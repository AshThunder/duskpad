// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// Small, dependency-free byte helpers shared by browser and Node code.

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error('invalid hex string');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** UTF-8 text right-padded with zeros to 32 bytes (Compact `pad(32, "...")`). */
export function pad32(text: string): Uint8Array {
  const enc = new TextEncoder().encode(text);
  if (enc.length > 32) throw new Error(`"${text}" is longer than 32 bytes`);
  const out = new Uint8Array(32);
  out.set(enc);
  return out;
}

export function random32(): Uint8Array {
  const out = new Uint8Array(32);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const shortHex = (h: string, n = 6) => (h.length <= 2 * n + 1 ? h : `${h.slice(0, n)}…${h.slice(-n)}`);
