// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// Simulator harness: runs sale.compact circuits in-process with compact-runtime, with a
// controllable block time. No network and no proofs; the same circuit logic is enforced.
import * as rt from '@midnight-ntwrk/compact-runtime';
import * as Sale from '@duskpad/contracts/sale';
import {
  adminKeyOf, deriveAdminSecret, deriveHolderSecret, deriveReceiptSecret, derivePlatformSecret, holderCommitment,
  pad32, pointOf, random32, saleWitnesses, scalarFrom, signCredential, toSaleParams,
  type Credential, type SaleInput, type SaleIntent,
} from '@duskpad/sdk';

export const ISSUER_SK = scalarFrom(pad32('duskpad-test-issuer'));
export const ROGUE_SK = scalarFrom(pad32('duskpad-rogue-issuer'));
export const AUDITOR_SK = scalarFrom(pad32('duskpad-test-auditor'));
export const PAY_COLOR = '11'.repeat(32);
export const PRICE = 1_000_000_000n; // 1,000 tUSD
export const T0 = 1_800_000_000;     // sale start (unix s)

export interface Person { name: string; master: Uint8Array; hs: Uint8Array; cred: Credential }

export function person(name: string, opts: { country?: number; kyc?: number; expiry?: number; issuerSk?: bigint } = {}): Person {
  const master = pad32('master-' + name);
  const hs = deriveHolderSecret(master);
  const cred = signCredential(opts.issuerSk ?? ISSUER_SK, {
    holderCommit: holderCommitment(hs),
    country: opts.country ?? 566,
    kycLevel: opts.kyc ?? 2,
    expiry: opts.expiry ?? T0 + 1_000_000,
  });
  return { name, master, hs, cred };
}

export const PROJECT_MASTER = pad32('master-project');
export const PLATFORM_MASTER = pad32('master-platform');

export function saleInput(over: Partial<SaleInput> = {}): SaleInput {
  return {
    kind: 'fixedPrice',
    payColor: PAY_COLOR,
    ticketPrice: PRICE,
    tokensPerTicket: 100_000_000n,
    softCap: 2,
    hardCap: 4,
    maxPerPerson: 2,
    start: T0,
    end: T0 + 3600,
    cliff: T0 + 7200,
    tranches: 3,
    trancheInterval: 600,
    feeBps: 250,
    feeKey: adminKeyOf(derivePlatformSecret(PLATFORM_MASTER)),
    saleId: pad32('sale-under-test'),
    tokenDomain: pad32('dusk:token:TEST'),
    nonceSeed: pad32('nonce-seed'),
    issuerPk: pointOf(ISSUER_SK),
    minKyc: 1,
    blockedCountries: [408, 364],
    auditorPk: null,
    ...over,
  };
}

const CPK = '00'.repeat(32);

export class SaleSim {
  readonly address = rt.sampleContractAddress();
  readonly intent: SaleIntent = {};
  readonly contract = new Sale.Contract(saleWitnesses<object>(this.intent));
  readonly saleId: Uint8Array;
  state: any;
  time: number;

  constructor(readonly input: SaleInput, adminMaster = PROJECT_MASTER) {
    this.saleId = input.saleId;
    this.intent.adminSecret = deriveAdminSecret(adminMaster, input.saleId);
    const init = this.contract.initialState(rt.createConstructorContext({}, CPK), toSaleParams(input));
    this.state = init.currentContractState;
    this.time = input.start;
  }

  get ledger(): Sale.Ledger {
    return Sale.ledger(this.state.data ?? this.state);
  }

  /** Run a circuit at the current block time; commits the new state only on success. */
  call(circuit: keyof Sale.ImpureCircuits<object>, intent: Partial<SaleIntent>, ...args: any[]) {
    Object.assign(this.intent, { credential: undefined, holderSecret: undefined, ticketIndex: undefined, receiptSecret: undefined, auditNonce: undefined }, intent);
    const ctx = rt.createCircuitContext(this.address, CPK, this.state, {}, undefined, undefined, this.time);
    const r = (this.contract.impureCircuits as any)[circuit](ctx, ...args);
    this.state = r.context.currentQueryContext.state;
    return r;
  }

  buy(p: Person, idx: number, opts: { color?: string; value?: bigint; cred?: Credential; hs?: Uint8Array } = {}) {
    return this.call('buyTicket', {
      credential: opts.cred ?? p.cred,
      holderSecret: opts.hs ?? p.hs,
      ticketIndex: BigInt(idx),
      receiptSecret: deriveReceiptSecret(p.master, this.saleId, idx),
    }, { nonce: random32(), color: hexBytes(opts.color ?? this.input.payColor), value: opts.value ?? this.input.ticketPrice });
  }

  vaultCoin(i = 0) { return [...this.ledger.vault][i]; }
  feeCoin(i = 0) { return [...this.ledger.feeVault][i]; }

  refund(p: Person, idx: number, coin = this.vaultCoin()) {
    return this.call('refund', { receiptSecret: deriveReceiptSecret(p.master, this.saleId, idx) }, coin);
  }

  claim(p: Person, idx: number, tranche: number) {
    return this.call('claim', { receiptSecret: deriveReceiptSecret(p.master, this.saleId, idx) }, BigInt(tranche));
  }

  withdraw(adminSecret: Uint8Array, coin = this.vaultCoin(), to = { bytes: pad32('project-payout') }) {
    return this.call('withdraw', { adminSecret }, coin, to);
  }

  collectFee(adminSecret: Uint8Array, coin = this.feeCoin(), to = { bytes: pad32('platform-payout') }) {
    return this.call('collectFee', { adminSecret }, coin, to);
  }

  finalize() { return this.call('finalize', {}); }
}

export function hexBytes(h: string) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export const projectAdmin = (saleId: Uint8Array) => deriveAdminSecret(PROJECT_MASTER, saleId);
export const platformAdmin = () => derivePlatformSecret(PLATFORM_MASTER);
