// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// Simulator tests for sale.compact (compact-runtime 0.16.0, Compact 0.31.1 output).
import { describe, it, expect, beforeEach } from 'vitest';
import * as rt from '@midnight-ntwrk/compact-runtime';
import * as Sale from '@duskpad/contracts/sale';
import {
  adminKeyOf, buyNullifier, claimNullifier, decryptAuditRecord, deriveReceiptSecret, holderCommitOf, holderCommitment,
  nextTicketIndex, pad32, pointOf, receiptLeaf, recoverTickets, refundNullifier, toHex, toSaleParams, readSale,
  trancheSchedule, signCredential, verifyCredential, saleTokenColor,
} from '@duskpad/sdk';
import {
  SaleSim, saleInput, person, projectAdmin, platformAdmin, ISSUER_SK, ROGUE_SK, AUDITOR_SK, PRICE, T0, PAY_COLOR, hexBytes,
} from './harness';

const expectFail = (fn: () => unknown, msg: string | RegExp) => expect(fn).toThrow(msg);

describe('constructor', () => {
  it('stores parameters and derives fee and tranche amounts with checked witness division', () => {
    const s = new SaleSim(saleInput({ ticketPrice: 1_234_567n, feeBps: 250, tokensPerTicket: 100n, tranches: 3 }));
    const v = readSale(s.ledger);
    expect(v.phase).toBe('live');
    expect(v.kind).toBe('fixedPrice');
    expect(v.feePerTicket).toBe((1_234_567n * 250n) / 10_000n); // floor
    expect(v.trancheAmount).toBe(33n);
    expect(v.lastTrancheAmount).toBe(34n);
    expect(v.blockedCountries).toEqual([408, 364]);
    expect(v.payColor).toBe(PAY_COLOR);
    expect(trancheSchedule(v).map((t) => t.amount)).toEqual([33n, 33n, 34n]);
  });

  it('stores only the hash of the project admin secret', () => {
    const inp = saleInput();
    const s = new SaleSim(inp);
    expect(toHex(s.ledger.projectKey)).toBe(toHex(adminKeyOf(projectAdmin(inp.saleId))));
  });

  it('SDK hashes match the contract pure circuits', () => {
    const sk = pad32('some-secret');
    expect(toHex(Sale.pureCircuits.keyOf(sk))).toBe(toHex(adminKeyOf(sk)));
    expect(Sale.pureCircuits.holderCommitOf(sk)).toBe(holderCommitOf(sk));
    expect(holderCommitment(sk)).toBe(holderCommitOf(sk));
  });

  const bad: [string, Parameters<typeof saleInput>[0], RegExp][] = [
    ['soft cap above hard cap', { softCap: 5, hardCap: 4 }, /soft cap above hard cap/],
    ['first-come with a soft cap', { kind: 'firstCome', softCap: 1 }, /first-come sales have no soft cap/],
    ['zero hard cap', { hardCap: 0, softCap: 0 }, /hard cap must be positive/],
    ['zero per-person cap', { maxPerPerson: 0 }, /per-person cap must be positive/],
    ['start after end', { start: T0 + 10, end: T0 }, /start must precede end/],
    ['cliff before end', { cliff: T0 + 10 }, /cliff must not precede end/],
    ['49 tranches', { tranches: 49 }, /1\.\.48 tranches/],
    ['fee above 20%', { feeBps: 2001 }, /fee above 20%/],
  ];
  for (const [name, over, msg] of bad) {
    it(`rejects ${name} in-circuit (bypassing SDK validation)`, () => {
      const inp = saleInput(over);
      // Build params without validation to prove the contract itself enforces it.
      const p = { ...toSaleParams(saleInput()), ...rawOverrides(inp) };
      const c = new Sale.Contract({ ...new SaleSim(saleInput()).contract.witnesses } as any);
      expectFail(() => c.initialState(rt.createConstructorContext({}, '00'.repeat(32)), p), msg);
    });
  }
});

function rawOverrides(i: ReturnType<typeof saleInput>) {
  return {
    kind: i.kind === 'fixedPrice' ? 0 : 1, softCapTickets: BigInt(i.softCap), hardCapTickets: BigInt(i.hardCap),
    maxTicketsPerPerson: BigInt(i.maxPerPerson), startTime: BigInt(i.start), endTime: BigInt(i.end), cliffTime: BigInt(i.cliff),
    trancheCount: BigInt(i.tranches), feeBps: BigInt(i.feeBps),
  } as Partial<Sale.SaleParams>;
}

