// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Headless smoke test of the Preprod build's wallet layer with a STUB extension that answers like
// the real ones do (Bech32m keys, string balances, a dead indexer URL, no proving provider).
// It never signs or submits anything. Usage: BASE=http://127.0.0.1:4174 node e2e/ui/preprod-smoke.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4174';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const CPK = 'mn_shield-cpk_preprod17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduqma8le8';
const EPK = 'mn_shield-epk_preprod199h826c7tzf7rmzkr3gx78qzc2jlxtctcdrwn9usa965rsk449zq6duxvd';
const ADDR = 'mn_shield-addr_preprod17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduzjmn4dv093ylpa3tpc5r0rspv9f0n9u9ux3hfj7gwja2pct26j3qstf7q9';

function stub({ key, name, rdns, networkId }) {
  return `(() => {
    const api = {
      getConfiguration: async () => ({ networkId: ${JSON.stringify(networkId)}, indexerUri: 'https://blockfrost.lw.iog.io/midnight-preprod/',
        indexerWsUri: 'wss://blockfrost.lw.iog.io/midnight-preprod/ws', proverServerUri: 'http://localhost:6300', substrateNodeUri: 'wss://rpc.preprod.midnight.network' }),
      getConnectionStatus: async () => ({ status: 'connected', networkId: ${JSON.stringify(networkId)} }),
      getShieldedAddresses: async () => ({ shieldedAddress: ${JSON.stringify(ADDR)}, shieldedCoinPublicKey: ${JSON.stringify(CPK)}, shieldedEncryptionPublicKey: ${JSON.stringify(EPK)} }),
      getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_preprod1stub' }),
      getShieldedBalances: async () => ({}),
      getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: '1000000000' }),
      getDustBalance: async () => ({ cap: 5000000000000000n, balance: 2500000000000000n }),
      balanceUnsealedTransaction: async () => { throw Object.assign(new Error('stub'), { code: 'Rejected' }); },
      submitTransaction: async () => { throw new Error('stub'); },
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
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
