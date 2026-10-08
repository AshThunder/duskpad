// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Browser end-to-end flow against the LOCAL stack (node + indexer + proof server, API, dev wallet
// bridge, Vite). Every persona runs in its own browser context (separate IndexedDB vault), connects a
// dev wallet through the DApp Connector interface and proves in the browser via the proof server.
//
//   create 2 sales -> credentials -> buy (x4) -> blocked-region check -> finalize (success + failure)
//   -> withdraw net of fee -> collect fee -> refund -> backup export -> import in a fresh wallet -> claim
//
// Usage: node e2e/ui/flow.mjs   (BASE=http://127.0.0.1:5173 SHOTS=/workspace/duskpad-shots)
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'; // vite preview of the production build
const SHOTS = process.env.SHOTS ?? '/workspace/duskpad-shots';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const SALE_MIN = Number(process.env.SALE_MIN ?? 7);
mkdirSync(SHOTS, { recursive: true });
// Resumable: each persona keeps a persistent browser profile (its private vault lives in IndexedDB),
// and finished steps are recorded, so `RESUME=1 node e2e/ui/flow.mjs` continues after a failure.
const WORK = process.env.UI_WORK ?? '/tmp/duskpad-ui-flow';
const STATE = `${WORK}/state.json`;
const RESUME = process.env.RESUME === '1' && existsSync(STATE);
if (!RESUME) { rmSync(WORK, { recursive: true, force: true }); }
mkdirSync(WORK, { recursive: true });
const state = RESUME ? JSON.parse(readFileSync(STATE, 'utf8')) : { done: [], shotN: 0 };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const results = [];
let shotN = state.shotN ?? 0;
const contexts = [];

async function shot(page, name, full = false) {
  const f = `${SHOTS}/${String(++shotN).padStart(2, '0')}-${name}.png`;
  state.shotN = shotN; save();
  await page.screenshot({ path: f, fullPage: full });
  log('  shot', f);
}

async function step(name, fn) {
  if (state.done.includes(name)) { log('SKIP (done)', name); results.push({ name, ok: true, resumed: true }); return; }
  const s = Date.now();
  try { await fn(); results.push({ name, ok: true, secs: (Date.now() - s) / 1000 }); state.done.push(name); save(); log('PASS', name); }
  catch (e) { results.push({ name, ok: false, error: String(e.message ?? e).slice(0, 400) }); log('FAIL', name, e.message); throw e; }
}
/** Screenshot-only detours between steps: never abort the run, skip quietly when resuming past them. */
async function extra(fn) { try { await fn(); } catch (e) { log('  (extra skipped)', String(e.message).split('\n')[0]); } }

