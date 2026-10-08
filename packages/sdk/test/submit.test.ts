// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// The 1AM sponsored-fee window: a balanced transaction whose fee intent expired must be
// re-balanced and re-submitted, and the wallet must always get back the exact hex it returned.
import { describe, it, expect } from 'vitest';
import { ContractDeploy, ContractState, CostModel, Intent, Transaction } from '@midnight-ntwrk/ledger-v8';
import { connectorWalletProviders, earliestTtl, explainError, isExpiredTxError, isPendingTxError, proofsNeeded, withProofReport, toHex } from '../src/index';

const noProver = { check: async () => { throw new Error('no circuits'); }, prove: async () => { throw new Error('no circuits'); } };

async function deployTx(ttlMs: number) {
  const intent = Intent.new(new Date(ttlMs)).addDeploy(new ContractDeploy(new ContractState()));
  const unproven = Transaction.fromParts('preprod', undefined, undefined, intent);
  return { unproven, bound: (await unproven.prove(noProver as any, CostModel.initialCostModel())).bind() };
}

const ERR_182 = { code: 'InternalError', reason: 'Operation failed: 1010: Invalid Transaction: Custom error: 182: (FiberFailure) SubmissionError: Transaction submission error' };

/** A fake 1AM: each balance returns a tx whose earliest TTL is `ttls[i]`; submit follows `submits`. */
async function fakeWallet(ttls: number[], submits: (unknown | null)[]) {
  const txs = await Promise.all(ttls.map((t) => deployTx(t)));
  // Upper-case + 0x prefix: only a verbatim pass-through matches what the wallet sent.
  const hexes = txs.map((t) => '0x' + toHex(t.bound.serialize()).toUpperCase());
  const calls = { balance: [] as string[], submit: [] as string[] };
  let b = 0, s = 0;
  const api = {
    balanceUnsealedTransaction: async (hex: string) => { calls.balance.push(hex); return { tx: hexes[Math.min(b++, hexes.length - 1)] }; },
    submitTransaction: async (hex: string) => { calls.submit.push(hex); const e = submits[s++]; if (e) throw e; },
  };
  return { api, calls, hexes, txs };
}

