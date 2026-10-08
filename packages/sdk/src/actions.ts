// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Transaction helpers built on Midnight.js 4.1.1. They are provider-agnostic: the same code
// runs in Node (headless wallet, e2e suite) and in the browser (1AM / Lace / dev wallet via
// the DApp Connector API). Every call reports real pipeline stages through `onStage`, which
// the UI turns into the "what's happening privately" stepper.
import { CompiledContract as CC } from '@midnight-ntwrk/compact-js';
// The compiled-contract generics are narrower than our dynamic witness objects; use it untyped.
const CompiledContract: any = CC;
import { createUnprovenDeployTx, deployContract, submitCallTx, submitTxAsync } from '@midnight-ntwrk/midnight-js-contracts';
import * as Sale from '@duskpad/contracts/sale';
import * as Tusd from '@duskpad/contracts/tusd';
import { saleWitnesses, type SaleIntent } from './sale.js';

export type Stage = 'execute' | 'prove' | 'balance' | 'submit' | 'confirm' | 'done';
export type StageListener = (stage: Stage, info?: Record<string, unknown>) => void;

export interface TxOptions {
  onStage?: StageListener;
  /** Coin public key (hex) -> encryption public key (hex), required when a contract pays a non-caller. */
  coinKeyMappings?: Map<string, string>;
  /** 'async' deploys: how long to poll the indexer for the new contract (default 5 minutes). */
  confirmTimeoutMs?: number;
}

export interface TxResult { txHash: string; blockHeight?: number; status?: string }

/** Wrap providers so the real proving / balancing / submission steps emit stage events. */
export function instrument<P extends Record<string, any>>(providers: P, onStage?: StageListener): P {
  if (!onStage) return providers;
  const proofProvider = {
    ...providers.proofProvider,
    proveTx: async (tx: any, cfg?: any) => {
      onStage('prove');
      return providers.proofProvider.proveTx(tx, cfg);
    },
  };
  const walletProvider = {
    ...providers.walletProvider,
    getCoinPublicKey: () => providers.walletProvider.getCoinPublicKey(),
    getEncryptionPublicKey: () => providers.walletProvider.getEncryptionPublicKey(),
    balanceTx: async (tx: any, ttl?: any) => {
      onStage('balance');
      return providers.walletProvider.balanceTx(tx, ttl);
    },
  };
  const midnightProvider = {
    ...providers.midnightProvider,
    submitTx: async (tx: any) => {
      onStage('submit');
      const id = await providers.midnightProvider.submitTx(tx);
      onStage('confirm', { txId: id });
      return id;
    },
  };
  return { ...providers, proofProvider, walletProvider, midnightProvider };
}

export function compiledSale(intent: SaleIntent, assetsPath = 'zk/sale') {
  return CompiledContract.withCompiledFileAssets(
    CompiledContract.withWitnesses(CompiledContract.make('sale', Sale.Contract as any), saleWitnesses(intent) as any),
    assetsPath,
  ) as any;
}

export function compiledTusd(assetsPath = 'zk/tusd') {
  return CompiledContract.withCompiledFileAssets(
    CompiledContract.withVacantWitnesses(CompiledContract.make('tusd', Tusd.Contract as any)),
    assetsPath,
  ) as any;
}

export type DeployMode = 'wait' | 'async';

/**
 * Deploy a contract. 'wait' blocks until the indexer sees it (fine locally); 'async' returns
 * as soon as the wallet accepted the transaction (recommended on Preprod, where the
 * indexer can lag behind).
 */
