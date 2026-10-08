// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Eligibility credentials: Schnorr signatures over the Jubjub curve, verified in-circuit
// by sale.compact (schnorrOk). The message is four field elements:
//   [holderCommit, country, kycLevel, expiry]
// holderCommit = degradeToTransient(H("dusk:holder:v1", holderSecret)), so the issuer
// never sees a wallet address and the credential is useless without the holder secret.
//
// Challenge: e = transientHash(Rx, Ry, PKx, PKy, m0..m3); only the low 128 bits are used
// as the scalar (the circuit checks the 128/128 split supplied by a witness).
import * as rt from '@midnight-ntwrk/compact-runtime';
import { bytesToBigInt, randomBytes } from './bytes.js';

/** Order of the Jubjub prime-order subgroup. */
export const JUBJUB_ORDER = 0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;
export const MASK128 = (1n << 128n) - 1n;
const V8 = new rt.CompactTypeVector(8, rt.CompactTypeField);
const V2B = new rt.CompactTypeVector(2, new rt.CompactTypeBytes(32));

export interface Point { x: bigint; y: bigint }

export interface CredentialAttrs {
  holderCommit: bigint;
  country: number;   // ISO-3166 numeric, never 0
  kycLevel: number;  // 1 basic, 2 verified, 3 enhanced
  expiry: number;    // unix seconds
}

export interface Credential {
  attrs: CredentialAttrs;
  R: Point;
  s: bigint;
  issuerPk: Point;
}

/** JSON-safe form (bigints as decimal strings). */
export interface CredentialJSON {
  v: 1;
  attrs: { holderCommit: string; country: number; kycLevel: number; expiry: number };
  R: { x: string; y: string };
  s: string;
  issuerPk: { x: string; y: string };
  issuer?: string;
  mock?: boolean;
}

export const scalarFrom = (bytes: Uint8Array) => bytesToBigInt(bytes) % JUBJUB_ORDER;
export const pointOf = (sk: bigint): Point => rt.ecMulGenerator(sk) as Point;

export function attrVector(a: CredentialAttrs): bigint[] {
  return [a.holderCommit, BigInt(a.country), BigInt(a.kycLevel), BigInt(a.expiry)];
}

export function challenge(R: Point, pk: Point, a: CredentialAttrs): bigint {
  return rt.transientHash(V8, [R.x, R.y, pk.x, pk.y, ...attrVector(a)]);
}

export function signCredential(sk: bigint, attrs: CredentialAttrs): Credential {
  if (attrs.country <= 0) throw new Error('country code must be positive');
  const pk = pointOf(sk);
  const k = scalarFrom(randomBytes(64)); // 512 random bits -> negligible modulo bias
  const R = pointOf(k);
  const e = challenge(R, pk, attrs);
  const s = (k + (e & MASK128) * sk) % JUBJUB_ORDER;
  return { attrs, R, s, issuerPk: pk };
}

export function verifyCredential(c: Credential): boolean {
  const e = challenge(c.R, c.issuerPk, c.attrs);
  const lhs = rt.ecMulGenerator(c.s) as Point;
  const rhs = rt.ecAdd(c.R, rt.ecMul(c.issuerPk, e & MASK128)) as Point;
  return lhs.x === rhs.x && lhs.y === rhs.y;
}

export function credentialToJSON(c: Credential, extra: { issuer?: string; mock?: boolean } = {}): CredentialJSON {
  return {
    v: 1,
    attrs: { ...c.attrs, holderCommit: c.attrs.holderCommit.toString() },
    R: { x: c.R.x.toString(), y: c.R.y.toString() },
    s: c.s.toString(),
    issuerPk: { x: c.issuerPk.x.toString(), y: c.issuerPk.y.toString() },
    ...extra,
  };
}

export function credentialFromJSON(j: CredentialJSON): Credential {
  return {
    attrs: { ...j.attrs, holderCommit: BigInt(j.attrs.holderCommit) },
    R: { x: BigInt(j.R.x), y: BigInt(j.R.y) },
    s: BigInt(j.s),
    issuerPk: { x: BigInt(j.issuerPk.x), y: BigInt(j.issuerPk.y) },
  };
}

/** Holder commitment as the issuer receives it (identical to hash.holderCommitOf). */
export function holderCommitment(holderSecret: Uint8Array): bigint {
  const tag = new Uint8Array(32);
  tag.set(new TextEncoder().encode('dusk:holder:v1'));
  return rt.degradeToTransient(rt.persistentHash(V2B, [tag, holderSecret]));
}

export const KYC_LEVELS = [
  { level: 1, label: 'Basic', hint: 'Email + liveness check' },
  { level: 2, label: 'Verified', hint: 'Government ID' },
  { level: 3, label: 'Enhanced', hint: 'ID + proof of address' },
] as const;

/** ISO-3166 numeric codes used by the demo issuer and the Create Sale page. */
export const COUNTRIES: { code: number; name: string }[] = [
  { code: 566, name: 'Nigeria' }, { code: 404, name: 'Kenya' }, { code: 288, name: 'Ghana' },
  { code: 710, name: 'South Africa' }, { code: 826, name: 'United Kingdom' }, { code: 276, name: 'Germany' },
  { code: 250, name: 'France' }, { code: 724, name: 'Spain' }, { code: 380, name: 'Italy' },
  { code: 528, name: 'Netherlands' }, { code: 756, name: 'Switzerland' }, { code: 124, name: 'Canada' },
  { code: 840, name: 'United States' }, { code: 76, name: 'Brazil' }, { code: 484, name: 'Mexico' },
  { code: 356, name: 'India' }, { code: 392, name: 'Japan' }, { code: 410, name: 'South Korea' },
  { code: 702, name: 'Singapore' }, { code: 36, name: 'Australia' }, { code: 784, name: 'United Arab Emirates' },
  { code: 643, name: 'Russia' }, { code: 364, name: 'Iran' }, { code: 408, name: 'North Korea' },
  { code: 192, name: 'Cuba' }, { code: 760, name: 'Syria' },
];
export const countryName = (code: number) => COUNTRIES.find((c) => c.code === code)?.name ?? `#${code}`;
