// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// DuskPad end-to-end suite: reproduces the 44-test feasibility matrix (section 7 of the research
// report) against the DuskPad contracts, on a LOCAL ledger-8 network. Nothing is mocked except the
// KYC issuer key: every accepted transaction is proved by the proof server, balanced by a real
// wallet, included in a block and read back from the indexer.
//
//   npm run stack:up      # node + indexer + proof server (docker)
//   npm run e2e           # this file
//
// "circuit" rows: the local circuit refused, so no proof could exist and nothing was submitted.
// "ledger" rows (races): two transactions built from the same state; the chain accepted one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { DAppConnectorWalletAdapter } from '@midnight-ntwrk/testkit-js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  adminKeyOf, callSale, callTusd, connectorWalletProviders, decryptAuditRecord, deploySale, deployTusd, deriveAdminSecret,
  deriveHolderSecret, derivePlatformSecret, deriveReceiptSecret, explainError, fromHex, holderCommitment, pad32, paymentCoin, pointOf,
  random32, readSale, readSaleLedger, saleTokenColor, scalarFrom, signCredential, toHex, toSaleParams, type Credential, type SaleInput,
  type SaleIntent,
} from '@duskpad/sdk';
import { SALE_ZK, TUSD_ZK } from '@duskpad/contracts/paths';
import {
  GENESIS_SEED, buildWallet, ensureFunded, env, log, nodeProviders, seedOf, shieldedBalance, sleep, stopAll, waitShielded, waitSynced,
  type Wallet,
} from '@duskpad/dev-wallet/node';
import { SaleSim, person as simPerson, saleInput as simSaleInput, ROGUE_SK as SIM_ROGUE } from '../../contracts/test/harness.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.resolve(here, '../reports');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const STORE = path.resolve(here, '../../.dev-wallet/e2e');
fs.mkdirSync(REPORTS, { recursive: true });
fs.mkdirSync(STORE, { recursive: true });

// ------------------------------------------------------------------------------------------
// Recording

