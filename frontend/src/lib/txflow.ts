// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Drives the "what's happening privately" stepper from REAL pipeline events emitted by the SDK
// (execute -> prove -> balance -> submit -> confirm). Local-only steps are marked done as they
// actually complete in the browser before the transaction is built.
import { useCallback, useRef, useState } from 'react';
import { explainError, type Action, type Stage, type TxResult } from '@duskpad/sdk';

export type StepStatus = 'pending' | 'active' | 'done' | 'error';
export type Exposure = 'private' | 'public' | 'mixed';
export interface Step { id: string; label: string; detail: string; exposure: Exposure; stage?: Stage | 'local'; status: StepStatus }

type StepDef = Omit<Step, 'status'>;

const CHAIN_STEPS = (proofDetail: string, balanceDetail: string): StepDef[] => [
  { id: 'execute', stage: 'execute', label: 'Run the circuit on your device', detail: 'Compact circuit executes locally with your private inputs as witnesses.', exposure: 'private' },
  { id: 'prove', stage: 'prove', label: 'Generate the zero-knowledge proof', detail: proofDetail, exposure: 'private' },
  { id: 'balance', stage: 'balance', label: 'Wallet balances the transaction', detail: balanceDetail, exposure: 'private' },
  { id: 'submit', stage: 'submit', label: 'Submit to Midnight', detail: 'Only the proof, nullifiers, commitments and public state changes are broadcast.', exposure: 'public' },
  { id: 'confirm', stage: 'confirm', label: 'Confirmed in a block', detail: 'The ledger re-checks the proof and rejects replays (spent nullifiers).', exposure: 'public' },
];

export const FLOWS: Partial<Record<Action, StepDef[]>> = {
  buy: [
    { id: 'vault', stage: 'local', label: 'Unlock your private vault', detail: 'Holder secret and issuer credential are read from encrypted local storage.', exposure: 'private' },
    { id: 'slot', stage: 'local', label: 'Pick an unused ticket slot i < N', detail: 'Your device checks which of your N nullifiers are unspent. Nobody else can compute them.', exposure: 'private' },
    ...CHAIN_STEPS('Proves: valid issuer signature, credential bound to you, country not blocked, KYC level, not expired, i < N, exact payment.',
      'Your wallet adds shielded tUSD inputs and change. Your coins never become public.'),
  ],
  refund: [
    { id: 'vault', stage: 'local', label: 'Re-derive your receipt secret', detail: 'From your master secret, sale id and ticket index.', exposure: 'private' },
    ...CHAIN_STEPS('Proves your receipt is in the sale\'s receipt tree via a Merkle path, without saying which one.', 'The contract pays one vault coin back to a fresh shielded output for you.'),
  ],
  claim: [
    { id: 'vault', stage: 'local', label: 'Re-derive your receipt secret', detail: 'Works from any wallet: only the vault (or its backup) is needed.', exposure: 'private' },
    ...CHAIN_STEPS('Proves ownership of an unclaimed receipt for this tranche; the buying wallet is never referenced.', 'The new sale tokens are minted straight to this wallet\'s shielded key.'),
  ],
  withdraw: [
    { id: 'vault', stage: 'local', label: 'Derive the project admin secret', detail: 'Only its hash (the project key) is on-chain.', exposure: 'private' },
    ...CHAIN_STEPS('Proves knowledge of the admin secret behind the project key.', 'The net amount goes to a shielded output; the fee coin stays in the fee vault.'),
  ],
  collectFee: [
    { id: 'vault', stage: 'local', label: 'Derive the platform secret', detail: 'Matches the fee key fixed at sale creation.', exposure: 'private' },
    ...CHAIN_STEPS('Proves knowledge of the platform secret.', 'The fee coin goes to a shielded output for the platform.'),
  ],
  deploy: [
    { id: 'vault', stage: 'local', label: 'Derive the project admin secret', detail: 'Bound to this sale id; only its hash is published.', exposure: 'private' },
    ...CHAIN_STEPS('The constructor validates every parameter and computes fee and tranche splits with checked witness division.', 'Your wallet pays the DUST fee for deployment.'),
  ],
  finalize: CHAIN_STEPS('Anyone can finalize once the sale has ended or sold out.', 'Your wallet pays the DUST fee.'),
  setup: [
    { id: 'key', stage: 'local', label: 'Derive the platform fee key', detail: 'A hash of your platform master secret; the secret itself stays in this browser.', exposure: 'private' },
    ...CHAIN_STEPS('Deploying needs no circuit proof; the wallet signs and the constructor state is published.', 'Your wallet pays the DUST fee (1AM sponsors it).'),
  ],
  mint: CHAIN_STEPS('Mint test tUSD from the faucet contract.', 'Minted coins are delivered to your shielded address.'),
};

export function useTxFlow() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TxResult | null>(null);
  const [running, setRunning] = useState(false);
  const stepsRef = useRef<Step[]>([]);

  const set = (next: Step[]) => { stepsRef.current = next; setSteps(next); };

  const advanceTo = (id: string) => {
    const idx = stepsRef.current.findIndex((s) => s.id === id);
    if (idx < 0) return;
    set(stepsRef.current.map((s, i) => ({ ...s, status: i < idx ? 'done' : i === idx ? 'active' : s.status === 'done' ? 'done' : 'pending' })));
  };

  const run = useCallback(async <T extends TxResult | { txHash: string }>(a: Action, fn: (onStage: (s: Stage) => void, markLocal: (id: string) => void) => Promise<T>): Promise<T | null> => {
    const defs = FLOWS[a] ?? [];
    setAction(a); setError(null); setResult(null); setRunning(true);
    set(defs.map((d, i) => ({ ...d, status: i === 0 ? 'active' : 'pending' })));
    const onStage = (s: Stage) => {
      if (s === 'done') { set(stepsRef.current.map((x) => ({ ...x, status: 'done' }))); return; }
      advanceTo(s);
    };
    const markLocal = (id: string) => {
      const idx = stepsRef.current.findIndex((s) => s.id === id);
      set(stepsRef.current.map((s, i) => ({ ...s, status: i <= idx ? 'done' : i === idx + 1 ? 'active' : s.status })));
    };
    try {
      const r = await fn(onStage, markLocal);
      set(stepsRef.current.map((x) => ({ ...x, status: 'done' })));
      setResult(r as TxResult);
      return r;
    } catch (e) {
      const msg = explainError(e);
      console.error(e);
      setError(msg);
      set(stepsRef.current.map((x) => (x.status === 'active' ? { ...x, status: 'error' } : x)));
      return null;
    } finally {
      setRunning(false);
    }
  }, []);

  const reset = useCallback(() => { set([]); setAction(null); setError(null); setResult(null); }, []);
  return { steps, action, error, result, running, run, reset };
}
