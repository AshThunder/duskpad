// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Local devnet only: send tNIGHT from the genesis wallet to a real wallet (1AM or Lace switched to
// the "Undeployed" network) so it can register DUST and use the local build.
//   npm run fund:local -- mn_addr_undeployed1... [more addresses] [--amount 1000]
import { GENESIS_SEED, buildWallet, log, transferNight, waitSynced } from './node.js';

const args = process.argv.slice(2);
const ai = args.indexOf('--amount');
const whole = ai >= 0 ? BigInt(args[ai + 1]) : 1000n;
const to = args.filter((a, i) => a.startsWith('mn_addr_') && i !== ai + 1);
if (!to.length || to.some((a) => !a.startsWith('mn_addr_undeployed1'))) {
  console.error('usage: npm run fund:local -- mn_addr_undeployed1... [--amount <tNIGHT>]  (unshielded undeployed addresses only)');
  process.exit(2);
}
const amount = whole * 1_000_000n; // NIGHT has 6 decimals

const g = await buildWallet('genesis', GENESIS_SEED);
try {
  await waitSynced(g);
  const id = await transferNight(g, to, amount);
  log(`sent ${whole} tNIGHT to ${to.join(', ')} (tx ${String(id)}). Register it for DUST in the wallet, then wait for DUST to accrue.`);
} finally {
  await g.wallet.stop().catch(() => {});
}
process.exit(0);
