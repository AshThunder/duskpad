// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { describe, it, expect } from 'vitest';
import * as rt from '@midnight-ntwrk/compact-runtime';
import * as Tusd from '@duskpad/contracts/tusd';
import { pad32 } from '@duskpad/sdk';

const CPK = '00'.repeat(32);
function deploy(cap = 1_000n) {
  const c = new Tusd.Contract({});
  const init = c.initialState(rt.createConstructorContext({}, CPK), pad32('tUSD'), pad32('seed'), cap);
  return { c, state: init.currentContractState as any, address: rt.sampleContractAddress() };
}
function call(d: ReturnType<typeof deploy>, circuit: 'mint' | 'mintTo', ...args: any[]) {
  const ctx = rt.createCircuitContext(d.address, CPK, d.state, {});
  const r = (d.c.impureCircuits as any)[circuit](ctx, ...args);
  d.state = r.context.currentQueryContext.state;
  return r;
}

describe('tUSD faucet', () => {
  it('mints within the faucet limit and counts mints', () => {
    const d = deploy();
    call(d, 'mint', 1_000n);
    call(d, 'mintTo', 5n, { bytes: pad32('someone') });
    expect(Tusd.ledger(d.state).mints).toBe(2n);
  });
  it('rejects zero and over-limit mints', () => {
    const d = deploy();
    expect(() => call(d, 'mint', 0n)).toThrow(/faucet limit/);
    expect(() => call(d, 'mint', 1_001n)).toThrow(/faucet limit/);
  });
  it('the token color is derived off-chain from domain and address', () => {
    const d = deploy();
    const a = rt.rawTokenType(pad32('tUSD'), d.address);
    const b = rt.rawTokenType(pad32('tUSD'), rt.sampleContractAddress());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
