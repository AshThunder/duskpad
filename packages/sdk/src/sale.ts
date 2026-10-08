// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Sale parameters, witnesses and read models for sale.compact.
import * as rt from '@midnight-ntwrk/compact-runtime';
import * as Sale from '@duskpad/contracts/sale';
import { fromHex, toHex } from './bytes.js';
import { attrVector, MASK128, pointOf, type Credential, type Point } from './credential.js';
import { buyNullifier, claimNullifier, receiptLeaf, refundNullifier } from './hash.js';
import { deriveHolderSecret, deriveReceiptSecret } from './secrets.js';

export { Sale };
export type SaleKindName = 'fixedPrice' | 'firstCome';
export type PhaseName = 'live' | 'succeeded' | 'failed';
export const PHASES: PhaseName[] = ['live', 'succeeded', 'failed'];
export const KINDS: SaleKindName[] = ['fixedPrice', 'firstCome'];
export const MAX_TRANCHES = 48;
export const MAX_FEE_BPS = 2000;

export interface SaleInput {
  kind: SaleKindName;
  payColor: string;            // hex token color of the payment stablecoin
  ticketPrice: bigint;         // base units
  tokensPerTicket: bigint;     // base units
  softCap: number;
  hardCap: number;
  maxPerPerson: number;
  start: number;               // unix seconds
  end: number;
  cliff: number;
  tranches: number;
  trancheInterval: number;     // seconds
  feeBps: number;
  feeKey: Uint8Array;          // adminKeyOf(platformSecret)
  saleId: Uint8Array;          // random 32 bytes
  tokenDomain: Uint8Array;     // pad32 of something unique-ish, e.g. "dusk:token:SYMBOL"
  nonceSeed: Uint8Array;
  issuerPk: Point;
  minKyc: number;
  blockedCountries: number[];  // up to 4 ISO numeric codes
  auditorPk?: Point | null;    // set => auditor disclosure enabled
}

/** Mirrors the constructor's assertions so the UI can reject bad input before proving. */
export function validateSaleInput(s: SaleInput): string[] {
  const e: string[] = [];
  if (s.hardCap <= 0) e.push('Hard cap must be at least 1 ticket.');
  if (s.softCap > s.hardCap) e.push('Soft cap cannot exceed the hard cap.');
  if (s.kind === 'firstCome' && s.softCap !== 0) e.push('First-come sales have no soft cap.');
  if (s.maxPerPerson <= 0) e.push('Allow at least one ticket per person.');
  if (s.maxPerPerson > 65535) e.push('Per-person cap is too large.');
  if (s.ticketPrice <= 0n) e.push('Ticket price must be positive.');
  if (s.tokensPerTicket <= 0n) e.push('Tokens per ticket must be positive.');
  if (s.start >= s.end) e.push('The sale must start before it ends.');
  if (s.cliff < s.end) e.push('The vesting cliff cannot be before the sale ends.');
  if (s.tranches < 1 || s.tranches > MAX_TRANCHES) e.push(`Use 1 to ${MAX_TRANCHES} vesting tranches.`);
  if (s.tranches > 1 && s.trancheInterval <= 0) e.push('Tranche interval must be positive.');
  if (s.feeBps < 0 || s.feeBps > MAX_FEE_BPS) e.push('Platform fee must be between 0 and 20%.');
  if (s.blockedCountries.length > 4) e.push('At most 4 blocked countries.');
  if (s.minKyc < 0 || s.minKyc > 3) e.push('KYC level must be 0 to 3.');
  if (s.payColor.replace(/^0x/, '').length !== 64) e.push('Payment token color must be 32 bytes.');
  return e;
}

export function toSaleParams(s: SaleInput): Sale.SaleParams {
  const errs = validateSaleInput(s);
  if (errs.length) throw new Error(errs.join(' '));
  const blocked = [...s.blockedCountries.map(BigInt), 0n, 0n, 0n, 0n].slice(0, 4);
  return {
    kind: s.kind === 'fixedPrice' ? Sale.SaleKind.fixedPrice : Sale.SaleKind.firstCome,
    payColor: fromHex(s.payColor),
    ticketPrice: s.ticketPrice,
    tokensPerTicket: s.tokensPerTicket,
    softCapTickets: BigInt(s.softCap),
    hardCapTickets: BigInt(s.hardCap),
    maxTicketsPerPerson: BigInt(s.maxPerPerson),
    startTime: BigInt(s.start),
    endTime: BigInt(s.end),
    cliffTime: BigInt(s.cliff),
    trancheCount: BigInt(s.tranches),
    trancheInterval: BigInt(s.tranches > 1 ? s.trancheInterval : 0),
    feeBps: BigInt(s.feeBps),
    feeKey: s.feeKey,
    saleId: s.saleId,
    tokenDomain: s.tokenDomain,
    nonceSeed: s.nonceSeed,
    issuerPk: s.issuerPk,
    minKyc: BigInt(s.minKyc),
    blockedCountries: blocked,
    auditorEnabled: !!s.auditorPk,
    // A valid curve point is still required when the auditor is disabled.
    auditorPk: s.auditorPk ?? pointOf(1n),
  };
}

