// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, EyeOff, FileSearch, Globe, KeyRound, RefreshCw } from 'lucide-react';
import { decodeTxEffects, decryptAuditRecord, fetchSaleActivity, formatUnits, type ActivityInfo, type ActivityItem, type TxEffects } from '@duskpad/sdk';
import { publicEndpoints } from '../lib/config';
import { useSale, saleStatus, STATUS_LABEL, useNow } from '../lib/sales';
import { useVault } from '../state/VaultContext';
import { RaiseChart } from '../components/RaiseChart';
import { Hex, Notice, Skeleton, Spinner, Stat } from '../components/ui';

const LABEL: Record<string, string> = { deploy: 'Sale created', buyTicket: 'Ticket bought', finalize: 'Finalized', refund: 'Refund', claim: 'Tokens claimed', withdraw: 'Proceeds withdrawn', collectFee: 'Fee collected' };

export function SaleReport() {
  const { address = '' } = useParams();
  const { meta, view, ledger, error } = useSale(address, 8000);
  const now = useNow(10_000);
  const [acts, setActs] = useState<ActivityItem[] | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actInfo, setActInfo] = useState<ActivityInfo | null>(null);

  const load = async () => {
    setLoading(true);
    try { setActs(await fetchSaleActivity(publicEndpoints().indexer, address, 500, true, { onInfo: setActInfo })); setActErr(null); }
    catch (e: any) {
      console.warn('[duskpad] activity query failed', e);
      // Keep the last good list; only show an error when there is nothing to show.
      setActErr(`Could not read this sale's activity from the indexer (${String(e?.message ?? e).slice(0, 160)}). Retrying every 15 s.`);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); const id = setInterval(() => void load(), 15_000); return () => clearInterval(id); /* eslint-disable-next-line */ }, [address]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (acts ?? []).filter((a) => a.status !== 'FAILURE').forEach((a) => { c[a.entryPoint] = (c[a.entryPoint] ?? 0) + 1; });
    return c;
  }, [acts]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!view) return <Skeleton className="h-96" />;
  const st = saleStatus(view, now / 1000);

  return (
    <div className="space-y-10">
      <Link to={`/sale/${address}`} className="inline-flex items-center gap-2 text-on-surface-variant hover:text-ink font-medium"><ArrowLeft size={16} /> Back to sale</Link>
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <span className="tag-terminal">[ PUBLIC REPORT · NO WALLET NEEDED ]</span>
          <h1 className="font-display text-display-md md:text-display-lg mt-4">{meta?.symbol ?? 'Sale'} report</h1>
          <p className="text-on-surface-variant mt-2 max-w-2xl">Everything below is read from the public indexer: exactly what any observer of Midnight can see about this sale.</p>
        </div>
        <button className="btn-light" onClick={() => void load()} disabled={loading}>{loading ? <Spinner /> : <RefreshCw size={16} />} Refresh</button>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4" data-testid="report-stats">
        <div className="card p-5"><Stat label="Status" value={STATUS_LABEL[st]} /></div>
        <div className="card p-5"><Stat label="Tickets sold" value={view.ticketsSold} sub={`of ${view.hardCap}`} /></div>
        <div className="card p-5"><Stat label="Raised" value={formatUnits(view.ticketPrice * BigInt(view.ticketsSold))} sub="tUSD" /></div>
        <div className="card p-5"><Stat label="Refunds / claims" value={`${view.refundsPaid} / ${view.claimsPaid}`} /></div>
        <div className="card p-5"><Stat label="Withdrawn / fees" value={`${view.ticketsWithdrawn} / ${view.feeCoinsCollected}`} sub="coins" /></div>
        <div className="bg-ink text-white rounded-card p-5"><div className="label-mono text-white/60">Unique buyers</div><div className="font-display text-[24px] font-bold flex items-center gap-2 mt-1"><EyeOff size={18} className="text-terminal" /> Hidden</div><div className="text-[12px] text-white/60">by design</div></div>
      </section>

      <section className="card p-7">
        <h2 className="font-display text-[22px] font-bold mb-2">Tickets over time</h2>
        <p className="text-on-surface-variant text-[14px] mb-4">From block timestamps of successful buyTicket calls.</p>
        {acts ? <RaiseChart activity={acts} softCap={view.softCap} hardCap={view.hardCap} start={view.start} end={view.end} /> : <Skeleton className="h-[260px]" />}
      </section>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
        <section className="card p-7 min-w-0">
          <h2 className="font-display text-[22px] font-bold mb-4 flex items-center gap-2"><Globe size={20} className="text-primary" /> On-chain activity</h2>
          {actErr && !acts && <Notice tone="error">{actErr}</Notice>}
          {actInfo?.truncated && <p className="text-[13px] text-on-surface-variant mb-3" data-testid="report-truncated">Showing activity from the last {actInfo.blocksScanned?.toLocaleString()} blocks; older history is not loaded.</p>}
          {!acts ? <Skeleton className="h-48" /> : (
            <ul className="divide-y divide-outline-variant/60" data-testid="report-activity">
              {acts.map((a) => <ActivityRow key={a.txHash + a.entryPoint} a={a} />)}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
          <section className="card p-7">
            <h3 className="font-display text-[19px] font-bold mb-3">Call counts</h3>
            {Object.entries(counts).map(([k, n]) => <div key={k} className="flex justify-between py-1.5 text-[14px] border-b border-outline-variant/50 last:border-0"><span>{LABEL[k] ?? k}</span><span className="font-mono">{n}</span></div>)}
            <div className="flex justify-between pt-3 text-[13px] text-on-surface-variant"><span>Buy nullifiers / receipt nullifiers</span><span className="font-mono">{view.buyNullifierCount} / {view.receiptNullifierCount}</span></div>
          </section>
          <section className="bg-ink text-white rounded-card p-7">
            <h3 className="font-display text-[19px] font-bold mb-3 flex items-center gap-2"><EyeOff size={18} className="text-terminal" /> Not in this report</h3>
            <ul className="space-y-2 text-[14px] text-white/80 list-disc pl-5">
              <li>Who bought, and how many tickets any one person holds</li>
              <li>Buyers' countries, KYC levels or credentials</li>
              <li>Which refund or claim belongs to which purchase</li>
              <li>Wallet addresses that received refunds, tokens or proceeds</li>
            </ul>
            <p className="text-[12px] text-white/50 mt-4">Still public: counts, timing, amounts per action (fixed price), and the DUST fee-paying wallet's activity. See How it works for limits.</p>
          </section>
          {view.auditorEnabled && ledger && <AuditorPanel address={address} records={[...(ledger.auditLog as any)].map(([k, v]: any) => ({ id: Number(k), ...v }))} />}
        </aside>
      </div>
    </div>
  );
}

function ActivityRow({ a }: { a: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const [eff, setEff] = useState<TxEffects | null | undefined>(undefined);
  const toggle = async () => { setOpen((o) => !o); if (eff === undefined && a.raw) setEff(await decodeTxEffects(a.raw)); };
  return (
    <li className="py-3">
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => void toggle()} aria-expanded={open}>
        <span className="flex items-center gap-3 min-w-0">
          <span className={`pill !text-[11px] ${a.status === 'FAILURE' ? 'bg-blush' : 'bg-surface-high'}`}>{LABEL[a.entryPoint] ?? a.entryPoint}</span>
          <span className="text-on-surface-variant text-[13px] truncate">block {a.height} · {new Date(a.timestamp).toLocaleString()}</span>
        </span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 panel p-4 text-[13px] grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          <div>Tx <Hex value={a.txHash} /></div>
          <div>Status <b>{a.status}</b></div>
          {a.fee && <div>Fee {formatUnits(BigInt(a.fee), 15, 6)} DUST</div>}
          {eff === undefined ? <div><Spinner size={13} /></div> : eff === null ? <div>Could not decode</div> : (<>
            <div>Shielded inputs (nullifiers) <b>{eff.shieldedInputs}</b></div>
            <div>Shielded outputs (commitments) <b>{eff.shieldedOutputs}</b></div>
            <div>Contract coins in / out <b>{eff.contractInputs} / {eff.contractOutputs}</b></div>
          </>)}
        </div>
      )}
    </li>
  );
}

