// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, Fingerprint, Globe2, KeyRound, Send, ShieldCheck } from 'lucide-react';
import { COUNTRIES, countryName, deriveHolderSecret, holderCommitment, KYC_LEVELS, verifyCredential, credentialFromJSON } from '@duskpad/sdk';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { fmtDate } from '../lib/sales';
import { useApp } from '../state/AppContext';
import { useWallet } from '../state/WalletContext';
import { useVault } from '../state/VaultContext';
import { WalletModal } from '../components/WalletModal';
import { Hex, MockBadge, Notice, Row, Spinner } from '../components/ui';

export function Credential() {
  const { issuer } = useApp();
  const { session } = useWallet();
  const vault = useVault();
  const [country, setCountry] = useState(566);
  const [level, setLevel] = useState(2);
  const [busy, setBusy] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const commit = useMemo(() => (vault.master ? holderCommitment(deriveHolderSecret(vault.master)) : null), [vault.master]);
  const cred = vault.data?.credential;
  const valid = useMemo(() => { try { return cred ? verifyCredential(credentialFromJSON(cred)) : false; } catch { return false; } }, [cred]);
  const boundHere = cred && commit !== null && BigInt(cred.attrs.holderCommit) === commit;

  async function request() {
    if (commit === null) return;
    setBusy(true);
    try {
      const c = await api.requestCredential(commit, country, level);
      await vault.update((d) => ({ ...d, credential: c, activity: [{ at: Date.now(), kind: 'credential', detail: `Level ${level}, ${countryName(country)} (mock issuer)` }, ...d.activity] }));
      toast.success('Credential saved to your vault');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-10 max-w-5xl">
      <header className="space-y-4">
        <MockBadge />
        <h1 className="font-display text-display-md md:text-display-lg">Eligibility credential</h1>
        <p className="text-on-surface-variant max-w-2xl">Sales check KYC level, region and expiry inside a zero-knowledge proof. You only need a signed credential from the issuer the sale trusts, kept in your private vault.</p>
      </header>

      <Notice tone="warn">
        <div className="flex gap-2"><AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span><b>This is a mock issuer for demonstration.</b> It signs whatever you select, with no identity verification. {issuer?.warning} A real deployment swaps in a KYC provider that signs the same three attributes.</span>
        </div>
      </Notice>

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <section className="card p-7 space-y-6">
          <h2 className="font-display text-[22px] font-bold flex items-center gap-2"><Fingerprint size={20} className="text-primary" /> Request a credential</h2>
          {!session ? (
            <button className="btn-dark w-full" onClick={() => setWalletOpen(true)}>Connect wallet to open your vault</button>
          ) : (<>
            <div className="panel p-4 space-y-1">
              <div className="label-mono text-on-surface-variant">Your holder commitment</div>
              {commit !== null ? <Hex value={commit.toString(16).padStart(64, '0')} chars={12} /> : <Spinner />}
              <p className="text-[12px] text-on-surface-variant pt-1">A hash of your vault's holder secret. The credential is bound to it, so it is useless in anyone else's vault.</p>
            </div>
            <label className="block"><span className="field-label">Country of residence</span>
              <select className="input" value={country} onChange={(e) => setCountry(Number(e.target.value))} data-testid="cred-country">
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
            <fieldset><legend className="field-label">Verification level</legend>
              <div className="grid grid-cols-3 gap-2">
                {KYC_LEVELS.map((l) => (
                  <button type="button" key={l.level} aria-pressed={level === l.level} onClick={() => setLevel(l.level)} data-testid={`cred-level-${l.level}`}
                    className={`p-3 rounded-2xl border-2 text-left ${level === l.level ? 'border-ink bg-surface-high' : 'border-outline-variant'}`}>
                    <div className="font-bold text-[14px]">{l.label}</div><div className="text-[12px] text-on-surface-variant">{l.hint}</div>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="text-[13px] text-on-surface-variant space-y-1">
              <div className="font-bold text-ink flex items-center gap-1.5"><Send size={14} /> Sent to the issuer</div>
              <div>holder commitment, country code, level. Not your wallet address, not your master secret.</div>
            </div>
            <button className="btn-dark w-full" onClick={() => void request()} disabled={busy || commit === null} data-testid="request-credential">
              {busy ? <Spinner /> : <BadgeCheck size={17} />} {cred ? 'Replace credential' : 'Get mock credential'}
            </button>
          </>)}
        </section>

        <section className="space-y-6">
          {cred ? (
            <div className="bg-ink text-white rounded-card p-7 space-y-5" data-testid="credential-card">
              <div className="flex items-center justify-between">
                <span className="tag-terminal">[ IN YOUR VAULT ]</span>
                {valid && boundHere ? <span className="pill bg-terminal/20 text-terminal"><ShieldCheck size={13} /> Valid signature</span> : <span className="pill bg-blush text-ink">Not usable here</span>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><div className="label-mono text-white/60">Level</div><div className="font-display text-[26px] font-bold">{KYC_LEVELS.find((l) => l.level === cred.attrs.kycLevel)?.label}</div></div>
                <div><div className="label-mono text-white/60">Region</div><div className="font-display text-[26px] font-bold flex items-center gap-2"><Globe2 size={20} />{countryName(cred.attrs.country)}</div></div>
              </div>
              <div className="text-white/70 text-[14px]">Expires {fmtDate(cred.attrs.expiry)} · issued by {cred.issuer ?? 'DuskPad mock issuer'}</div>
              {!boundHere && <p className="text-blush text-[13px]">This credential belongs to another vault. Request a new one.</p>}
            </div>
          ) : (
            <div className="card p-7 text-on-surface-variant">No credential yet. Request one to join sales.</div>
          )}
          <div className="card p-7">
            <h3 className="font-display text-[19px] font-bold mb-3 flex items-center gap-2"><KeyRound size={18} className="text-primary" /> What a sale learns</h3>
            <Row k="Your country" v="No. Only that it is not on the blocked list" />
            <Row k="Your KYC level" v="No. Only that it meets the minimum" />
            <Row k="Your identity or wallet" v="No" />
            <Row k="That a valid credential was used" v="Yes, via the proof" />
            <Row k="Your other tickets" v="No. Each uses a fresh nullifier" />
            <p className="text-[13px] text-on-surface-variant mt-4">See <Link className="underline" to="/how-it-works">How it works</Link> for the exact public and private data per action, measured on a local devnet.</p>
          </div>
        </section>
      </div>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