// ---------------------------------------------------------------------------------------
// Witnesses. The circuit asks for private inputs through these callbacks; an `intent`
// object is filled in by the caller right before each transaction.

export interface SaleIntent {
  credential?: Credential;
  holderSecret?: Uint8Array;
  ticketIndex?: bigint;
  receiptSecret?: Uint8Array;
  adminSecret?: Uint8Array;
  auditNonce?: bigint;
}

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`missing private input: ${what}`);
  return v;
};

export function saleWitnesses<PS>(intent: SaleIntent): Sale.Witnesses<PS> {
  return {
    credAttrs: ({ privateState }) => [privateState, attrVector(need(intent.credential, 'credential').attrs)],
    sigR: ({ privateState }) => [privateState, need(intent.credential, 'credential').R],
    sigS: ({ privateState }) => [privateState, need(intent.credential, 'credential').s],
    splitChallenge: ({ privateState }, e) => [privateState, [e >> 128n, e & MASK128]],
    holderSecret: ({ privateState }) => [privateState, need(intent.holderSecret, 'holder secret')],
    ticketIndex: ({ privateState }) => [privateState, need(intent.ticketIndex, 'ticket index')],
    receiptSecret: ({ privateState }) => [privateState, need(intent.receiptSecret, 'receipt secret')],
    receiptPath: ({ privateState, ledger }, leaf) => {
      const p = ledger.receipts.findPathForLeaf(leaf);
      if (!p) throw new Error('receipt not found in the sale\'s receipt tree');
      return [privateState, p];
    },
    adminSecret: ({ privateState }) => [privateState, need(intent.adminSecret, 'admin secret')],
    divFloor: ({ privateState }, n, d) => [privateState, [n / d, n % d]],
    auditNonce: ({ privateState }) => {
      const r = intent.auditNonce ?? (BigInt('0x' + toHex(globalThis.crypto.getRandomValues(new Uint8Array(48)))) % 0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n);
      return [privateState, r];
    },
  };
}

// ---------------------------------------------------------------------------------------
// Read model

export interface CoinView { nonce: string; color: string; value: bigint; mtIndex: bigint; raw: { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint } }

export interface SaleView {
  phase: PhaseName;
  kind: SaleKindName;
  payColor: string;
  ticketPrice: bigint;
  tokensPerTicket: bigint;
  softCap: number;
  hardCap: number;
  maxPerPerson: number;
  start: number;
  end: number;
  cliff: number;
  tranches: number;
  trancheInterval: number;
  feeBps: number;
  feePerTicket: bigint;
  trancheAmount: bigint;
  lastTrancheAmount: bigint;
  saleId: string;
  tokenDomain: string;
  issuerPk: Point;
  minKyc: number;
  blockedCountries: number[];
  auditorEnabled: boolean;
  auditorPk: Point;
  projectKey: string;
  feeKey: string;
  ticketsSold: number;
  refundsPaid: number;
  claimsPaid: number;
  ticketsWithdrawn: number;
  feeCoinsCollected: number;
  buyNullifierCount: number;
  receiptNullifierCount: number;
  vault: CoinView[];
  feeVault: CoinView[];
  auditCount: number;
}

const coinView = (c: { nonce: Uint8Array; color: Uint8Array; value: bigint; mt_index: bigint }): CoinView => ({
  nonce: toHex(c.nonce), color: toHex(c.color), value: c.value, mtIndex: c.mt_index, raw: c,
});

