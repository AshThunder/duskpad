// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Midnight.js providers for the browser, built only from the DApp Connector v4 ConnectedAPI.
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { LedgerParameters, ZswapChainState } from '@midnight-ntwrk/ledger-v8';
import { connectorProofProvider, connectorWalletProviders, proofProviderWithFallback } from '@duskpad/sdk';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { fromHex } from './hex';
import { IS_LOCAL, type Endpoints } from './config';

export type ContractKind = 'sale' | 'tusd';

async function latestAction(indexer: string, query: string, address: string) {
  const r = await fetch(indexer, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: address } }),
  });
  if (!r.ok) throw new Error(`Indexer HTTP error: ${r.status}`);
  const j = await r.json();
  if (j?.errors?.length) throw new Error(j.errors.map((e: any) => e.message).join('; '));
  return j?.data?.contractAction ?? null;
}

/**
 * Public data provider. On Preprod the latest-state queries go through `contractAction(address)`
 * without an offset, as the 1AM integration notes recommend (the preview/preprod indexers have had
 * an `offset: null` bug). If that direct query fails, the stock Midnight.js query is tried.
 */
export function publicDataProvider(ep: Endpoints) {
  const base: any = indexerPublicDataProvider(ep.indexer, ep.indexerWs);
  if (IS_LOCAL) return base;
  return {
    ...base,
    async queryContractState(address: string, config?: unknown) {
      if (config) return base.queryContractState(address, config);
      try {
        const a = await latestAction(ep.indexer, 'query($a: HexEncoded!){ contractAction(address: $a) { state } }', address);
        return a?.state ? ContractState.deserialize(fromHex(a.state)) : null;
      } catch (e) {
        console.warn('[duskpad] direct contract-state query failed, using Midnight.js query', e);
        return base.queryContractState(address);
      }
    },
    async queryZSwapAndContractState(address: string, config?: unknown) {
      if (config) return base.queryZSwapAndContractState(address, config);
      try {
        const a = await latestAction(ep.indexer,
          'query($a: HexEncoded!){ contractAction(address: $a) { state zswapState transaction { block { ledgerParameters } } } }', address);
        if (!a?.zswapState) return null;
        const params = a.transaction?.block?.ledgerParameters;
        return [
          ZswapChainState.deserialize(fromHex(a.zswapState)),
          ContractState.deserialize(fromHex(a.state)),
          params ? LedgerParameters.deserialize(fromHex(params)) : LedgerParameters.initialParameters(),
        ];
      } catch (e) {
        console.warn('[duskpad] direct zswap+contract query failed, using Midnight.js query', e);
        return base.queryZSwapAndContractState(address);
      }
    },
  };
}

/** ZK assets are served by the app itself (`/zk/<kind>/{keys,zkir}`), with CORS enabled by the preview server. */
export function zkConfig(kind: ContractKind) {
  return new FetchZkConfigProvider(new URL(`/zk/${kind}`, window.location.origin).toString(), window.fetch.bind(window));
}

/** Private state is unused by DuskPad circuits (secrets come from the vault), so memory suffices. */
export function memoryPrivateStateProvider() {
  let scope = '';
  const states = new Map<string, unknown>();
  const keys = new Map<string, unknown>();
  return {
    setContractAddress(a: string) { scope = a; },
    async set(id: string, s: unknown) { states.set(`${scope}:${id}`, s); },
    async get(id: string) { return states.get(`${scope}:${id}`) ?? null; },
    async remove(id: string) { states.delete(`${scope}:${id}`); },
    async clear() { states.clear(); },
    async setSigningKey(a: string, k: unknown) { keys.set(a, k); },
    async getSigningKey(a: string) { return keys.get(a) ?? null; },
    async removeSigningKey(a: string) { keys.delete(a); },
    async clearSigningKeys() { keys.clear(); },
    async exportPrivateStates(): Promise<never> { throw new Error('not supported'); },
    async importPrivateStates(): Promise<never> { throw new Error('not supported'); },
    async exportSigningKeys(): Promise<never> { throw new Error('not supported'); },
    async importSigningKeys(): Promise<never> { throw new Error('not supported'); },
  };
}

export interface WalletKeys { coinPublicKey: string; encryptionPublicKey: string }
export type ProvingMode = 'wallet' | 'proof-server';

/**
 * Providers for one contract kind. Proving order: the wallet's getProvingProvider (1AM in-extension
 * or ProofStation; newer Lace builds proxy to Lace's proof-server setting), then the proof server in
 * `ep.prover` if the wallet lacks the method or its prover fails for a technical reason.
 */
export async function walletProviders(api: ConnectedAPI, keys: WalletKeys, ep: Endpoints, networkId: string, kind: ContractKind,
  opts: { useWalletProver: boolean; onProvingMode?: (m: ProvingMode, why?: string) => void }) {
  setNetworkId(networkId as any);
  const zk = zkConfig(kind);
  let walletProof: any = null;
  if (opts.useWalletProver) {
    try { walletProof = await connectorProofProvider(api as any, zk); }
    catch (e) { console.warn('[duskpad] wallet proving unavailable, using the proof server', e); }
  }
  let server: any = null;
  const serverProof = () => (server ??= httpClientProofProvider(ep.prover, zk));
  opts.onProvingMode?.(walletProof ? 'wallet' : 'proof-server', walletProof ? undefined : 'wallet has no getProvingProvider');
  const proofProvider = proofProviderWithFallback(walletProof, serverProof, (e) => {
    console.warn('[duskpad] wallet prover failed, retrying on the proof server', e);
    opts.onProvingMode?.('proof-server', String((e as any)?.message ?? e));
  });
  return {
    privateStateProvider: memoryPrivateStateProvider(),
    publicDataProvider: publicDataProvider(ep),
    zkConfigProvider: zk,
    proofProvider,
    ...connectorWalletProviders(api as any, keys),
  } as any;
}
