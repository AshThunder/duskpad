// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Checks the hosted Explore page and each showcase sale's sale and report pages; saves screenshots.
//   node e2e/ui/showcase-verify.mjs [state.json] [outdir]
import fs from 'node:fs';
import { chromium } from 'playwright';

const STATE = process.argv[2] ?? '/workspace/duskpad-wallets/showcase-state.json';
const OUT = process.argv[3] ?? '/workspace/duskpad-wallets';
const BASE = process.env.BASE ?? 'https://duskpad.vercel.app';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const S = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const sales = Object.entries(S.sales).filter(([, r]) => r.address);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fail++; };

await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' });
await page.waitForTimeout(12000);
const cards = await page.locator('[data-testid="sale-card"]').allInnerTexts();
ok(cards.length >= sales.length, `Explore shows ${cards.length} cards (expected ${sales.length})`);
for (const c of cards) console.log('  card:', c.replace(/\s+/g, ' ').slice(0, 220));
await page.screenshot({ path: `${OUT}/showcase-explore.png`, fullPage: true });

for (const [key, r] of sales) {
  for (const [kind, url] of [['sale', `/sale/${r.address}`], ['report', `/sale/${r.address}/report`]]) {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(kind === 'report' ? 20000 : 10000);
    const text = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const bad = /error|not found|unknown field/i.test(text.slice(0, 600));
    ok(text.length > 200 && !bad, `${key} ${kind} page loads: ${text.slice(0, 200)}`);
    await page.screenshot({ path: `${OUT}/showcase-${key}-${kind}.png`, fullPage: true });
  }
}
ok(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
process.exit(fail ? 1 : 0);