describe('1AM sponsored fee window (node error 182)', () => {
  const keys = { coinPublicKey: '00'.repeat(32), encryptionPublicKey: '00'.repeat(32) };

  it('reads the earliest intent TTL and classifies 182 as expired', async () => {
    const t = Date.now() + 45_000;
    const { bound } = await deployTx(t);
    expect(earliestTtl(bound)).toBe(Math.floor(t / 1000) * 1000);
    expect(isExpiredTxError(ERR_182)).toBe(true);
    expect(isExpiredTxError({ reason: 'Custom error: 138' })).toBe(false);
    expect(explainError(ERR_182)).toMatch(/fee window had already closed .*182/);
    expect(explainError({ reason: '1010: Invalid Transaction: Custom error: 199' })).toMatch(/ledger error 199/);
  });

  it('submits the exact hex the wallet returned from balancing', async () => {
    const w = await fakeWallet([Date.now() + 60_000], [null]);
    const p = connectorWalletProviders(w.api, keys);
    const { unproven } = await deployTx(Date.now() + 3_600_000);
    const balanced = await p.walletProvider.balanceTx(unproven as any);
    await p.midnightProvider.submitTx(balanced);
    expect(w.calls.submit).toEqual([w.hexes[0]]);
  });

  it('re-balances the same unsealed tx and re-submits when the node says 182', async () => {
    const w = await fakeWallet([Date.now() + 60_000, Date.now() + 61_000], [ERR_182, null]);
    const events: string[] = [];
    const p = connectorWalletProviders(w.api, keys, {
      onBalanced: ({ attempt }) => events.push(`balanced:${attempt}`),
      onRebalance: ({ attempt, reason }) => events.push(`rebalance:${attempt}:${reason}`),
      onSubmitted: ({ attempt }) => events.push(`submitted:${attempt}`),
    });
    const { unproven } = await deployTx(Date.now() + 3_600_000);
    const id = await p.midnightProvider.submitTx(await p.walletProvider.balanceTx(unproven as any));
    expect(w.calls.balance).toHaveLength(2);
    expect(w.calls.balance[0]).toBe(w.calls.balance[1]);
    expect(w.calls.submit).toEqual([w.hexes[0], w.hexes[1]]);
    expect(id).toBe(w.txs[1].bound.identifiers()[0]);
    expect(events).toEqual(['balanced:1', 'rebalance:2:node-rejected-expired', 'balanced:2', 'submitted:2']);
  });

  it('re-balances before submitting if the fee window already closed', async () => {
    const w = await fakeWallet([Date.now() - 5_000, Date.now() + 60_000], [null]);
    const p = connectorWalletProviders(w.api, keys);
    const { unproven } = await deployTx(Date.now() + 3_600_000);
    await p.midnightProvider.submitTx(await p.walletProvider.balanceTx(unproven as any));
    expect(w.calls.balance).toHaveLength(2);
    expect(w.calls.submit).toEqual([w.hexes[1]]);
  });

  it('gives up after maxRebalances and never retries a rejection', async () => {
    const w = await fakeWallet([Date.now() + 60_000], [ERR_182, ERR_182, ERR_182, ERR_182]);
    const p = connectorWalletProviders(w.api, keys, {}, { maxRebalances: 2 });
    const { unproven } = await deployTx(Date.now() + 3_600_000);
    await expect(p.midnightProvider.submitTx(await p.walletProvider.balanceTx(unproven as any))).rejects.toBe(ERR_182);
    expect(w.calls.submit).toHaveLength(3);

    const r = await fakeWallet([Date.now() + 60_000], [{ code: 'Rejected', reason: 'User rejected' }]);
    const p2 = connectorWalletProviders(r.api, keys);
    await expect(p2.midnightProvider.submitTx(await p2.walletProvider.balanceTx(unproven as any))).rejects.toMatchObject({ code: 'Rejected' });
    expect(r.calls.balance).toHaveLength(1);
  });

  it('reports which prover ran and how many proofs a deploy needs', async () => {
    const { unproven } = await deployTx(Date.now() + 3_600_000);
    expect(proofsNeeded(unproven)).toBe(0);
    const reports: any[] = [];
    const pp = withProofReport({ proveTx: async (tx: any) => tx }, '1AM in-wallet prover', (r) => reports.push(r));
    await pp.proveTx(unproven);
    expect(reports[0]).toMatchObject({ prover: '1AM in-wallet prover', proofs: 0, ok: true });
  });

  it('waits for the previous transaction, then retries when 1AM says one is already pending', async () => {
    const PENDING = { code: 'InternalError', reason: 'A transaction is already pending. Wait for it to confirm or expire before requesting another.' };
    expect(isPendingTxError(PENDING)).toBe(true);
    expect(isPendingTxError({ reason: 'PENDING_TRANSACTION: sponsor busy' })).toBe(true);
    expect(isPendingTxError(ERR_182)).toBe(false);
    expect(explainError(PENDING)).toMatch(/previous transaction pending/);
    expect(explainError({ reason: 'Unable to prepare unsealed DApp transaction for sponsored DUST' })).toMatch(/Pay with My Dust/);
    expect(explainError({ code: 'Rejected', reason: 'User declined to pay dust fee' })).toMatch(/Pay with My Dust/);

    const w = await fakeWallet([Date.now() + 60_000], [null]);
    let fails = 2;
    const inner = w.api.balanceUnsealedTransaction;
    w.api.balanceUnsealedTransaction = async (hex: string) => { if (fails-- > 0) throw PENDING; return inner(hex); };
    const log: string[] = [];
    const slept: number[] = [];
    const p = connectorWalletProviders(w.api, keys, {
      onWaitPending: ({ retry }) => log.push(`wait:${retry}`),
      onSubmitted: ({ txId }) => log.push(`submitted:${txId === w.txs[0].bound.identifiers()[0]}`),
    }, { beforeBalance: async () => { log.push('gate'); }, pendingDelayMs: 1234, sleep: async (ms) => { slept.push(ms); } });
    const { unproven } = await deployTx(Date.now() + 3_600_000);
    await p.midnightProvider.submitTx(await p.walletProvider.balanceTx(unproven as any));
    expect(log).toEqual(['gate', 'wait:1', 'wait:2', 'submitted:true']);
    expect(slept).toEqual([1234, 1234]);

    const w2 = await fakeWallet([Date.now() + 60_000], [null]);
    w2.api.balanceUnsealedTransaction = async () => { throw PENDING; };
    const p2 = connectorWalletProviders(w2.api, keys, {}, { pendingRetries: 3, sleep: async () => {} });
    await expect(p2.walletProvider.balanceTx(unproven as any)).rejects.toBe(PENDING);
  });
});
