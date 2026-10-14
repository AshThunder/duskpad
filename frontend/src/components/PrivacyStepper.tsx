// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// "What's happening privately": a live view of a transaction's real pipeline stages, each tagged
// with whether it happens on your device (private) or on the public chain.
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Cpu, Eye, EyeOff, Loader2, Radio, ShieldCheck, Timer, XCircle } from 'lucide-react';
import { useDiag } from '../lib/diag';
import { visibilityOf, type Action } from '@duskpad/sdk';
import type { Step } from '../lib/txflow';

const TITLES: Partial<Record<Action, string>> = {
  buy: 'Buying a ticket privately', refund: 'Claiming your refund privately', claim: 'Claiming vested tokens',
  withdraw: 'Withdrawing proceeds', collectFee: 'Collecting platform fees', deploy: 'Deploying your sale', finalize: 'Finalizing the sale', mint: 'Minting test tUSD', setup: 'Deploying tUSD for this network',
};

export function PrivacyStepper({ action, steps, error, compact = false }: { action: Action; steps: Step[]; error?: string | null; compact?: boolean }) {
  const done = steps.filter((s) => s.status === 'done').length;
  const active = steps.findIndex((s) => s.status === 'active');
  const pct = steps.length ? (done / steps.length) * 100 : 0;
  const vis = visibilityOf(action);
  return (
    <div className="bg-white border-2 border-ink rounded-card p-6" aria-live="polite">
      <div className="flex items-center gap-4 mb-5">
        <div className="bg-primary/10 text-primary p-3 rounded-full"><ShieldCheck size={24} /></div>
        <div>
          <div className="font-display text-[19px] font-bold text-ink">{TITLES[action] ?? 'Transaction'}</div>
          <div className="label-mono text-ink/60">
            {error ? 'Stopped' : done === steps.length && steps.length ? 'All steps completed' : `Step ${Math.max(active + 1, 1)} of ${steps.length}`}
          </div>
        </div>
      </div>
      <div className="w-full bg-ink/10 h-2 rounded-full mb-6 overflow-hidden">
        <div className="bg-ink h-full transition-all duration-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <ol className="flex flex-col gap-1 relative">
        <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-ink/10" aria-hidden />
        {steps.map((s) => (
          <li key={s.id} className={`flex items-start gap-4 relative ${s.status === 'pending' ? 'opacity-45' : ''}`}>
            <div className={`mt-0.5 bg-white rounded-full ${s.status === 'active' ? 'text-primary' : s.status === 'done' ? 'text-success' : s.status === 'error' ? 'text-error' : 'text-ink/30'}`}>
              {s.status === 'done' ? <CheckCircle2 size={32} /> : s.status === 'active' ? <Loader2 size={32} className="spin" /> : s.status === 'error' ? <XCircle size={32} /> : <Circle size={32} />}
            </div>
            <div className="flex-1 pb-4 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-bold ${s.status === 'active' ? 'text-primary' : 'text-ink'}`}>{s.label}</span>
                <ExposureTag e={s.exposure} />
              </div>
              {(!compact || s.status === 'active') && <div className="text-[14px] mt-1 text-on-surface-variant">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
      {!error && <WaitNotice />}
      {!error && <SponsorNotice action={action} active={steps[active]?.id} />}
      {!error && <FeeWindowNotice active={steps[active]?.id} />}
      {error && (
        <div className="mt-2 p-4 bg-error-container text-on-error-container rounded-2xl flex items-start gap-2 text-[14px]" data-testid="tx-error">
          <XCircle size={20} className="shrink-0 mt-0.5" /><span className="whitespace-pre-line break-words">{error}</span>
        </div>
      )}
      {!compact && vis && (
        <div className="mt-5 grid md:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-ink text-white p-4">
            <div className="flex items-center gap-2 label-mono text-terminal mb-2"><Eye size={14} /> Public on-chain</div>
            <ul className="text-[13px] space-y-1.5 opacity-90 list-disc pl-4">{vis.public.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
          <div className="rounded-2xl bg-primary-fixed p-4">
            <div className="flex items-center gap-2 label-mono text-primary mb-2"><EyeOff size={14} /> Stays private</div>
            <ul className="text-[13px] space-y-1.5 text-[#22005d] list-disc pl-4">{[...vis.hidden, ...vis.local.map((l) => `${l} (never leaves your device)`)].map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}

function ExposureTag({ e }: { e: Step['exposure'] }) {
  if (e === 'private') return <span className="pill bg-primary-fixed text-primary !py-0.5"><Cpu size={11} /> on your device</span>;
  if (e === 'public') return <span className="pill bg-ink text-terminal !py-0.5"><Radio size={11} /> public</span>;
  return <span className="pill bg-surface-high !py-0.5">mixed</span>;
}

/**
 * While the wallet waits for "Submit Transaction" approval, show how long the balanced
 * transaction's fee stays valid. 1AM's sponsored DUST fee lasts well under a minute.
 */
function FeeWindowNotice({ active }: { active?: string }) {
  const { fee } = useDiag();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  if (!fee || fee.submitted || (active !== 'submit' && active !== 'balance')) return null;
  if (active === 'balance') {
    if (!fee.rebalanceReason) return null;
    return (
      <div className="mt-2 p-4 bg-primary-fixed rounded-2xl flex items-start gap-2 text-[14px]" data-testid="fee-window">
        <Timer size={20} className="shrink-0 mt-0.5" />
        <span>The previous fee window closed before the transaction reached the network, so the wallet is balancing it again (attempt {fee.attempt}). Approve <b>both</b> wallet prompts straight away.</span>
      </div>
    );
  }
  const left = fee.expiresAt === null ? null : Math.floor((fee.expiresAt - now) / 1000);
  return (
    <div className={`mt-2 p-4 rounded-2xl flex items-start gap-2 text-[14px] ${left !== null && left < 15 ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed'}`} data-testid="fee-window">
      <Timer size={20} className="shrink-0 mt-0.5" />
      <span>
        Approve <b>Submit Transaction</b> in your wallet now.{' '}
        {left === null ? null : left > 0
          ? <>The fee on this transaction is valid for <b>{left} s</b> more.</>
          : <>The fee window has closed; DuskPad will ask the wallet to balance it again.</>}
      </span>
    </div>
  );
}

/** Shown while DuskPad holds the balance request until the wallet's previous transaction clears. */
function WaitNotice() {
  const { wait } = useDiag();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  if (!wait) return null;
  const secs = Math.max(0, Math.floor(((wait.retryAt ?? now) - now) / 1000));
  return (
    <div className="mt-2 p-4 bg-primary-fixed rounded-2xl flex items-start gap-2 text-[14px]" data-testid="wait-notice">
      <Loader2 size={20} className="shrink-0 mt-0.5 spin" />
      <span>
        {wait.reason === 'previous-tx'
          ? <>Waiting for your previous transaction to confirm before asking the wallet to balance this one ({Math.floor((now - wait.since) / 1000)} s).</>
          : <>The wallet still has your previous transaction pending (1AM&apos;s DUST sponsor allows one at a time). Retrying in <b>{secs} s</b> (retry {wait.retry} of 3); approve <b>Balance &amp; Sign</b> again when 1AM asks.</>}
      </span>
    </div>
  );
}

/**
 * 1AM cannot sponsor DUST when the wallet itself must add shielded inputs (buying a ticket spends your
 * tUSD): its sponsored path only accepts transactions that need no balancing besides the fee.
 */
function SponsorNotice({ action, active }: { action: Action; active?: string }) {
  const { walletKind } = useDiag();
  if (walletKind !== '1am' || action !== 'buy' || (active !== 'prove' && active !== 'balance' && active !== 'execute')) return null;
  return (
    <div className="mt-2 p-4 bg-primary-fixed rounded-2xl flex items-start gap-2 text-[14px]" data-testid="sponsor-notice">
      <Cpu size={20} className="shrink-0 mt-0.5" />
      <span>
        Buying spends your shielded tUSD, which 1AM&apos;s DUST sponsor cannot balance. When 1AM shows
        <b> &ldquo;Dust Sponsorship Failed&rdquo;</b>, choose <b>Pay with My Dust</b> (this needs some DUST in the wallet).
      </span>
    </div>
  );
}
