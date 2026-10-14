// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Seeds DuskPad's Explore page on Midnight Preprod with showcase sales (open, upcoming, succeeded,
// refunding) from a project wallet, with purchases from separate buyer wallets. Resumable: progress and secrets go to SHOWCASE_STATE.
//   BLOCKFROST_PROJECT_ID=... tsx e2e/src/showcase.ts --mnemonic-file <project seed> --funder-file <seed that funds buyers> --platform-file <file> [--buyers 4] [--only a,b]
import { WebSocket } from 'ws';
(globalThis as any).WebSocket ??= WebSocket;
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import * as Rx from 'rxjs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { FluentWalletBuilder, MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  adminKeyOf, callSale, callTusd, credentialFromJSON, deploySale, deriveAdminSecret, deriveHolderSecret, derivePlatformSecret,
  deriveReceiptSecret, explainError, pointOf, scalarFrom, fromHex, holderCommitment, pad32, paymentCoin, random32, readSale, readSaleLedger, toHex, toSaleParams,
  type SaleInput,
} from '@duskpad/sdk';
import { SALE_ZK, TUSD_ZK } from '@duskpad/contracts/paths';
import { env, log, nodeProviders, sleep, type Wallet } from '@duskpad/dev-wallet/node';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const NET = 'preprod';
const HOSTED = process.env.DUSKPAD_HOSTED ?? 'https://duskpad.vercel.app/api';
const LOCAL_REG = path.resolve(import.meta.dirname, '../../services/api/data/registry.json');
const STATE = process.env.SHOWCASE_STATE ?? '/workspace/duskpad-wallets/showcase-state.json';
const STORE = process.env.SHOWCASE_STORE ?? '/workspace/duskpad-wallets/showcase-store';
const U = 1_000_000n;
const now = () => Math.floor(Date.now() / 1000);
const wat = (s: number) => new Date(s * 1000).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' WAT';
Object.assign(env, { walletNetworkId: NET, networkId: NET });
// Preprod defaults: Blockfrost indexer (project id in the query string so HTTP and WebSocket both carry it) and Midnight's RPC.
const BF = process.env.BLOCKFROST_PROJECT_ID;
if (!process.env.INDEXER_URL) { if (!BF) throw new Error('Set BLOCKFROST_PROJECT_ID'); env.indexer = `https://midnight-preprod.blockfrost.io/api/v0?project_id=${BF}`; env.indexerWS = `wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=${BF}`; }
if (!process.env.NODE_URL) { env.node = 'https://rpc.preprod.midnight.network'; env.nodeWS = 'wss://rpc.preprod.midnight.network'; }
setNetworkId(NET as any);
fs.mkdirSync(STORE, { recursive: true });

// ---- state ----
// Each wallet runs in its own process (--role project | funder | buyer1..N) because a fresh Preprod wallet replays
// ~1.6M DUST events on one CPU thread. Roles coordinate through their state files.
const ROLE = arg('--role') ?? 'project';
const fileOf = (role: string) => (role === 'project' ? STATE : STATE.replace(/\.json$/, `-${role}.json`));
const peek = (role: string): any => { try { return JSON.parse(fs.readFileSync(fileOf(role), 'utf8')); } catch { return {}; } };
const until = async (cond: () => boolean, what: string) => { let n = 0; while (!cond()) { if (n++ % 20 === 0) log(`${ROLE} waiting for ${what}`); await sleep(30_000); } };
const MY = fileOf(ROLE);
const S: any = fs.existsSync(MY) ? JSON.parse(fs.readFileSync(MY, 'utf8')) : { sales: {}, holders: {}, done: {} };
const save = () => fs.writeFileSync(MY, JSON.stringify(S, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2), { mode: 0o600 });
async function step(key: string, fn: () => Promise<unknown>) {
  if (S.done[key]) return;
  for (let i = 1; ; i++) {
    try { log('>>', key); await fn(); S.done[key] = new Date().toISOString(); save(); log('ok', key); return; }
    catch (e) { const m = `${explainError(e)} | ${String((e as any)?.message ?? e).slice(0, 300)}`; log(`FAIL ${key} (try ${i}):`, m); if (i >= 3) throw e; await sleep(20_000); }
  }
}

