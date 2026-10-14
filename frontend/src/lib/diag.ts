// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Live transaction diagnostics shared by the dashboard ("Wallet connection" card), the privacy
// stepper (fee-window countdown) and error messages: which prover proved the last transaction,
// which indexer and wallet were used, and the balanced transaction's fee window.
import { useSyncExternalStore } from 'react';
import type { ProofReport } from '@duskpad/sdk';

export interface FeeWindow { attempt: number; expiresAt: number | null; balancedAt: number; submitted: boolean; rebalanceReason?: string }
export interface WaitInfo { reason: 'previous-tx' | 'wallet-pending'; since: number; retryAt?: number; retry?: number }
export interface Diag {
  wallet: string | null;
  walletKind: string | null;
  /** Set while DuskPad waits for an earlier transaction before asking the wallet to balance. */
  wait: WaitInfo | null;
  indexer: string | null;
  lastProof: ProofReport | null;
  fee: FeeWindow | null;
}

let state: Diag = { wallet: null, walletKind: null, wait: null, indexer: null, lastProof: null, fee: null };
const subs = new Set<() => void>();

export function getDiag(): Diag { return state; }
export function setDiag(patch: Partial<Diag>) { state = { ...state, ...patch }; subs.forEach((f) => f()); }
export function resetDiag() { setDiag({ wallet: null, walletKind: null, wait: null, indexer: null, lastProof: null, fee: null }); }
function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function useDiag(): Diag { return useSyncExternalStore(subscribe, getDiag, getDiag); }

const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');

/** "1AM in-wallet prover, 0 proofs (deploy), 0.4 s" */
export function describeProof(p: ProofReport | null): string {
  if (!p) return '—';
  const n = p.proofs === null ? '' : p.proofs === 0 ? ', no ZK proof needed' : `, ${p.proofs} proof${p.proofs === 1 ? '' : 's'}`;
  const t = `${(p.ms / 1000).toFixed(1)} s`;
  return `${p.prover}${n}, ${t}${p.ok ? '' : ' (failed)'} · ${new Date(p.at).toLocaleTimeString()}`;
}

/** One line appended to transaction errors so a report always says what was used. */
export function diagSuffix(d: Diag = state): string {
  const bits = [
    `Prover: ${d.lastProof ? d.lastProof.prover : 'not reached'}`,
    `Indexer: ${d.indexer ? host(d.indexer) : 'unknown'}`,
    `Wallet: ${d.wallet ?? 'not connected'}`,
  ];
  if (d.fee?.attempt && d.fee.attempt > 1) bits.push(`Balance attempts: ${d.fee.attempt}`);
  return bits.join(' · ');
}