type Where = 'simulator' | 'chain' | 'circuit' | 'ledger' | 'Midnight.js' | 'wallet' | 'chain and wallet' | 'off-chain';
interface Row { id: string; name: string; expected: string; ok: boolean; detail: string; where: Where; secs: number }
const rows: Row[] = [];
let mark = Date.now();
function record(id: string, name: string, expected: string, ok: boolean, detail: string, where: Where) {
  const secs = (Date.now() - mark) / 1000; mark = Date.now();
  rows.push({ id, name, expected, ok, detail, where, secs });
  log(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(8)} ${name} :: ${detail}`);
}
const errMsg = (e: unknown) => { const m = explainError(e); const raw = String((e as any)?.message ?? e); return m === raw ? m : `${m} [${raw.slice(0, 160)}]`; };
const allText = (e: unknown) => { const parts: string[] = []; let c: any = e; for (let i = 0; c && i < 6; i++, c = c.cause) parts.push(String(c?.message ?? c)); return parts.join(' | '); };

async function expectReject(id: string, name: string, fragment: string | RegExp, fn: () => Promise<unknown>, where: Where = 'circuit') {
  mark = Date.now();
  try {
    await fn();
    record(id, name, `rejected: ${fragment}`, false, 'UNEXPECTEDLY ACCEPTED', where);
  } catch (e) {
    const text = allText(e);
    const ok = typeof fragment === 'string' ? text.includes(fragment) : fragment.test(text);
    record(id, name, `rejected: ${fragment}`, ok, ok ? `rejected ("${typeof fragment === 'string' ? fragment : fragment.source}")` : `wrong error: ${text.slice(0, 300)}`, where);
  }
}
async function check(id: string, name: string, expected: string, where: Where, fn: () => Promise<[boolean, string]>) {
  mark = Date.now();
  try { const [ok, d] = await fn(); record(id, name, expected, ok, d, where); }
  catch (e) { record(id, name, expected, false, `error: ${errMsg(e)}`, where); }
}
/** Two transactions from two wallets at once. Passes when exactly one is accepted. */
async function race(fns: [() => Promise<unknown>, () => Promise<unknown>]) {
  const r = await Promise.allSettled(fns.map((f) => f()));
  const won = r.filter((x) => x.status === 'fulfilled').length;
  const lost = r.find((x) => x.status === 'rejected') as PromiseRejectedResult | undefined;
  return { won, loserError: lost ? allText(lost.reason) : '' };
}

// ------------------------------------------------------------------------------------------
// Fixtures

const U = 1_000_000n;                 // 6 decimals
const PRICE = 1_000n * U;             // 1,000 tUSD per ticket
const TOKENS = 100n * U;              // 100 sale tokens per ticket
const FEE_BPS = 250;                  // 2.5% -> 25 tUSD per ticket
const FEE = (PRICE * BigInt(FEE_BPS)) / 10_000n;
const ISSUER_SK = scalarFrom(pad32('duskpad-e2e-issuer'));
const ROGUE_SK = scalarFrom(pad32('duskpad-e2e-rogue'));
const AUDITOR_SK = scalarFrom(pad32('duskpad-e2e-auditor'));
const PROJECT_MASTER = random32();
const PLATFORM_MASTER = random32();
const now = () => Math.floor(Date.now() / 1000);

interface Holder { name: string; master: Uint8Array; hs: Uint8Array; cred: Credential }
function holder(name: string, o: { country?: number; kyc?: number; expiry?: number; sk?: bigint } = {}): Holder {
  const master = random32();
  const hs = deriveHolderSecret(master);
  const cred = signCredential(o.sk ?? ISSUER_SK, { holderCommit: holderCommitment(hs), country: o.country ?? 566, kycLevel: o.kyc ?? 2, expiry: o.expiry ?? now() + 86_400 });
  return { name, master, hs, cred };
}

function saleInput(tusdColor: string, over: Partial<SaleInput>): SaleInput {
  const t = now();
  return {
    kind: 'fixedPrice', payColor: tusdColor, ticketPrice: PRICE, tokensPerTicket: TOKENS,
    softCap: 2, hardCap: 4, maxPerPerson: 2, start: t - 30, end: t + 600, cliff: t + 600, tranches: 1, trancheInterval: 0,
    feeBps: FEE_BPS, feeKey: adminKeyOf(derivePlatformSecret(PLATFORM_MASTER)), saleId: random32(), tokenDomain: pad32('dusk:token:E2E'),
    nonceSeed: random32(), issuerPk: pointOf(ISSUER_SK), minKyc: 2, blockedCountries: [408, 364], auditorPk: null, ...over,
  };
}

const wallets: Wallet[] = [];
let genesis: Wallet | null = null;

try {
  log(`DuskPad e2e run ${RUN_ID} against ${env.node} / ${env.indexer} / ${env.proofServer}`);

  // ---- P1: simulator probes (same contract, in-process) -------------------------------------
  mark = Date.now();
  {
    const probes: [string, () => void, boolean][] = [];
    const s = new SaleSim(simSaleInput());
    const a = simPerson('a'), b = simPerson('b');
    probes.push(['valid buy', () => s.buy(a, 0), true]);
    probes.push(['second buy, next index', () => s.buy(a, 1), true]);
    probes.push(['tampered attribute (country)', () => s.buy(b, 0, { cred: { ...b.cred, attrs: { ...b.cred.attrs, country: 840 } } }), false]);
    probes.push(['stolen credential', () => s.buy(b, 0, { cred: a.cred }), false]);
    probes.push(['blocked country', () => s.buy(simPerson('kp', { country: 408 }), 0), false]);
    probes.push(['second person', () => s.buy(b, 0), true]);
    void SIM_ROGUE;
    const res = probes.map(([n, f, want]) => { try { f(); return [n, want] as const; } catch { return [n, !want] as const; } });
    const ok = res.filter(([, r]) => r).length;
    record('P1', 'Simulator probes (valid buy, second buy, tampered attribute, stolen credential, blocked country, second person)', '6/6', ok === 6, `${ok}/6 ${res.filter(([, r]) => !r).map(([n]) => n).join(', ')}`, 'simulator');
  }

  // ---- SETUP ----------------------------------------------------------------------------------
  mark = Date.now();
  genesis = await buildWallet('genesis', GENESIS_SEED);
  const [A, B, P, F, X, W] = await Promise.all(['A', 'B', 'P', 'F', 'X', 'W'].map((n) => buildWallet(`e2e-${n}`, seedOf(`e2e-${n}`))));
  wallets.push(A, B, P, F, X, W);
  await Promise.all([genesis, ...wallets].map((w) => waitSynced(w)));
  await ensureFunded(genesis, wallets);
  record('SETUP-1', 'Local ledger-8 stack; buyer A, buyer B, project, platform, fresh and connector wallets funded (tNIGHT) with DUST registered', 'all funded', true, '6 wallets synced, funded and generating DUST', 'chain');

  const sp = (w: Wallet) => nodeProviders(w, SALE_ZK, STORE, `sale-${RUN_ID}`);
  const tp = (w: Wallet) => nodeProviders(w, TUSD_ZK, STORE, `tusd-${RUN_ID}`);
  const pubData = indexerPublicDataProvider(env.indexer, env.indexerWS);
  const cpk = (w: Wallet) => String(w.zswap.coinPublicKey);
  const epk = (w: Wallet) => String(w.zswap.encryptionPublicKey);

  // ---- A: payment token --------------------------------------------------------------------
  const DOMAIN = pad32('duskpad:tUSD');
  const tusd = await deployTusd(tp(P), DOMAIN, random32(), 100_000n * U, { assetsPath: TUSD_ZK });
  const fake = await deployTusd(tp(P), DOMAIN, random32(), 100_000n * U, { assetsPath: TUSD_ZK });
  const TC = rt.rawTokenType(DOMAIN, tusd.address);
  const FC = rt.rawTokenType(DOMAIN, fake.address);
  log(`tUSD ${tusd.address} color ${TC}; FAKE ${fake.address} color ${FC}`);
  record('A-0', 'Same domain separator in another contract gives a different token color', 'colors differ', TC !== FC, `tUSD ${TC.slice(0, 12)}… vs FAKE ${FC.slice(0, 12)}…`, 'ledger');

  const a0 = await shieldedBalance(A, TC), b0 = await shieldedBalance(B, TC);
  await callTusd(tp(A), tusd.address, 'mint', [10_000n * U], { assetsPath: TUSD_ZK });
  await callTusd(tp(B), tusd.address, 'mint', [10_000n * U], { assetsPath: TUSD_ZK });
  const a1 = await waitShielded(A, TC, a0 + 10_000n * U), b1 = await waitShielded(B, TC, b0 + 10_000n * U);
  // A-0b in the research was a FINDING: kernel.self() in a constructor is not the deployed address.
  // DuskPad therefore never derives a color on-chain at deploy time; this guards that design.
  record('A-0b', '(adapted) Token colors are derived off-chain from the deployed address: minted coins land under rawTokenType(domain, address)', 'wallet sees coins under the off-chain color',
    a1 === a0 + 10_000n * U, `A holds ${a1 - a0} base units under ${TC.slice(0, 12)}… (constructor never computes a color)`, 'chain and wallet');
  record('A-1', 'Shielded tUSD minted to buyer A and buyer B', '+10,000 each', a1 - a0 === 10_000n * U && b1 - b0 === 10_000n * U, `A +${(a1 - a0) / U}, B +${(b1 - b0) / U}`, 'chain');

  const bKey = { bytes: fromHex(cpk(B)) };
  await expectReject('A-2a', 'Contract output to a non-caller key without its encryption key', /encryption public key|Unable to resolve/i,
    () => callTusd(tp(A), tusd.address, 'mintTo', [500n * U, bKey], { assetsPath: TUSD_ZK }), 'Midnight.js');
  await check('A-2b', 'Contract output to a non-caller key with additionalCoinEncPublicKeyMappings', 'B wallet sees +500', 'chain and wallet', async () => {
    await callTusd(tp(A), tusd.address, 'mintTo', [500n * U, bKey], { assetsPath: TUSD_ZK, coinKeyMappings: new Map([[cpk(B), epk(B)]]) });
    const b2 = await waitShielded(B, TC, b1 + 500n * U);
    return [b2 === b1 + 500n * U, `B ${b1 / U} -> ${b2 / U}`];
  });

  // ---- Sales --------------------------------------------------------------------------------
  const t = now();
  const S1in = saleInput(TC, { softCap: 5, hardCap: 6, maxPerPerson: 2, end: t + 480, cliff: t + 480, auditorPk: pointOf(AUDITOR_SK), tokenDomain: pad32('dusk:token:S1') });
  const S2in = saleInput(TC, { softCap: 2, hardCap: 4, maxPerPerson: 2, end: t + 900, cliff: t + 960, tranches: 2, trancheInterval: 60, tokenDomain: pad32('dusk:token:S2') });
  const pAdmin = (s: SaleInput) => deriveAdminSecret(PROJECT_MASTER, s.saleId);
  const S1 = (await deploySale(sp(P), toSaleParams(S1in), pAdmin(S1in), { assetsPath: SALE_ZK })).address;
  const S2 = (await deploySale(sp(P), toSaleParams(S2in), pAdmin(S2in), { assetsPath: SALE_ZK })).address;
  log(`S1 ${S1} (soft cap 5, auditor on, ends ${new Date(S1in.end * 1000).toLocaleTimeString()}), S2 ${S2}`);
  const view = async (a: string) => readSale((await readSaleLedger(pubData, a))!);

  // ---- W: DApp Connector path (the exact providers the web app uses) ---------------------------
  const adapter = new DAppConnectorWalletAdapter(W.provider, env);
  const addrs = await adapter.getShieldedAddresses();
  const connProviders = (zkPath: string) => {
    const zk = new NodeZkConfigProvider(zkPath);
    return {
      ...nodeProviders(W, zkPath, STORE, `conn-${RUN_ID}`),
      zkConfigProvider: zk, proofProvider: httpClientProofProvider(env.proofServer, zk),
      ...connectorWalletProviders(adapter as any, { coinPublicKey: addrs.shieldedCoinPublicKey, encryptionPublicKey: addrs.shieldedEncryptionPublicKey }),
    };
  };
  let S3 = '';
  const S3in = saleInput(TC, { hardCap: 10, softCap: 0, kind: 'firstCome', end: now() + 1800, cliff: now() + 1800, tokenDomain: pad32('dusk:token:S3') });
  await check('W-1', 'DApp Connector v4 ConnectedAPI path: deploy a sale', 'deployed', 'chain', async () => {
    S3 = (await deploySale(connProviders(SALE_ZK), toSaleParams(S3in), random32(), { assetsPath: SALE_ZK })).address;
    return [!!(await readSaleLedger(pubData, S3)), `sale ${S3.slice(0, 16)}…`];
  });
  await check('W-2', 'DApp Connector path: shielded mint; getShieldedBalances() shows it', '+5,000', 'chain and wallet', async () => {
    const before = BigInt((await adapter.getShieldedBalances())[TC] ?? 0n);
    await callTusd(connProviders(TUSD_ZK), tusd.address, 'mint', [5_000n * U], { assetsPath: TUSD_ZK });
    for (let i = 0; i < 60; i++) { const v = BigInt((await adapter.getShieldedBalances())[TC] ?? 0n); if (v === before + 5_000n * U) return [true, `${before / U} -> ${v / U}`]; await sleep(2000); }
    return [false, 'balance did not update'];
  });
  await check('W-3', 'DApp Connector path: private buyTicket, wallet adds tUSD inputs in balanceUnsealedTransaction', '-1,000, ticketsSold=1', 'chain', async () => {
    const before = BigInt((await adapter.getShieldedBalances())[TC] ?? 0n);
    const h = holder('W');
    await callSale(connProviders(SALE_ZK), S3, { credential: h.cred, holderSecret: h.hs, ticketIndex: 0n, receiptSecret: deriveReceiptSecret(h.master, S3in.saleId, 0) },
      'buyTicket', [paymentCoin(fromHex(TC), PRICE)], { assetsPath: SALE_ZK });
    let v = before;
    for (let i = 0; i < 60 && v !== before - PRICE; i++) { await sleep(2000); v = BigInt((await adapter.getShieldedBalances())[TC] ?? 0n); }
    const sold = (await view(S3)).ticketsSold;
    return [v === before - PRICE && sold === 1, `${before / U} -> ${v / U}, ticketsSold=${sold}`];
  });

  // ---- C / F: buying on S1 --------------------------------------------------------------------
  const hA = holder('A'), hB = holder('B'), hR = holder('R');
  const buyIntent = (h: Holder, sale: SaleInput, i: number, over: Partial<SaleIntent> = {}): SaleIntent =>
    ({ credential: h.cred, holderSecret: h.hs, ticketIndex: BigInt(i), receiptSecret: deriveReceiptSecret(h.master, sale.saleId, i), ...over });
  const buy = (w: Wallet, sale: string, input: SaleInput, intent: SaleIntent, coin = paymentCoin(fromHex(TC), PRICE)) =>
    callSale(sp(w), sale, intent, 'buyTicket', [coin], { assetsPath: SALE_ZK });

  await check('C-1', 'A and B each buy 1 ticket with shielded tUSD', 'A,B -1,000; vault 2 coins; 2 buy nullifiers', 'chain', async () => {
    const [ab, bb] = [await shieldedBalance(A, TC), await shieldedBalance(B, TC)];
    await buy(A, S1, S1in, buyIntent(hA, S1in, 0));
    await buy(B, S1, S1in, buyIntent(hB, S1in, 0));
    const [aa, ba] = [await waitShielded(A, TC, ab - PRICE), await waitShielded(B, TC, bb - PRICE)];
    const v = await view(S1);
    return [aa === ab - PRICE && ba === bb - PRICE && v.vault.length === 2 && v.buyNullifierCount === 2, `A ${(aa - ab) / U}, B ${(ba - bb) / U}, vault ${v.vault.length}, nullifiers ${v.buyNullifierCount}`];
  });
  await check('C-2', 'A buys a 2nd ticket (per-person max = 2)', 'accepted', 'chain', async () => {
    await buy(A, S1, S1in, buyIntent(hA, S1in, 1));
    const v = await view(S1);
    return [v.ticketsSold === 3, `ticketsSold=${v.ticketsSold}`];
  });
  await expectReject('F-1', 'Credential signed by a non-issuer key', 'bad issuer signature', () => buy(A, S1, S1in, buyIntent(holder('rogue', { sk: ROGUE_SK }), S1in, 0)));
  await expectReject('F-2', 'KYC level below minimum', 'kyc level too low', () => buy(A, S1, S1in, buyIntent(holder('low', { kyc: 1 }), S1in, 0)));
  await expectReject('F-5', '3rd ticket for the same person (over the per-person cap)', 'per-person ticket cap reached', () => buy(A, S1, S1in, buyIntent(hA, S1in, 2)));
  await expectReject('F-6', 'Same person reuses ticket index 0', 'ticket index already used', () => buy(A, S1, S1in, buyIntent(hA, S1in, 0)));
  await expectReject('F-7', "A's credential and holder secret used from B's wallet", 'ticket index already used', () => buy(B, S1, S1in, buyIntent(hA, S1in, 0)));
  await expectReject('F-8', 'Blocked country', 'blocked region', () => buy(A, S1, S1in, buyIntent(holder('kp', { country: 408 }), S1in, 0)));
  await expectReject('F-9', 'Stolen credential (wrong holder secret)', 'credential not bound to this holder', () => buy(B, S1, S1in, buyIntent(hA, S1in, 0, { holderSecret: hB.hs })));
  await expectReject('F-10', 'Wrong coin color (FAKE token, same "tUSD" domain, different contract)', 'wrong payment token', () => buy(A, S1, S1in, buyIntent(hR, S1in, 0), paymentCoin(fromHex(FC), PRICE)));
  await expectReject('F-11', 'Wrong amount (999)', 'wrong payment amount', () => buy(A, S1, S1in, buyIntent(hR, S1in, 0), paymentCoin(fromHex(TC), PRICE - U)));
  await expectReject('X-1', '(extra) Expired credential', 'credential expired', () => buy(A, S1, S1in, buyIntent(holder('old', { expiry: now() - 60 }), S1in, 0)));
  await check('F-12', 'Race: same person and ticket index submitted at once from 2 wallets (same state)', 'one accepted; loser not charged', 'ledger', async () => {
    const [ab, bb] = [await shieldedBalance(A, TC), await shieldedBalance(B, TC)];
    const r = await race([() => buy(A, S1, S1in, buyIntent(hR, S1in, 0)), () => buy(B, S1, S1in, buyIntent(hR, S1in, 0))]);
    await sleep(12_000);
    const [aa, ba] = [await shieldedBalance(A, TC), await shieldedBalance(B, TC)];
    const charged = [ab - aa, bb - ba].filter((d) => d === PRICE).length;
    const v = await view(S1);
    return [r.won === 1 && charged === 1 && v.ticketsSold === 4, `accepted=${r.won}, charged wallets=${charged}, ticketsSold=${v.ticketsSold}; loser: ${r.loserError.slice(0, 140)}`];
  });
  await expectReject('S1-W', 'Withdraw while the sale is live', 'sale did not succeed', async () => {
    const v = await view(S1);
    return callSale(sp(P), S1, { adminSecret: pAdmin(S1in) }, 'withdraw', [v.vault[0].raw, { bytes: fromHex(cpk(P)) }], { assetsPath: SALE_ZK });
  });
  await check('X-3', '(extra) Auditor disclosure: auditor key decrypts each ticket to the buyer\'s credential commitment', 'A x2, B x1, R x1', 'off-chain', async () => {
    const L = (await readSaleLedger(pubData, S1))!;
    const commits = [...(L.auditLog as any)].map(([, rec]: any) => decryptAuditRecord(AUDITOR_SK, rec));
    const count = (h: Holder) => commits.filter((c) => c === holderCommitment(h.hs)).length;
    return [count(hA) === 2 && count(hB) === 1 && count(hR) === 1, `${commits.length} records: A ${count(hA)}, B ${count(hB)}, R ${count(hR)}`];
  });

  // ---- E (part 1): S2 sells out, succeeds, project and platform get paid ------------------------
  const pTusd0 = await shieldedBalance(P, TC), fTusd0 = await shieldedBalance(F, TC);
  const [aS2, bS2] = [await shieldedBalance(A, TC), await shieldedBalance(B, TC)];
  for (const [w, h, i] of [[A, hA, 0], [A, hA, 1], [B, hB, 0], [B, hB, 1]] as const) await buy(w, S2, S2in, buyIntent(h, S2in, i));
  log('S2: 4 tickets bought (A x2, B x2)');
  await expectReject('F-13', 'Buy when sold out', 'sold out', () => buy(A, S2, S2in, buyIntent(hR, S2in, 0)));
  await check('E-0', 'Finalize S2 early on hard cap with soft cap met', 'phase=succeeded', 'chain', async () => {
    await callSale(sp(B), S2, {}, 'finalize', [], { assetsPath: SALE_ZK });
    const v = await view(S2); return [v.phase === 'succeeded', `phase=${v.phase}, sold=${v.ticketsSold}`];
  });
  const claim = (w: Wallet, h: Holder, i: number, tr: number) => callSale(sp(w), S2, { receiptSecret: deriveReceiptSecret(h.master, S2in.saleId, i) }, 'claim', [BigInt(tr)], { assetsPath: SALE_ZK });
  await expectReject('E-1', 'Claim before cliff', 'tranche still locked', () => claim(A, hA, 0, 0));
  await expectReject('E-2', 'Refund when the soft cap was met', 'refunds not open', async () => {
    const v = await view(S2); return callSale(sp(A), S2, { receiptSecret: deriveReceiptSecret(hA.master, S2in.saleId, 0) }, 'refund', [v.vault[0].raw], { assetsPath: SALE_ZK });
  });
  await expectReject('E-3', 'Withdraw by a non-project wallet', 'not the project', async () => {
    const v = await view(S2); return callSale(sp(B), S2, { adminSecret: deriveAdminSecret(random32(), S2in.saleId) }, 'withdraw', [v.vault[0].raw, { bytes: fromHex(cpk(B)) }], { assetsPath: SALE_ZK });
  });
  await expectReject('E-4', '(adapted) Withdraw a forged coin that is not in the vault (the fee split itself is fixed in-contract)', 'not a vault coin', async () => {
    const v = await view(S2); const c = v.vault[0].raw;
    return callSale(sp(P), S2, { adminSecret: pAdmin(S2in) }, 'withdraw', [{ ...c, value: c.value * 2n }, { bytes: fromHex(cpk(P)) }], { assetsPath: SALE_ZK });
  });
  await check('E-5', 'Project withdraws all 4 ticket coins net of 2.5%', 'project +3,900; fee vault 4 x 25', 'chain', async () => {
    for (let i = 0; i < 4; i++) {
      const v = await view(S2);
      await callSale(sp(P), S2, { adminSecret: pAdmin(S2in) }, 'withdraw', [v.vault[0].raw, { bytes: fromHex(cpk(P)) }], { assetsPath: SALE_ZK });
    }
    const p1 = await waitShielded(P, TC, pTusd0 + 4n * (PRICE - FEE));
    const v = await view(S2);
    return [p1 - pTusd0 === 4n * (PRICE - FEE) && v.feeVault.length === 4 && v.feeVault.every((c) => c.value === FEE) && v.vault.length === 0,
      `project +${(p1 - pTusd0) / U}; fee vault ${v.feeVault.length} x ${FEE / U}; withdrawn=${v.ticketsWithdrawn}`];
  });
  await expectReject('E-6', 'Fee collection by a non-platform wallet', 'not the platform', async () => {
    const v = await view(S2); return callSale(sp(B), S2, { adminSecret: derivePlatformSecret(random32()) }, 'collectFee', [v.feeVault[0].raw, { bytes: fromHex(cpk(B)) }], { assetsPath: SALE_ZK });
  });
  await check('E-7', 'Platform collects fees', 'platform +100', 'chain', async () => {
    for (let i = 0; i < 4; i++) {
      const v = await view(S2);
      await callSale(sp(F), S2, { adminSecret: derivePlatformSecret(PLATFORM_MASTER) }, 'collectFee', [v.feeVault[0].raw, { bytes: fromHex(cpk(F)) }], { assetsPath: SALE_ZK });
    }
    const f1 = await waitShielded(F, TC, fTusd0 + 4n * FEE);
    return [f1 - fTusd0 === 4n * FEE, `platform +${(f1 - fTusd0) / U}`];
  });
  await check('E-10', 'Conservation: buyers paid 4,000 = project 3,900 + platform 100', 'equal', 'chain', async () => {
    const paid = (aS2 - (await shieldedBalance(A, TC))) + (bS2 - (await shieldedBalance(B, TC)));
    const got = (await shieldedBalance(P, TC)) - pTusd0 + (await shieldedBalance(F, TC)) - fTusd0;
    return [paid === 4n * PRICE && got === paid, `paid ${paid / U} = received ${got / U}`];
  });

  // ---- D: S1 misses its soft cap ------------------------------------------------------------------
  const waitUntil = async (unix: number, what: string) => { const ms = unix * 1000 - Date.now() + 8000; if (ms > 0) { log(`waiting ${Math.ceil(ms / 1000)}s for ${what}`); await sleep(ms); } };
  await waitUntil(S1in.end, 'S1 to end');
  await expectReject('F-4', 'Buy after end time', 'sale ended', () => buy(B, S1, S1in, buyIntent(holder('late'), S1in, 0)));
  await check('D-0', 'Finalize S1 after end with soft cap missed', 'phase=failed', 'chain', async () => {
    await callSale(sp(B), S1, {}, 'finalize', [], { assetsPath: SALE_ZK });
    const v = await view(S1); return [v.phase === 'failed', `phase=${v.phase}, sold=${v.ticketsSold} < soft cap ${v.softCap}`];
  });
  const refund = async (w: Wallet, h: Holder, i: number, coinIdx = 0) => {
    const v = await view(S1);
    return callSale(sp(w), S1, { receiptSecret: deriveReceiptSecret(h.master, S1in.saleId, i) }, 'refund', [v.vault[coinIdx].raw], { assetsPath: SALE_ZK });
  };
  await check('D-1', 'Buyer A refund', 'A +1,000', 'chain', async () => {
    const b = await shieldedBalance(A, TC); await refund(A, hA, 0);
    const a = await waitShielded(A, TC, b + PRICE); return [a === b + PRICE, `A ${b / U} -> ${a / U}`];
  });
  await check('D-2', 'Buyer B refund', 'B +1,000', 'chain', async () => {
    const b = await shieldedBalance(B, TC); await refund(B, hB, 0);
    const a = await waitShielded(B, TC, b + PRICE); return [a === b + PRICE, `B ${b / U} -> ${a / U}`];
  });
  await expectReject('D-3', 'Double refund, same receipt (sequential)', 'receipt already used for this', () => refund(A, hA, 0));
  await check('D-4', 'Race: double refund of the same receipt from 2 wallets, different vault coins', 'one accepted', 'ledger', async () => {
    const r = await race([() => refund(A, hA, 1, 0), () => refund(B, hA, 1, 1)]);
    return [r.won === 1, `accepted=${r.won}; loser: ${r.loserError.slice(0, 160)}`];
  });
  await check('D-5', 'After the race: no double payout (refunds = tickets, vault empty, 4 receipt nullifiers)', 'consistent', 'chain', async () => {
    await refund(A, hR, 0);
    const v = await view(S1);
    return [v.refundsPaid === 4 && v.ticketsSold === 4 && v.vault.length === 0 && v.receiptNullifierCount === 4,
      `refundsPaid=${v.refundsPaid}, sold=${v.ticketsSold}, vault=${v.vault.length}, receiptNullifiers=${v.receiptNullifierCount}`];
  });

  // ---- E (part 2): vesting claims ---------------------------------------------------------------
  const SC = saleTokenColor(S2in.tokenDomain, S2);
  const per = TOKENS / 2n;
  await waitUntil(S2in.cliff, 'S2 cliff');
  await expectReject('X-4', '(extra) Tranche 2 stays locked until cliff + interval', 'tranche still locked', () => claim(A, hA, 0, 1));
  await check('E-8', 'Claims after cliff mint sale tokens (tranche 1 = 50 per ticket)', 'A +100, B +50', 'chain', async () => {
    const [a0s, b0s] = [await shieldedBalance(A, SC), await shieldedBalance(B, SC)];
    await claim(A, hA, 0, 0); await claim(A, hA, 1, 0); await claim(B, hB, 0, 0);
    const [a1s, b1s] = [await waitShielded(A, SC, a0s + 2n * per), await waitShielded(B, SC, b0s + per)];
    return [a1s - a0s === 2n * per && b1s - b0s === per, `A +${(a1s - a0s) / U}, B +${(b1s - b0s) / U} (color ${SC.slice(0, 12)}…)`];
  });
  await expectReject('E-9', 'Double claim (sequential)', 'receipt already used for this', () => claim(A, hA, 0, 0));
  await check('E-11', 'Fresh wallet (never bought, no tUSD) claims with a receipt secret', 'fresh +50', 'chain', async () => {
    const xt = await shieldedBalance(X, TC);
    const x0 = await shieldedBalance(X, SC); await claim(X, hB, 1, 0);
    const x1 = await waitShielded(X, SC, x0 + per);
    return [x1 - x0 === per && xt === 0n, `fresh wallet sale tokens ${x0 / U} -> ${x1 / U}; its tUSD = ${xt}`];
  });
  await waitUntil(S2in.cliff + S2in.trancheInterval, 'S2 tranche 2');
  await check('E-12', 'Race: double claim of the same receipt and tranche from 2 wallets', 'one accepted', 'ledger', async () => {
    const r = await race([() => claim(A, hA, 0, 1), () => claim(B, hA, 0, 1)]);
    const v = await view(S2);
    return [r.won === 1 && v.claimsPaid === 5, `accepted=${r.won}, claimsPaid=${v.claimsPaid}; loser: ${r.loserError.slice(0, 140)}`];
  });
} catch (e) {
  log('ABORTED:', allText(e));
  record('ABORT', 'Suite aborted', 'n/a', false, allText(e).slice(0, 400), 'chain');
} finally {
  await stopAll(wallets);
  if (genesis) await genesis.wallet.stop().catch(() => {});
  const pass = rows.filter((r) => r.ok).length;
  const core = rows.filter((r) => !r.id.startsWith('X-') && r.id !== 'ABORT');
  const md = [
    `# DuskPad e2e run ${RUN_ID}`, '',
    `Local ledger-8 network. ${pass}/${rows.length} passed (${core.filter((r) => r.ok).length}/${core.length} matrix rows, ${rows.filter((r) => r.id.startsWith('X-') && r.ok).length} extras).`, '',
    '| ID | Test | Result | Where enforced | s |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.name} | ${r.ok ? 'PASS' : '**FAIL**'}: ${r.detail.replace(/\|/g, '/')} | ${r.where} | ${r.secs.toFixed(0)} |`),
  ].join('\n');
  fs.writeFileSync(path.join(REPORTS, `run-${RUN_ID}.json`), JSON.stringify({ runId: RUN_ID, pass, total: rows.length, rows }, null, 2));
  fs.writeFileSync(path.join(REPORTS, `run-${RUN_ID}.md`), md);
  log(`\n${md}\n\nRESULT ${pass}/${rows.length} passed; report e2e/reports/run-${RUN_ID}.md`);
  process.exit(pass === rows.length ? 0 : 1);
}