// ---- config ----
const net = await (await fetch(`${HOSTED}/networks/${NET}`)).json();
const TC: string = net.tusd.color;
const issuerPk = { x: BigInt(net.issuer.publicKey.x), y: BigInt(net.issuer.publicKey.y) };
const platform = JSON.parse(fs.readFileSync(arg('--platform-file')!, 'utf8'));
const PLATFORM_SECRET = derivePlatformSecret(fromHex(platform.platformMaster));
if (toHex(adminKeyOf(PLATFORM_SECRET)) !== net.platform.feeKey) throw new Error('platform file does not match hosted fee key');
if (ROLE === 'project') S.projectMaster ??= toHex(random32()); else { await until(() => !!peek('project').projectMaster, 'project master'); S.projectMaster = peek('project').projectMaster; }
save();
const PROJECT_MASTER = fromHex(S.projectMaster);

// ---- wallets: project/platform (1AM seed), funder (Lace seed), and separate buyer wallets ----
import { nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk';
import { createHash } from 'node:crypto';
const complete = (p: any) => !!p && typeof p.isStrictlyComplete === 'function' && p.isStrictlyComplete();
async function openWallet(name: string, o: { mnemonic?: string; seed?: string }): Promise<Wallet> {
  let b: any = FluentWalletBuilder.forEnvironment(env)
    .withDustOptions({ ledgerParams: LedgerParameters.initialParameters(), additionalFeeOverhead: 1_000n, feeBlocksMargin: 5 } as any);
  b = o.mnemonic ? b.withMnemonic(o.mnemonic) : b.withSeed(o.seed);
  const { wallet, seeds, keystore } = await b.buildWithoutStarting();
  const zswap = ZswapSecretKeys.fromSeed(seeds.shielded); const dust = DustSecretKey.fromSeed(seeds.dust);
  await wallet.start(zswap, dust);
  const provider = await MidnightWalletProvider.withWallet(pino({ level: 'silent' }), env, wallet, zswap, dust, keystore);
  const st0: any = await Rx.firstValueFrom(wallet.state());
  return { name, provider, wallet, zswap, dust, keystore,
    shieldedAddress: MidnightBech32m.encode(NET, st0.shielded.address).asString(), unshieldedAddress: keystore.getBech32Address().asString() };
}
const state = (w: Wallet): Promise<any> => Rx.firstValueFrom(w.wallet.state());
async function synced(w: Wallet) {
  const t0 = Date.now();
  const tick = setInterval(async () => { const s = await state(w); const pr = (p: any) => { const o: any = {}; for (const k of Object.keys(p ?? {})) if (typeof p[k] !== 'function') o[k] = String(p[k]); return JSON.stringify(o); };
    log(`${w.name} syncing ${Math.round((Date.now() - t0) / 1000)}s shielded ${pr(s.shielded.state.progress)} dust ${pr(s.dust.state.progress)}`); }, 60_000);
  await Rx.firstValueFrom(w.wallet.state().pipe(Rx.filter((s: any) => complete(s.shielded.state.progress) && complete(s.unshielded.progress) && complete(s.dust.state.progress))));
  clearInterval(tick); log(`${w.name} synced in ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(await bal(w), (_, v) => typeof v === 'bigint' ? v.toString() : v));
}
const bal = async (w: Wallet) => { const s = await state(w); return { night: (s.unshielded.balances[nativeToken().raw] ?? 0n) as bigint, tusd: (s.shielded.balances[TC] ?? 0n) as bigint, dust: s.dust.balance(new Date()) as bigint, dustCoins: s.dust.availableCoins.length as number }; };
const waitFor = async (w: Wallet, pred: (s: any) => boolean, what: string, ms = 1_800_000) => {
  await Rx.firstValueFrom(w.wallet.state().pipe(Rx.filter(pred), Rx.timeout(ms))).catch(() => { throw new Error(`timeout waiting for ${what}`); });
};
const readMn = (f: string) => fs.readFileSync(f, 'utf8').trim().split(/\s+/).join(' ');
const BUYERS = Number(arg('--buyers') ?? 3);
const buyerSeed = (i: number) => createHash('sha256').update(`duskpad-showcase-buyer-${i}:${S.projectMaster}`).digest('hex');
async function buyerAddress(i: number) {
  const { keystore } = await (FluentWalletBuilder.forEnvironment(env) as any).withSeed(buyerSeed(i)).buildWithoutStarting();
  return keystore.getBech32Address().asString() as string;
}
const BN = /^buyer(\d+)$/.exec(ROLE) ? Number(/^buyer(\d+)$/.exec(ROLE)![1]) : 0;
let W: Wallet = null as any;
if (ROLE === 'project') { W = await openWallet('project', { mnemonic: readMn(arg('--mnemonic-file')!) }); await synced(W); }

if (ROLE === 'funder') {
  const FUNDER = await openWallet('funder', { mnemonic: readMn(arg('--funder-file')!) });
  await synced(FUNDER);
  await step('fund-buyers', async () => {
    const to = [] as string[]; for (let i = 1; i <= BUYERS; i++) to.push(await buyerAddress(i));
    const FUND_EACH = (await bal(FUNDER)).night / BigInt(BUYERS + 1);
    log('sending each buyer', String(FUND_EACH), 'tNIGHT base units');
    const outputs = to.map((a) => ({ type: nativeToken().raw, amount: FUND_EACH, receiverAddress: (UnshieldedAddress as any).codec.decode(NET, MidnightBech32m.parse(a)) }));
    for (let t = 0; ; t++) {
      try {
        const recipe = await FUNDER.wallet.transferTransaction([{ type: 'unshielded', outputs }], { shieldedSecretKeys: FUNDER.zswap, dustSecretKey: FUNDER.dust }, { ttl: new Date(Date.now() + 30 * 60_000) });
        const signed = await FUNDER.wallet.signRecipe(recipe, (p: any) => FUNDER.keystore.signData(p));
        log('funded buyers tx', String(await FUNDER.wallet.submitTransaction(await FUNDER.wallet.finalizeRecipe(signed)))); break;
      } catch (e: any) { if (/balance dust/i.test(String(e?.message)) && t < 40) { await sleep(10_000); continue; } throw e; }
    }
  });
  await FUNDER.wallet.stop().catch(() => {}); log('DONE'); process.exit(0);
}

const buyers: Wallet[] = [];
if (BN) {
  const b = await openWallet(ROLE, { seed: buyerSeed(BN) });
  buyers[BN - 1] = b; W = b;
  await synced(b);
  await step(`dust:${b.name}`, async () => {
    await waitFor(b, (s) => Object.values(s.unshielded?.balances ?? {}).some((v: any) => v > 0n), `${b.name} tNIGHT`, 6 * 3600_000);
    const s = await state(b);
    const utxos = s.unshielded.availableCoins.filter((c: any) => c.meta.registeredForDustGeneration === false);
    if (utxos.length) {
      const recipe = await b.wallet.registerNightUtxosForDustGeneration(utxos, b.keystore.getPublicKey(), (p: any) => b.keystore.signData(p));
      await b.wallet.submitTransaction(await b.wallet.finalizeRecipe(recipe));
    }
    await waitFor(b, (st) => (st.dust?.availableCoins.length ?? 0) >= 1, `${b.name} DUST`);
    log(b.name, 'DUST ok', JSON.stringify(await bal(b), (_, v) => typeof v === 'bigint' ? v.toString() : v));
  });
  await until(() => !!peek('project').t0, 'project to start deploying');
  S.t0 = peek('project').t0;
}
const zswap = W.zswap;

// ---- holders: each buyer wallet holds one identity with its own credential from the hosted mock issuer ----
const COUNTRY = [566, 288, 826, 404, 276, 710];
async function holder(n: number) {
  const name = `buyer${n}`;
  if (!S.holders[name]) {
    const master = random32(); const hs = deriveHolderSecret(master);
    const r = await fetch(`${HOSTED}/issuer/credential`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holderCommit: holderCommitment(hs).toString(), country: COUNTRY[(n - 1) % COUNTRY.length], kycLevel: 3, validDays: 365 }) });
    if (!r.ok) throw new Error(`credential ${r.status} ${await r.text()}`);
    S.holders[name] = { master: toHex(master), cred: await r.json() }; save();
  }
  const h = S.holders[name]; const master = fromHex(h.master);
  return { master, hs: deriveHolderSecret(master), cred: credentialFromJSON(h.cred) };
}

// ---- sales ----
interface Def { key: string; name: string; symbol: string; description: string; website: string; accent: number; auditor?: boolean;
  input: Omit<SaleInput, 'saleId' | 'nonceSeed' | 'tokenDomain' | 'payColor' | 'issuerPk' | 'feeKey' | 'feeBps' | 'auditorPk'> }
const T = S.t0 ??= now(); save(); // project: first sync done; buyers: copied from the project file
const d = (y: number, mo: number, day: number, h: number) => Math.floor(Date.UTC(y, mo - 1, day, h - 1) / 1000); // WAT = UTC+1
const DAY = 86_400, MONTH = 30 * DAY;
const DEFS: Def[] = [
  { key: 'hush', name: 'Hushline Relay', symbol: 'HUSH', accent: 1, website: 'https://hushline.network',
    description: 'A private RPC relay for Midnight dApps. Requests are mixed through shielded relays, so no node operator can link a wallet to its IP address or its queries.',
    input: { kind: 'fixedPrice', ticketPrice: 500n * U, tokensPerTicket: 2_000n * U, softCap: 2, hardCap: 4, maxPerPerson: 2,
      start: T - 60, end: T + 120 * 60, cliff: T + 120 * 60, tranches: 2, trancheInterval: MONTH, minKyc: 2, blockedCountries: [408, 364] } },
  { key: 'sable', name: 'Sablepay', symbol: 'SABLE', accent: 3, website: 'https://sablepay.xyz',
    description: 'Confidential payroll for DAOs and remote teams. Salaries settle in shielded stablecoins, and auditors get selective disclosure instead of a public ledger.',
    input: { kind: 'fixedPrice', ticketPrice: 200n * U, tokensPerTicket: 1_000n * U, softCap: 10, hardCap: 40, maxPerPerson: 4,
      start: T - 60, end: T + 120 * 60, cliff: T + 120 * 60, tranches: 1, trancheInterval: 0, minKyc: 2, blockedCountries: [408, 364] } },
  { key: 'ash', name: 'Ashfall Oracle', symbol: 'ASHF', accent: 2, website: 'https://ashfall.network',
    description: 'Private price feeds. Data providers commit prices inside zero-knowledge proofs, so DeFi apps get verified quotes without exposing who reported what.',
    input: { kind: 'firstCome', ticketPrice: 100n * U, tokensPerTicket: 500n * U, softCap: 0, hardCap: 6, maxPerPerson: 2,
      start: T - 60, end: T + 6 * DAY, cliff: T + 13 * DAY, tranches: 1, trancheInterval: 0, minKyc: 1, blockedCountries: [408] } },
  { key: 'gloam', name: 'Gloamswap', symbol: 'GLOAM', accent: 0, website: 'https://gloamswap.exchange',
    description: 'A dark-pool exchange on Midnight. Orders are matched inside zero-knowledge circuits, so size and price stay hidden until settlement and nobody can front-run.',
    input: { kind: 'fixedPrice', ticketPrice: 250n * U, tokensPerTicket: 1_000n * U, softCap: 20, hardCap: 120, maxPerPerson: 4,
      start: T - 60, end: d(2026, 11, 21, 18), cliff: d(2026, 11, 28, 18), tranches: 3, trancheInterval: MONTH, minKyc: 2, blockedCountries: [408, 364, 760, 192] } },
  { key: 'cinder', name: 'Cinder Compute', symbol: 'CNDR', accent: 2, website: 'https://cinder.computer',
    description: 'An encrypted compute market. GPU owners rent capacity to private AI jobs, with payments and workloads shielded end to end. First come, first served.',
    input: { kind: 'firstCome', ticketPrice: 50n * U, tokensPerTicket: 400n * U, softCap: 0, hardCap: 400, maxPerPerson: 10,
      start: T - 60, end: d(2026, 11, 30, 18), cliff: d(2026, 11, 30, 18), tranches: 1, trancheInterval: 0, minKyc: 1, blockedCountries: [] } },
  { key: 'lantern', name: 'Lantern ID', symbol: 'LNTN', accent: 0, website: 'https://lantern.id', auditor: true,
    description: 'Reusable private identity. Prove you are over 18, accredited or outside a sanctioned region without showing a document. This sale has auditor disclosure enabled.',
    input: { kind: 'fixedPrice', ticketPrice: 750n * U, tokensPerTicket: 1_500n * U, softCap: 8, hardCap: 30, maxPerPerson: 1,
      start: T - 60, end: d(2026, 10, 31, 18), cliff: d(2026, 11, 7, 18), tranches: 12, trancheInterval: MONTH, minKyc: 3, blockedCountries: [408, 364, 760, 192] } },
  { key: 'tenebra', name: 'Tenebra Vault', symbol: 'TNBR', accent: 1, website: 'https://tenebra.finance',
    description: 'Private custody for funds and treasuries. Multi-party vaults keep balances shielded and publish compliance proofs instead of the book.',
    input: { kind: 'fixedPrice', ticketPrice: 1_000n * U, tokensPerTicket: 2_500n * U, softCap: 15, hardCap: 50, maxPerPerson: 2,
      start: d(2026, 10, 17, 16), end: d(2026, 10, 24, 16), cliff: d(2026, 11, 24, 16), tranches: 6, trancheInterval: MONTH, minKyc: 3, blockedCountries: [408, 364, 760, 192] } },
];
const ORDER = (arg('--only') ?? DEFS.map((x) => x.key).join(',')).split(',');
const def = (k: string) => DEFS.find((x) => x.key === k)!;

function inputOf(df: Def): SaleInput {
  const rec = S.sales[df.key] ??= { saleId: toHex(random32()), nonceSeed: toHex(random32()), ...(df.auditor ? { auditorSecret: String(scalarFrom(random32())) } : {}) };
  return { ...df.input, payColor: TC, issuerPk, feeKey: fromHex(net.platform.feeKey), feeBps: net.platform.defaultFeeBps,
    saleId: fromHex(rec.saleId), nonceSeed: fromHex(rec.nonceSeed), tokenDomain: pad32(`dusk:token:${df.symbol}`),
    auditorPk: rec.auditorSecret ? pointOf(BigInt(rec.auditorSecret)) : null };
}
async function register(df: Def) {
  const rec = S.sales[df.key];
  const body = { address: rec.address, network: NET, name: df.name, symbol: df.symbol, description: df.description, website: df.website, accent: df.accent, txHash: rec.txHash };
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${HOSTED}/sales`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 201 || r.status === 409) { log('hosted registry', df.name, r.status); break; }
    log('hosted registry', r.status, (await r.text()).slice(0, 120)); await sleep(15_000);
  }
  const all = fs.existsSync(LOCAL_REG) ? JSON.parse(fs.readFileSync(LOCAL_REG, 'utf8')) : [];
  if (!all.some((s: any) => s.address === rec.address)) { all.push({ ...body, createdAt: Date.now() }); fs.writeFileSync(LOCAL_REG, JSON.stringify(all, null, 2) + '\n'); }
}

