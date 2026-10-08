// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Info, Lock, Rocket, ShieldCheck, Sparkles, Ticket, Timer, Users, X } from 'lucide-react';
import {
  COUNTRIES, countryName, deploySale, deriveAdminSecret, feePerTicketOf, formatUnits, fromHex, JUBJUB_ORDER, KYC_LEVELS, pad32,
  parseUnits, pointOf, random32, splitTranches, toHex, toSaleParams, validateSaleInput, type SaleInput, type SaleKindName,
} from '@duskpad/sdk';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { IS_LOCAL } from '../lib/config';
import { useTxFlow } from '../lib/txflow';
import { useApp } from '../state/AppContext';
import { useWallet } from '../state/WalletContext';
import { useVault } from '../state/VaultContext';
import { PrivacyStepper } from '../components/PrivacyStepper';
import { WalletModal } from '../components/WalletModal';
import { MockBadge, Notice, Row, Spinner } from '../components/ui';

const TINTS = [{ id: 0, cls: 'bg-mint', name: 'Mint' }, { id: 1, cls: 'bg-lilac', name: 'Lilac' }, { id: 2, cls: 'bg-butter', name: 'Butter' }, { id: 3, cls: 'bg-blush', name: 'Blush' }];
const UNITS = { minutes: 60, hours: 3600, days: 86400 } as const;
type Unit = keyof typeof UNITS;

