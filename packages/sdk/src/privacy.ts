// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// The privacy model, as MEASURED on a local ledger-8 network (decoded transactions,
// indexer view and contract state; see README "Privacy model"). The UI renders this table
// on How It Works and in the per-action stepper, so the product never claims more privacy
// than was observed.

export type Action = 'deploy' | 'buy' | 'finalize' | 'refund' | 'withdraw' | 'collectFee' | 'claim' | 'mint';

export interface Visibility {
  action: Action;
  title: string;
  circuit: string;
  public: string[];
  hidden: string[];
  /** What stays on the device and is only used inside the proof. */
  local: string[];
}

export const VISIBILITY: Visibility[] = [
  {
    action: 'buy',
    title: 'Buy a ticket',
    circuit: 'buyTicket',
    public: [
      'The sale address and the entry point name (buyTicket)',
      'The payment coin paid into the sale vault: token color, value (= ticket price), nonce and commitment',
      'A buy nullifier and a receipt commitment (unlinkable random-looking hashes)',
      'tickets sold +1, and that the block time was inside the sale window',
      'One shielded input nullifier and one change output, with no owner shown',
    ],
    hidden: [
      'Who bought: no wallet key or address appears in the transaction',
      'Credential attributes: country, KYC level, expiry, and the holder secret',
      'How many tickets one person holds, and which tickets belong to the same person',
      'The buyer\'s other coins and change amount',
    ],
    local: ['Master secret and holder secret', 'Issuer-signed credential', 'Ticket index i < N', 'Receipt secret'],
  },
  {
    action: 'refund',
    title: 'Refund (soft cap missed)',
    circuit: 'refund',
    public: [
      'Entry point refund and the vault coin spent (value, color, nonce, index) with its nullifier',
      'A refund nullifier for one receipt',
      'One shielded output, with no owner shown',
    ],
    hidden: ['Who was refunded', 'Which purchase it was: the receipt is proven by a Merkle path, not revealed'],
    local: ['Receipt secret', 'Merkle path to the receipt'],
  },
  {
    action: 'claim',
    title: 'Claim vested tokens',
    circuit: 'claim',
    public: [
      'Entry point claim and the tranche number',
      'A public mint of the sale token: domain and amount for that tranche',
      'A claim nullifier for (receipt, tranche)',
      'One shielded output, with no owner shown',
    ],
    hidden: ['Who claimed, and the link to any purchase or buying wallet (a brand-new wallet can claim)'],
    local: ['Receipt secret', 'Merkle path to the receipt'],
  },
  {
    action: 'withdraw',
    title: 'Project withdraws proceeds',
    circuit: 'withdraw',
    public: [
      'Entry point withdraw and the vault coin spent',
      'The fee change coin written to the fee vault, so the net amount can be derived',
      'One shielded output to the project, with no owner shown',
    ],
    hidden: ['The project\'s receiving address', 'The admin secret (only the result of a hash check is public)'],
    local: ['Admin secret derived from the project\'s master secret'],
  },
  {
    action: 'collectFee',
    title: 'Platform collects fees',
    circuit: 'collectFee',
    public: ['Entry point collectFee and the fee coin spent', 'One shielded output, with no owner shown'],
    hidden: ['The platform\'s receiving address'],
    local: ['Platform admin secret'],
  },
  {
    action: 'deploy',
    title: 'Create a sale',
    circuit: 'constructor',
    public: ['Every sale parameter: price, caps, per-person limit, times, vesting, fee, issuer key, KYC minimum, blocked countries, auditor flag'],
    hidden: ['The project admin secret (only its hash, the project key, is stored)'],
    local: ['Admin secret'],
  },
  {
    action: 'finalize',
    title: 'Finalize',
    circuit: 'finalize',
    public: ['The phase change (succeeded or failed)'],
    hidden: [],
    local: [],
  },
  {
    action: 'mint',
    title: 'Mint test tUSD',
    circuit: 'mint',
    public: ['The minted amount and token color'],
    hidden: ['The recipient'],
    local: [],
  },
];

export const visibilityOf = (a: Action) => VISIBILITY.find((v) => v.action === a)!;

export const AGGREGATE_LIMITS = [
  'Ticket price, tickets sold, total raised, the project\'s net and the platform fee are public.',
  'Each claim reveals its tranche and minted amount.',
  'Fees are paid in DUST by the submitting wallet; DUST registration links to that wallet\'s NIGHT, so claim from a wallet you do not mind being seen paying a fee.',
  'Sybil resistance is only as strong as the issuer: N tickets per person assumes one credential per person.',
  'With the auditor flag on, a designated auditor can decrypt which credential holder bought each ticket.',
];