describe('buyTicket: eligibility and caps', () => {
  let s: SaleSim;
  const alice = person('alice');
  const bob = person('bob', { country: 826, kyc: 3 });
  beforeEach(() => { s = new SaleSim(saleInput()); });

  it('valid credential buys a ticket; vault, nullifier and receipt match the SDK', () => {
    s.buy(alice, 0);
    const L = s.ledger;
    expect(L.ticketsSold).toBe(1n);
    expect(L.vault.size()).toBe(1n);
    expect(s.vaultCoin().value).toBe(PRICE);
    expect(L.buyNullifiers.member(buyNullifier(s.saleId, alice.hs, 0))).toBe(true);
    const leaf = receiptLeaf(s.saleId, deriveReceiptSecret(alice.master, s.saleId, 0));
    expect(L.receipts.findPathForLeaf(leaf)).toBeDefined();
  });

  it('the same person buys up to N tickets with distinct indices', () => {
    s.buy(alice, 0);
    s.buy(alice, 1);
    expect(s.ledger.ticketsSold).toBe(2n);
  });

  it('rejects ticket N+1 for the same person', () => {
    s.buy(alice, 0); s.buy(alice, 1);
    expectFail(() => s.buy(alice, 2), /per-person ticket cap reached/);
  });

  it('rejects reusing a ticket index', () => {
    s.buy(alice, 0);
    expectFail(() => s.buy(alice, 0), /ticket index already used/);
  });

  it('different people get unrelated nullifiers', () => {
    s.buy(alice, 0); s.buy(bob, 0);
    const a = toHex(buyNullifier(s.saleId, alice.hs, 0)), b = toHex(buyNullifier(s.saleId, bob.hs, 0));
    expect(a).not.toBe(b);
    expect(s.ledger.buyNullifiers.size()).toBe(2n);
  });

  it('rejects a credential signed by a non-issuer key', () => {
    expectFail(() => s.buy(person('mallory', { issuerSk: ROGUE_SK }), 0), /bad issuer signature/);
  });

  it('rejects a tampered attribute (KYC level raised after signing)', () => {
    const c = { ...alice.cred, attrs: { ...alice.cred.attrs, kycLevel: 3 } };
    expect(verifyCredential(c)).toBe(false);
    expectFail(() => s.buy(alice, 0, { cred: c }), /bad issuer signature/);
  });

  it('rejects a stolen credential used with another holder secret', () => {
    expectFail(() => s.buy(bob, 0, { cred: alice.cred }), /credential not bound to this holder/);
  });

  it('rejects every blocked country slot', () => {
    expectFail(() => s.buy(person('kp', { country: 408 }), 0), /blocked region/);
    expectFail(() => s.buy(person('ir', { country: 364 }), 0), /blocked region/);
  });

  it('rejects KYC below the minimum', () => {
    const t = new SaleSim(saleInput({ minKyc: 3 }));
    expectFail(() => t.buy(alice, 0), /kyc level too low/);
    t.buy(bob, 0); // kyc 3
  });

  it('rejects an expired credential', () => {
    const old = person('old', { expiry: T0 + 10 });
    s.time = T0 + 20;
    expectFail(() => s.buy(old, 0), /credential expired/);
  });

  it('enforces the sale window', () => {
    s.time = T0 - 1;
    expectFail(() => s.buy(alice, 0), /sale not started/);
    s.time = T0 + 3600;
    expectFail(() => s.buy(alice, 0), /sale ended/);
  });

  it('rejects the wrong payment token or amount', () => {
    expectFail(() => s.buy(alice, 0, { color: '22'.repeat(32) }), /wrong payment token/);
    expectFail(() => s.buy(alice, 0, { value: PRICE - 1n }), /wrong payment amount/);
  });

  it('rejects buys once the hard cap is reached', () => {
    s.buy(alice, 0); s.buy(alice, 1); s.buy(bob, 0); s.buy(bob, 1);
    expectFail(() => s.buy(person('carol'), 0), /sold out/);
  });

  it('a master secret alone rediscovers its tickets from public state', () => {
    s.buy(alice, 0); s.buy(bob, 0); s.buy(alice, 1);
    const mine = recoverTickets(s.ledger, alice.master);
    expect(mine.map((t) => t.index)).toEqual([0, 1]);
    expect(mine.every((t) => t.receiptInTree && !t.refunded)).toBe(true);
    expect(nextTicketIndex(s.ledger, alice.master)).toBeNull();
    expect(nextTicketIndex(s.ledger, bob.master)).toBe(1);
  });
});