const sp = (w: Wallet, tag: string) => nodeProviders(w, SALE_ZK, STORE, tag);
const pub = indexerPublicDataProvider(env.indexer, env.indexerWS);
const view = async (a: string) => readSale((await readSaleLedger(pub, a))!);
const cpk = String(zswap.coinPublicKey);

// Project: deploy and register everything (one wallet, sequential).
if (ROLE === 'project') for (const key of ORDER) {
  const df = def(key); const input = inputOf(df); save();
  await step(`deploy:${key}`, async () => {
    const r: any = await deploySale(sp(W, key), toSaleParams(input), deriveAdminSecret(PROJECT_MASTER, input.saleId), { assetsPath: SALE_ZK });
    S.sales[key].address = r.address; S.sales[key].txHash = r.txHash ?? r.deployTxData?.public?.txHash; save();
    log(df.name, r.address, 'ends', wat(input.end));
  });
  await step(`register:${key}`, () => register(df));
}
const saleReady = (k: string) => !!peek('project').done?.[`deploy:${k}`];
const syncSale = (k: string) => { S.sales[k] = peek('project').sales[k]; save(); };
const A = (k: string) => S.sales[k].address;
const boughtBy = (k: string) => { let n = 0; for (let i = 1; i <= BUYERS; i++) n += Object.keys(peek(`buyer${i}`).done ?? {}).filter((x) => x.startsWith(`buy:${k}:`)).length; return n; };
const planned = (k: string) => Object.entries(plan).filter(([n]) => Number(n) <= BUYERS).flatMap(([, v]) => v).filter(([x]) => x === k).length;
const admin = (key: string) => deriveAdminSecret(PROJECT_MASTER, inputOf(def(key)).saleId);
const waitUntil = async (unix: number, what: string) => { const ms = unix * 1000 - Date.now() + 30_000; if (ms > 0) { log(`waiting ${Math.ceil(ms / 1000)}s for ${what}`); await sleep(ms); } };
const buyerDone = (n: number, k: string) => !!peek(`buyer${n}`).done?.[k];

