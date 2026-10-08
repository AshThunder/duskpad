// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Midnight.js providers for the browser, built only from the DApp Connector v4 ConnectedAPI.
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { CostModel, Transaction } from '@midnight-ntwrk/ledger-v8';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { fromHex, toHex } from './hex';
import { IS_LOCAL, type Endpoints } from './config';

export type ContractKind = 'sale' | 'tusd';

/**
 * Public data provider. On Preprod the latest-state queries are routed through
 * `contractAction { state }` (the 1AM integration notes report `offset: null` issues there).
 */
export function publicDataProvider(ep: Endpoints) {
  const base: any = indexerPublicDataProvider(ep.indexer, ep.indexerWs);
  if (IS_LOCAL) return base;
  return {
    ...base,
    async queryContractState(address: string, config?: unknown) {
      if (config) return base.queryContractState(address, config);
      const r = await fetch(ep.indexer, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'query($a: HexEncoded!){ contractAction(address: $a) { state } }', variables: { a: address } }),
      });
      const j = await r.json();
      const s = j?.data?.contractAction?.state;
      return s ? ContractState.deserialize(fromHex(s)) : null;
    },
  };
}

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

export async function walletProviders(api: ConnectedAPI, keys: WalletKeys, ep: Endpoints, networkId: string, kind: ContractKind,
  opts: { useWalletProver: boolean }) {
  setNetworkId(networkId as any);
  const zk = zkConfig(kind);
  let proofProvider: any = null;
  if (opts.useWalletProver && typeof (api as any).getProvingProvider === 'function') {
    try {
      const pp = await (api as any).getProvingProvider(zk);
      proofProvider = { proveTx: (tx: any) => tx.prove(pp, CostModel.initialCostModel()) };
    } catch (e) {
      console.warn('[duskpad] wallet proving unavailable, falling back to proof server', e);
    }
  }
  proofProvider ??= httpClientProofProvider(ep.prover, zk);
  return {
    privateStateProvider: memoryPrivateStateProvider(),
    publicDataProvider: publicDataProvider(ep),
    zkConfigProvider: zk,
    proofProvider,
    walletProvider: {
      getCoinPublicKey: () => keys.coinPublicKey,
      getEncryptionPublicKey: () => keys.encryptionPublicKey,
      balanceTx: async (tx: any) => {
        const r = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
        if (!r?.tx) throw new Error('wallet returned no transaction');
        return Transaction.deserialize('signature', 'proof', 'binding', fromHex(r.tx));
      },
    },
    midnightProvider: {
      submitTx: async (tx: any) => {
        await api.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    },
  } as any;
}
