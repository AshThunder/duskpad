// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Shielded address parsing. A Midnight shielded address is bech32m("mn_shield-addr_<network>",
// coinPublicKey(32) || encryptionPublicKey(32)). Contract payouts to someone other than the
// caller need both halves: the coin key goes into the circuit, the encryption key is handed to
// Midnight.js (additionalCoinEncPublicKeyMappings) so the recipient's wallet can see the coin.
import { bech32m } from '@scure/base';
import { toHex } from './bytes.js';

export interface ShieldedKeys { coinPublicKey: string; encryptionPublicKey: string; network: string }

export function parseShieldedAddress(addr: string, expectedNetwork?: string): ShieldedKeys {
  let d: { prefix: string; words: number[] };
  try { d = bech32m.decode(addr.trim() as `${string}1${string}`, false); } catch { throw new Error('Not a valid bech32m address'); }
  const m = d.prefix.match(/^mn_shield-addr_(.+)$/);
  if (!m) throw new Error('Not a Midnight shielded address (expected mn_shield-addr_…)');
  if (expectedNetwork && m[1] !== expectedNetwork) throw new Error(`Address is for ${m[1]}, expected ${expectedNetwork}`);
  const b = Uint8Array.from(bech32m.fromWords(d.words));
  if (b.length !== 64) throw new Error('Unexpected shielded address length');
  return { coinPublicKey: toHex(b.slice(0, 32)), encryptionPublicKey: toHex(b.slice(32)), network: m[1] };
}
