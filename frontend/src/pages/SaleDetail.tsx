// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, BarChart3, CalendarClock, CheckCircle2, Coins, Eye, Gift, Landmark, Lock, RotateCcw, ShieldAlert,
  ShieldCheck, Ticket, Unlock, Wallet, XCircle,
} from 'lucide-react';
import {
  adminKeyOf, countryName, deriveAdminSecret, formatUnits, fromHex, KYC_LEVELS, parseShieldedAddress, recoverTickets, saleTokenColor,
  toHex, trancheSchedule, type Action, type OwnedTicket, type SaleView, balanceOf } from '@duskpad/sdk';
import { toast } from 'sonner';
import { useSale, useNow, saleStatus, STATUS_LABEL, fmtDate, fmtDuration } from '../lib/sales';
import { useTxFlow } from '../lib/txflow';
import { eligibility } from '../lib/eligibility';
import { buyTicket, claimTranche, finalizeSale, mintTusd, ownPayout, refundTicket, withdrawCoin, type Payout } from '../lib/chain';
import { NETWORK } from '../lib/config';
import { useWallet } from '../state/WalletContext';
import { useVault } from '../state/VaultContext';
import { useApp } from '../state/AppContext';
import { PrivacyStepper } from '../components/PrivacyStepper';
import { OutcomeModal } from '../components/OutcomeModal';
import { WalletModal } from '../components/WalletModal';
import { Countdown, Hex, Notice, ProgressBar, Row, Skeleton, Spinner, Stat } from '../components/ui';

type Outcome = { title: string; body: React.ReactNode; txHash?: string };

