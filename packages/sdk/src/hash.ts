// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// Hash helpers that reproduce, bit for bit, the hashes computed inside sale.compact.
import * as rt from '@midnight-ntwrk/compact-runtime';
import { pad32 } from './bytes.js';

const B32 = new rt.CompactTypeBytes(32);
const vecB = (n: number) => new rt.CompactTypeVector(n, B32);

/** persistentHash<Vector<n, Bytes<32>>>(parts) */
export function hashBytes(parts: Uint8Array[]): Uint8Array {
  for (const p of parts) if (p.length !== 32) throw new Error('hashBytes expects 32-byte parts');
  return rt.persistentHash(vecB(parts.length), parts);
}

/** Compact `(x as Field) as Bytes<32>`. */
export function fieldToBytes32(x: bigint): Uint8Array {
  return rt.convertFieldToBytes(32, x, 'duskpad');
}

export const TAG = {
  admin: pad32('dusk:admin:v1'),
  holder: pad32('dusk:holder:v1'),
  buy: pad32('dusk:buy:v1'),
  receipt: pad32('dusk:receipt:v1'),
  rnul: pad32('dusk:rnul:v1'),
  refund: pad32('refund'),
} as const;

/** keyOf(sk) in sale.compact: public commitment to an admin secret. */
export const adminKeyOf = (sk: Uint8Array) => hashBytes([TAG.admin, sk]);
/** holderCommitOf(hs): the value an issuer signs instead of any wallet address. */
export const holderCommitOf = (hs: Uint8Array): bigint => rt.degradeToTransient(hashBytes([TAG.holder, hs]));
export const buyNullifier = (saleId: Uint8Array, hs: Uint8Array, idx: number | bigint) =>
  hashBytes([TAG.buy, saleId, hs, fieldToBytes32(BigInt(idx))]);
export const receiptLeaf = (saleId: Uint8Array, rs: Uint8Array) => hashBytes([TAG.receipt, saleId, rs]);
export const claimNullifier = (saleId: Uint8Array, rs: Uint8Array, tranche: number | bigint) =>
  hashBytes([TAG.rnul, saleId, rs, fieldToBytes32(BigInt(tranche))]);
export const refundNullifier = (saleId: Uint8Array, rs: Uint8Array) => hashBytes([TAG.rnul, saleId, rs, TAG.refund]);
