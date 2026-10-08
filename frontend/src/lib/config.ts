// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
export type NetworkId = 'undeployed' | 'preprod';

export const NETWORK: NetworkId = (import.meta.env.VITE_NETWORK as NetworkId) ?? 'undeployed';
export const API = import.meta.env.VITE_API_URL ?? '/api';
export const IS_LOCAL = NETWORK === 'undeployed';

export interface Endpoints { indexer: string; indexerWs: string; prover: string }

export function localEndpoints(): Endpoints {
  const o = window.location.origin;
  return {
    indexer: `${o}/indexer/api/v4/graphql`,
    indexerWs: `${o.replace(/^http/, 'ws')}/indexer/api/v4/graphql/ws`,
    prover: `${o}/prover`,
  };
}

export const PREPROD: Endpoints = {
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWs: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  prover: import.meta.env.VITE_PREPROD_PROVER ?? 'http://127.0.0.1:6300',
};

/** Endpoints used for public reads (no wallet needed). */
export const publicEndpoints = (): Endpoints => (IS_LOCAL ? localEndpoints() : PREPROD);

export const NETWORK_LABEL: Record<NetworkId, string> = { undeployed: 'Local devnet', preprod: 'Midnight Preprod' };