export function SaleDetail() {
  const { address = '' } = useParams();
  const { meta, view, ledger, error, loading, refresh } = useSale(address, 4000);
  const { session, balances, refreshBalances } = useWallet();
  const vault = useVault();
  const { network } = useApp();
  const now = useNow(1000);
  const flow = useTxFlow();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);

  const master = vault.master;
  const tickets: OwnedTicket[] = useMemo(() => (ledger && master ? recoverTickets(ledger, master) : []), [ledger, master]);
  const isProject = useMemo(() => !!(view && master && toHex(adminKeyOf(deriveAdminSecret(master, fromHex(view.saleId)))) === view.projectKey), [view, master]);

  if (loading) return <div className="space-y-6"><Skeleton className="h-12 w-72" /><Skeleton className="h-64" /></div>;
  if (error || !view) return <Notice tone="error">{error ?? 'Sale not found'}</Notice>;

  const nowS = now / 1000;
  const st = saleStatus(view, nowS);
  const symbol = meta?.symbol ?? 'TOKEN';
  const raised = view.ticketPrice * BigInt(view.ticketsSold);
  const tusdBal = balanceOf(balances?.shielded, view.payColor);
  const saleTokenBal = balanceOf(balances?.shielded, saleTokenColor(view.tokenDomain, address));

  const after = async () => { await Promise.all([refresh(), refreshBalances()]); };

  async function go<T extends { txHash: string }>(action: Action, fn: Parameters<typeof flow.run<T>>[1], done: (r: T) => Outcome | null) {
    const r = await flow.run<T>(action, fn);
    await after();
    if (r) { const o = done(r); if (o) setOutcome({ ...o, txHash: r.txHash }); }
    else toast.error('Transaction did not go through');
  }

  const onBuy = () => go('buy', (onStage, markLocal) => buyTicket(session!, address, master!, vault.data!.credential!, onStage, markLocal), (r) => {
    void vault.update((d) => ({ ...d, tickets: [...d.tickets, { sale: address, index: r.index, boughtAt: Date.now(), txHash: r.txHash }],
      activity: [{ at: Date.now(), kind: 'buy', sale: address, txHash: r.txHash, detail: `${symbol} ticket #${r.index + 1}` }, ...d.activity] }));
    return { title: 'Ticket secured', body: <BuyOutcome view={view} index={r.index} symbol={symbol} /> };
  });

  const onRefund = (t: OwnedTicket) => go('refund', (onStage, markLocal) => {
    const coin = view.vault[Math.floor(Math.random() * view.vault.length)];
    if (!coin) throw new Error('The sale vault is empty');
    return refundTicket(session!, address, master!, t.index, coin, onStage, markLocal);
  }, (r) => {
    void vault.update((d) => ({ ...d, activity: [{ at: Date.now(), kind: 'refund', sale: address, txHash: r.txHash, detail: `Ticket #${t.index + 1}` }, ...d.activity] }));
    return { title: 'Refund received', body: <p className="text-on-surface-variant">{formatUnits(view.ticketPrice)} tUSD came back to a fresh shielded output. The chain shows that <em>a</em> ticket was refunded, not which one or whose.</p> };
  });

  const onClaim = (t: OwnedTicket, tranche: number, amount: bigint) => go('claim', (onStage, markLocal) => claimTranche(session!, address, master!, t.index, tranche, onStage, markLocal), (r) => {
    void vault.update((d) => ({ ...d, activity: [{ at: Date.now(), kind: 'claim', sale: address, txHash: r.txHash, detail: `Tranche ${tranche + 1}, ticket #${t.index + 1}` }, ...d.activity] }));
    return { title: `${formatUnits(amount)} ${symbol} claimed`, body: <p className="text-on-surface-variant">Minted straight to this wallet's shielded address. Nothing links it to the wallet that paid for the ticket.</p> };
  });

  const onFinalize = () => go('finalize', (onStage) => finalizeSale(session!, address, onStage), () => ({ title: 'Sale finalized', body: <p className="text-on-surface-variant">The outcome is now fixed on-chain. Refresh happens automatically.</p> }));

  const onFaucet = () => go('mint', (onStage) => mintTusd(session!, network!.tusd.address, 5_000_000_000n, onStage), () => ({ title: '5,000 tUSD minted', body: <p className="text-on-surface-variant">Test stablecoin delivered to your shielded balance.</p> }));

  const onWithdraw = (payout: Payout) => go('withdraw', (onStage, markLocal) => {
    const coin = view.vault[0];
    if (!coin) throw new Error('Nothing left to withdraw');
    return withdrawCoin(session!, address, master!, view.saleId, coin, payout, onStage, markLocal);
  }, () => ({ title: 'Proceeds withdrawn', body: <p className="text-on-surface-variant">{formatUnits(view.ticketPrice - view.feePerTicket)} tUSD sent to a shielded output; the {formatUnits(view.feePerTicket)} tUSD fee moved to the platform fee vault.</p> }));

  const busy = flow.running;
  const showStepper = flow.action && (flow.running || flow.error);

  return (
    <div className="space-y-10">
      <Link to="/explore" className="inline-flex items-center gap-2 text-on-surface-variant hover:text-ink font-medium"><ArrowLeft size={16} /> All sales</Link>

      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <span className={`tag-terminal ${st !== 'live' ? '!text-surface-highest' : ''}`} data-testid="sale-status">[ {STATUS_LABEL[st]} ]</span>
            <span className="pill bg-surface-high text-on-surface-variant">{view.kind === 'fixedPrice' ? 'Fixed price · soft cap' : 'First-come · capped'}</span>
            {view.auditorEnabled && <span className="pill bg-butter text-ink"><Eye size={13} /> Auditor disclosure on · unaudited</span>}
          </div>
          <h1 className="font-display text-display-md md:text-display-lg leading-none">{symbol}</h1>
          <p className="text-[20px] text-on-surface-variant mt-2">{meta?.name ?? 'Unregistered sale'}</p>
          {meta?.description && <p className="mt-4 max-w-3xl text-on-surface-variant leading-relaxed">{meta.description}</p>}
        </div>
        <Link to={`/sale/${address}/report`} className="btn-light"><BarChart3 size={16} /> Public sale report</Link>
      </header>

      <div className="grid lg:grid-cols-[1fr_420px] gap-8 items-start">
        <div className="space-y-8 min-w-0">
          <section className="card p-8 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <Stat label="Ticket price" value={<>{formatUnits(view.ticketPrice)} <span className="text-[15px]">tUSD</span></>} />
              <Stat label="Per ticket" value={<>{formatUnits(view.tokensPerTicket)} <span className="text-[15px]">{symbol}</span></>} />
              <Stat label="Raised" value={<>{formatUnits(raised)} <span className="text-[15px]">tUSD</span></>} sub={`${view.ticketsSold} of ${view.hardCap} tickets`} />
              <Stat label={st === 'upcoming' ? 'Starts in' : st === 'live' ? 'Ends in' : 'Ended'} value={st === 'upcoming' ? <Countdown to={view.start} now={now} /> : st === 'live' ? <Countdown to={view.end} now={now} /> : fmtDate(view.end)} />
            </div>
            <div>
              <ProgressBar value={view.ticketsSold} max={view.hardCap} marks={view.softCap > 0 ? [{ at: view.softCap, label: `SOFT CAP ${view.softCap}` }] : []} />
              <div className="flex justify-between mt-2 font-mono text-[12px] text-on-surface-variant">
                <span>{view.ticketsSold} sold</span>
                <span>{view.softCap > 0 ? (view.ticketsSold >= view.softCap ? 'Soft cap reached' : `${view.softCap - view.ticketsSold} more to reach soft cap`) : 'No soft cap'}</span>
              </div>
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-8">
            <section className="card p-7">
              <h2 className="font-display text-[22px] font-bold mb-4 flex items-center gap-2"><ShieldCheck size={20} className="text-primary" /> Eligibility rules</h2>
              <Row k="Minimum KYC" v={`Level ${view.minKyc} · ${KYC_LEVELS.find((l) => l.level === view.minKyc)?.label ?? 'Any'}`} />
              <Row k="Blocked regions" v={view.blockedCountries.length ? view.blockedCountries.map(countryName).join(', ') : 'None'} />
              <Row k="Per person" v={`Up to ${view.maxPerPerson} ticket${view.maxPerPerson > 1 ? 's' : ''}`} />
              <Row k="Issuer key" v={<Hex value={view.issuerPk.x.toString(16).padStart(64, '0')} />} />
              <p className="text-[13px] text-on-surface-variant mt-4">All checks run inside the buy proof. Your country, level and identity are never written on-chain.</p>
            </section>
            <section className="card p-7">
              <h2 className="font-display text-[22px] font-bold mb-4 flex items-center gap-2"><CalendarClock size={20} className="text-primary" /> Vesting</h2>
              <Row k="Sale window" v={`${fmtDate(view.start)} → ${fmtDate(view.end)}`} />
              <Row k="Cliff" v={fmtDate(view.cliff)} />
              <Row k="Tranches" v={view.tranches === 1 ? '1 (all at cliff)' : `${view.tranches} every ${fmtDuration(view.trancheInterval)}`} />
              <Row k="Platform fee" v={`${(view.feeBps / 100).toFixed(2)}% · ${formatUnits(view.feePerTicket)} tUSD per ticket`} />
              <div className="mt-4 flex gap-1.5 flex-wrap">
                {trancheSchedule(view).map((t) => (
                  <span key={t.index} className={`pill !text-[11px] ${t.unlockAt <= nowS && view.phase === 'succeeded' ? 'bg-mint text-ink' : 'bg-surface-high text-on-surface-variant'}`}>
                    {t.unlockAt <= nowS ? <Unlock size={11} /> : <Lock size={11} />} {formatUnits(t.amount)}
                  </span>
                ))}
              </div>
            </section>
          </div>

          <section className="card p-7">
            <h2 className="font-display text-[22px] font-bold mb-4 flex items-center gap-2"><Landmark size={20} className="text-primary" /> Contract</h2>
            <Row k="Sale contract" v={<Hex value={address} chars={10} />} />
            <Row k="Sale id" v={<Hex value={view.saleId} />} />
            <Row k="Payment token" v={<span className="flex items-center gap-2">tUSD (shielded) <Hex value={view.payColor} /></span>} />
            <Row k="Sale token color" v={<Hex value={saleTokenColor(view.tokenDomain, address)} />} />
            <Row k="Project key" v={<Hex value={view.projectKey} />} />
            <Row k="Network" v={NETWORK} />
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 space-y-6">
          {showStepper ? (
            <div className="space-y-3">
              <PrivacyStepper action={flow.action!} steps={flow.steps} error={flow.error} />
              {flow.error && <button className="btn-light w-full" onClick={flow.reset}>Back</button>}
            </div>
          ) : !session ? (
            <section className="bg-ink text-white rounded-card p-8 space-y-5">
              <Wallet size={28} className="text-terminal" />
              <h2 className="font-display text-[26px] font-bold">Connect to take part</h2>
              <p className="text-white/70">Use 1AM or Lace. Your private vault (master secret, credential, receipts) stays in this browser.</p>
              <button className="btn-light w-full" onClick={() => setWalletOpen(true)} data-testid="detail-connect">Connect wallet</button>
            </section>
          ) : (
            <ActionPanel {...{ view, st, nowS, symbol, tickets, isProject, busy, tusdBal, saleTokenBal, master, onBuy, onRefund, onClaim, onFinalize, onFaucet, onWithdraw }}
              credential={vault.data?.credential} canFaucet={!!network?.tusd} session={session} />
          )}
        </aside>
      </div>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <OutcomeModal open={!!outcome} onClose={() => { setOutcome(null); flow.reset(); }} title={outcome?.title ?? ''} txHash={outcome?.txHash}>{outcome?.body}</OutcomeModal>
    </div>
  );
}

