// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Midnight.js wallet + midnight providers built ONLY from a DApp Connector v4 ConnectedAPI
// (1AM, Lace, or any compliant wallet). Shared by the web app and the e2e suite, so the e2e
// "W-*" tests exercise the exact code the browser runs.
//
// Wallets disagree on encodings, so everything coming out of a wallet is normalized here:
//  * getShieldedAddresses: the v4 spec says Bech32m for all three fields. Lace returns
//    mn_shield-cpk_<net>1… / mn_shield-epk_<net>1…; the testkit adapter (dev wallet) returns
//    raw hex. Midnight.js wants raw hex, so both forms are accepted, and the shielded address
//    itself (always Bech32m) is the fallback and the cross-check.
//  * balances: bigint (1AM, Lace), decimal strings (dev wallet over JSON) or numbers.
//    Token-type keys are lower-cased and stripped of any 0x prefix.
//  * submitTransaction: void (1AM, Lace, spec) or a tx id (some wallets).
import { CostModel, Transaction } from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import { fromHex, toHex } from './bytes.js';
import { parseShieldedAddress } from './address.js';

export interface ConnectorKeys { coinPublicKey: string; encryptionPublicKey: string }

/** The subset of ConnectedAPI that DuskPad needs to build, balance and submit transactions. */
export interface ConnectorLike {
  balanceUnsealedTransaction(tx: string, options?: unknown): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<unknown>;
  getProvingProvider?(keyMaterialProvider: unknown): Promise<unknown>;
}

const HEX32 = /^(0x)?[0-9a-f]{64}$/i;

/** Decode a 32-byte key given as hex or as Bech32m with the expected HRP kind ("shield-cpk" / "shield-epk"). */
export function decodeKey32(value: unknown, kind: 'shield-cpk' | 'shield-epk'): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (HEX32.test(v)) return v.replace(/^0x/i, '').toLowerCase();
  try {
    const d = bech32m.decode(v as `${string}1${string}`, false);
    if (!new RegExp(`^mn_${kind}_`).test(d.prefix)) return null;
    const b = Uint8Array.from(bech32m.fromWords(d.words));
    return b.length === 32 ? toHex(b) : null;
  } catch { return null; }
}

/**
 * Turn a wallet's getShieldedAddresses() result into the raw hex keys Midnight.js expects.
 * Throws if the wallet's fields disagree with its own shielded address.
 */
export function normalizeShieldedKeys(sh: { shieldedAddress: string; shieldedCoinPublicKey?: unknown; shieldedEncryptionPublicKey?: unknown }): ConnectorKeys & { network: string | null } {
  let fromAddr: { coinPublicKey: string; encryptionPublicKey: string; network: string } | null = null;
  try { fromAddr = parseShieldedAddress(sh.shieldedAddress); } catch { fromAddr = null; }
  const cpk = decodeKey32(sh.shieldedCoinPublicKey, 'shield-cpk') ?? fromAddr?.coinPublicKey ?? null;
  const epk = decodeKey32(sh.shieldedEncryptionPublicKey, 'shield-epk') ?? fromAddr?.encryptionPublicKey ?? null;
  if (!cpk || !epk) throw new Error('The wallet did not return usable shielded keys.');
  if (fromAddr && (fromAddr.coinPublicKey !== cpk || fromAddr.encryptionPublicKey !== epk)) {
    throw new Error('The wallet returned shielded keys that do not match its shielded address.');
  }
  return { coinPublicKey: cpk, encryptionPublicKey: epk, network: fromAddr?.network ?? null };
}

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  if (v && typeof v === 'object' && '__bigint' in (v as any)) return BigInt((v as any).__bigint);
  return 0n;
};

/** Normalize a token balance record (bigint | string | number values; any-case, optional 0x keys). */
export function normalizeBalances(rec: unknown): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  if (!rec || typeof rec !== 'object') return out;
  for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
    const key = k.replace(/^0x/i, '').toLowerCase();
    out[key] = (out[key] ?? 0n) + toBig(v);
  }
  return out;
}

