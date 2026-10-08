// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { describe, it, expect } from 'vitest';
import {
  signCredential, verifyCredential, credentialToJSON, credentialFromJSON, pointOf, scalarFrom, pad32, holderCommitment,
  encryptBackup, decryptBackup, newVault, validateSaleInput, formatUnits, parseUnits, splitTranches, feePerTicketOf,
  deriveHolderSecret, deriveReceiptSecret, deriveAdminSecret, derivePlatformSecret, toHex, fromHex, explainError, VISIBILITY,
} from '../src/index';

const sk = scalarFrom(pad32('issuer'));
const attrs = { holderCommit: holderCommitment(pad32('hs')), country: 566, kycLevel: 2, expiry: 2_000_000_000 };

describe('credentials', () => {
  it('sign/verify round trip, JSON round trip', () => {
    const c = signCredential(sk, attrs);
    expect(verifyCredential(c)).toBe(true);
    const back = credentialFromJSON(JSON.parse(JSON.stringify(credentialToJSON(c, { mock: true }))));
    expect(verifyCredential(back)).toBe(true);
    expect(back.issuerPk).toEqual(pointOf(sk));
  });
  it('detects tampering of any attribute or a wrong issuer key', () => {
    const c = signCredential(sk, attrs);
    for (const k of ['country', 'kycLevel', 'expiry'] as const) {
      expect(verifyCredential({ ...c, attrs: { ...c.attrs, [k]: c.attrs[k] + 1 } })).toBe(false);
    }
    expect(verifyCredential({ ...c, attrs: { ...c.attrs, holderCommit: c.attrs.holderCommit + 1n } })).toBe(false);
    expect(verifyCredential({ ...c, issuerPk: pointOf(sk + 1n) })).toBe(false);
  });
  it('signatures are randomized', () => {
    expect(signCredential(sk, attrs).s).not.toBe(signCredential(sk, attrs).s);
  });
  it('refuses country 0 (reserved for empty blocked-country slots)', () => {
    expect(() => signCredential(sk, { ...attrs, country: 0 })).toThrow();
  });
});

describe('master secret derivation', () => {
  const m = pad32('m');
  it('is deterministic and domain separated', () => {
    const sid = pad32('sale');
    expect(toHex(deriveHolderSecret(m))).toBe(toHex(deriveHolderSecret(m)));
    const all = [deriveHolderSecret(m), deriveReceiptSecret(m, sid, 0), deriveReceiptSecret(m, sid, 1), deriveAdminSecret(m, sid), derivePlatformSecret(m)].map(toHex);
    expect(new Set(all).size).toBe(all.length);
    expect(toHex(deriveReceiptSecret(m, pad32('other'), 0))).not.toBe(toHex(deriveReceiptSecret(m, sid, 0)));
  });
});

describe('encrypted backup', () => {
  it('round-trips with the right passphrase and fails with a wrong one', async () => {
    const v = newVault();
    const b = await encryptBackup(v, 'correct horse battery');
    expect(b.ciphertext).not.toContain(v.masterSecret);
    expect((await decryptBackup(b, 'correct horse battery')).masterSecret).toBe(v.masterSecret);
    await expect(decryptBackup(b, 'wrong horse battery')).rejects.toThrow(/Wrong passphrase/);
  });
  it('rejects short passphrases and foreign files', async () => {
    await expect(encryptBackup(newVault(), 'short')).rejects.toThrow();
    await expect(decryptBackup({ format: 'x' } as any, 'whatever-long')).rejects.toThrow(/Not a DuskPad backup/);
  });
});

