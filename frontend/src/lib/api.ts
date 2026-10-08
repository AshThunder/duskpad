// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import type { CredentialJSON } from '@duskpad/sdk';
import { API, NETWORK } from './config';

export interface SaleMeta {
  address: string; network: string; name: string; symbol: string; description: string;
  website?: string; category?: string; accent?: number; txHash?: string; createdAt: number;
}

export interface NetworkConfig {
  networkId: string;
  tusd: { address: string; color: string; domain: string; decimals: number; faucetLimit: string };
  platform: { feeKey: string; defaultFeeBps: number; name: string };
  issuer: { name: string; mock: boolean; publicKey: { x: string; y: string } };
}

export interface IssuerInfo {
  name: string; mock: true; warning: string; publicKey: { x: string; y: string }; credentialDays: number;
  levels: { level: number; label: string; hint: string }[]; countries: { code: number; name: string }[];
}

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as any).error ?? `HTTP ${r.status}`);
  return body as T;
}

export const api = {
  network: () => fetch(`${API}/networks/${NETWORK}`).then((r) => j<NetworkConfig>(r)),
  issuer: () => fetch(`${API}/issuer`).then((r) => j<IssuerInfo>(r)),
  requestCredential: (holderCommit: bigint, country: number, kycLevel: number) =>
    fetch(`${API}/issuer/credential`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holderCommit: holderCommit.toString(), country, kycLevel }),
    }).then((r) => j<CredentialJSON>(r)),
  /** Record a public-network deployment (tUSD + platform fee key). Set-once on the server. */
  registerNetwork: (b: { tusd: { address: string; domain: string; faucetLimit: string }; platform: { feeKey: string; defaultFeeBps: number; name?: string } }) =>
    fetch(`${API}/networks/${NETWORK}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
      .then((r) => j<NetworkConfig>(r)),
  sales: () => fetch(`${API}/sales?network=${NETWORK}`).then((r) => j<SaleMeta[]>(r)),
  sale: (address: string) => fetch(`${API}/sales/${address}`).then((r) => (r.status === 404 ? null : j<SaleMeta>(r))),
  registerSale: (m: Omit<SaleMeta, 'createdAt' | 'network'>) =>
    fetch(`${API}/sales`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...m, network: NETWORK }) })
      .then((r) => j<SaleMeta>(r)),
};