/** Poll the indexer until a contract exists at `address` (true) or the timeout passes (false). */
export async function waitForContract(publicDataProvider: any, address: string, timeoutMs = 300_000, everyMs = 4_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { if (await publicDataProvider.queryContractState(address)) return true; } catch { /* indexer hiccup: keep polling */ }
    if (Date.now() + everyMs > until) return false;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function deploy(providers: any, compiledContract: any, args: unknown[], mode: DeployMode, opts: TxOptions) {
  const p = instrument(providers, opts.onStage);
  opts.onStage?.('execute');
  if (mode === 'wait') {
    const r: any = await deployContract(p, { compiledContract, args } as any);
    opts.onStage?.('done');
    return { address: r.deployTxData.public.contractAddress as string, txHash: r.deployTxData.public.txHash as string, blockHeight: r.deployTxData.public.blockHeight as number };
  }
  const { sampleSigningKey } = await import('@midnight-ntwrk/compact-runtime');
  const data: any = await createUnprovenDeployTx(p, { compiledContract, args, signingKey: sampleSigningKey() } as any);
  const txHash = await submitTxAsync(p, { unprovenTx: data.private.unprovenTx } as any);
  const address = data.public.contractAddress as string;
  // Confirm by polling contract state instead of Midnight.js' deploy watcher (which can hang on
  // public networks). A timeout is not fatal: the transaction is already submitted.
  opts.onStage?.('confirm', { txHash: String(txHash) });
  const confirmed = await waitForContract(p.publicDataProvider, address, opts.confirmTimeoutMs ?? 300_000);
  opts.onStage?.('done', { txHash: String(txHash) });
  return { address, txHash: String(txHash), confirmed };
}

export async function deploySale(providers: any, params: Sale.SaleParams, adminSecret: Uint8Array,
  opts: TxOptions & { mode?: DeployMode; assetsPath?: string } = {}) {
  return deploy(providers, compiledSale({ adminSecret }, opts.assetsPath), [params], opts.mode ?? 'wait', opts);
}

export async function deployTusd(providers: any, domain: Uint8Array, nonceSeed: Uint8Array, maxPerMint: bigint,
  opts: TxOptions & { mode?: DeployMode; assetsPath?: string } = {}) {
  return deploy(providers, compiledTusd(opts.assetsPath), [domain, nonceSeed, maxPerMint], opts.mode ?? 'wait', opts);
}

async function call(providers: any, compiledContract: any, contractAddress: string, circuitId: string, args: unknown[], opts: TxOptions): Promise<TxResult> {
  const p = instrument(providers, opts.onStage);
  opts.onStage?.('execute', { circuitId });
  const r: any = await submitCallTx(p, {
    compiledContract, contractAddress, circuitId, args,
    ...(opts.coinKeyMappings ? { additionalCoinEncPublicKeyMappings: opts.coinKeyMappings } : {}),
  } as any);
  opts.onStage?.('done', { txHash: r.public.txHash });
  return { txHash: r.public.txHash, blockHeight: r.public.blockHeight, status: String(r.public.status) };
}

export type SaleCircuit = 'buyTicket' | 'finalize' | 'claim' | 'refund' | 'withdraw' | 'collectFee';

export function callSale(providers: any, address: string, intent: SaleIntent, circuit: SaleCircuit, args: unknown[],
  opts: TxOptions & { assetsPath?: string } = {}) {
  return call(providers, compiledSale(intent, opts.assetsPath), address, circuit, args, opts);
}

export function callTusd(providers: any, address: string, circuit: 'mint' | 'mintTo', args: unknown[],
  opts: TxOptions & { assetsPath?: string } = {}) {
  return call(providers, compiledTusd(opts.assetsPath), address, circuit, args, opts);
}

/** A fresh payment coin of exactly `value`; the wallet balances it from the buyer's shielded tUSD. */
export function paymentCoin(color: Uint8Array, value: bigint) {
  const nonce = new Uint8Array(32);
  globalThis.crypto.getRandomValues(nonce);
  return { nonce, color, value };
}

export async function readSaleLedger(publicDataProvider: any, address: string): Promise<Sale.Ledger | null> {
  const st = await publicDataProvider.queryContractState(address);
  return st ? Sale.ledger(st.data) : null;
}

export async function readTusdLedger(publicDataProvider: any, address: string): Promise<Tusd.Ledger | null> {
  const st = await publicDataProvider.queryContractState(address);
  return st ? Tusd.ledger(st.data) : null;
}

/** Turn wallet / runtime errors into a short, human sentence. */
export function explainError(e: unknown): string {
  const parts: string[] = [];
  let x: any = e;
  for (let i = 0; x && i < 5; i++) {
    // DApp Connector errors carry { code, reason } (1AM: code 'Rejected'; Lace: ErrorCodes.Rejected).
    if (x.code === 'Rejected' || x.code === -3) return 'The wallet rejected the request.';
    parts.push(String(x.message ?? x.reason ?? x.info ?? x));
    x = x.cause;
  }
  const all = parts.join(' | ');
  const known: [RegExp, string][] = [
    [/failed assert: ([^|\n]+)/i, '$1'],
    [/Unable to resolve encryption public key/i, 'The payout address is missing its encryption key.'],
    [/BalanceCheckOverspend|\b138\b.*dust|could not balance dust|insufficient.*dust|Not enough dust/i, 'Your wallet has no spendable DUST for fees yet.'],
    [/insufficient (funds|balance)|Insufficient/i, 'Not enough shielded tUSD in this wallet.'],
    [/rejected|denied|cancel/i, 'The wallet rejected the request.'],
    [/Request timed out/i, 'The wallet did not answer within 5 minutes. Check the extension popup and try again.'],
    [/Payload too large/i, 'The transaction is too large for the wallet extension to accept.'],
    [/No account is connected|Please reconnect|disconnected/i, 'The wallet disconnected. Reconnect it and try again.'],
    [/Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED/i, 'A network service could not be reached (proof server, indexer or node). Check that it is running.'],
  ];
  for (const [re, msg] of known) {
    const m = all.match(re);
    if (m) return msg.replace('$1', (m[1] ?? '').trim());
  }
  return parts[0]?.split('\n')[0]?.slice(0, 300) ?? 'Unknown error';
}
