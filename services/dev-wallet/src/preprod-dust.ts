// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Operator tool for PUBLIC TEST networks (Preprod): inspect a wallet's NIGHT UTXOs / DUST registration and
// optionally register unregistered NIGHT UTXOs for DUST generation to the wallet's own dust address.
//   tsx src/preprod-dust.ts --mnemonic-file <path> [--register] [--watch-min N]
// The mnemonic is read from the file and never printed. Test funds only.
import { WebSocket } from 'ws';
(globalThis as any).WebSocket ??= WebSocket;
import fs from 'node:fs';
import * as Rx from 'rxjs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys, nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(k);
const wat = (d = new Date()) => d.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour12: false }) + ' WAT';
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

const { wallet, seeds, keystore } = await FluentWalletBuilder.forEnvironment(env)
  .withDustOptions({ ledgerParams: LedgerParameters.initialParameters(), additionalFeeOverhead: 1_000n, feeBlocksMargin: 5 } as any)
  .withMnemonic(mnemonic)
  .buildWithoutStarting();
const zswap = ZswapSecretKeys.fromSeed(seeds.shielded);
const dustSk = DustSecretKey.fromSeed(seeds.dust);
const stop = async (code: number) => { await wallet.stop().catch(() => {}); process.exit(code); };
process.on('SIGINT', () => void stop(130));
process.on('SIGTERM', () => void stop(143));
await wallet.start(zswap, dustSk);

const complete = (p: any) => !!p && typeof p.isStrictlyComplete === 'function' && p.isStrictlyComplete();
const isSynced = (s: any) => complete(s.shielded.state.progress) && complete(s.unshielded.progress) && complete(s.dust.state.progress);
const t0 = Date.now();
const tick = setInterval(async () => {
  const s: any = await Rx.firstValueFrom(wallet.state());
  log(`syncing ${Math.round((Date.now() - t0) / 1000)}s`, 'shielded', complete(s.shielded.state.progress), 'unshielded', complete(s.unshielded.progress), 'dust', complete(s.dust.state.progress));
}, 30_000);
let st: any = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter(isSynced)));
clearInterval(tick);
log('synced in', Math.round((Date.now() - t0) / 1000), 's');

const night = nativeToken().raw;
const report = (s: any, label: string) => {
  const now = new Date();
  log(`--- ${label} ---`);
  log('unshielded address', keystore.getBech32Address().asString());
  log('shielded address  ', MidnightBech32m.encode(NET, s.shielded.address).asString());
  log('dust address      ', MidnightBech32m.encode(NET, s.dust.address).asString());
  log('unshielded balances', JSON.stringify(Object.fromEntries(Object.entries(s.unshielded.balances).map(([k, v]) => [k === night ? 'NIGHT' : k, String(v)]))));
  const fmt = (c: any) => ({ type: c.utxo.type === night ? 'NIGHT' : c.utxo.type, value: String(c.utxo.value), intentHash: c.utxo.intentHash, outputNo: c.utxo.outputNo, owner: c.utxo.owner, ctime: wat(new Date(c.meta.ctime)), registeredForDustGeneration: c.meta.registeredForDustGeneration });
  log('available UTXOs', JSON.stringify(s.unshielded.availableCoins.map(fmt), null, 1));
  log('pending UTXOs', JSON.stringify(s.unshielded.pendingCoins.map(fmt), null, 1));
  log('DUST balance (specks)', String(s.dust.balance(now)), '· available dust coins', s.dust.availableCoins.length, '· pending dust coins', s.dust.pendingCoins.length);
  for (const d of s.dust.availableCoins) log('dust coin', JSON.stringify(d, (_k, v) => typeof v === 'bigint' ? String(v) : v instanceof Date ? wat(v) : v));
  try {
    const est = s.dust.estimateDustGeneration(s.unshielded.availableCoins.filter((c: any) => c.utxo.type === night), now);
    log('dust generation estimate', JSON.stringify(est, (_k, v) => typeof v === 'bigint' ? String(v) : v instanceof Date ? wat(v) : v).slice(0, 2000));
  } catch (e) { log('estimate failed', String(e)); }
};
report(st, 'synced state');

if (has('--register')) {
  const unregistered = st.unshielded.availableCoins.filter((c: any) => c.utxo.type === night && c.meta.registeredForDustGeneration === false);
  if (unregistered.length === 0) {
    log('nothing to register: no unregistered NIGHT UTXOs');
  } else {
    try {
      const est = await wallet.estimateRegistration(unregistered);
      log('registration fee estimate (specks)', String(est.fee));
    } catch (e) { log('estimateRegistration failed', String(e)); }
    log(`registering ${unregistered.length} NIGHT UTXO(s) to own dust address`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), (p: Uint8Array) => keystore.signData(p), st.dust.address);
    log('proving via', env.proofServer);
    const finalized = await wallet.finalizeRecipe(recipe);
    const txId = await wallet.submitTransaction(finalized);
    log('SUBMITTED registration tx', String(txId), 'at', wat());
    try { log('tx hash', String((finalized as any).transactionHash())); } catch { /* older ledger builds */ }
  }
}

const watchMin = Number(arg('--watch-min') ?? (has('--register') ? 8 : 0));
if (watchMin > 0) {
  const end = Date.now() + watchMin * 60_000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 30_000));
    const s: any = await Rx.firstValueFrom(wallet.state());
    const regs = s.unshielded.availableCoins.map((c: any) => `${String(c.utxo.value)}:${c.meta.registeredForDustGeneration}`).join(',');
    const line = `NIGHT avail=[${regs}] pending=${s.unshielded.pendingCoins.length} DUST=${String(s.dust.balance(new Date()))} dustCoins=${s.dust.availableCoins.length}/${s.dust.pendingCoins.length}`;
    log(line);
  }
  st = await Rx.firstValueFrom(wallet.state());
  report(st, 'after watch');
}
await stop(0);