// Buyer n: mint tUSD, buy, then refund (Sablepay) and claim (Hushline).
const plan: Record<number, [string, number][]> = {
  1: [['hush', 0], ['sable', 0], ['ash', 0], ['ash', 1], ['gloam', 0], ['lantern', 0], ['cinder', 0]],
  2: [['hush', 0], ['sable', 0], ['ash', 0], ['ash', 1], ['gloam', 0], ['cinder', 0], ['cinder', 1], ['cinder', 2]],
  3: [['hush', 0], ['hush', 1], ['sable', 0], ['ash', 0], ['ash', 1], ['gloam', 0], ['gloam', 1], ['lantern', 0]],
};
if (BN) {
  const b = W;
  await step(`mint:${b.name}`, async () => { if ((await bal(b)).tusd < 3_000n * U) {
    await callTusd(nodeProviders(b, TUSD_ZK, STORE, `tusd-${b.name}`), net.tusd.address, 'mint', [5_000n * U], { assetsPath: TUSD_ZK });
    await waitFor(b, (s) => (s.shielded.balances[TC] ?? 0n) >= 3_000n * U, `${b.name} tUSD`, 300_000); } });
  for (const [key, i] of plan[BN] ?? []) {
    if (!ORDER.includes(key)) continue;
    await until(() => saleReady(key), `${key} deploy`); syncSale(key);
    await step(`buy:${key}:${b.name}:${i}`, async () => {
      const input = inputOf(def(key)); const h = await holder(BN);
      await callSale(sp(b, key), A(key), { credential: h.cred, holderSecret: h.hs, ticketIndex: BigInt(i), receiptSecret: deriveReceiptSecret(h.master, input.saleId, i) },
        'buyTicket', [paymentCoin(fromHex(TC), input.ticketPrice)], { assetsPath: SALE_ZK });
    });
  }
  if (BN <= 2 && ORDER.includes('sable')) {
    await until(() => !!peek('project').done?.['finalize:sable'], 'Sablepay finalize');
    await step(`refund:sable:${b.name}`, async () => {
      const h = await holder(BN); const v = await view(A('sable'));
      await callSale(sp(b, 'sable'), A('sable'), { receiptSecret: deriveReceiptSecret(h.master, inputOf(def('sable')).saleId, 0) }, 'refund', [v.vault[BN - 1].raw], { assetsPath: SALE_ZK });
    });
  }
  if (BN <= 2 && ORDER.includes('hush')) {
    await until(() => !!peek('project').done?.['finalize:hush'], 'Hushline finalize');
    await waitUntil(inputOf(def('hush')).cliff, 'Hushline cliff');
    await step(`claim:hush:${b.name}`, async () => {
      const h = await holder(BN);
      await callSale(sp(b, 'hush'), A('hush'), { receiptSecret: deriveReceiptSecret(h.master, inputOf(def('hush')).saleId, 0) }, 'claim', [0n], { assetsPath: SALE_ZK });
    });
  }
}

