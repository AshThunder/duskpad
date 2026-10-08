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

// Indexers differ: the local standalone indexer offers `contract(address) { actions }`, while the
// public Preprod indexer (API v4) only has `contractAction(address, offset)`, where a block offset
// means "the action in exactly that block". So history is read with `contract.actions` when the
// schema has it, and otherwise by scanning the blocks between the deployment and the latest action
// (batched, within the indexer's query-complexity limit), cached and extended incrementally.
const ACTIONS_Q = `query($a: HexEncoded!, $n: Int) {
  contract(address: $a) {
    actions(limit: $n) {
      __typename
      ... on ContractCall { entryPoint }
      transaction { hash raw block { height timestamp } ... on RegularTransaction { fee transactionResult { status } } }
    }
  }
}`;

const LATEST_Q = `query($a: HexEncoded!) {
  contractAction(address: $a) {
    __typename
    transaction { hash block { height } }
    ... on ContractCall { deploy { transaction { block { height } } } }
  }
}`;

/** Blocks per request for the light scan / detail queries (Preprod rejects ~30 and ~20 as "too complex"). */
const SCAN_BATCH = 24;
const DETAIL_BATCH = 12;
const RAW_BATCH = 8;

export async function gql<T = any>(url: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`indexer HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map((e: any) => e.message).join('; '));
  return j.data as T;
}

export interface ActivityInfo {
  source: 'contract' | 'scan';
  /** Blocks read by the scan so far (scan only). */
  blocksScanned?: number;
  /** True when the scan stopped at `maxBlocks` and older history is not shown. */
  truncated?: boolean;
}

export interface ActivityOptions {
  /** Most blocks a scan reads back from the latest action (default 6000, about 10 hours on Preprod). */
  maxBlocks?: number;
  concurrency?: number;
  onInfo?: (info: ActivityInfo) => void;
}

const noContractField = (e: unknown) => /Unknown field "contract"|Cannot query field "contract"/i.test(String((e as any)?.message ?? e));
/** Indexers known to lack `contract(address)`, so they are not asked again. */
const scanOnly = new Set<string>();

interface ScanCache { from: number; to: number; items: ActivityItem[]; raw: Map<string, string>; truncated: boolean }
const scanCache = new Map<string, ScanCache>();

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); }
  }));
  return out;
}

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Heights (inclusive range) of blocks with a transaction that touched `address`. */
async function scanHeights(url: string, address: string, from: number, to: number, concurrency: number): Promise<number[]> {
  const heights = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const a = address.toLowerCase();
  const found = await pool(chunks(heights, SCAN_BATCH).map((hs) => async () => {
    const q = `{ ${hs.map((h) => `h${h}: block(offset: { height: ${h} }) { height transactions { contractActions { address } } }`).join(' ')} }`;
    const d = await gql<any>(url, q);
    return hs.filter((h) => (d[`h${h}`]?.transactions ?? []).some((t: any) => (t.contractActions ?? []).some((c: any) => String(c.address).toLowerCase() === a)));
  }), concurrency);
  return found.flat();
}

/** Full action details for the given blocks, newest first. */
async function blockActions(url: string, address: string, heights: number[], concurrency: number): Promise<ActivityItem[]> {
  const a = address.toLowerCase();
  const per = await pool(chunks(heights, DETAIL_BATCH).map((hs) => async () => {
    const q = `{ ${hs.map((h) => `h${h}: block(offset: { height: ${h} }) { height timestamp transactions { hash ... on RegularTransaction { fee transactionResult { status } } contractActions { __typename address ... on ContractCall { entryPoint } } } }`).join(' ')} }`;
    const d = await gql<any>(url, q);
    const items: ActivityItem[] = [];
    for (const h of hs) {
      const b = d[`h${h}`];
      for (const t of b?.transactions ?? []) {
        for (const c of t.contractActions ?? []) {
          if (String(c.address).toLowerCase() !== a) continue;
          items.push({
            entryPoint: c.__typename === 'ContractDeploy' ? 'deploy' : c.entryPoint ?? c.__typename,
            txHash: t.hash, height: b.height, timestamp: Number(b.timestamp),
            status: t.transactionResult?.status ?? 'SUCCESS', fee: t.fee,
          });
        }
      }
    }
    return items;
  }), concurrency);
  return per.flat().sort((x, y) => y.height - x.height);
}

async function rawTxs(url: string, hashes: string[], concurrency: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await pool(chunks(hashes, RAW_BATCH).map((hs) => async () => {
    const q = `{ ${hs.map((h, i) => `t${i}: transactions(offset: { hash: "${h}" }) { hash raw }`).join(' ')} }`;
    try {
      const d = await gql<any>(url, q);
      hs.forEach((_, i) => { for (const t of d[`t${i}`] ?? []) if (t?.raw) out.set(t.hash, t.raw); });
    } catch { /* raw is optional (used only for the effects drill-down) */ }
  }), concurrency);
  return out;
}

async function scanActivity(url: string, address: string, limit: number, withRaw: boolean, opts: ActivityOptions): Promise<ActivityItem[]> {
  const concurrency = opts.concurrency ?? 4;
  const maxBlocks = opts.maxBlocks ?? 6000;
  const d = await gql<any>(url, LATEST_Q, { a: address });
  const latest = d?.contractAction;
  if (!latest) { opts.onInfo?.({ source: 'scan', blocksScanned: 0 }); return []; }
  const top: number = latest.transaction.block.height;
  const deployH: number | undefined = latest.__typename === 'ContractDeploy' ? top : latest.deploy?.transaction?.block?.height;
  const floor = Math.max(deployH ?? 0, top - maxBlocks + 1);
  const key = `${url}|${address.toLowerCase()}`;
  let c = scanCache.get(key);
  if (!c || c.from > floor) {
    // Fresh scan; the deploy block is always included, even when the range is truncated.
    const hs = await scanHeights(url, address, floor, top, concurrency);
    if (deployH !== undefined && deployH < floor) hs.push(deployH);
    c = { from: floor, to: top, items: await blockActions(url, address, hs, concurrency), raw: new Map(), truncated: deployH === undefined || deployH < floor };
    scanCache.set(key, c);
  } else if (top > c.to) {
    const hs = await scanHeights(url, address, c.to + 1, top, concurrency);
    c.items = [...(await blockActions(url, address, hs, concurrency)), ...c.items];
    c.to = top;
  }
  opts.onInfo?.({ source: 'scan', blocksScanned: c.to - c.from + 1, truncated: c.truncated });
  const items = c.items.slice(0, limit);
  if (withRaw) {
    const missing = [...new Set(items.map((i) => i.txHash))].filter((h) => !c!.raw.has(h));
    if (missing.length) for (const [h, r] of await rawTxs(url, missing, concurrency)) c.raw.set(h, r);
    return items.map((i) => ({ ...i, raw: c!.raw.get(i.txHash) }));
  }
  return items.map((i) => ({ ...i }));
}

/** Contract activity, newest first: deploy + every call, with status, fee and (optionally) raw tx. */
export async function fetchSaleActivity(indexerUrl: string, address: string, limit = 200, withRaw = false, opts: ActivityOptions = {}): Promise<ActivityItem[]> {
  if (!scanOnly.has(indexerUrl)) {
    try {
      const d = await gql<any>(indexerUrl, ACTIONS_Q, { a: address, n: limit });
      opts.onInfo?.({ source: 'contract' });
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
    } catch (e) {
      if (!noContractField(e)) throw e;
      scanOnly.add(indexerUrl);
    }
  }
  return scanActivity(indexerUrl, address, limit, withRaw, opts);
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
