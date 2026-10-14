// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Sale activity on indexers with and without `contract(address) { actions }` (Preprod has only
// `contractAction`, whose block offset means "exactly that block").
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchSaleActivity } from '../src/index';

const A = 'ab'.repeat(32);
// A fake chain: blocks 100..160, our contract deployed at 100, bought at 120 (two txs), finalized at 150.
const chain: Record<number, { ts: number; txs: { hash: string; acts: { t: string; e?: string; a: string }[] }[] }> = {};
for (let h = 100; h <= 160; h++) chain[h] = { ts: 1_000_000 + h * 6000, txs: [] };
chain[100].txs.push({ hash: 'd0', acts: [{ t: 'ContractDeploy', a: A }] });
chain[110].txs.push({ hash: 'x0', acts: [{ t: 'ContractCall', e: 'other', a: 'cd'.repeat(32) }] });
chain[120].txs.push({ hash: 'b1', acts: [{ t: 'ContractCall', e: 'buyTicket', a: A }] }, { hash: 'b2', acts: [{ t: 'ContractCall', e: 'buyTicket', a: A }] });
chain[150].txs.push({ hash: 'f1', acts: [{ t: 'ContractCall', e: 'finalize', a: A }] });

let requests: string[] = [];
function mockIndexer(withContractField: boolean) {
  requests = [];
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    const { query } = JSON.parse(init.body);
    requests.push(query);
    const json = (data: any) => ({ ok: true, json: async () => data });
    if (/contract\(address/.test(query)) {
      if (!withContractField) return json({ errors: [{ message: 'Unknown field "contract" on type "Query". Did you mean "contractAction"?' }] });
      return json({ data: { contract: { actions: [] } } });
    }
    if (/contractAction\(/.test(query)) {
      const top = Math.max(...Object.keys(chain).map(Number).filter((h) => chain[h].txs.some((t) => t.acts.some((x) => x.a === A))));
      return json({ data: { contractAction: { __typename: 'ContractCall', transaction: { hash: 'f1', block: { height: top } }, deploy: { transaction: { block: { height: 100 } } } } } });
    }
    const aliases = [...query.matchAll(/(h\d+): block\(offset: \{ height: (\d+) \}\)/g)];
    if (aliases.length) {
      const data: any = {};
      for (const [, k, h] of aliases) {
        const b = chain[Number(h)];
        data[k] = b && { height: Number(h), timestamp: b.ts, transactions: b.txs.map((t) => ({ hash: t.hash, fee: '7', transactionResult: { status: 'SUCCESS' }, contractActions: t.acts.map((x) => ({ __typename: x.t, address: x.a, entryPoint: x.e })) })) };
      }
      return json({ data });
    }
    const raws = [...query.matchAll(/(t\d+): transactions\(offset: \{ hash: "(\w+)" \}\)/g)];
    if (raws.length) return json({ data: Object.fromEntries(raws.map(([, k, h]) => [k, [{ hash: h, raw: `00${h}` }]])) });
    throw new Error('unexpected query ' + query);
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('sale activity', () => {
  it('falls back to a block scan when the indexer has no contract(address) field, and refreshes incrementally', async () => {
    mockIndexer(false);
    const url = 'https://preprod.example/graphql';
    let info: any;
    const acts = await fetchSaleActivity(url, A, 500, true, { onInfo: (i) => (info = i) });
    expect(acts.map((a) => `${a.height}:${a.entryPoint}`)).toEqual(['150:finalize', '120:buyTicket', '120:buyTicket', '100:deploy']);
    expect(acts[0]).toMatchObject({ txHash: 'f1', status: 'SUCCESS', fee: '7', raw: '00f1', timestamp: 1_000_000 + 150 * 6000 });
    expect(info).toEqual({ source: 'scan', blocksScanned: 51, truncated: false });
    // Every scan request stays within the complexity budget.
    for (const q of requests) expect((q.match(/block\(offset/g) ?? []).length).toBeLessThanOrEqual(24);

    // A new call lands at 158: the refresh scans only blocks 151..158 and does not re-ask for contract(address).
    chain[158].txs.push({ hash: 'w1', acts: [{ t: 'ContractCall', e: 'withdraw', a: A }] });
    requests = [];
    const again = await fetchSaleActivity(url, A, 500, false);
    expect(again.map((a) => a.entryPoint)).toEqual(['withdraw', 'finalize', 'buyTicket', 'buyTicket', 'deploy']);
    expect(requests.some((q) => /contract\(address/.test(q))).toBe(false);
    const scanned = requests.flatMap((q) => [...q.matchAll(/height: (\d+)/g)].map((m) => Number(m[1])));
    expect(Math.min(...scanned)).toBeGreaterThanOrEqual(151);
  });

  it('marks history as truncated past maxBlocks but still includes the deployment', async () => {
    mockIndexer(false);
    let info: any;
    const acts = await fetchSaleActivity('https://other.example/graphql', A, 500, false, { maxBlocks: 20, onInfo: (i) => (info = i) });
    expect(acts.map((a) => a.entryPoint)).toEqual(['withdraw', 'finalize', 'deploy']);
    expect(info).toMatchObject({ source: 'scan', truncated: true });
  });

  it('uses contract(address).actions when the indexer has it', async () => {
    mockIndexer(true);
    let info: any;
    await fetchSaleActivity('http://local.example/graphql', A, 10, false, { onInfo: (i) => (info = i) });
    expect(info).toEqual({ source: 'contract' });
    expect(requests).toHaveLength(1);
  });
});