function BuyOutcome({ view, index, symbol }: { view: SaleView; index: number; symbol: string }) {
  return (
    <div className="space-y-3 text-on-surface-variant">
      <p>Ticket <b className="text-ink">#{index + 1}</b> of your {view.maxPerPerson} allowed. You will be able to claim <b className="text-ink">{formatUnits(view.tokensPerTicket)} {symbol}</b> after the cliff on {fmtDate(view.cliff)}.</p>
      <ul className="text-[14px] space-y-1">
        <li className="flex gap-2"><CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> Public: one ticket sold, a nullifier, a receipt commitment.</li>
        <li className="flex gap-2"><ShieldCheck size={16} className="text-primary shrink-0 mt-0.5" /> Private: who you are, your country, your level, your other tickets.</li>
      </ul>
      <p className="text-[13px]">Back up your vault from the Dashboard if you plan to claim from another wallet.</p>
    </div>
  );
}

interface PanelProps {
  view: SaleView; st: ReturnType<typeof saleStatus>; nowS: number; symbol: string; tickets: OwnedTicket[]; isProject: boolean; busy: boolean;
  tusdBal: bigint; saleTokenBal: bigint; master: Uint8Array | null; credential: any; canFaucet: boolean; session: any;
  onBuy: () => void; onRefund: (t: OwnedTicket) => void; onClaim: (t: OwnedTicket, tranche: number, amount: bigint) => void;
  onFinalize: () => void; onFaucet: () => void; onWithdraw: (p: Payout) => void;
}