const localInput = (ms: number) => { const d = new Date(ms); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export function CreateSale() {
  const nav = useNavigate();
  const { network, issuer } = useApp();
  const { session } = useWallet();
  const vault = useVault();
  const flow = useTxFlow();
  const [walletOpen, setWalletOpen] = useState(false);

  const [f, setF] = useState({
    name: '', symbol: '', description: '', website: '', accent: 1,
    kind: 'fixedPrice' as SaleKindName,
    price: '100', tokensPerTicket: '1000', hardCap: '100', softCap: '20', maxPerPerson: '3',
    start: localInput(Date.now() + 2 * 60_000), duration: '2', durationUnit: 'days' as Unit,
    cliffAfter: '7', cliffUnit: 'days' as Unit, tranches: '4', interval: '30', intervalUnit: 'days' as Unit,
    minKyc: 1, blocked: [] as number[], auditor: false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const built = useMemo(() => {
    try {
      if (!network || !issuer) return { errors: ['Waiting for network configuration…'] };
      // A start time in the past means "start now" (the contract only needs start < end).
      const start = Math.max(Math.floor(new Date(f.start).getTime() / 1000), Math.floor(Date.now() / 1000));
      const end = start + Number(f.duration) * UNITS[f.durationUnit];
      const input: Omit<SaleInput, 'saleId' | 'nonceSeed' | 'tokenDomain'> = {
        kind: f.kind, payColor: network.tusd.color,
        ticketPrice: parseUnits(f.price || '0'), tokensPerTicket: parseUnits(f.tokensPerTicket || '0'),
        softCap: f.kind === 'firstCome' ? 0 : Number(f.softCap || 0), hardCap: Number(f.hardCap || 0), maxPerPerson: Number(f.maxPerPerson || 0),
        start, end, cliff: end + Number(f.cliffAfter || 0) * UNITS[f.cliffUnit],
        tranches: Number(f.tranches || 0), trancheInterval: Number(f.interval || 0) * UNITS[f.intervalUnit],
        feeBps: network.platform.defaultFeeBps, feeKey: fromHex(network.platform.feeKey),
        issuerPk: { x: BigInt(issuer.publicKey.x), y: BigInt(issuer.publicKey.y) },
        minKyc: f.minKyc, blockedCountries: f.blocked, auditorPk: null,
      };
      const errors = validateSaleInput({ ...input, saleId: new Uint8Array(32), nonceSeed: new Uint8Array(32), tokenDomain: new Uint8Array(32) });
      if (!f.name.trim()) errors.push('Give the project a name.');
      if (!/^[A-Z0-9]{2,12}$/.test(f.symbol)) errors.push('Symbol: 2 to 12 letters or digits.');
      return { input, errors };
    } catch (e: any) { return { errors: [e.message] }; }
  }, [f, network, issuer]);

  const input = built.input;
  const fee = input ? feePerTicketOf(input.ticketPrice, input.feeBps) : 0n;
  const split = input && input.tranches > 0 ? splitTranches(input.tokensPerTicket, input.tranches) : null;

  async function deploy() {
    if (!session || !vault.master || !input) return;
    const saleId = random32();
    const auditorSk = f.auditor ? (BigInt('0x' + toHex(crypto.getRandomValues(new Uint8Array(48)))) % JUBJUB_ORDER) : null;
    const full: SaleInput = { ...input, saleId, nonceSeed: random32(), tokenDomain: pad32(`dusk:token:${f.symbol}`), auditorPk: auditorSk ? pointOf(auditorSk) : null };
    const r = await flow.run('deploy', async (onStage, markLocal) => {
      const adminSecret = deriveAdminSecret(vault.master!, saleId);
      const params = toSaleParams(full);
      markLocal('vault');
      const providers = await session.providers('sale');
      return deploySale(providers, params, adminSecret, { onStage, mode: IS_LOCAL ? 'wait' : 'async', assetsPath: '/zk/sale' });
    });
    if (!r) return;
    await vault.update((d) => ({
      ...d,
      ownedSales: [...d.ownedSales, { address: r.address, saleId: toHex(saleId), createdAt: Date.now(), role: 'project' }],
      auditorKeys: auditorSk ? [...(d.auditorKeys ?? []), { sale: r.address, sk: auditorSk.toString() }] : d.auditorKeys,
      activity: [{ at: Date.now(), kind: 'deploy', sale: r.address, txHash: r.txHash, detail: `${f.symbol} sale created` }, ...d.activity],
    }));
    // The registry checks that the contract exists on-chain; on Preprod the indexer may lag a little.
    for (let i = 0; i < 20; i++) {
      try {
        await api.registerSale({ address: r.address, name: f.name.trim(), symbol: f.symbol, description: f.description.trim(), website: f.website.trim() || undefined, accent: f.accent, txHash: r.txHash });
        break;
      } catch (e: any) {
        if (i === 19) toast.error(`Deployed, but registry listing failed: ${e.message}`);
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
    toast.success(`${f.symbol} sale deployed`);
    nav(`/sale/${r.address}`);
  }

  if (flow.action) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 py-6">
        <PrivacyStepper action="deploy" steps={flow.steps} error={flow.error} />
        {flow.error && <button className="btn-light w-full" onClick={flow.reset}>Back to the form</button>}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <span className="tag-terminal">[ ONE CONTRACT PER SALE ]</span>
        <h1 className="font-display text-display-md md:text-display-lg mt-4">Launch a private sale</h1>
        <p className="text-on-surface-variant mt-2 max-w-2xl">Every rule below is fixed in the contract at deploy time and enforced inside the buyers' proofs. The admin secret is derived from your vault and never leaves this browser.</p>
      </header>

      <div className="grid lg:grid-cols-[1fr_400px] gap-8 items-start">
        <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); void deploy(); }} noValidate>
          <Section icon={<Sparkles size={20} />} title="Project">
            <div className="grid md:grid-cols-2 gap-5">
              <Field label="Project name"><input className="input" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Nova Labs" data-testid="f-name" /></Field>
              <Field label="Token symbol"><input className="input font-mono" required pattern="[A-Z0-9]{2,12}" value={f.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} placeholder="NOVA" data-testid="f-symbol" /></Field>
            </div>
            <Field label="Description"><textarea className="input min-h-[96px]" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What are you building and what does the token do?" /></Field>
            <div className="grid md:grid-cols-2 gap-5">
              <Field label="Website (optional)"><input className="input" type="url" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></Field>
              <Field label="Card colour">
                <div className="flex gap-2">{TINTS.map((t) => (
                  <button type="button" key={t.id} aria-label={t.name} aria-pressed={f.accent === t.id} onClick={() => set('accent', t.id)}
                    className={`${t.cls} w-11 h-11 rounded-full border-2 ${f.accent === t.id ? 'border-ink' : 'border-transparent'}`} />
                ))}</div>
              </Field>
            </div>
          </Section>

          <Section icon={<Ticket size={20} />} title="Sale type and tickets">
            <div className="grid md:grid-cols-2 gap-4" role="radiogroup">
              {([['fixedPrice', 'Fixed price + soft cap', 'If the soft cap is missed, every buyer can refund privately.'], ['firstCome', 'Capped first-come', 'No minimum: the sale succeeds with whatever sells.']] as const).map(([k, t, d]) => (
                <button type="button" role="radio" aria-checked={f.kind === k} key={k} onClick={() => set('kind', k)} data-testid={`kind-${k}`}
                  className={`text-left p-5 rounded-2xl border-2 transition-colors ${f.kind === k ? 'border-ink bg-surface-high' : 'border-outline-variant hover:border-ink/40'}`}>
                  <div className="font-display font-bold text-[17px]">{t}</div><div className="text-[14px] text-on-surface-variant mt-1">{d}</div>
                </button>
              ))}
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <Field label="Ticket price (tUSD)" hint="Paid in shielded tUSD"><input className="input font-mono" inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} data-testid="f-price" /></Field>
              <Field label={`Tokens per ticket (${f.symbol || 'TOKEN'})`}><input className="input font-mono" inputMode="decimal" value={f.tokensPerTicket} onChange={(e) => set('tokensPerTicket', e.target.value)} /></Field>
              <Field label="Hard cap (tickets)"><input className="input font-mono" inputMode="numeric" value={f.hardCap} onChange={(e) => set('hardCap', e.target.value.replace(/\D/g, ''))} data-testid="f-hardcap" /></Field>
              {f.kind === 'fixedPrice' && <Field label="Soft cap (tickets)" hint="Below this, refunds open"><input className="input font-mono" inputMode="numeric" value={f.softCap} onChange={(e) => set('softCap', e.target.value.replace(/\D/g, ''))} data-testid="f-softcap" /></Field>}
              <Field label="Max tickets per person" hint="Enforced with per-person nullifiers"><input className="input font-mono" inputMode="numeric" value={f.maxPerPerson} onChange={(e) => set('maxPerPerson', e.target.value.replace(/\D/g, ''))} data-testid="f-max" /></Field>
            </div>
          </Section>

          <Section icon={<Timer size={20} />} title="Schedule and vesting">
            <div className="grid md:grid-cols-2 gap-5">
              <Field label="Start" hint="A past time means the sale opens immediately"><input className="input" type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} data-testid="f-start" /></Field>
              <Field label="Duration"><Dur value={f.duration} unit={f.durationUnit} onValue={(v) => set('duration', v)} onUnit={(u) => set('durationUnit', u)} testid="f-duration" /></Field>
              <Field label="Cliff after sale end"><Dur value={f.cliffAfter} unit={f.cliffUnit} onValue={(v) => set('cliffAfter', v)} onUnit={(u) => set('cliffUnit', u)} testid="f-cliff" /></Field>
              <Field label="Vesting tranches" hint="1 to 48"><input className="input font-mono" inputMode="numeric" value={f.tranches} onChange={(e) => set('tranches', e.target.value.replace(/\D/g, ''))} data-testid="f-tranches" /></Field>
              {Number(f.tranches) > 1 && <Field label="Between tranches"><Dur value={f.interval} unit={f.intervalUnit} onValue={(v) => set('interval', v)} onUnit={(u) => set('intervalUnit', u)} testid="f-interval" /></Field>}
            </div>
          </Section>

          <Section icon={<ShieldCheck size={20} />} title="Eligibility" badge={<MockBadge />}>
            <Field label="Minimum KYC level">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[{ level: 0, label: 'Any', hint: 'Credential only' }, ...KYC_LEVELS].map((l) => (
                  <button type="button" key={l.level} aria-pressed={f.minKyc === l.level} onClick={() => set('minKyc', l.level)}
                    className={`p-3 rounded-2xl border-2 text-left ${f.minKyc === l.level ? 'border-ink bg-surface-high' : 'border-outline-variant'}`}>
                    <div className="font-bold text-[14px]">{l.label}</div><div className="text-[12px] text-on-surface-variant">{l.hint}</div>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Blocked regions (up to 4)">
              <div className="flex flex-wrap gap-2 mb-3">
                {f.blocked.map((c) => (
                  <span key={c} className="pill bg-blush text-ink">{countryName(c)}<button type="button" aria-label={`Unblock ${countryName(c)}`} onClick={() => set('blocked', f.blocked.filter((x) => x !== c))}><X size={13} /></button></span>
                ))}
                {!f.blocked.length && <span className="text-[14px] text-on-surface-variant">None</span>}
              </div>
              <select className="input" disabled={f.blocked.length >= 4} value="" onChange={(e) => { const c = Number(e.target.value); if (c && !f.blocked.includes(c)) set('blocked', [...f.blocked, c]); }} data-testid="f-block">
                <option value="">Add a blocked region…</option>
                {COUNTRIES.filter((c) => !f.blocked.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </Field>
            <p className="text-[13px] text-on-surface-variant">Credentials come from the DuskPad <b>mock issuer</b> (demo only). Its public key is baked into the contract; a production deployment would point at a real KYC provider's key.</p>
          </Section>

          <Section icon={<Eye size={20} />} title="Auditor disclosure" badge={<span className="pill bg-butter text-ink !text-[11px]">OPTIONAL · UNAUDITED</span>}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 w-5 h-5 accent-primary" checked={f.auditor} onChange={(e) => set('auditor', e.target.checked)} data-testid="f-auditor" />
              <span className="text-[14px] text-on-surface-variant">Each ticket also publishes the buyer's credential commitment encrypted to an auditor key (hashed ElGamal). Only the auditor can decrypt it, and only the issuer can map it to a person. A fresh auditor key is generated and saved in your vault. This construction has not been externally audited.</span>
            </label>
          </Section>

          {built.errors.length > 0 && <Notice tone="warn"><ul className="list-disc pl-5 space-y-0.5">{built.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
        </form>

        <aside className="lg:sticky lg:top-24 space-y-5">
          <div className={`${TINTS[f.accent].cls} rounded-card p-7 shadow-tint`}>
            <span className="tag-terminal">[ PREVIEW ]</span>
            <div className="font-display text-[40px] font-bold leading-none mt-5 break-words">{f.symbol || 'SYMBOL'}</div>
            <div className="text-ink/70 font-medium mt-1">{f.name || 'Project name'}</div>
          </div>
          <div className="card p-6">
            <h2 className="font-display text-[19px] font-bold mb-3">Summary</h2>
            {input ? (<>
              <Row k="Max raise" v={`${formatUnits(input.ticketPrice * BigInt(input.hardCap))} tUSD`} />
              {input.softCap > 0 && <Row k="Soft cap" v={`${formatUnits(input.ticketPrice * BigInt(input.softCap))} tUSD`} />}
              <Row k="Tokens for sale" v={`${formatUnits(input.tokensPerTicket * BigInt(input.hardCap))} ${f.symbol || ''}`} />
              <Row k={`Platform fee (${(input.feeBps / 100).toFixed(2)}%)`} v={`${formatUnits(fee)} per ticket`} />
              <Row k="You receive" v={`${formatUnits(input.ticketPrice - fee)} per ticket`} />
              {split && <Row k="Per tranche" v={input.tranches === 1 ? 'All at cliff' : `${formatUnits(split.per)} (last ${formatUnits(split.last)})`} />}
            </>) : <p className="text-on-surface-variant text-[14px]">Fill in the form.</p>}
            <div className="mt-4 p-4 rounded-2xl bg-surface-high text-[13px] text-on-surface-variant flex gap-2"><Lock size={15} className="shrink-0 mt-0.5" /> The admin key is derived from your vault master secret and this sale's id. Back up your vault to keep control of the proceeds.</div>
          </div>
          {!session ? (
            <button className="btn-dark w-full !py-4" onClick={() => setWalletOpen(true)}><Users size={17} /> Connect wallet to deploy</button>
          ) : (
            <button className="btn-dark w-full !py-4 text-[16px]" disabled={built.errors.length > 0 || flow.running || !vault.master} onClick={() => void deploy()} data-testid="deploy-sale">
              {flow.running ? <Spinner /> : <Rocket size={18} />} Deploy sale contract
            </button>
          )}
          <p className="text-[12px] text-on-surface-variant flex gap-1.5"><Info size={14} className="shrink-0" /> Deployment proves the constructor locally and costs DUST. {IS_LOCAL ? 'Local devnet: free test funds.' : 'Preprod: use test funds only.'}</p>
        </aside>
      </div>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}

function Section({ icon, title, badge, children }: { icon: React.ReactNode; title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-7 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-[22px] font-bold flex items-center gap-2"><span className="text-primary">{icon}</span>{title}</h2>{badge}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="field-label">{label}</span>{hint && <span className="hint">{hint}</span>}{children}</label>;
}

function Dur({ value, unit, onValue, onUnit, testid }: { value: string; unit: Unit; onValue: (v: string) => void; onUnit: (u: Unit) => void; testid?: string }) {
  return (
    <div className="flex gap-2">
      <input className="input font-mono" inputMode="numeric" value={value} onChange={(e) => onValue(e.target.value.replace(/\D/g, ''))} data-testid={testid} />
      <select className="input !w-36" value={unit} onChange={(e) => onUnit(e.target.value as Unit)} data-testid={testid ? `${testid}-unit` : undefined}>
        {Object.keys(UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );
}
