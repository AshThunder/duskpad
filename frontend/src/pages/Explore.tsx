// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, Search } from 'lucide-react';
import { SaleCard } from '../components/SaleCard';
import { Empty, Notice, Skeleton } from '../components/ui';
import { saleStatus, useNow, useSaleViews, useSales, type SaleStatus } from '../lib/sales';

const FILTERS: { id: 'all' | SaleStatus | 'ended'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'live', label: 'Live' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'ended', label: 'Ended' },
];

export function Explore() {
  const { sales, error } = useSales();
  const { views } = useSaleViews((sales ?? []).map((s) => s.address));
  const now = useNow(1000);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [q, setQ] = useState('');
  const list = useMemo(() => (sales ?? []).filter((m) => {
    if (q && !`${m.name} ${m.symbol}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'all') return true;
    const v = views[m.address]?.view;
    if (!v) return false;
    const st = saleStatus(v, now / 1000);
    return filter === 'ended' ? ['awaiting', 'succeeded', 'failed', 'soldout'].includes(st) : st === filter;
  }), [sales, views, filter, q, now]);

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <span className="tag-terminal mb-4">[ OFF-CHAIN REGISTRY · ON-CHAIN STATE ]</span>
          <h1 className="font-display text-display-md md:text-display-lg mt-4">Token sales</h1>
          <p className="text-on-surface-variant mt-2 max-w-2xl">Names come from the DuskPad registry; every number on a card is read live from the sale contract through the indexer.</p>
        </div>
        <Link to="/create" className="btn-dark"><Rocket size={16} /> Launch a sale</Link>
      </header>
      <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="flex gap-2 flex-wrap" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
              className={`pill !px-4 !py-2 ${filter === f.id ? 'bg-ink text-white' : 'bg-surface-high text-on-surface-variant hover:bg-surface-highest'}`}>{f.label}</button>
          ))}
        </div>
        <label className="relative md:w-80">
          <span className="sr-only">Search sales</span>
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
          <input className="input !pl-11 !py-2.5" placeholder="Search by name or symbol" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {error && <Notice tone="error">Registry unavailable: {error}. Start the API with <code>npm run dev:api</code>.</Notice>}
      {!sales && !error && <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[420px] !rounded-card" />)}</div>}
      {sales && list.length === 0 && (
        <Empty icon={<Rocket />} title={sales.length ? 'No sales match this filter' : 'No sales yet'}>
          {sales.length ? 'Try another filter.' : <>Be the first: <Link className="link" to="/create">launch a sale</Link>.</>}
        </Empty>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
        {list.map((m, i) => <SaleCard key={m.address} meta={m} view={views[m.address]?.view ?? (views[m.address] === null ? null : undefined)} index={i} now={now} />)}
      </div>
    </div>
  );
}
