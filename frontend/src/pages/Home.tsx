// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, EyeOff, Lock, Sparkles, Ticket, Wallet } from 'lucide-react';
import { formatUnits } from '@duskpad/sdk';
import { useSaleViews, useSales, saleStatus, useNow } from '../lib/sales';
import { SaleCard } from '../components/SaleCard';

export function Home() {
  const { sales } = useSales();
  const { views } = useSaleViews((sales ?? []).map((s) => s.address));
  const now = useNow(1000);
  const vs = Object.values(views).filter(Boolean).map((x) => x!.view);
  const live = vs.filter((v) => saleStatus(v, now / 1000) === 'live').length;
  const tickets = vs.reduce((a, v) => a + v.ticketsSold, 0);
  const raised = vs.reduce((a, v) => a + v.ticketPrice * BigInt(v.ticketsSold), 0n);
  const featured = (sales ?? []).slice(0, 3);

  return (
    <div className="flex flex-col gap-20">
      <section className="grid lg:grid-cols-2 gap-12 items-center pt-4">
        <div className="space-y-8 animate-rise">
          <span className="tag-terminal"><Lock size={13} /> [ ZERO-KNOWLEDGE LAUNCHPAD ]</span>
          <h1 className="font-display text-[52px] md:text-display-xl text-ink">
            Prove you qualify.<br />Buy unseen.<br /><span className="dusk-text">Claim unlinked.</span>
          </h1>
          <p className="text-xl text-on-surface-variant max-w-xl">
            DuskPad runs compliant token sales on Midnight. Buyers prove KYC eligibility inside a zero-knowledge circuit and pay in shielded
            tUSD. The chain enforces caps and refunds, yet never learns who bought or how much any one person holds.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/explore" className="btn-dark">Explore sales <ArrowRight size={16} /></Link>
            <Link to="/create" className="btn-light">Launch a sale</Link>
          </div>
        </div>
        <LedgerMock />
      </section>

      <section className="card p-8 grid grid-cols-1 md:grid-cols-4 gap-8 divide-y md:divide-y-0 md:divide-x divide-outline-variant/40">
        {[
          ['Live sales', live || '–'],
          ['Tickets sold', tickets || '–'],
          ['Raised (tUSD)', raised ? formatUnits(raised) : '–'],
          ['Buyer identities on-chain', '0'],
        ].map(([k, v]) => (
          <div key={String(k)} className="text-center pt-4 md:pt-0">
            <div className="label-mono text-on-surface-variant mb-2">{k}</div>
            <div className="font-display text-[40px] font-bold">{v}</div>
          </div>
        ))}
      </section>

      <section>
        <div className="text-center mb-12">
          <h2 className="font-display text-display-md">Three proofs, zero doxxing</h2>
          <p className="text-on-surface-variant mt-3">Every rule below is part of the proven statement, so a modified client cannot break it.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { n: 'STEP 1', icon: <BadgeCheck />, t: 'Prove you qualify', d: 'An issuer signs your KYC level, country and expiry over a commitment to a secret only you hold. The sale checks the signature in-circuit. No wallet address is ever signed.' },
            { n: 'STEP 2', icon: <EyeOff />, t: 'Buy unseen', d: 'Pay a fixed price in shielded tUSD. Up to N tickets per person are enforced with nullifiers that cannot be linked to you or to each other.' },
            { n: 'STEP 3', icon: <Sparkles />, t: 'Claim unlinked', d: 'After the cliff, prove you hold a receipt and claim each vesting tranche from any wallet, even a brand-new one. If the soft cap is missed, refunds are just as private.' },
          ].map((s) => (
            <div key={s.n} className="card p-8 min-h-[300px]">
              <span className="pill bg-butter text-[#241a00] mb-6">{s.n}</span>
              <div className="w-12 h-12 bg-surface-mid rounded-full flex items-center justify-center my-6">{s.icon}</div>
              <h3 className="font-display text-[24px] font-semibold mb-3">{s.t}</h3>
              <p className="text-on-surface-variant">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {featured.length > 0 && (
        <section>
          <div className="flex justify-between items-end mb-8">
            <h2 className="font-display text-display-md">Latest sales</h2>
            <Link to="/explore" className="link font-mono text-[13px] uppercase">All sales →</Link>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            {featured.map((m, i) => <SaleCard key={m.address} meta={m} view={views[m.address]?.view ?? (views[m.address] === null ? null : undefined)} index={i} now={now} />)}
          </div>
        </section>
      )}

      <section className="rounded-card bg-ink text-white p-10 md:p-14 grid md:grid-cols-[1.4fr_1fr] gap-10 items-center grain">
        <div>
          <h2 className="font-display text-[40px] font-bold leading-tight">Run a compliant raise without building a honeypot of investor data.</h2>
          <p className="text-white/70 mt-4 text-lg">One contract per sale. Fixed-price or first-come. Soft cap with automatic private refunds. Cliff and tranche vesting. Platform fee taken on withdrawal.</p>
        </div>
        <div className="flex flex-col gap-3">
          <Link to="/create" className="btn bg-white text-ink hover:opacity-90"><Ticket size={16} /> Launch a sale</Link>
          <Link to="/how-it-works" className="btn border-2 border-white/40 text-white hover:bg-white/10"><Wallet size={16} /> See the privacy model</Link>
        </div>
      </section>
    </div>
  );
}

function LedgerMock() {
  const rows = [
    ['buyTicket', '0x9f3c…a1e2', '1,000 tUSD'],
    ['buyTicket', '0x41d0…77b9', '1,000 tUSD'],
    ['claim · t0', '0xc7e5…09fa', '+333 NOVA'],
    ['buyTicket', '0x2b8a…f413', '1,000 tUSD'],
  ];
  return (
    <div className="relative w-full max-w-xl mx-auto lg:ml-auto">
      <div className="absolute -top-6 -right-4 w-40 h-40 rounded-full dusk-gradient blur-3xl opacity-40" aria-hidden />
      <div className="relative bg-white rounded-panel shadow-lift border border-outline-variant/30 p-6 md:p-8 overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-display text-[20px] font-bold">What the chain sees</h3>
          <span className="flex items-center gap-2 text-success text-[13px] font-bold"><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> LEDGER</span>
        </div>
        <div className="grid grid-cols-[1.1fr_1.3fr_1fr_0.9fr] label-mono text-on-surface-variant pb-2 border-b border-surface-highest">
          <div>CIRCUIT</div><div>NULLIFIER</div><div>AMOUNT</div><div className="text-right">BUYER</div>
        </div>
        {rows.map(([c, n, a], i) => (
          <div key={i} className="grid grid-cols-[1.1fr_1.3fr_1fr_0.9fr] items-center py-3 border-b border-surface-highest/60 font-mono text-[13px]">
            <div className="font-bold">{c}</div><div className="text-on-surface-variant">{n}</div><div>{a}</div>
            <div className="flex justify-end"><span className="tag-terminal !text-[11px] !px-2"><Lock size={11} /> ***</span></div>
          </div>
        ))}
        <div className="mt-5 rounded-2xl bg-primary-fixed p-4 text-[13px] text-[#22005d]">
          Country, KYC level, wallet, and tickets-per-person: <b>not in any transaction.</b> Measured on a local ledger-8 network.
        </div>
      </div>
    </div>
  );
}