async function persona(id) {
  const ctx = await chromium.launchPersistentContext(`${WORK}/profile-${id}`, { executablePath: CHROME, args: ['--no-sandbox'], viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  contexts.push(ctx);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('pageerror', (e) => log(`  [${id}] pageerror`, e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') log(`  [${id}] console.error`, m.text().slice(0, 240)); });
  await page.goto(BASE + '/');
  const which = await Promise.race([
    page.waitForSelector('button[aria-label="Disconnect wallet"]', { timeout: 20_000 }).then(() => 'connected'),
    page.waitForSelector('[data-testid=connect-wallet]', { timeout: 20_000 }).then(() => 'connect'),
  ]);
  if (which === 'connect') {
    await page.click('[data-testid=connect-wallet]');
    await page.click(`[data-testid="wallet-duskpad-dev-${id}"]`);
  }
  await page.waitForSelector('button[aria-label="Disconnect wallet"]', { timeout: 60_000 });
  return page;
}

/** Wait for a transaction flow to finish: outcome dialog, or the stepper reporting an error. */
async function waitTx(page, { outcome = true, timeout = 900_000 } = {}) {
  const h = await page.waitForFunction((o) => {
    const t = document.body.innerText;
    if (t.includes('Stopped')) return 'error';
    if (o && document.querySelector('[data-testid=outcome-close]')?.checkVisibility()) return 'ok';
    if (!o && !t.includes('Step ') ) return 'ok';
    return false;
  }, outcome, { timeout, polling: 1000 });
  const r = await h.jsonValue();
  if (r === 'error') {
    const msg = await page.locator('[aria-live=polite]').innerText().catch(() => 'unknown');
    throw new Error('transaction failed: ' + msg.replace(/\s+/g, ' ').slice(0, 400));
  }
}
const closeOutcome = (page) => page.click('[data-testid=outcome-close]');
const localInput = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

async function createSale(page, o) {
  await page.goto(BASE + '/create');
  await page.fill('[data-testid=f-name]', o.name);
  await page.fill('[data-testid=f-symbol]', o.symbol);
  await page.fill('textarea', o.description);
  await page.click(`[data-testid=kind-${o.kind}]`);
  await page.fill('[data-testid=f-price]', o.price);
  await page.fill('[data-testid=f-hardcap]', o.hard);
  if (o.kind === 'fixedPrice') await page.fill('[data-testid=f-softcap]', o.soft);
  await page.fill('[data-testid=f-max]', o.max);
  await page.fill('[data-testid=f-start]', localInput(Date.now()));
  await page.fill('[data-testid=f-duration]', String(o.minutes));
  await page.selectOption('[data-testid=f-duration-unit]', 'minutes');
  await page.fill('[data-testid=f-cliff]', '1');
  await page.selectOption('[data-testid=f-cliff-unit]', 'minutes');
  await page.fill('[data-testid=f-tranches]', '2');
  await page.fill('[data-testid=f-interval]', '2');
  await page.selectOption('[data-testid=f-interval-unit]', 'minutes');
  if (o.minKyc !== undefined) await page.getByRole('button', { name: new RegExp(`^${o.minKycLabel}`) }).click();
  for (const c of o.block ?? []) await page.selectOption('[data-testid=f-block]', String(c));
  if (o.auditor) await page.check('[data-testid=f-auditor]');
  if (o.shot) await shot(page, 'create-sale-form', true);
  await page.click('[data-testid=deploy-sale]');
  await page.waitForTimeout(1500);
  if (o.shot) await shot(page, 'deploy-stepper');
  await page.waitForFunction(() => location.pathname.startsWith('/sale/') || document.body.innerText.includes('Stopped'), null, { timeout: 900_000, polling: 1000 });
  if (!page.url().includes('/sale/')) throw new Error('deploy failed: ' + (await page.locator('[aria-live=polite]').innerText()).slice(0, 300));
  return page.url().split('/sale/')[1];
}

async function getCredential(page, country, level, shotName) {
  await page.goto(BASE + '/credential');
  await page.selectOption('[data-testid=cred-country]', String(country));
  await page.click(`[data-testid=cred-level-${level}]`);
  await page.click('[data-testid=request-credential]');
  await page.waitForSelector('[data-testid=credential-card]');
  if (shotName) await shot(page, shotName);
}

async function faucet(page) {
  await page.goto(BASE + '/dashboard');
  const read = async () => Number(((await page.locator('[data-testid=dash-tusd]').textContent()) ?? '0').replace(/,/g, ''));
  await page.waitForTimeout(3000); // let the first balance poll land
  const before = await read();
  await page.click('[data-testid=dash-faucet]');
  await page.waitForFunction((b) => { const t = document.querySelector('[data-testid=dash-tusd]')?.textContent ?? '0'; return Number(t.replace(/,/g, '')) >= b + 5000 || document.body.innerText.includes('Stopped'); }, before, { timeout: 900_000, polling: 2000 });
  if (await page.getByText('Stopped').count()) throw new Error('faucet mint failed');
  log(`  tUSD ${before} -> ${await read()}`);
}

async function buy(page, sale, shotName) {
  await page.goto(`${BASE}/sale/${sale}`);
  await page.waitForSelector('[data-testid=buy-ticket]:not([disabled])', { timeout: 180_000 });
  await page.click('[data-testid=buy-ticket]');
  if (shotName) { await page.waitForTimeout(2500); await shot(page, shotName); }
  await waitTx(page);
  if (shotName) await shot(page, shotName + '-done');
  await closeOutcome(page);
}

async function waitUntil(page, sel, timeout = 1_200_000) {
  await page.waitForSelector(sel, { timeout });
}

try {
  // ---- Project creates two sales ----------------------------------------------------------
  const project = await persona('project');
  if (!RESUME) await shot(project, 'home');
  let saleA = state.saleA, saleB = state.saleB;
  await step('project deploys a fixed-price sale (soft cap 2, max 2/person, KYC>=2, blocks one region, auditor on)', async () => {
    saleA = await createSale(project, { name: 'Nova Labs', symbol: 'NOVA', description: 'Private compute marketplace token. Demo sale on the local devnet.', kind: 'fixedPrice', price: '100', hard: '6', soft: '2', max: '2', minutes: SALE_MIN, minKyc: 2, minKycLabel: 'Verified', block: [408], auditor: true, shot: true });
    state.saleA = saleA; save(); log('  sale A', saleA);
  });
  await step('project deploys a second sale that will miss its soft cap', async () => {
    saleB = await createSale(project, { name: 'Lumen Grid', symbol: 'LUMEN', description: 'Energy data network. This demo sale is set up to miss its soft cap.', kind: 'fixedPrice', price: '50', hard: '5', soft: '3', max: '1', minutes: SALE_MIN });
    state.saleB = saleB; save(); log('  sale B', saleB);
  });
  if (!RESUME) await extra(async () => {
    await project.goto(BASE + '/explore');
    await project.waitForSelector('[data-testid=sale-card]');
    await project.waitForTimeout(2500);
    await shot(project, 'explore');
  });

  // ---- Buyers ------------------------------------------------------------------------------
  const alice = await persona('alice');
  await step('alice gets a mock credential (Nigeria, Verified)', () => getCredential(alice, 566, 2, 'credential'));
  await step('alice mints test tUSD', () => faucet(alice));
  if (!state.done.includes('alice buys ticket 1 of 2 (stepper shows the private pipeline)')) await extra(async () => {
    await alice.goto(`${BASE}/sale/${saleA}`);
    await alice.waitForSelector('[data-testid=buy-ticket]', { timeout: 15_000 });
    await shot(alice, 'sale-detail-live');
  });
  await step('alice buys ticket 1 of 2 (stepper shows the private pipeline)', () => buy(alice, saleA, 'buy-stepper'));
  await step('alice buys ticket 2 of 2', () => buy(alice, saleA));
  await step('alice is stopped at the per-person cap', async () => {
    await alice.goto(`${BASE}/sale/${saleA}`);
    await alice.waitForFunction(() => document.querySelector('[data-testid=my-tickets]')?.textContent?.startsWith('2 /'), null, { timeout: 60_000 });
    await alice.waitForSelector('[data-testid=buy-ticket][disabled]');
    if (!(await alice.getByText('Per-person limit reached').count())) throw new Error('cap message missing');
    await shot(alice, 'per-person-cap');
  });

  const bob = await persona('bob');
  await step('bob gets a credential and buys one ticket', async () => {
    await getCredential(bob, 276, 3);
    await faucet(bob);
    await buy(bob, saleA);
  });

  const carol = await persona('carol');
  await step('carol (blocked region, Basic KYC) is shown as ineligible for NOVA', async () => {
    await getCredential(carol, 408, 1);
    await faucet(carol);
    await carol.goto(`${BASE}/sale/${saleA}`);
    await carol.waitForSelector('[data-testid=buy-ticket][disabled]');
    await carol.getByText('is blocked for this sale').waitFor();
    await shot(carol, 'ineligible-blocked-region');
  });
  await step('carol re-verifies (Ghana, Verified) and buys one LUMEN ticket', async () => {
    await getCredential(carol, 288, 2);
    await buy(carol, saleB);
  });

  // ---- After the sale window ------------------------------------------------------------
  log(`waiting for both sales to end (${SALE_MIN} min windows)…`);
  await step('anyone finalizes NOVA (succeeded)', async () => {
    await bob.goto(`${BASE}/sale/${saleA}`);
    await waitUntil(bob, '[data-testid=finalize]');
    await bob.click('[data-testid=finalize]');
    await waitTx(bob); await closeOutcome(bob);
    await bob.waitForFunction(() => document.querySelector('[data-testid=sale-status]')?.textContent?.includes('SUCCEEDED'), null, { timeout: 120_000 });
  });
  await step('anyone finalizes LUMEN (failed: refunds open)', async () => {
    await bob.goto(`${BASE}/sale/${saleB}`);
    await waitUntil(bob, '[data-testid=finalize]');
    await bob.click('[data-testid=finalize]');
    await waitTx(bob); await closeOutcome(bob);
    await bob.waitForFunction(() => document.querySelector('[data-testid=sale-status]')?.textContent?.includes('REFUNDING'), null, { timeout: 120_000 });
  });
  await step('carol refunds her LUMEN ticket privately', async () => {
    await carol.goto(`${BASE}/sale/${saleB}`);
    await carol.waitForSelector('[data-testid=refund-ticket]', { timeout: 120_000 });
    await carol.click('[data-testid=refund-ticket]');
    await carol.waitForTimeout(2500);
    await shot(carol, 'refund-stepper');
    await waitTx(carol); await shot(carol, 'refund-done'); await closeOutcome(carol);
    await carol.getByText('Refunded', { exact: true }).first().waitFor({ timeout: 120_000 });
  });
  await step('project withdraws one ticket of proceeds net of the fee', async () => {
    await project.goto(`${BASE}/sale/${saleA}`);
    await project.waitForSelector('[data-testid=withdraw]:not([disabled])', { timeout: 120_000 });
    await shot(project, 'project-console');
    await project.click('[data-testid=withdraw]');
    await waitTx(project); await shot(project, 'withdraw-done'); await closeOutcome(project);
  });
  const platform = await persona('platform');
  await step('platform collects the fee coin', async () => {
    await platform.goto(BASE + '/platform');
    await platform.click('[data-testid=load-dev-master]');
    const enabled = platform.locator('[data-testid=collect-fee]:not([disabled])').first();
    await enabled.waitFor({ timeout: 120_000 });
    await platform.waitForTimeout(1500);
    await shot(platform, 'platform-fees');
    const before = Number((await platform.locator('[data-testid=pending-fees]').textContent()).replace(/,/g, ''));
    await enabled.click();
    await platform.waitForFunction((b) => Number((document.querySelector('[data-testid=pending-fees]')?.textContent ?? '0').replace(/,/g, '')) < b || document.body.innerText.includes('Stopped'), before, { timeout: 900_000, polling: 2000 });
    log(`  pending fees ${before} -> ${await platform.locator('[data-testid=pending-fees]').textContent()}`);
    if (await platform.getByText('Stopped').count()) throw new Error('collectFee failed');
  });

  // ---- Claim from a fresh wallet via encrypted backup ---------------------------------------
  const backupPath = '/tmp/duskpad-alice-backup.json';
  await step('alice exports an encrypted vault backup', async () => {
    await alice.goto(BASE + '/dashboard');
    await alice.waitForFunction(() => document.querySelector('[data-testid=dash-tickets]')?.textContent === '2', null, { timeout: 120_000 });
    await shot(alice, 'dashboard');
    await alice.click('[data-testid=open-export]');
    await alice.fill('[data-testid=backup-pass]', 'correct horse battery');
    await alice.fill('[data-testid=backup-pass2]', 'correct horse battery');
    const [dl] = await Promise.all([alice.waitForEvent('download'), alice.click('[data-testid=backup-submit]')]);
    await dl.saveAs(backupPath);
  });
  const fresh = await persona('fresh');
  await step('a fresh wallet imports the backup and sees alice\'s 2 tickets', async () => {
    await fresh.goto(BASE + '/dashboard');
    await fresh.click('[data-testid=open-import]');
    await fresh.setInputFiles('[data-testid=import-file]', backupPath);
    await fresh.fill('[data-testid=backup-pass]', 'correct horse battery');
    await fresh.click('[data-testid=backup-submit]');
    await fresh.waitForFunction(() => document.querySelector('[data-testid=dash-tickets]')?.textContent === '2', null, { timeout: 120_000 });
    await shot(fresh, 'fresh-wallet-dashboard');
  });
  await step('fresh wallet claims tranche 1 after the cliff (tokens land in the fresh wallet)', async () => {
    await fresh.goto(`${BASE}/sale/${saleA}`);
    await fresh.waitForSelector('[data-testid=claim-tranche]', { timeout: 600_000 });
    await shot(fresh, 'claim-ready');
    await fresh.locator('[data-testid=claim-tranche]').first().click();
    await fresh.waitForTimeout(2500);
    await shot(fresh, 'claim-stepper');
    await waitTx(fresh); await shot(fresh, 'claim-done'); await closeOutcome(fresh);
    await fresh.waitForFunction(() => (document.querySelector('[data-testid=token-balance]')?.textContent ?? '0') !== '0', null, { timeout: 300_000, polling: 3000 });
  });

  // ---- Public views --------------------------------------------------------------------------
  await step('public sale report renders indexer activity', async () => {
    await project.goto(`${BASE}/sale/${saleA}/report`);
    await project.waitForSelector('[data-testid=report-activity] li');
    await project.waitForTimeout(2000);
    await shot(project, 'sale-report', true);
    await project.getByRole('button', { name: /Decrypt records/ }).click();
    await project.waitForTimeout(1000);
    await shot(project, 'auditor-view');
  });
  await project.goto(BASE + '/how-it-works');
  await project.waitForTimeout(1500);
  await shot(project, 'how-it-works', true);
  writeFileSync(`${SHOTS}/../duskpad-ui-flow.json`, JSON.stringify({ base: BASE, saleA, saleB, results, at: new Date().toISOString() }, null, 2));
} catch (e) {
  log('aborted:', e.message);
  process.exitCode = 1;
} finally {
  const ok = results.filter((r) => r.ok).length;
  log(`UI flow: ${ok}/${results.length} steps passed`);
  writeFileSync(`/tmp/duskpad-ui-flow-results.json`, JSON.stringify(results, null, 2));
  for (const c of contexts) await c.close().catch(() => {});
}
