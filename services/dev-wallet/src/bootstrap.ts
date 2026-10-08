// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Local bootstrap: funds the dev accounts from the genesis wallet, registers DUST, deploys the
// tUSD test stablecoin and records the network config (tUSD color, platform fee key, issuer key)
// in services/api/data/networks.json. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { TUSD_ZK } from '@duskpad/contracts/paths';
import { adminKeyOf, derivePlatformSecret, deployTusd, pad32, readTusdLedger, toHex, pointOf, scalarFrom } from '@duskpad/sdk';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { GENESIS_SEED, buildWallet, ensureFunded, log, nodeProviders, seedOf, waitSynced, type Wallet } from './node.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DUSKPAD_DATA_DIR ?? path.resolve(here, '../../api/data');
export const STORE_DIR = path.resolve(here, '../../../.dev-wallet');

export const ACCOUNTS = [
  { id: 'alice', label: 'Alice', role: 'Buyer' },
  { id: 'bob', label: 'Bob', role: 'Buyer' },
  { id: 'carol', label: 'Carol', role: 'Buyer' },
  { id: 'project', label: 'Nova Labs', role: 'Project team' },
  { id: 'platform', label: 'DuskPad Ops', role: 'Platform operator' },
  { id: 'fresh', label: 'Fresh wallet', role: 'Never bought anything' },
] as const;

/** Local platform operator master secret (dev only; exposed by the dev-wallet bridge). */
export const PLATFORM_MASTER = new Uint8Array(createHash('sha256').update('duskpad-dev-platform-master').digest());
export const TUSD_DOMAIN = pad32('duskpad:tUSD');
export const TUSD_FAUCET_LIMIT = 100_000_000_000n; // 100,000 tUSD per mint (6 decimals)
const ISSUER_PK = pointOf(scalarFrom(pad32(process.env.ISSUER_SEED ?? 'duskpad-mock-issuer-v1')));

export interface NetworkConfig {
  networkId: string;
  tusd: { address: string; color: string; domain: string; decimals: number; faucetLimit: string };
  platform: { feeKey: string; defaultFeeBps: number; name: string };
  issuer: { name: string; mock: boolean; publicKey: { x: string; y: string } };
  updatedAt: string;
}

export function readNetworks(): Record<string, NetworkConfig> {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'networks.json'), 'utf8')); } catch { return {}; }
}

export async function bootstrap(wallets?: Record<string, Wallet>, genesis?: Wallet): Promise<{ wallets: Record<string, Wallet>; config: NetworkConfig }> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const g = genesis ?? await buildWallet('genesis', GENESIS_SEED);
  const ws = wallets ?? Object.fromEntries(await Promise.all(ACCOUNTS.map(async (a) => [a.id, await buildWallet(a.id, seedOf(a.id))] as const)));
  log('syncing wallets…');
  await waitSynced(g);
  await Promise.all(Object.values(ws).map((w) => waitSynced(w)));
  await ensureFunded(g, Object.values(ws));
  log('all dev accounts funded with tNIGHT and DUST');

  const nets = readNetworks();
  let cfg = nets.undeployed;
  const providers = nodeProviders(g, TUSD_ZK, STORE_DIR, 'tusd');
  const exists = cfg ? await readTusdLedger(providers.publicDataProvider, cfg.tusd.address).catch(() => null) : null;
  if (!cfg || !exists) {
    log('deploying tUSD…');
    const d = await deployTusd(providers, TUSD_DOMAIN, pad32('duskpad-tusd-' + Date.now()), TUSD_FAUCET_LIMIT, { assetsPath: TUSD_ZK });
    const color = rt.rawTokenType(TUSD_DOMAIN, d.address);
    cfg = {
      networkId: 'undeployed',
      tusd: { address: d.address, color, domain: toHex(TUSD_DOMAIN), decimals: 6, faucetLimit: TUSD_FAUCET_LIMIT.toString() },
      platform: { feeKey: toHex(adminKeyOf(derivePlatformSecret(PLATFORM_MASTER))), defaultFeeBps: 250, name: 'DuskPad (local)' },
      issuer: { name: 'DuskPad Mock KYC Issuer', mock: true, publicKey: { x: ISSUER_PK.x.toString(), y: ISSUER_PK.y.toString() } },
      updatedAt: new Date().toISOString(),
    };
    nets.undeployed = cfg;
    fs.writeFileSync(path.join(DATA_DIR, 'networks.json'), JSON.stringify(nets, null, 2));
    log(`tUSD at ${d.address} color ${color}`);
  } else {
    log(`tUSD already deployed at ${cfg.tusd.address}`);
  }
  if (!genesis) await g.wallet.stop().catch(() => {});
  return { wallets: ws, config: cfg };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { wallets } = await bootstrap();
  await Promise.all(Object.values(wallets).map((w) => w.wallet.stop().catch(() => {})));
  process.exit(0);
}