// Project: settle the finished sales once the buyers are done.
if (ROLE === 'project') {
  const cpk = String(W.zswap.coinPublicKey);
  if (ORDER.includes('ash')) {
    await until(() => boughtBy('ash') >= planned('ash'), 'Ashfall buys');
    await step('finalize:ash', () => callSale(sp(W, 'ash'), A('ash'), {}, 'finalize', [], { assetsPath: SALE_ZK }));
  }
  if (ORDER.includes('hush')) {
    await until(() => boughtBy('hush') >= planned('hush'), 'Hushline buys');
    await step('finalize:hush', () => callSale(sp(W, 'hush'), A('hush'), {}, 'finalize', [], { assetsPath: SALE_ZK }));
    for (let i = 0; i < 4; i++) await step(`withdraw:hush:${i}`, async () => { const v = await view(A('hush')); if (!v.vault.length) return;
      await callSale(sp(W, 'hush'), A('hush'), { adminSecret: admin('hush') }, 'withdraw', [v.vault[0].raw, { bytes: fromHex(cpk) }], { assetsPath: SALE_ZK }); });
    for (let i = 0; i < 4; i++) await step(`fee:hush:${i}`, async () => { const v = await view(A('hush')); if (!v.feeVault.length) return;
      await callSale(sp(W, 'hush'), A('hush'), { adminSecret: PLATFORM_SECRET }, 'collectFee', [v.feeVault[0].raw, { bytes: fromHex(cpk) }], { assetsPath: SALE_ZK }); });
  }
  if (ORDER.includes('sable')) {
    await waitUntil(inputOf(def('sable')).end, 'Sablepay to end');
    await step('finalize:sable', () => callSale(sp(W, 'sable'), A('sable'), {}, 'finalize', [], { assetsPath: SALE_ZK }));
  }
  for (const key of ORDER) { const v = await view(A(key)); log(key, A(key), `phase=${v.phase} sold=${v.ticketsSold} withdrawn=${v.ticketsWithdrawn} refunds=${v.refundsPaid} claims=${v.claimsPaid}`); }
}
await W.wallet.stop().catch(() => {});
log('DONE', ROLE);
process.exit(0);
