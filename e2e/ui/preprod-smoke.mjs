// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Headless smoke test of the Preprod build's wallet layer with a STUB extension that answers like
// the real ones do (Bech32m keys, string balances, a dead indexer URL, no proving provider).
// It never signs or submits anything to a real network: the fee-window scenarios hand the app
// pre-built transactions and fake the wallet's answers (including node error 182). Usage: BASE=http://127.0.0.1:4174 node e2e/ui/preprod-smoke.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4174';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const CPK = 'mn_shield-cpk_preprod17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduqma8le8';
const EPK = 'mn_shield-epk_preprod199h826c7tzf7rmzkr3gx78qzc2jlxtctcdrwn9usa965rsk449zq6duxvd';
const ADDR = 'mn_shield-addr_preprod17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduzjmn4dv093ylpa3tpc5r0rspv9f0n9u9ux3hfj7gwja2pct26j3qstf7q9';

function stub({ key, name, rdns, networkId, balanced = null, submitPlan = null }) {
  return `(() => {
    const balanced = ${JSON.stringify(balanced)}, plan = ${JSON.stringify(submitPlan)};
    const calls = window.__calls = { balance: [], submit: [] };
    const err182 = () => Object.assign(new Error('Operation failed: 1010: Invalid Transaction: Custom error: 182: (FiberFailure) SubmissionError: Transaction submission error'),
      { code: 'InternalError', reason: 'Operation failed: 1010: Invalid Transaction: Custom error: 182: (FiberFailure) SubmissionError: Transaction submission error' });
    const api = {
      getConfiguration: async () => ({ networkId: ${JSON.stringify(networkId)}, indexerUri: 'https://blockfrost.lw.iog.io/midnight-preprod/',
        indexerWsUri: 'wss://blockfrost.lw.iog.io/midnight-preprod/ws', proverServerUri: 'http://localhost:6300', substrateNodeUri: 'wss://rpc.preprod.midnight.network' }),
      getConnectionStatus: async () => ({ status: 'connected', networkId: ${JSON.stringify(networkId)} }),
      getShieldedAddresses: async () => ({ shieldedAddress: ${JSON.stringify(ADDR)}, shieldedCoinPublicKey: ${JSON.stringify(CPK)}, shieldedEncryptionPublicKey: ${JSON.stringify(EPK)} }),
      getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_preprod1stub' }),
      getShieldedBalances: async () => ({}),
      getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: '1000000000' }),
      getDustBalance: async () => ({ cap: 5000000000000000n, balance: 2500000000000000n }),
      balanceUnsealedTransaction: async (hex) => {
        if (!balanced) throw Object.assign(new Error('stub'), { code: 'Rejected' });
        calls.balance.push(hex); await new Promise((r) => setTimeout(r, 300));
        return { tx: balanced[Math.min(calls.balance.length - 1, balanced.length - 1)] };
      },
      submitTransaction: async (hex) => {
        if (!plan) throw new Error('stub');
        calls.submit.push(hex); await new Promise((r) => setTimeout(r, 1500));
        if (plan[Math.min(calls.submit.length - 1, plan.length - 1)] === '182') throw err182();
      },
    };
    window.midnight = window.midnight || {};
    window.midnight[${JSON.stringify(key)}] = { name: ${JSON.stringify(name)}, icon: '', apiVersion: '4.0.0', rdns: ${JSON.stringify(rdns)},
      connect: async (n) => { if (n !== ${JSON.stringify(networkId)}) throw Object.assign(new Error('Network mismatch'), { code: 'InvalidRequest' }); return api; } };
  })();`;
}

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  // 1) 1AM-like stub on preprod
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(stub({ key: '1am', name: '1AM', rdns: 'com.midnight.1am', networkId: 'preprod' }));
    await ctx.addInitScript(stub({ key: 'mnLace', name: 'Lace', rdns: 'io.lace.wallet', networkId: 'preprod' }));
    const page = await ctx.newPage();
    const errors = [];
    // Aborted WASM/asset loads are a side effect of navigating mid-load in this script, not app errors.
    page.on('pageerror', (e) => { if (!/aborted/i.test(String(e))) errors.push(String(e)); });
    await page.goto(BASE + '/');
    check('setup banner shown while preprod has no deployment', await page.getByTestId('setup-banner').waitFor({ timeout: 15000 }).then(() => true, () => false));
    await page.goto(BASE + '/dashboard');
    await page.getByRole('button', { name: 'Connect wallet' }).first().click();
    const names = await page.locator('dialog button .font-bold').allInnerTexts();
    check('connect modal lists 1AM first, then Lace', names[0] === '1AM' && names[1] === 'Lace', names.join(' | '));
    await page.locator('dialog button', { hasText: '1AM' }).first().click();
    const diag = page.getByTestId('wallet-diagnostics');
    await diag.waitFor({ timeout: 30000 });
    const text = await diag.innerText();
    check('Bech32m keys accepted and session opened', /1AM/.test(text), text.replace(/\n/g, ' / '));
    check('dead wallet indexer replaced by the default Preprod indexer', /Indexer\s*default/i.test(text));
    check('wallet proof server used when it answers', /Proof server\s*wallet/i.test(text));
    check('wallet proving reported as not offered for this stub', /Wallet proving\s*not offered/i.test(text));
    const dust = await page.getByTestId('dash-dust').innerText();
    check('DUST balance (bigint) rendered', dust.trim() !== '—', dust);
    await page.goto(BASE + '/setup');
    await page.getByRole('button', { name: 'Generate' }).click();
    check('setup page: deploy enabled once wallet + secret are present', await page.getByTestId('setup-deploy').isEnabled());
    check('no uncaught page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 2) wallet on the wrong network
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(stub({ key: '1am', name: '1AM', rdns: 'com.midnight.1am', networkId: 'preview' }));
    const page = await ctx.newPage();
    await page.goto(BASE + '/dashboard');
    await page.getByRole('button', { name: 'Connect wallet' }).first().click();
    await page.locator('dialog button', { hasText: '1AM' }).first().click();
    const alert = page.locator('dialog [role=alert]');
    await alert.waitFor({ timeout: 15000 });
    const msg = await alert.innerText();
    check('wrong wallet network gives a readable error', /Preprod/.test(msg) && /network/i.test(msg), msg);
    await ctx.close();
  }
  // 3) + 4) 1AM's sponsored fee window: the node answers 182 (intent TTL expired)
  {
    const { ContractDeploy, ContractState, CostModel, Intent, Transaction } = await import('@midnight-ntwrk/ledger-v8');
    const noProver = { check: async () => { throw new Error('no circuits'); }, prove: async () => { throw new Error('no circuits'); } };
    const built = async (ttlMs) => {
      const tx = Transaction.fromParts('preprod', undefined, undefined, Intent.new(new Date(ttlMs)).addDeploy(new ContractDeploy(new ContractState())));
      return Buffer.from((await tx.prove(noProver, CostModel.initialCostModel())).bind().serialize()).toString('hex').toUpperCase();
    };
    const runSetup = async (balanced, submitPlan) => {
      const ctx = await browser.newContext();
      await ctx.addInitScript(stub({ key: '1am', name: '1AM', rdns: 'com.midnight.1am', networkId: 'preprod', balanced, submitPlan }));
      const page = await ctx.newPage();
      await page.goto(BASE + '/setup');
      await page.getByRole('button', { name: 'Connect wallet' }).first().click();
      await page.locator('dialog button', { hasText: '1AM' }).first().click();
      await page.getByTestId('setup-1am-hint').waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: 'Generate' }).click();
      await page.getByTestId('setup-deploy').click();
      return { ctx, page };
    };
    {
      const balanced = [await built(Date.now() + 45_000), await built(Date.now() + 50_000)];
      const { ctx, page } = await runSetup(balanced, ['182', 'ok']);
      const sawWindow = await page.getByTestId('fee-window').waitFor({ timeout: 60000 }).then(() => true, () => false);
      check('fee-window countdown shown while the wallet waits for Submit', sawWindow, sawWindow ? (await page.getByTestId('fee-window').innerText()).replace(/\n/g, ' ') : '');
      await page.waitForFunction(() => window.__calls.submit.length >= 2, null, { timeout: 60000 }).catch(() => {});
      const calls = await page.evaluate(() => window.__calls);
      check('182 -> same unsealed tx re-balanced once and re-submitted', calls.balance.length === 2 && calls.balance[0] === calls.balance[1] && calls.submit.length === 2,
        `balance ${calls.balance.length}, submit ${calls.submit.length}`);
      check('wallet gets back its own balanced hex verbatim', calls.submit[0] === balanced[0] && calls.submit[1] === balanced[1]);
      const confirming = await page.getByText('Confirmed in a block').locator('xpath=ancestor::li').locator('.spin').waitFor({ timeout: 20000 }).then(() => true, () => false);
      check('stepper moves on to confirmation after the retry', confirming);
      const proof = await page.locator('text=/Last proof:/').textContent().catch(() => '') ?? '';
      check('LAST PROOF names the prover and the indexer', /proof server localhost:6300/.test(proof) && /no ZK proof needed/.test(proof) && /Indexer: indexer\.preprod/.test(proof), proof);
      await ctx.close();
    }
    {
      const balanced = [await built(Date.now() + 45_000)];
      const { ctx, page } = await runSetup(balanced, ['182']);
      const err = page.getByTestId('tx-error');
      const shown = await err.waitFor({ timeout: 90000 }).then(() => true, () => false);
      const msg = shown ? await err.innerText() : '';
      const calls = await page.evaluate(() => window.__calls);
      check('persistent 182 gives up after 2 re-balances', calls.submit.length === 3 && calls.balance.length === 3, `balance ${calls.balance.length}, submit ${calls.submit.length}`);
      check('182 error explains the fee window and names prover, indexer and wallet',
        /fee window/.test(msg) && /Dust Sponsorship/.test(msg) && /Prover: proof server localhost:6300/.test(msg) && /Indexer: indexer\.preprod\.midnight\.network/.test(msg) && /Wallet: 1AM/.test(msg), msg.replace(/\n/g, ' / '));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
