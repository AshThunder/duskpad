// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// Copies compiled proving keys and ZKIR into public/zk so FetchZkConfigProvider can load them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../contracts/managed');
const dst = path.resolve(here, '../public/zk');
for (const c of ['sale', 'tusd']) {
  for (const sub of ['keys', 'zkir']) {
    const from = path.join(src, c, sub);
    if (!fs.existsSync(from)) { console.warn(`[copy-zk] missing ${from}; run "npm run compile" first`); continue; }
    fs.mkdirSync(path.join(dst, c, sub), { recursive: true });
    for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dst, c, sub, f));
  }
}
console.log('[copy-zk] ZK assets copied to public/zk');
