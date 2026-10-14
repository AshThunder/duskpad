// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Operator tool for PUBLIC TEST networks (Preprod): run a headless wallet from a mnemonic file,
// report its balances, and optionally deploy + register tUSD the same way the in-app Setup page
// does (createUnprovenDeployTx + submitTxAsync, confirmed by polling the indexer).
//   tsx src/preprod-wallet.ts --mnemonic-file <path> [--expect mn_shield-addr_preprod1...] [--deploy-tusd] [--fee-key <hex>]
// The mnemonic is read from the file and never printed. Test funds only.
import { WebSocket } from 'ws';
(globalThis as any).WebSocket ??= WebSocket;
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pino from 'pino';
import * as Rx from 'rxjs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys, nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { FluentWalletBuilder, MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { deployTusd, pad32, waitForContract } from '@duskpad/sdk';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(k);
const wat = () => new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour12: false }) + ' WAT';
const log = (...a: unknown[]) => console.log(`[${wat()}]`, ...a);

const NET = 'preprod';
const env: any = {
  walletNetworkId: NET, networkId: NET,
  indexer: process.env.INDEXER_URL ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: process.env.INDEXER_WS_URL ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: process.env.NODE_URL ?? 'https://rpc.preprod.midnight.network',
  nodeWS: process.env.NODE_WS_URL ?? 'wss://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
  faucet: '',
};
setNetworkId(NET as any);

const file = arg('--mnemonic-file');
if (!file) { console.error('--mnemonic-file is required'); process.exit(2); }
const mnemonic = fs.readFileSync(file, 'utf8').trim().split(/\s+/).join(' ');

const silent = pino({ level: 'silent' });
const { wallet, seeds, keystore } = await FluentWalletBuilder.forEnvironment(env)
  .withDustOptions({ ledgerParams: LedgerParameters.initialParameters(), additionalFeeOverhead: 1_000n, feeBlocksMargin: 5 } as any)
  .withMnemonic(mnemonic)
  .buildWithoutStarting();
const zswap = ZswapSecretKeys.fromSeed(seeds.shielded);
const dust = DustSecretKey.fromSeed(seeds.dust);
await wallet.start(zswap, dust);
const provider = await MidnightWalletProvider.withWallet(silent, env, wallet, zswap, dust, keystore);
const st0: any = await Rx.firstValueFrom(wallet.state());
const shieldedAddress = MidnightBech32m.encode(NET, st0.shielded.address).asString();
log('shielded address', shieldedAddress);
const expect = arg('--expect');
if (expect && expect !== shieldedAddress) { log('ERROR: derived address does not match --expect; wrong derivation or wrong file'); process.exit(3); }

const complete = (p: any) => !!p && typeof p.isStrictlyComplete === 'function' && p.isStrictlyComplete();
const t0 = Date.now();
const tick = setInterval(async () => {
  const s: any = await Rx.firstValueFrom(wallet.state());
  log(`syncing ${Math.round((Date.now() - t0) / 1000)}s`, 'shielded', complete(s.shielded.state.progress), 'unshielded', complete(s.unshielded.progress), 'dust', complete(s.dust.state.progress));
}, 20_000);
const synced: any = await Rx.firstValueFrom(wallet.state().pipe(
  Rx.filter((s: any) => complete(s.shielded.state.progress) && complete(s.unshielded.progress) && complete(s.dust.state.progress))));
clearInterval(tick);
log('synced in', Math.round((Date.now() - t0) / 1000), 's ·',
  'tNIGHT', String(synced.unshielded?.balances[nativeToken().raw] ?? 0n),
  '· DUST', String(synced.dust?.balance(new Date()) ?? 0n), '· dust coins', synced.dust?.availableCoins.length ?? 0);

if (has('--deploy-tusd')) {
  const zkPath = path.resolve(import.meta.dirname, '../../../contracts/managed/tusd');
  const zk = new NodeZkConfigProvider(zkPath);
  const providers: any = {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: path.join(os.tmpdir(), 'duskpad-preprod-ps'), privateStateStoreName: 'tusd-ps', signingKeyStoreName: 'tusd-sk',
      privateStoragePasswordProvider: () => 'Qv7#mZ2!pLx9@tR4wK8$nB5^', accountId: keystore.getBech32Address().asString(),
    } as any),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: provider, midnightProvider: provider,
  };
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  log('deploying tUSD (async submit, then polling the indexer)');
  const r: any = await deployTusd(providers, pad32('duskpad:tUSD'), nonce, 100_000_000_000n, {
    mode: 'async', confirmTimeoutMs: 600_000, onStage: (s, i) => log('stage', s, i ? JSON.stringify(i) : ''),
  });
  log('tUSD', r.address, 'tx', r.txHash, 'confirmed', r.confirmed);
  const feeKey = arg('--fee-key');
  if (r.confirmed && feeKey) {
    const api = process.env.DUSKPAD_API ?? 'http://127.0.0.1:8787/api';
    const res = await fetch(`${api}/networks/${NET}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tusd: { address: r.address, domain: Buffer.from(pad32('duskpad:tUSD')).toString('hex'), faucetLimit: '100000000000' }, platform: { feeKey, defaultFeeBps: 250 } }) });
    log('registered with API', res.status, (await res.text()).slice(0, 300));
  }
  void waitForContract;
}
await wallet.stop().catch(() => {});
process.exit(0);
