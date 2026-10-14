// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// Display helpers for base-unit token amounts.

export const TUSD_DECIMALS = 6;
export const SALE_TOKEN_DECIMALS = 6;

export function formatUnits(v: bigint, decimals = TUSD_DECIMALS, maxFrac = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  const w = whole.toLocaleString('en-US');
  return (neg ? '-' : '') + (frac ? `${w}.${frac}` : w);
}

export function parseUnits(s: string, decimals = TUSD_DECIMALS): bigint {
  const t = s.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`"${s}" is not a number`);
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) throw new Error(`At most ${decimals} decimals`);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0');
}
