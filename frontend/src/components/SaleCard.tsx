// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { Link } from 'react-router-dom';
import { formatUnits, type SaleView } from '@duskpad/sdk';
import type { SaleMeta } from '../lib/api';
import { STATUS_LABEL, saleStatus } from '../lib/sales';
import { Countdown, ProgressBar, Skeleton } from './ui';

const TINTS = ['bg-mint', 'bg-lilac', 'bg-butter', 'bg-blush'];

export function SaleCard({ meta, view, index, now }: { meta: SaleMeta; view: SaleView | null | undefined; index: number; now: number }) {
  const tint = TINTS[(meta.accent ?? index) % TINTS.length];
  const st = view ? saleStatus(view, now / 1000) : null;
  return (
    <article className={`${tint} rounded-card p-7 flex flex-col gap-5 shadow-tint hover:-translate-y-1 transition-transform duration-300 animate-rise`} data-testid="sale-card">
      <div className="flex justify-between items-start">
        <span className={`tag-terminal ${st && st !== 'live' ? '!text-surface-highest' : ''}`}>[ {st ? STATUS_LABEL[st] : '…'} ]</span>
        <div className="text-right">
          <div className="label-mono text-ink/60 mb-1">{st === 'upcoming' ? 'STARTS IN' : st === 'live' ? 'ENDS IN' : 'TYPE'}</div>
          <div className="font-mono font-bold text-ink">
            {view && st === 'upcoming' ? <Countdown to={view.start} now={now} /> : view && st === 'live' ? <Countdown to={view.end} now={now} /> : view ? (view.kind === 'fixedPrice' ? 'FIXED PRICE' : 'FIRST-COME') : '—'}
          </div>
        </div>
      </div>
      <div className="py-3">
        <h2 className="font-display text-[42px] leading-none font-bold text-ink mb-2 break-words">{meta.symbol}</h2>
        <p className="text-ink/70 font-medium">{meta.name}</p>
      </div>
      {view ? (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-baseline border-b border-ink/10 pb-3">
            <span className="label-mono text-ink/60">TICKET PRICE</span>
            <span className="font-display text-[24px] font-bold text-ink">{formatUnits(view.ticketPrice)} <span className="text-[14px]">tUSD</span></span>
          </div>
          <div className="flex justify-between items-baseline border-b border-ink/10 py-3">
            <span className="label-mono text-ink/60">PER PERSON</span>
            <span className="font-mono text-ink">up to {view.maxPerPerson}</span>
          </div>
          <div className="pt-1">
            <ProgressBar value={view.ticketsSold} max={view.hardCap} marks={view.softCap > 0 ? [{ at: view.softCap, label: 'SOFT CAP' }] : []} />
            <div className="flex justify-between mt-2 font-mono text-[12px] text-ink/70">
              <span>{view.ticketsSold} / {view.hardCap} tickets</span>
              <span>{formatUnits(view.ticketPrice * BigInt(view.ticketsSold))} tUSD raised</span>
            </div>
          </div>
        </div>
      ) : view === null ? (
        <div className="text-ink/60 text-[14px]">Contract not found on this network.</div>
      ) : (
        <div className="space-y-3"><Skeleton className="h-6" /><Skeleton className="h-6" /><Skeleton className="h-3" /></div>
      )}
      <Link to={`/sale/${meta.address}`} className="btn-dark w-full mt-1">View sale</Link>
    </article>
  );
}
