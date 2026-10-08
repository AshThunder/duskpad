// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useCallback, useEffect, useRef, useState } from 'react';
import { readSale, readSaleLedger, type Sale, type SaleView } from '@duskpad/sdk';
import { api, type SaleMeta } from './api';
import { useApp } from '../state/AppContext';

export type SaleStatus = 'upcoming' | 'live' | 'soldout' | 'awaiting' | 'succeeded' | 'failed';

export function saleStatus(v: SaleView, nowS = Date.now() / 1000): SaleStatus {
  if (v.phase === 'succeeded') return 'succeeded';
  if (v.phase === 'failed') return 'failed';
  if (v.ticketsSold >= v.hardCap) return 'soldout';
  if (nowS < v.start) return 'upcoming';
  if (nowS >= v.end) return 'awaiting';
  return 'live';
}

export const STATUS_LABEL: Record<SaleStatus, string> = {
  upcoming: 'UPCOMING', live: 'LIVE', soldout: 'SOLD OUT', awaiting: 'ENDED', succeeded: 'SUCCEEDED', failed: 'REFUNDING',
};

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export function useSales() {
  const [sales, setSales] = useState<SaleMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => { api.sales().then(setSales).catch((e) => setError(String(e.message ?? e))); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { sales, error, reload };
}

export function useSale(address: string | undefined, pollMs = 5000) {
  const { publicData } = useApp();
  const [meta, setMeta] = useState<SaleMeta | null>(null);
  const [ledger, setLedger] = useState<Sale.Ledger | null>(null);
  const [view, setView] = useState<SaleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const L = await readSaleLedger(publicData, address);
      if (!alive.current) return;
      if (!L) { setError('No contract found at this address on this network.'); setLoading(false); return; }
      setLedger(L); setView(readSale(L)); setError(null);
    } catch (e: any) {
      if (alive.current) setError(String(e?.message ?? e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [address, publicData]);

  useEffect(() => {
    alive.current = true;
    if (!address) return;
    api.sale(address).then((m) => alive.current && setMeta(m)).catch(() => {});
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [address, refresh, pollMs]);

  return { meta, ledger, view, error, loading, refresh };
}

/** Load ledgers for many sales at once (Explore / Dashboard). */
export function useSaleViews(addresses: string[]) {
  const { publicData } = useApp();
  const [views, setViews] = useState<Record<string, { view: SaleView; ledger: Sale.Ledger } | null>>({});
  const key = addresses.join(',');
  const load = useCallback(async () => {
    const out: Record<string, { view: SaleView; ledger: Sale.Ledger } | null> = {};
    await Promise.all(addresses.map(async (a) => {
      try {
        const L = await readSaleLedger(publicData, a);
        out[a] = L ? { view: readSale(L), ledger: L } : null;
      } catch { out[a] = null; }
    }));
    setViews(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, publicData]);
  useEffect(() => { void load(); const id = setInterval(() => void load(), 10_000); return () => clearInterval(id); }, [load]);
  return { views, reload: load };
}

export function fmtDuration(sec: number): string {
  if (sec <= 0) return '0s';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const parts = d ? [[d, 'd'], [h, 'h']] : h ? [[h, 'h'], [m, 'm']] : m ? [[m, 'm'], [s, 's']] : [[s, 's']];
  return parts.filter(([v], i) => i === 0 || v).map(([v, u]) => `${v}${u}`).join(' ');
}

export const fmtDate = (unixS: number) =>
  new Date(unixS * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
