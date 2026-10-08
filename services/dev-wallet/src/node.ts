// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Node-side helpers shared by the dev-wallet bridge, the bootstrap script and the e2e suite:
// headless wallets (testkit-js + wallet-sdk), funding, DUST registration and Midnight.js
// providers. Local undeployed network only.
import { WebSocket } from 'ws';
(globalThis as any).WebSocket ??= WebSocket;
import { createHash } from 'node:crypto';
import path from 'node:path';
import pino from 'pino';
import * as Rx from 'rxjs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys, nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { FluentWalletBuilder, MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

export const env: any = {
  walletNetworkId: 'undeployed',
  networkId: 'undeployed',
  indexer: process.env.INDEXER_URL ?? 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: process.env.INDEXER_WS_URL ?? 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: process.env.NODE_URL ?? 'http://127.0.0.1:9944',
  nodeWS: process.env.NODE_WS_URL ?? 'ws://127.0.0.1:9944',
  proofServer: process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
  faucet: '',
};
setNetworkId('undeployed');

export const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
export const seedOf = (name: string) => createHash('sha256').update('duskpad-dev-' + name).digest('hex');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const wat = () => new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour12: false }) + ' WAT';
export const log = (...a: unknown[]) => console.log(`[${wat()}]`, ...a);

const silent = pino({ level: 'silent' });

export interface Wallet {
  name: string;
  provider: any; // MidnightWalletProvider
  wallet: any;
  zswap: any;
  dust: any;
  keystore: any;
  shieldedAddress: string;
  unshieldedAddress: string;
}

const complete = (p: any) => !!p && typeof p.isStrictlyComplete === 'function' && p.isStrictlyComplete();

export async function buildWallet(name: string, seed: string): Promise<Wallet> {
  const { wallet, seeds, keystore } = await FluentWalletBuilder.forEnvironment(env)
    .withDustOptions({ ledgerParams: LedgerParameters.initialParameters(), additionalFeeOverhead: 1_000n, feeBlocksMargin: 5 } as any)
    .withSeed(seed)
    .buildWithoutStarting();
  const zswap = ZswapSecretKeys.fromSeed(seeds.shielded);
  const dust = DustSecretKey.fromSeed(seeds.dust);
  await wallet.start(zswap, dust);
  const provider = await MidnightWalletProvider.withWallet(silent, env, wallet, zswap, dust, keystore);
  const st: any = await Rx.firstValueFrom(wallet.state());
  const shieldedAddress = MidnightBech32m.encode('undeployed', st.shielded.address).asString();
  const unshieldedAddress = keystore.getBech32Address().asString();
  return { name, provider, wallet, zswap, dust, keystore, shieldedAddress, unshieldedAddress };
}

export async function waitSynced(w: Wallet, timeout = 600_000) {
  await Rx.firstValueFrom(w.wallet.state().pipe(
    Rx.filter((s: any) => complete(s.shielded.state.progress) && complete(s.unshielded.progress) && complete(s.dust.state.progress)),
    Rx.timeout({ each: timeout, with: () => Rx.throwError(() => new Error(`${w.name} sync timeout`)) }),
  ));
}

export const walletState = (w: Wallet): Promise<any> => Rx.firstValueFrom(w.wallet.state());

export async function balances(w: Wallet) {
  await waitSynced(w);
  const s: any = await walletState(w);
  return {
    night: (s.unshielded?.balances[nativeToken().raw] ?? 0n) as bigint,
    shielded: { ...(s.shielded?.balances ?? {}) } as Record<string, bigint>,
    dust: (s.dust?.balance(new Date()) ?? 0n) as bigint,
    dustCoins: (s.dust?.availableCoins.length ?? 0) as number,
  };
}

export async function waitFor(w: Wallet, pred: (s: any) => boolean, label: string, timeout = 300_000) {
  return Rx.firstValueFrom(w.wallet.state().pipe(
    Rx.filter((s: any) => { try { return pred(s); } catch { return false; } }),
    Rx.timeout({ each: timeout, with: () => Rx.throwError(() => new Error(`${label} timed out`)) }),
  ));
}