export function readSale(L: Sale.Ledger): SaleView {
  const c = L.config;
  return {
    phase: PHASES[Number(L.phase)],
    kind: KINDS[Number(c.kind)],
    payColor: toHex(c.payColor),
    ticketPrice: c.ticketPrice,
    tokensPerTicket: c.tokensPerTicket,
    softCap: Number(c.softCapTickets),
    hardCap: Number(c.hardCapTickets),
    maxPerPerson: Number(c.maxTicketsPerPerson),
    start: Number(c.startTime),
    end: Number(c.endTime),
    cliff: Number(c.cliffTime),
    tranches: Number(c.trancheCount),
    trancheInterval: Number(c.trancheInterval),
    feeBps: Number(c.feeBps),
    feePerTicket: L.feePerTicket,
    trancheAmount: L.trancheAmount,
    lastTrancheAmount: L.lastTrancheAmount,
    saleId: toHex(c.saleId),
    tokenDomain: toHex(c.tokenDomain),
    issuerPk: c.issuerPk,
    minKyc: Number(c.minKyc),
    blockedCountries: c.blockedCountries.map(Number).filter((x) => x !== 0),
    auditorEnabled: c.auditorEnabled,
    auditorPk: c.auditorPk,
    projectKey: toHex(L.projectKey),
    feeKey: toHex(c.feeKey),
    ticketsSold: Number(L.ticketsSold),
    refundsPaid: Number(L.refundsPaid),
    claimsPaid: Number(L.claimsPaid),
    ticketsWithdrawn: Number(L.ticketsWithdrawn),
    feeCoinsCollected: Number(L.feeCoinsCollected),
    buyNullifierCount: Number(L.buyNullifiers.size()),
    receiptNullifierCount: Number(L.receiptNullifiers.size()),
    vault: [...L.vault].map(coinView),
    feeVault: [...L.feeVault].map(coinView),
    auditCount: Number(L.auditLog.size()),
  };
}

export interface Tranche { index: number; unlockAt: number; amount: bigint }
export function trancheSchedule(v: Pick<SaleView, 'cliff' | 'tranches' | 'trancheInterval' | 'trancheAmount' | 'lastTrancheAmount'>): Tranche[] {
  return Array.from({ length: v.tranches }, (_, i) => ({
    index: i,
    unlockAt: v.cliff + i * v.trancheInterval,
    amount: i === v.tranches - 1 ? v.lastTrancheAmount : v.trancheAmount,
  }));
}

/** Platform fee per ticket, floor(price * bps / 10000), as the constructor computes it. */
export const feePerTicketOf = (price: bigint, bps: number) => (price * BigInt(bps)) / 10000n;
/** Equal tranche split; the last tranche absorbs the remainder. */
export function splitTranches(total: bigint, n: number): { per: bigint; last: bigint } {
  const per = total / BigInt(n);
  return { per, last: total - per * BigInt(n - 1) };
}

// ---------------------------------------------------------------------------------------
// Private discovery from public state: what does this master secret own in this sale?

export interface OwnedTicket {
  index: number;
  receiptSecret: Uint8Array;
  receiptInTree: boolean;
  refunded: boolean;
  claimed: boolean[]; // per tranche
}

export function nextTicketIndex(L: Sale.Ledger, master: Uint8Array): number | null {
  const c = L.config;
  const hs = deriveHolderSecret(master);
  for (let i = 0; i < Number(c.maxTicketsPerPerson); i++) {
    if (!L.buyNullifiers.member(buyNullifier(c.saleId, hs, i))) return i;
  }
  return null;
}

export function recoverTickets(L: Sale.Ledger, master: Uint8Array): OwnedTicket[] {
  const c = L.config;
  const hs = deriveHolderSecret(master);
  const out: OwnedTicket[] = [];
  for (let i = 0; i < Number(c.maxTicketsPerPerson); i++) {
    if (!L.buyNullifiers.member(buyNullifier(c.saleId, hs, i))) continue;
    const rs = deriveReceiptSecret(master, c.saleId, i);
    out.push({
      index: i,
      receiptSecret: rs,
      receiptInTree: L.receipts.findPathForLeaf(receiptLeaf(c.saleId, rs)) !== undefined,
      refunded: L.receiptNullifiers.member(refundNullifier(c.saleId, rs)),
      claimed: Array.from({ length: Number(c.trancheCount) }, (_, t) => L.receiptNullifiers.member(claimNullifier(c.saleId, rs, t))),
    });
  }
  return out;
}

/** Sale token color: tokenType(tokenDomain, saleAddress), derived off-chain after deploy. */
export function saleTokenColor(tokenDomain: Uint8Array | string, contractAddress: string): string {
  const d = typeof tokenDomain === 'string' ? fromHex(tokenDomain) : tokenDomain;
  return rt.rawTokenType(d, contractAddress);
}