function AuditorPanel({ address, records }: { address: string; records: { id: number; ephemeral: any; ciphertext: bigint }[] }) {
  const vault = useVault();
  const saved = vault.data?.auditorKeys?.find((k) => k.sale === address)?.sk ?? '';
  const [sk, setSk] = useState('');
  const [out, setOut] = useState<{ id: number; commit: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decrypt = () => {
    setErr(null);
    try { const key = BigInt((sk || saved).trim()); setOut(records.map((r) => ({ id: r.id, commit: decryptAuditRecord(key, r).toString(16).padStart(64, '0') }))); }
    catch (e: any) { setErr(e.message); }
  };
  const groups = out ? Object.entries(out.reduce<Record<string, number>>((m, r) => ({ ...m, [r.commit]: (m[r.commit] ?? 0) + 1 }), {})) : [];
  return (
    <section className="card p-7 space-y-3 border-2 border-butter" data-testid="auditor-panel">
      <h3 className="font-display text-[19px] font-bold flex items-center gap-2"><FileSearch size={18} className="text-primary" /> Auditor view</h3>
      <span className="pill bg-butter text-ink !text-[11px]">OPTIONAL · UNAUDITED CONSTRUCTION</span>
      <p className="text-[13px] text-on-surface-variant">{records.length} encrypted disclosure records on-chain. Only the auditor key can open them, revealing credential commitments (not identities).</p>
      <input className="input font-mono !text-[12px]" placeholder={saved ? 'Using the key saved in your vault' : 'Auditor secret key (decimal)'} value={sk} onChange={(e) => setSk(e.target.value)} />
      <button className="btn-dark w-full" onClick={decrypt} disabled={!sk && !saved}><KeyRound size={15} /> Decrypt records</button>
      {err && <Notice tone="error">{err}</Notice>}
      {out && <div className="text-[13px] space-y-1">{groups.map(([c, n]) => <div key={c} className="flex justify-between"><Hex value={c} /> <span className="font-mono">{n} ticket{n > 1 ? 's' : ''}</span></div>)}</div>}
    </section>
  );
}