describe('finalize', () => {
  const alice = person('alice'), bob = person('bob');

  it('cannot finalize while running and not sold out', () => {
    const s = new SaleSim(saleInput());
    expectFail(() => s.finalize(), /sale still running/);
  });

  it('fails a fixed-price sale that missed its soft cap', () => {
    const s = new SaleSim(saleInput());
    s.buy(alice, 0);
    s.time = T0 + 3600;
    s.finalize();
    expect(readSale(s.ledger).phase).toBe('failed');
  });

  it('succeeds when the soft cap is met, and only once', () => {
    const s = new SaleSim(saleInput());
    s.buy(alice, 0); s.buy(bob, 0);
    s.time = T0 + 3600;
    s.finalize();
    expect(readSale(s.ledger).phase).toBe('succeeded');
    expectFail(() => s.finalize(), /already finalized/);
  });

  it('may finalize early once sold out', () => {
    const s = new SaleSim(saleInput({ hardCap: 2 }));
    s.buy(alice, 0); s.buy(bob, 0);
    s.finalize();
    expect(readSale(s.ledger).phase).toBe('succeeded');
  });

  it('a first-come sale always succeeds (no minimum)', () => {
    const s = new SaleSim(saleInput({ kind: 'firstCome', softCap: 0 }));
    s.buy(alice, 0);
    s.time = T0 + 3600;
    s.finalize();
    const v = readSale(s.ledger);
    expect(v.kind).toBe('firstCome');
    expect(v.phase).toBe('succeeded');
  });
});

describe('refunds (soft cap missed)', () => {
  const alice = person('alice');
  let s: SaleSim;
  beforeEach(() => {
    s = new SaleSim(saleInput({ softCap: 3 }));
    s.buy(alice, 0); s.buy(alice, 1);
    s.time = T0 + 3600;
  });

  it('refunds are closed before the sale fails', () => {
    expectFail(() => s.refund(alice, 0), /refunds not open/);
  });

  it('pays a refund from the vault and spends the refund nullifier', () => {
    s.finalize();
    s.refund(alice, 0);
    const L = s.ledger;
    expect(L.vault.size()).toBe(1n);
    expect(L.refundsPaid).toBe(1n);
    expect(L.receiptNullifiers.member(refundNullifier(s.saleId, deriveReceiptSecret(alice.master, s.saleId, 0)))).toBe(true);
    expect(recoverTickets(L, alice.master).map((t) => t.refunded)).toEqual([true, false]);
  });

  it('rejects a second refund for the same receipt', () => {
    s.finalize();
    s.refund(alice, 0);
    expectFail(() => s.refund(alice, 0), /receipt already used for this/);
    s.refund(alice, 1); // the other ticket is still refundable
    expect(s.ledger.vault.size()).toBe(0n);
  });

  it('rejects a receipt that was never issued', () => {
    s.finalize();
    expectFail(() => s.refund(person('nobody'), 0), /receipt not found/);
  });

  it('rejects paying out a coin that is not in the vault', () => {
    s.finalize();
    const fake = { ...s.vaultCoin(), nonce: pad32('not-a-vault-coin') };
    expectFail(() => s.refund(alice, 0, fake), /not a vault coin/);
  });

  it('claims are impossible in a failed sale', () => {
    s.finalize();
    s.time = T0 + 99_999;
    expectFail(() => s.claim(alice, 0, 0), /sale did not succeed/);
  });

  it('the project cannot withdraw from a failed sale', () => {
    s.finalize();
    expectFail(() => s.withdraw(projectAdmin(s.saleId)), /sale did not succeed/);
  });
});

