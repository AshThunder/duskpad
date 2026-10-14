// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Optional auditor disclosure (UNAUDITED, behind a per-sale flag). For each ticket the buyer
// publishes hashed-ElGamal  (E = r*G, c = holderCommit + H(r*A))  to the auditor key A.
// The auditor recovers holderCommit = c - H(a*E) and can ask the issuer who it belongs to.
import * as rt from '@midnight-ntwrk/compact-runtime';
import type { Point } from './credential.js';

const V2 = new rt.CompactTypeVector(2, rt.CompactTypeField);
// BLS12-381 scalar field modulus (Compact Field).
export const FIELD_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

export function decryptAuditRecord(auditorSk: bigint, rec: { ephemeral: Point; ciphertext: bigint }): bigint {
  const shared = rt.ecMul(rec.ephemeral, auditorSk) as Point;
  const mask = rt.transientHash(V2, [shared.x, shared.y]);
  return ((rec.ciphertext - mask) % FIELD_MODULUS + FIELD_MODULUS) % FIELD_MODULUS;
}
