// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { Link } from 'react-router-dom';
import { AlertTriangle, Cpu, FileKey2, Fingerprint, Lock, Network, Receipt, Ticket } from 'lucide-react';
import { AGGREGATE_LIMITS } from '@duskpad/sdk';
import { VisibilityTable } from '../components/VisibilityTable';

const ENFORCED: [string, string, string][] = [
  ['Credential signed by the sale\'s issuer key', 'circuit', 'bad issuer signature'],
  ['Credential bound to the buyer\'s holder secret', 'circuit', 'credential not bound to this holder'],
  ['Country not on the blocked list; KYC level; expiry', 'circuit', 'blocked region / kyc level too low / credential expired'],
  ['At most N tickets per person', 'circuit + ledger', 'per-person ticket cap reached / ticket index already used'],
  ['Exact price in the right token', 'circuit', 'wrong payment amount / wrong payment token'],
  ['Same ticket raced from two wallets', 'ledger', 'one included, the other fails its fallible segment; payment is not taken'],
  ['Refund or claim the same receipt twice (even raced)', 'circuit + ledger', 'receipt already used for this'],
  ['Only the project withdraws, only the platform collects', 'circuit', 'not the project / not the platform'],
];

export function HowItWorks() {
  return (
    <div className="space-y-28">
      <section className="grid lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 space-y-7">
          <span className="tag-terminal"><Lock size={13} /> [ PRIVACY MODEL · MEASURED ]</span>
          <h1 className="font-display text-display-md md:text-display-xl">Zero knowledge <span className="text-surface-dim">&amp;</span><br />token sales.</h1>
          <p className="text-lg text-on-surface-variant max-w-2xl">
            This page shows exactly what a DuskPad transaction reveals. The tables come from decoding real transactions on a local
            ledger-8 Midnight network (node 1.0.400, indexer 4.3.5) and reading the indexer and contract state: no wallet key appeared in any of them.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/explore" className="btn-dark">Explore sales</Link>
            <a href="#visibility" className="btn-light">Jump to the table</a>
          </div>
        </div>
        <div className="lg:col-span-5">
          <div className="bg-butter p-8 rounded-card shadow-tint rotate-2 max-w-sm ml-auto">
            <div className="label-mono border-b border-ink/20 pb-2 mb-4">PUBLIC LEDGER · buyTicket</div>
            <div className="space-y-3 font-mono text-[13px]">
              {[['buy nullifier', '0x7a1e…c3'], ['receipt commit', '0x09bd…44'], ['vault coin', '1,000 tUSD']].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-ink/10 pb-2"><span>{k}</span><span className="font-bold">{v}</span></div>
              ))}
              {['buyer', 'country', 'KYC level', 'tickets held'].map((k) => (
                <div key={k} className="flex justify-between"><span>{k}</span><span className="bg-ink text-surface px-2 rounded text-[11px]">HIDDEN</span></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Steps title="Launching a sale" sub="Permissionless: one contract per sale, parameters fixed at deployment." color="bg-primary" items={[
        ['Pick the rules', 'Fixed-price with a soft cap (private refunds if missed) or capped first-come. Ticket price, caps, up to N per person, vesting cliff and tranches, KYC minimum and up to 4 blocked countries.'],
        ['Deploy', 'Your wallet deploys a fresh sale contract. Its constructor validates every parameter and stores only the hash of an admin secret derived from your DuskPad vault.'],
        ['List it', 'Name and description go to the off-chain registry. Numbers on DuskPad pages are always read from the contract.'],
      ]} />

      <Steps title="Buying" sub="Your identity is checked inside the proof, not by the contract reading your data." color="bg-secondary" items={[
        ['Get verified once', 'The (mock) issuer signs country, KYC level and expiry over a commitment to your holder secret. It never sees your wallet.'],
        ['Prove and pay', 'Your device proves the signature, your holder secret, the region and level rules, and that ticket slot i < N is unused. Your wallet adds shielded tUSD.'],
        ['Keep a receipt', 'A receipt commitment goes into a Merkle tree. Only your vault can open it, and nothing links it to the wallet that paid.'],
      ]} />

      <Steps title="Settlement" sub="Finalize is permissionless once the sale ends or sells out." color="bg-tertiary" items={[
        ['Soft cap missed', 'Every buyer proves a receipt and is refunded from the vault into a fresh shielded output.'],
        ['Soft cap met', 'The project withdraws each ticket coin net of the platform fee; the fee coin lands in a fee vault the platform collects.'],
        ['Vesting', 'Each tranche unlocks on schedule. Tokens are minted at claim time to whichever wallet claims: a brand-new wallet works.'],
      ]} />

      <section id="visibility" className="space-y-6 scroll-mt-28">
        <div className="max-w-3xl">
          <h2 className="font-display text-display-md">Public vs private, per transaction</h2>
          <p className="text-on-surface-variant mt-3">Sources: indexer GraphQL view, decoded transactions and contract ledger state. Fees are paid in DUST; no contract call created or spent an unshielded UTXO.</p>
        </div>
        <VisibilityTable />
        <div className="rounded-card bg-butter/60 border border-[#c9a74d]/50 p-6">
          <div className="flex items-center gap-2 font-bold mb-3"><AlertTriangle size={18} /> Honest limits</div>
          <ul className="list-disc pl-5 space-y-1.5 text-[15px]">{AGGREGATE_LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="font-display text-display-md">Where each rule is enforced</h2>
        <p className="text-on-surface-variant max-w-3xl">"Circuit" means the rule is part of the proven statement, so no valid proof exists that breaks it. "Ledger" means the network itself rejects it even when two transactions are built from the same state. Each row has a passing test in the end-to-end suite.</p>
        <div className="grid md:grid-cols-2 gap-3">
          {ENFORCED.map(([rule, where, msg]) => (
            <div key={rule} className="card p-5 flex gap-4 items-start">
              <span className={`pill shrink-0 ${where.includes('ledger') ? 'bg-ink text-terminal' : 'bg-primary-fixed text-primary'}`}>{where}</span>
              <div><div className="font-bold">{rule}</div><code className="font-mono text-[12px] text-on-surface-variant">{msg}</code></div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-8">
        <h2 className="font-display text-display-md">Architecture</h2>
        <div className="grid md:grid-cols-3 gap-4 items-stretch">
          <Box icon={<Cpu />} title="Your browser" tone="bg-primary-fixed" items={['DuskPad app (React)', 'Private vault: master secret, credential, tickets (AES-GCM, device key)', 'Circuit execution with witnesses', 'Encrypted backup export / import']} />
          <Box icon={<FileKey2 />} title="Your wallet" tone="bg-mint" items={['1AM or Lace via DApp Connector v4', 'Proving (or the proof server)', 'Adds shielded tUSD inputs, pays DUST', 'Submits the transaction']} />
          <Box icon={<Network />} title="Midnight" tone="bg-butter" items={['Sale contract per sale (Compact 0.31.1)', 'tUSD shielded test token', 'Indexer: public state + activity', 'Ledger 8: nullifiers, Merkle roots']} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Box icon={<Fingerprint />} title="Mock KYC issuer (demo)" tone="bg-blush" items={['Signs [holderCommit, country, KYC level, expiry]', 'Jubjub Schnorr, verified in-circuit', 'Never sees a wallet address', 'Clearly labelled MOCK: no real identity checks']} />
          <Box icon={<Receipt />} title="Registry (off-chain)" tone="bg-lilac" items={['Sale names and descriptions for Explore', 'Refuses addresses that do not exist on-chain', 'Holds no buyer data at all']} />
        </div>
      </section>

      <section className="rounded-card bg-ink text-white p-10 grid md:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <h2 className="font-display text-[34px] font-bold">See it on a live sale</h2>
          <p className="text-white/70 mt-2">Every sale has a public report page built only from indexer data.</p>
        </div>
        <Link to="/explore" className="btn bg-white text-ink"><Ticket size={16} /> Browse sales</Link>
      </section>
    </div>
  );
}

function Steps({ title, sub, color, items }: { title: string; sub: string; color: string; items: [string, string][] }) {
  return (
    <section className="space-y-12 pb-4">
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <h2 className="font-display text-headline">{title}</h2>
        <p className="text-on-surface-variant">{sub}</p>
      </div>
      <div className="grid md:grid-cols-3 gap-8">
        {items.map(([t, d], i) => (
          <div key={t} className="panel p-8 relative">
            <div className={`absolute -top-4 -left-4 w-12 h-12 ${color} text-white rounded-full flex items-center justify-center font-display text-xl shadow-lg`}>{i + 1}</div>
            <h3 className="font-display text-xl mb-3 mt-3">{t}</h3>
            <p className="text-on-surface-variant">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Box({ icon, title, items, tone }: { icon: React.ReactNode; title: string; items: string[]; tone: string }) {
  return (
    <div className={`${tone} rounded-card p-6`}>
      <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">{icon}</div><h3 className="font-display text-[20px] font-bold">{title}</h3></div>
      <ul className="space-y-1.5 text-[14px]">{items.map((x) => <li key={x} className="flex gap-2"><span className="text-ink/40">—</span>{x}</li>)}</ul>
    </div>
  );
}

