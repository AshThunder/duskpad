// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Midnight.js wallet + midnight providers built ONLY from a DApp Connector v4 ConnectedAPI
// (1AM, Lace, or any compliant wallet). Shared by the web app and the e2e suite, so the e2e
// "W-*" tests exercise the exact code the browser runs.
import { CostModel, Transaction } from '@midnight-ntwrk/ledger-v8';
import { fromHex, toHex } from './bytes.js';

export interface ConnectorKeys { coinPublicKey: string; encryptionPublicKey: string }

/** The subset of ConnectedAPI that DuskPad needs to build, balance and submit transactions. */
export interface ConnectorLike {
  balanceUnsealedTransaction(tx: string, options?: unknown): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<void>;
  getProvingProvider?(keyMaterialProvider: unknown): Promise<unknown>;
}

export function connectorWalletProviders(api: ConnectorLike, keys: ConnectorKeys) {
  return {
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
  };
}

/** Ask the wallet to prove (1AM does this in-extension). Returns null if unsupported. */
export async function connectorProofProvider(api: ConnectorLike, zkConfigProvider: unknown) {
  if (typeof api.getProvingProvider !== 'function') return null;
  const pp = await api.getProvingProvider(zkConfigProvider);
  return { proveTx: (tx: any) => tx.prove(pp, CostModel.initialCostModel()) };
}