describe('success: withdraw, fees, vesting claims', () => {
  const alice = person('alice'), bob = person('bob');
  let s: SaleSim;
  beforeEach(() => {
    s = new SaleSim(saleInput());
    s.buy(alice, 0); s.buy(alice, 1); s.buy(bob, 0);
    s.time = T0 + 3600;
    s.finalize();
  });

  it('withdraw is refused while live', () => {
    const t = new SaleSim(saleInput());
    t.buy(alice, 0);
    expectFail(() => t.withdraw(projectAdmin(t.saleId)), /sale did not succeed/);
  });

  it('refunds are refused after success', () => {
    expectFail(() => s.refund(alice, 0), /refunds not open/);
  });

  it('only the project key can withdraw', () => {
    expectFail(() => s.withdraw(pad32('wrong-admin')), /not the project/);
    expectFail(() => s.withdraw(platformAdmin()), /not the project/);
  });

  it('withdraw pays net of fee and moves the fee into the fee vault', () => {
    s.withdraw(projectAdmin(s.saleId));
    const L = s.ledger;
    expect(L.vault.size()).toBe(2n);
    expect(L.ticketsWithdrawn).toBe(1n);
    expect(L.feeVault.size()).toBe(1n);
    expect(s.feeCoin().value).toBe((PRICE * 250n) / 10_000n);
  });

  it('a zero-fee sale withdraws the whole coin and leaves no fee coin', () => {
    const t = new SaleSim(saleInput({ feeBps: 0 }));
    t.buy(alice, 0); t.buy(bob, 0);
    t.time = T0 + 3600; t.finalize();
    t.withdraw(projectAdmin(t.saleId));
    expect(t.ledger.feeVault.size()).toBe(0n);
  });

  it('only the platform key can collect fees', () => {
    s.withdraw(projectAdmin(s.saleId));
    expectFail(() => s.collectFee(projectAdmin(s.saleId)), /not the platform/);
    s.collectFee(platformAdmin());
    expect(s.ledger.feeVault.size()).toBe(0n);
    expect(s.ledger.feeCoinsCollected).toBe(1n);
  });

  it('claims are locked before the cliff', () => {
    s.time = T0 + 7199;
    expectFail(() => s.claim(alice, 0, 0), /tranche still locked/);
  });

  it('each tranche unlocks on schedule and can be claimed once', () => {
    s.time = T0 + 7200;
    s.claim(alice, 0, 0);
    expectFail(() => s.claim(alice, 0, 0), /receipt already used for this/);
    expectFail(() => s.claim(alice, 0, 1), /tranche still locked/);
    s.time = T0 + 7200 + 600;
    s.claim(alice, 0, 1);
    expectFail(() => s.claim(alice, 0, 3), /no such tranche/);
    const rs = deriveReceiptSecret(alice.master, s.saleId, 0);
    expect(s.ledger.receiptNullifiers.member(claimNullifier(s.saleId, rs, 1))).toBe(true);
    expect(s.ledger.claimsPaid).toBe(2n);
    expect(recoverTickets(s.ledger, alice.master)[0].claimed).toEqual([true, true, false]);
  });

  it('claims mint the tranche amount, in the sale token color, to the caller', () => {
    s.time = T0 + 99_999;
    const r = s.claim(bob, 0, 2);
    const outs = (r.context.currentZswapLocalState as any).outputs;
    expect(outs.length).toBe(1);
    // last tranche absorbs the remainder: 100e6 - 2 * 33_333_333
    expect(BigInt(outs[0].coinInfo.value)).toBe(33_333_334n);
    expect(toHex(outs[0].coinInfo.color)).toBe(saleTokenColor(s.input.tokenDomain, s.address));
    expect(outs[0].recipient.is_left).toBe(true); // a user key (the caller), not a contract
    expect(s.ledger.mintCounter).toBe(1n);
  });

  it('a receipt from another person cannot be claimed twice by anyone', () => {
    s.time = T0 + 99_999;
    s.claim(bob, 0, 0);
    // anyone holding bob's receipt secret is "bob" to the contract; the nullifier still blocks a replay
    expectFail(() => s.claim(bob, 0, 0), /receipt already used for this/);
  });
});

describe('auditor disclosure (flagged, unaudited)', () => {
  it('records nothing when the flag is off', () => {
    const s = new SaleSim(saleInput());
    s.buy(person('alice'), 0);
    expect(s.ledger.auditLog.size()).toBe(0n);
  });

  it('the auditor can decrypt the holder commitment of each ticket', () => {
    const s = new SaleSim(saleInput({ auditorPk: pointOf(AUDITOR_SK) }));
    const alice = person('alice'), bob = person('bob');
    s.buy(alice, 0); s.buy(bob, 0);
    const log = s.ledger.auditLog;
    expect(log.size()).toBe(2n);
    expect(decryptAuditRecord(AUDITOR_SK, log.lookup(0n))).toBe(alice.cred.attrs.holderCommit);
    expect(decryptAuditRecord(AUDITOR_SK, log.lookup(1n))).toBe(bob.cred.attrs.holderCommit);
    expect(decryptAuditRecord(AUDITOR_SK + 1n, log.lookup(0n))).not.toBe(alice.cred.attrs.holderCommit);
  });
});

describe('issuer key handling', () => {
  it('a sale only trusts its own issuer key', () => {
    const otherIssuer = 12345n;
    const s = new SaleSim(saleInput({ issuerPk: pointOf(otherIssuer) }));
    expectFail(() => s.buy(person('alice'), 0), /bad issuer signature/);
    const p = person('alice');
    const cred = signCredential(otherIssuer, p.cred.attrs);
    s.buy(p, 0, { cred });
    expect(s.ledger.ticketsSold).toBe(1n);
  });
});
