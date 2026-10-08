// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Public sale report: everything here is read from the indexer, i.e. exactly what any
// observer of the chain can see. No wallet or private state is involved.

export interface ActivityItem {
  entryPoint: string;   // 'deploy' for the deployment
  txHash: string;
  height: number;
  timestamp: number;    // ms
  status: string;
  fee?: string;         // DUST (specks), paid by the submitting wallet
  raw?: string;
}

const ACTIONS_Q = `query($a: HexEncoded!, $n: Int) {
  contract(address: $a) {
    actions(limit: $n) {
      __typename
      ... on ContractCall { entryPoint }
      transaction { hash raw block { height timestamp } ... on RegularTransaction { fee transactionResult { status } } }
    }
  }
}`;

export async function gql<T = any>(url: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`indexer HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map((e: any) => e.message).join('; '));
  return j.data as T;
}

export async function fetchSaleActivity(indexerUrl: string, address: string, limit = 200, withRaw = false): Promise<ActivityItem[]> {
  const d = await gql<any>(indexerUrl, ACTIONS_Q, { a: address, n: limit });
  const acts = d?.contract?.actions ?? [];
  return acts.map((a: any) => ({
    entryPoint: a.__typename === 'ContractDeploy' ? 'deploy' : a.entryPoint ?? a.__typename,
    txHash: a.transaction.hash,
    height: a.transaction.block.height,
    timestamp: Number(a.transaction.block.timestamp),
    status: a.transaction.transactionResult?.status ?? 'SUCCESS',
    fee: a.transaction.fee,
    raw: withRaw ? a.transaction.raw : undefined,
  }));
}

export async function chainTip(indexerUrl: string): Promise<{ height: number; timestamp: number }> {
  const d = await gql<any>(indexerUrl, '{ block { height timestamp } }');
  return { height: d.block.height, timestamp: Number(d.block.timestamp) };
}

export interface TxEffects {
  shieldedInputs: number;         // nullifiers revealed
  shieldedOutputs: number;        // commitments created
  contractInputs: number;         // coins spent by a contract
  contractOutputs: number;        // coins created for a contract
  deltas: Record<string, string>; // per token color: net value balance of the offer
}

/** Decode a raw transaction into the shielded effects an observer can count. */
export async function decodeTxEffects(rawHex: string): Promise<TxEffects | null> {
  try {
    const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
    const bytes = new Uint8Array(rawHex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(rawHex.slice(i * 2, i * 2 + 2), 16);
    const tx: any = Transaction.deserialize('signature', 'proof', 'binding', bytes);
    const offers: any[] = [tx.guaranteedOffer, ...(tx.fallibleOffer ? [...tx.fallibleOffer.values()] : [])].filter(Boolean);
    const eff: TxEffects = { shieldedInputs: 0, shieldedOutputs: 0, contractInputs: 0, contractOutputs: 0, deltas: {} };
    for (const o of offers) {
      eff.shieldedInputs += o.inputs.length;
      eff.shieldedOutputs += o.outputs.length;
      eff.contractInputs += o.inputs.filter((i: any) => i.contractAddress).length;
      eff.contractOutputs += o.outputs.filter((x: any) => x.contractAddress).length;
      for (const [k, v] of o.deltas.entries()) eff.deltas[String(k)] = String(v);
    }
    return eff;
  } catch {
    return null;
  }
}
