// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// LOCAL ONLY. Injects the dev wallet bridge accounts as DApp Connector wallets under
// window.midnight['duskpad-dev-<id>'], so the app uses one code path for 1AM, Lace and dev.
import { IS_LOCAL } from './config';

export interface DevAccount { id: string; label: string; role: string; ready: boolean; shieldedAddress: string | null }

const revive = (_k: string, v: any) => (v && typeof v === 'object' && '__bigint' in v ? BigInt(v.__bigint) : v);

async function rpc(id: string, method: string, params: unknown[]) {
  const r = await fetch(`/dev-wallet/${id}/rpc`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  const j = JSON.parse(await r.text(), revive);
  if (!r.ok) throw new Error(j.error ?? `dev wallet error ${r.status}`);
  return j.result;
}

const ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#1c1c1e"/><path d="M9 21h14M11 16h10M13 11h6" stroke="#00e676" stroke-width="2.4" stroke-linecap="round"/></svg>');

function remoteApi(id: string) {
  const call = (m: string) => (...params: unknown[]) => rpc(id, m, params);
  return {
    getConfiguration: call('getConfiguration'),
    getConnectionStatus: call('getConnectionStatus'),
    getShieldedAddresses: call('getShieldedAddresses'),
    getUnshieldedAddress: call('getUnshieldedAddress'),
    getDustAddress: call('getDustAddress'),
    getShieldedBalances: call('getShieldedBalances'),
    getUnshieldedBalances: call('getUnshieldedBalances'),
    getDustBalance: call('getDustBalance'),
    balanceUnsealedTransaction: call('balanceUnsealedTransaction'),
    balanceSealedTransaction: call('balanceSealedTransaction'),
    submitTransaction: call('submitTransaction'),
    hintUsage: async () => {},
  };
}

export async function installDevWallets(): Promise<DevAccount[]> {
  if (!IS_LOCAL) return [];
  try {
    const r = await fetch('/dev-wallet/accounts');
    if (!r.ok) return [];
    const accounts: DevAccount[] = await r.json();
    const w = window as any;
    w.midnight ??= {};
    for (const a of accounts) {
      w.midnight[`duskpad-dev-${a.id}`] = {
        name: `${a.label}`,
        icon: ICON,
        apiVersion: '4.0.1',
        rdns: 'local.duskpad.devwallet',
        devRole: a.role,
        connect: async (networkId: string) => {
          if (networkId !== 'undeployed') throw new Error('The dev wallet only works on the local undeployed network');
          return remoteApi(a.id);
        },
      };
    }
    return accounts;
  } catch {
    return [];
  }
}

export async function devPlatformMaster(): Promise<string | null> {
  try {
    const r = await fetch('/dev-wallet/platform-master');
    return r.ok ? (await r.json()).masterSecret : null;
  } catch { return null; }
}