/** Look up a token balance by raw color; tolerates wallets that prefix the token type with a tag. */
export function balanceOf(balances: Record<string, bigint> | undefined, color: string): bigint {
  if (!balances) return 0n;
  const c = color.replace(/^0x/i, '').toLowerCase();
  if (c in balances) return balances[c];
  for (const [k, v] of Object.entries(balances)) if (k.length > 64 && k.endsWith(c)) return v;
  return 0n;
}

/** Dust balance from getDustBalance(): `{ balance, cap }` (spec) or a bare number. */
export function normalizeDust(d: unknown): { balance: bigint; cap: bigint | null } | null {
  if (d == null) return null;
  if (typeof d === 'object' && 'balance' in (d as any)) {
    const cap = (d as any).cap;
    return { balance: toBig((d as any).balance), cap: cap == null ? null : toBig(cap) };
  }
  return { balance: toBig(d), cap: null };
}

export function connectorWalletProviders(api: ConnectorLike, keys: ConnectorKeys) {
  return {
    walletProvider: {
      getCoinPublicKey: () => keys.coinPublicKey,
      getEncryptionPublicKey: () => keys.encryptionPublicKey,
      balanceTx: async (tx: any) => {
        // 1AM routes this through ProofStation, which adds the DUST fee (sponsorship);
        // Lace and the dev wallet pay it from the user's own DUST.
        const r = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
        if (!r?.tx || typeof r.tx !== 'string') throw new Error('wallet returned no transaction');
        return Transaction.deserialize('signature', 'proof', 'binding', fromHex(r.tx));
      },
    },
    midnightProvider: {
      submitTx: async (tx: any) => {
        const r: any = await api.submitTransaction(toHex(tx.serialize()));
        // The spec returns void. The identifier of the finalized tx is what the indexer reports.
        const own = tx.identifiers()[0];
        if (own) return own;
        if (typeof r === 'string' && r) return r;
        return r?.transactionId ?? r?.txId ?? r?.id ?? own;
      },
    },
  };
}

/**
 * Ask the wallet to prove (1AM proves in-extension or via ProofStation; newer Lace builds proxy to
 * the proof server configured in Lace). Returns null if unsupported.
 * Uses `tx.prove(provingProvider, CostModel.initialCostModel())` directly, the only pattern
 * confirmed to work with 1AM's provingProvider (createProofProvider does not pass the CostModel).
 */
export async function connectorProofProvider(api: ConnectorLike, zkConfigProvider: unknown) {
  if (typeof api.getProvingProvider !== 'function') return null;
  const pp = await api.getProvingProvider(zkConfigProvider);
  if (!pp) return null;
  return { proveTx: (tx: any) => tx.prove(pp, CostModel.initialCostModel()) };
}

/** True for errors that mean "the user said no", which must never trigger a silent fallback. */
export function isRejection(e: unknown): boolean {
  let x: any = e;
  for (let i = 0; x && i < 5; i++) {
    if (x.code === 'Rejected' || x.code === -3 || x.code === 'Disconnected') return true;
    if (/reject|denied|cancel/i.test(String(x.message ?? x.reason ?? ''))) return true;
    x = x.cause;
  }
  return false;
}

/**
 * Prove with the wallet first and fall back to a proof server if the wallet's prover fails for a
 * technical reason (unsupported circuit size, 1AM's 5-minute request timeout, extension restart).
 * A user rejection is re-thrown unchanged.
 */
export function proofProviderWithFallback(primary: { proveTx: (tx: any, cfg?: any) => Promise<any> } | null,
  fallback: () => { proveTx: (tx: any, cfg?: any) => Promise<any> }, onFallback?: (e: unknown) => void) {
  if (!primary) return fallback();
  return {
    proveTx: async (tx: any, cfg?: any) => {
      try { return await primary.proveTx(tx, cfg); }
      catch (e) {
        if (isRejection(e)) throw e;
        onFallback?.(e);
        return fallback().proveTx(tx, cfg);
      }
    },
  };
}