describe('sale input validation', () => {
  const base = {
    kind: 'fixedPrice' as const, payColor: '11'.repeat(32), ticketPrice: 1n, tokensPerTicket: 1n, softCap: 1, hardCap: 2, maxPerPerson: 1,
    start: 1, end: 2, cliff: 2, tranches: 1, trancheInterval: 0, feeBps: 0, feeKey: pad32('f'), saleId: pad32('s'),
    tokenDomain: pad32('t'), nonceSeed: pad32('n'), issuerPk: pointOf(1n), minKyc: 0, blockedCountries: [],
  };
  it('accepts a valid sale', () => expect(validateSaleInput(base)).toEqual([]));
  it('flags each invalid field', () => {
    expect(validateSaleInput({ ...base, softCap: 3 })).toHaveLength(1);
    expect(validateSaleInput({ ...base, kind: 'firstCome' })).toHaveLength(1);
    expect(validateSaleInput({ ...base, cliff: 1 })).toHaveLength(1);
    expect(validateSaleInput({ ...base, tranches: 2 })).toHaveLength(1);
    expect(validateSaleInput({ ...base, feeBps: 2500 })).toHaveLength(1);
    expect(validateSaleInput({ ...base, blockedCountries: [1, 2, 3, 4, 5] })).toHaveLength(1);
  });
});

describe('amount helpers', () => {
  it('formats and parses 6-decimal units', () => {
    expect(formatUnits(1_234_500_000n)).toBe('1,234.5');
    expect(parseUnits('1,234.5')).toBe(1_234_500_000n);
    expect(() => parseUnits('1.1234567')).toThrow();
    expect(() => parseUnits('abc')).toThrow();
  });
  it('splits tranches and fees like the contract', () => {
    expect(splitTranches(100n, 3)).toEqual({ per: 33n, last: 34n });
    expect(feePerTicketOf(1_000n, 250)).toBe(25n);
    expect(feePerTicketOf(999n, 250)).toBe(24n);
  });
  it('hex round trip', () => expect(toHex(fromHex('00ff10'))).toBe('00ff10'));
});

describe('errors and privacy table', () => {
  it('extracts contract assertion messages', () => {
    expect(explainError(new Error('Error: failed assert: per-person ticket cap reached'))).toBe('per-person ticket cap reached');
  });
  it('documents every user-facing action', () => {
    for (const a of ['buy', 'refund', 'claim', 'withdraw', 'collectFee', 'deploy']) expect(VISIBILITY.find((v) => v.action === a)).toBeDefined();
  });
});

import { parseShieldedAddress } from '../src/address';
describe('shielded address parsing', () => {
  const addr = 'mn_shield-addr_undeployed17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduzjmn4dv093ylpa3tpc5r0rspv9f0n9u9ux3hfj7gwja2pct26j3qf068ud';
  it('splits coin and encryption keys (values cross-checked against the wallet\'s getShieldedAddresses)', () => {
    const k = parseShieldedAddress(addr, 'undeployed');
    expect(k.coinPublicKey).toBe('f486dc9e4ef95469e0a432eaee72c57e7a4f449182069b5ead08b504f9ef1b78');
    expect(k.encryptionPublicKey).toBe('296e756b1e5893e1ec561c506f1c02c2a5f32f0bc346e99790e97541c2d5a944');
  });
  it('rejects other networks and garbage', () => {
    expect(() => parseShieldedAddress(addr, 'preprod')).toThrow(/expected preprod/);
    expect(() => parseShieldedAddress('hello')).toThrow();
  });
});