export async function shieldedBalance(w: Wallet, color: string): Promise<bigint> {
  return (await balances(w)).shielded[color] ?? 0n;
}

/** Wait until a shielded balance equals `expected`; returns the last seen value on timeout. */
export async function waitShielded(w: Wallet, color: string, expected: bigint, timeout = 120_000): Promise<bigint> {
  try {
    await waitFor(w, (s) => (s.shielded?.balances?.[color] ?? 0n) === expected, `${w.name} balance`, timeout);
    return expected;
  } catch { return shieldedBalance(w, color); }
}

/** One multi-output tNIGHT transfer (sequential genesis transfers raced into "Custom error: 170"). */
export async function transferNight(from: Wallet, to: string[], amount: bigint) {
  const { UnshieldedAddress } = await import('@midnight-ntwrk/wallet-sdk');
  const outputs = to.map((a) => ({ type: nativeToken().raw, receiverAddress: (UnshieldedAddress as any).codec.decode('undeployed', MidnightBech32m.parse(a)), amount }));
  for (let i = 0; ; i++) {
    try {
      const recipe = await from.wallet.transferTransaction(
        [{ type: 'unshielded', outputs }],
        { shieldedSecretKeys: from.zswap, dustSecretKey: from.dust },
        { ttl: new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signed = await from.wallet.signRecipe(recipe, (p: any) => from.keystore.signData(p));
      const fin = await from.wallet.finalizeRecipe(signed);
      return await from.wallet.submitTransaction(fin);
    } catch (e: any) {
      if (/could not balance dust/i.test(String(e?.message)) && i < 40) { await sleep(5000); continue; }
      throw e;
    }
  }
}

export async function registerDust(w: Wallet) {
  await waitSynced(w);
  const s: any = await walletState(w);
  const utxos = s.unshielded.availableCoins.filter((c: any) => c.meta.registeredForDustGeneration === false);
  if (utxos.length) {
    const recipe = await w.wallet.registerNightUtxosForDustGeneration(utxos, w.keystore.getPublicKey(), (p: any) => w.keystore.signData(p));
    const fin = await w.wallet.finalizeRecipe(recipe);
    await w.wallet.submitTransaction(fin);
  }
  await waitFor(w, (st) => (st.dust?.availableCoins.length ?? 0) >= 1, `${w.name} spendable dust`, 300_000);
}

/** Fund wallets that have neither NIGHT nor DUST from genesis, then register DUST for all. */
export async function ensureFunded(genesis: Wallet, wallets: Wallet[], amount = 1_000_000_000n) {
  const need: Wallet[] = [];
  for (const w of wallets) {
    const b = await balances(w);
    if (b.dustCoins < 1 && b.night === 0n) need.push(w);
  }
  if (need.length) {
    await transferNight(genesis, need.map((w) => w.unshieldedAddress), amount);
    log(`funded ${need.map((w) => w.name).join(', ')} with tNIGHT`);
  }
  for (const w of wallets) {
    const b = await balances(w);
    if (b.dustCoins < 1) {
      await waitFor(w, (s) => Object.values(s.unshielded?.balances ?? {}).some((v: any) => v > 0n), `${w.name} funds`);
      await registerDust(w);
    }
  }
}

const PS_PASSWORD = 'Qv7#mZ2!pLx9@tR4wK8$nB5^'; // local dev store only; must not contain sequences

export function nodeProviders(w: Wallet, zkPath: string, storeDir: string, tag: string) {
  const zk = new NodeZkConfigProvider(zkPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: path.join(storeDir, `${w.name}-${tag}`),
      privateStateStoreName: `${tag}-ps`,
      signingKeyStoreName: `${tag}-sk`,
      privateStoragePasswordProvider: () => PS_PASSWORD,
      accountId: w.unshieldedAddress,
    } as any),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: w.provider,
    midnightProvider: w.provider,
  } as any;
}

export async function stopAll(ws: Wallet[]) {
  await Promise.all(ws.map((w) => w.wallet.stop().catch(() => {})));
}
