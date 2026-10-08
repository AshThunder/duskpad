// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Loader2, ShieldAlert } from 'lucide-react';
import { shortHex } from '../lib/hex';

export function Spinner({ size = 16, label = 'Working' }: { size?: number; label?: string }) {
  return <Loader2 size={size} className="spin shrink-0" role="status" aria-label={label} />;
}

export function Hex({ value, chars = 8, className = '' }: { value: string; chars?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className={`inline-flex items-center gap-1.5 font-mono text-[13px] hover:text-primary ${className}`}
      aria-label={`Copy ${value}`}
    >
      <span>{shortHex(value, chars)}</span>
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} className="opacity-50" />}
    </button>
  );
}

export function Stat({ label, value, sub, className = '' }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="label-mono text-on-surface-variant mb-2">{label}</div>
      <div className="font-display text-[28px] leading-tight font-bold text-ink">{value}</div>
      {sub && <div className="text-[13px] text-on-surface-variant mt-1">{sub}</div>}
    </div>
  );
}

export function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-4 border-b border-ink/10 py-3 last:border-b-0">
      <span className="label-mono text-ink/60">{k}</span>
      <span className="text-right text-ink">{v}</span>
    </div>
  );
}

export function MockBadge({ children = 'MOCK ISSUER · DEMO ONLY' }: { children?: ReactNode }) {
  return (
    <span className="pill bg-butter text-[#503d00] border border-[#c9a74d]">
      <ShieldAlert size={13} /> {children}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="panel p-10 text-center flex flex-col items-center gap-4">
      <div className="w-14 h-14 rounded-full bg-surface-high flex items-center justify-center text-ink">{icon}</div>
      <h3 className="font-display text-[22px] font-semibold">{title}</h3>
      {children && <div className="text-on-surface-variant max-w-md">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const cls = {
    info: 'bg-primary-fixed/60 text-[#22005d] border-primary/20',
    warn: 'bg-butter/60 text-[#503d00] border-[#c9a74d]/50',
    error: 'bg-error-container text-on-error-container border-error/30',
    ok: 'bg-success-container text-[#0b3d21] border-success/30',
  }[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-2xl border px-4 py-3 text-[14px] ${cls}`}>{children}</div>;
}

/** Native <dialog> opened with showModal(); light-dismiss via closedby="any" with a click fallback. */
export function Dialog({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCloseEv = () => onClose();
    d.addEventListener('close', onCloseEv);
    const fallback = (e: MouseEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype || e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) d.close();
    };
    d.addEventListener('click', fallback);
    return () => { d.removeEventListener('close', onCloseEv); d.removeEventListener('click', fallback); };
  }, [onClose]);
  return (
    // eslint-disable-next-line react/no-unknown-property
    <dialog ref={ref} className="dk-dialog" aria-label={label} {...({ closedby: 'any' } as any)}>
      {open && children}
    </dialog>
  );
}

export function Countdown({ to, now }: { to: number; now: number }) {
  const s = Math.max(0, Math.floor(to - now / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = d ? [`${d}d`, `${h}h`, `${m}m`] : h ? [`${h}h`, `${m}m`, `${sec}s`] : [`${m}m`, `${sec}s`];
  return <span className="font-mono tabular-nums">{parts.join(' ')}</span>;
}

export function ProgressBar({ value, max, marks = [] }: { value: number; max: number; marks?: { at: number; label: string }[] }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="relative pt-6">
      {marks.map((m) => (
        <div key={m.label} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: `${(m.at / max) * 100}%` }}>
          <span className="label-mono text-[10px] text-on-surface-variant whitespace-nowrap">{m.label}</span>
        </div>
      ))}
      <div className="h-3 rounded-full bg-ink/10 overflow-hidden relative" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className="h-full dusk-gradient rounded-full transition-[width] duration-700" style={{ width: `${pct}%` }} />
        {marks.map((m) => (
          <div key={m.label} className="absolute top-0 bottom-0 w-[2px] bg-ink/60" style={{ left: `${(m.at / max) * 100}%` }} />
        ))}
      </div>
    </div>
  );
}