import {
  normalizeShieldedKeys, normalizeBalances, balanceOf, normalizeDust, decodeKey32, isRejection, proofProviderWithFallback,
} from '../src/connector';
describe('wallet connector normalization (1AM / Lace / dev wallet encodings)', () => {
  const addr = 'mn_shield-addr_undeployed17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduzjmn4dv093ylpa3tpc5r0rspv9f0n9u9ux3hfj7gwja2pct26j3qf068ud';
  const cpk = 'f486dc9e4ef95469e0a432eaee72c57e7a4f449182069b5ead08b504f9ef1b78';
  const epk = '296e756b1e5893e1ec561c506f1c02c2a5f32f0bc346e99790e97541c2d5a944';
  // Bech32m vectors produced with @midnight-ntwrk/wallet-sdk-address-format (the codec Lace uses).
  const cpkB32 = 'mn_shield-cpk_undeployed17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduqqsmgq5';
  const cpkPreprod = 'mn_shield-cpk_preprod17jrde8jwl92xnc9yxt4wuuk90eay73y3sgrfkh4dpz6sf700rduqma8le8';
  const epkPreprod = 'mn_shield-epk_preprod199h826c7tzf7rmzkr3gx78qzc2jlxtctcdrwn9usa965rsk449zq6duxvd';

  it('accepts hex keys (dev wallet / testkit adapter)', () => {
    expect(normalizeShieldedKeys({ shieldedAddress: addr, shieldedCoinPublicKey: cpk, shieldedEncryptionPublicKey: epk }))
      .toEqual({ coinPublicKey: cpk, encryptionPublicKey: epk, network: 'undeployed' });
  });
  it('decodes Bech32m keys (Lace, DApp Connector v4 spec)', () => {
    expect(decodeKey32(cpkB32, 'shield-cpk')).toBe(cpk);
    expect(decodeKey32(cpkPreprod, 'shield-cpk')).toBe(cpk);
    expect(decodeKey32(epkPreprod, 'shield-epk')).toBe(epk);
    expect(decodeKey32(cpkPreprod, 'shield-epk')).toBeNull();
    expect(decodeKey32('0x' + cpk.toUpperCase(), 'shield-cpk')).toBe(cpk);
    const k = normalizeShieldedKeys({ shieldedAddress: addr, shieldedCoinPublicKey: cpkB32, shieldedEncryptionPublicKey: '0x' + epk });
    expect(k.coinPublicKey).toBe(cpk);
    expect(k.encryptionPublicKey).toBe(epk);
  });
  it('falls back to the shielded address and rejects inconsistent wallets', () => {
    expect(normalizeShieldedKeys({ shieldedAddress: addr }).coinPublicKey).toBe(cpk);
    expect(() => normalizeShieldedKeys({ shieldedAddress: addr, shieldedCoinPublicKey: epk, shieldedEncryptionPublicKey: epk })).toThrow(/do not match/);
    expect(() => normalizeShieldedKeys({ shieldedAddress: 'nope' })).toThrow();
  });
  it('normalizes balances from bigint, strings and numbers', () => {
    const b = normalizeBalances({ ['0x' + cpk.toUpperCase()]: '24000000000', [epk]: 5n, abc: 7 });
    expect(b[cpk]).toBe(24000000000n);
    expect(balanceOf(b, epk)).toBe(5n);
    expect(balanceOf(b, '0x' + cpk)).toBe(24000000000n);
    expect(balanceOf({ ['02' + cpk]: 9n }, cpk)).toBe(9n);
    expect(balanceOf(undefined, cpk)).toBe(0n);
    expect(normalizeDust({ balance: '10', cap: 20n })).toEqual({ balance: 10n, cap: 20n });
    expect(normalizeDust(null)).toBeNull();
  });
  it('only falls back to the proof server on technical errors, never on a rejection', async () => {
    const rejected = Object.assign(new Error('Transaction rejected by the user'), { code: 'Rejected' });
    expect(isRejection(rejected)).toBe(true);
    expect(isRejection(new Error('Request timed out'))).toBe(false);
    const fb = { proveTx: async () => 'server' };
    const timeout = proofProviderWithFallback({ proveTx: async () => { throw new Error('Request timed out'); } }, () => fb);
    await expect(timeout.proveTx({})).resolves.toBe('server');
    const reject = proofProviderWithFallback({ proveTx: async () => { throw rejected; } }, () => fb);
    await expect(reject.proveTx({})).rejects.toBe(rejected);
    expect(explainError(rejected)).toBe('The wallet rejected the request.');
    expect(explainError({ code: 'Rejected', reason: 'x' })).toBe('The wallet rejected the request.');
  });
});