function ActionPanel(p: PanelProps) {
  const { view, st, nowS, symbol, tickets, busy } = p;
  const elig = eligibility(p.credential, view, p.master, nowS);
  const remaining = view.maxPerPerson - tickets.length;
  const schedule = trancheSchedule(view);

  return (
    <>
      <section className="card p-7 space-y-5" data-testid="action-panel">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[22px] font-bold flex items-center gap-2"><Ticket size={20} className="text-primary" /> Your position</h2>
          <span className="pill bg-surface-high text-on-surface-variant" data-testid="my-tickets">{tickets.length} / {view.maxPerPerson} tickets</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[14px]">
          <div className="panel p-4"><div className="label-mono text-on-surface-variant">tUSD</div><div className="font-mono font-bold mt-1" data-testid="tusd-balance">{formatUnits(p.tusdBal)}</div></div>
          <div className="panel p-4"><div className="label-mono text-on-surface-variant">{symbol}</div><div className="font-mono font-bold mt-1" data-testid="token-balance">{formatUnits(p.saleTokenBal)}</div></div>
        </div>

        {st === 'live' && (
          <div className="space-y-4">
            <ul className="space-y-2" aria-label="Eligibility checks">
              {elig.checks.map((c) => (
                <li key={c.id} className="flex gap-2 text-[14px]">
                  {c.ok ? <BadgeCheck size={17} className="text-success shrink-0" /> : <XCircle size={17} className="text-error shrink-0" />}
                  <span><span className="font-medium">{c.label}</span>{c.detail && <span className="block text-on-surface-variant text-[13px]">{c.detail}</span>}</span>
                </li>
              ))}
            </ul>
            {!p.credential && <Link to="/credential" className="btn-light w-full"><ShieldCheck size={16} /> Get a credential</Link>}
            {p.tusdBal < view.ticketPrice && p.canFaucet && (
              <button className="btn-light w-full" onClick={p.onFaucet} disabled={busy} data-testid="faucet">
                <Coins size={16} /> Mint 5,000 test tUSD
              </button>
            )}
            <button className="btn-dark w-full !py-4 text-[16px]" onClick={p.onBuy} disabled={busy || !elig.ok || remaining <= 0 || p.tusdBal < view.ticketPrice} data-testid="buy-ticket">
              {busy ? <Spinner /> : <Ticket size={18} />} {remaining <= 0 ? 'Per-person limit reached' : `Buy 1 ticket · ${formatUnits(view.ticketPrice)} tUSD`}
            </button>
            <p className="text-[12px] text-on-surface-variant text-center">One ticket per transaction. Each uses a fresh nullifier, so your tickets can't be linked together.</p>
          </div>
        )}

        {st === 'upcoming' && <Notice>Opens {fmtDate(view.start)}. Get your credential ready now.</Notice>}

        {(st === 'awaiting' || st === 'soldout') && view.phase === 'live' && (
          <div className="space-y-3">
            <Notice>{st === 'soldout' ? 'Sold out.' : 'The sale window closed.'} Anyone can finalize to lock in the result ({view.ticketsSold >= view.softCap ? 'success' : 'refunds'}).</Notice>
            <button className="btn-dark w-full" onClick={p.onFinalize} disabled={busy} data-testid="finalize">{busy ? <Spinner /> : <CheckCircle2 size={16} />} Finalize sale</button>
          </div>
        )}

        {view.phase === 'failed' && (
          <div className="space-y-3">
            <Notice tone="warn">Soft cap missed. Every ticket can be refunded in full, privately.</Notice>
            {tickets.length === 0 && <p className="text-on-surface-variant text-[14px]">No tickets found for this vault.</p>}
            {tickets.map((t) => (
              <div key={t.index} className="panel p-4 flex items-center justify-between">
                <span className="font-mono">Ticket #{t.index + 1}</span>
                {t.refunded ? <span className="pill bg-mint text-ink">Refunded</span> : (
                  <button className="btn-dark !py-2" onClick={() => p.onRefund(t)} disabled={busy} data-testid="refund-ticket"><RotateCcw size={15} /> Refund {formatUnits(view.ticketPrice)}</button>
                )}
              </div>
            ))}
          </div>
        )}

        {view.phase === 'succeeded' && (
          <div className="space-y-3">
            {tickets.length === 0 ? (
              <p className="text-on-surface-variant text-[14px]">No tickets found for this vault. If you bought from another browser, import your backup on the Dashboard.</p>
            ) : tickets.map((t) => (
              <div key={t.index} className="panel p-4 space-y-2">
                <div className="font-mono text-[13px] text-on-surface-variant">Ticket #{t.index + 1}</div>
                {schedule.map((tr) => {
                  const claimed = t.claimed[tr.index];
                  const locked = tr.unlockAt > nowS;
                  return (
                    <div key={tr.index} className="flex items-center justify-between text-[14px]">
                      <span>Tranche {tr.index + 1} · {formatUnits(tr.amount)} {symbol}</span>
                      {claimed ? <span className="pill bg-mint text-ink !text-[11px]">Claimed</span>
                        : locked ? <span className="pill bg-surface-high text-on-surface-variant !text-[11px]"><Lock size={11} /> in {fmtDuration(tr.unlockAt - nowS)}</span>
                        : <button className="btn-dark !py-1.5 !px-3 !text-[13px]" disabled={busy} onClick={() => p.onClaim(t, tr.index, tr.amount)} data-testid="claim-tranche"><Gift size={14} /> Claim</button>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      {p.isProject && <ProjectPanel view={view} busy={busy} session={p.session} onWithdraw={p.onWithdraw} />}
    </>
  );
}

function ProjectPanel({ view, busy, session, onWithdraw }: { view: SaleView; busy: boolean; session: any; onWithdraw: (p: Payout) => void }) {
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const net = view.ticketPrice - view.feePerTicket;
  const available = view.phase === 'succeeded' ? view.vault.length : 0;
  const submit = () => {
    setErr(null);
    if (!custom.trim()) return onWithdraw(ownPayout(session));
    try { const k = parseShieldedAddress(custom, NETWORK); onWithdraw({ coinPublicKey: k.coinPublicKey, encryptionPublicKey: k.encryptionPublicKey }); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <section className="bg-ink text-white rounded-card p-7 space-y-4" data-testid="project-panel">
      <div className="flex items-center gap-2"><ShieldAlert size={18} className="text-terminal" /><h2 className="font-display text-[20px] font-bold">Project console</h2></div>
      <p className="text-white/70 text-[14px]">This vault holds the admin secret for this sale.</p>
      <div className="grid grid-cols-2 gap-3 text-[14px]">
        <div className="bg-white/10 rounded-2xl p-4"><div className="label-mono text-white/60">Withdrawable</div><div className="font-mono font-bold mt-1" data-testid="withdrawable">{available} × {formatUnits(net)}</div></div>
        <div className="bg-white/10 rounded-2xl p-4"><div className="label-mono text-white/60">Withdrawn</div><div className="font-mono font-bold mt-1">{view.ticketsWithdrawn} tickets</div></div>
      </div>
      {view.phase !== 'succeeded' ? <p className="text-white/60 text-[13px]">Proceeds unlock once the sale is finalized as successful.</p> : (
        <>
          <label className="block">
            <span className="label-mono text-white/60">Payout address (optional)</span>
            <input className="input mt-2 !bg-white/10 !text-white !border-white/20" placeholder="Your connected wallet" value={custom} onChange={(e) => setCustom(e.target.value)} />
          </label>
          {err && <p className="text-blush text-[13px]">{err}</p>}
          <button className="btn-light w-full" disabled={busy || available === 0} onClick={submit} data-testid="withdraw">
            {busy ? <Spinner /> : <Coins size={16} />} Withdraw one ticket's proceeds
          </button>
          <p className="text-white/50 text-[12px]">One vault coin per transaction. The {formatUnits(view.feePerTicket)} tUSD fee moves to the platform fee vault in the same proof.</p>
        </>
      )}
    </section>
  );
}
