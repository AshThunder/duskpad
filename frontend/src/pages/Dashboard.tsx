// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArchiveRestore, Coins, Download, Eye, EyeOff, FolderLock, KeyRound, Link2, Plus, ShieldCheck, Ticket, Upload, Wallet,
} from 'lucide-react';
import {
  adminKeyOf, deriveAdminSecret, formatUnits, fromHex, recoverTickets, saleTokenColor, toHex, trancheSchedule, type EncryptedBackup, balanceOf } from '@duskpad/sdk';
import { IS_LOCAL, NETWORK } from '../lib/config';
import { toast } from 'sonner';
import { useSales, useSaleViews, useNow, saleStatus, STATUS_LABEL, fmtDate } from '../lib/sales';
import { useTxFlow } from '../lib/txflow';
import { mintTusd } from '../lib/chain';
import { useApp } from '../state/AppContext';
import { useWallet } from '../state/WalletContext';
import { useVault } from '../state/VaultContext';
import { PrivacyStepper } from '../components/PrivacyStepper';
import { WalletModal } from '../components/WalletModal';
import { Dialog, Empty, Notice, Row, Spinner, Stat } from '../components/ui';

/** Unshielded NIGHT's raw token type. */
const NIGHT = '0'.repeat(64);

export function Dashboard() {
  const { network } = useApp();
  const { session, balances, refreshBalances, proving } = useWallet();
  const vault = useVault();
  const { sales } = useSales();
  const { views, reload } = useSaleViews((sales ?? []).map((s) => s.address));
  const now = useNow(5000);
  const flow = useTxFlow();
  const [walletOpen, setWalletOpen] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [backupOpen, setBackupOpen] = useState<'export' | 'import' | null>(null);

  const master = vault.master;
  const rows = useMemo(() => {
    if (!master || !sales) return [];
    return sales.flatMap((m) => {
      const v = views[m.address];
      if (!v) return [];
      const tickets = recoverTickets(v.ledger, master);
      const isProject = toHex(adminKeyOf(deriveAdminSecret(master, fromHex(v.view.saleId)))) === v.view.projectKey;
      if (!tickets.length && !isProject) return [];
      const sched = trancheSchedule(v.view);
      const claimable = v.view.phase === 'succeeded'
        ? tickets.reduce((n, t) => n + sched.filter((tr) => tr.unlockAt <= now / 1000 && !t.claimed[tr.index]).length, 0) : 0;
      const refundable = v.view.phase === 'failed' ? tickets.filter((t) => !t.refunded).length : 0;
      return [{ meta: m, view: v.view, tickets, isProject, claimable, refundable }];
    });
  }, [master, sales, views, now]);

  if (!session) {
    return (
      <div className="max-w-xl mx-auto py-16">
        <Empty icon={<Wallet size={28} />} title="Connect to open your private dashboard">
          <p>Everything here is computed in your browser from your vault and public chain state.</p>
          <button className="btn-dark mt-6" onClick={() => setWalletOpen(true)}>Connect wallet</button>
        </Empty>
        <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      </div>
    );
  }

  const tusd = network ? balanceOf(balances?.shielded, network.tusd.color) : 0n;
  const tickets = rows.reduce((n, r) => n + r.tickets.length, 0);
  const onFaucet = async () => {
    const r = await flow.run('mint', (onStage) => mintTusd(session, network!.tusd.address, 5_000_000_000n, onStage));
    await refreshBalances();
    if (r) { toast.success('5,000 tUSD minted'); flow.reset(); }
  };

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <span className="tag-terminal">[ PRIVATE · COMPUTED LOCALLY ]</span>
          <h1 className="font-display text-display-md md:text-display-lg mt-4">Your dashboard</h1>
          <p className="text-on-surface-variant mt-2 max-w-2xl">Nobody else can build this page: your tickets are found by re-deriving your nullifiers and receipts from the vault's master secret and checking them against public state.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-light" onClick={() => setBackupOpen('import')} data-testid="open-import"><Upload size={16} /> Import backup</button>
          <button className="btn-dark" onClick={() => setBackupOpen('export')} data-testid="open-export"><Download size={16} /> Export backup</button>
        </div>
      </header>

      {flow.action && (flow.running || flow.error) && (
        <div className="max-w-xl"><PrivacyStepper action={flow.action} steps={flow.steps} error={flow.error} compact />{flow.error && <button className="btn-light mt-3" onClick={flow.reset}>Dismiss</button>}</div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-mint rounded-card p-6"><Stat label="Shielded tUSD" value={<span data-testid="dash-tusd">{formatUnits(tusd)}</span>} /></div>
        <div className="bg-lilac rounded-card p-6"><Stat label="Tickets held" value={<span data-testid="dash-tickets">{tickets}</span>} sub={`across ${rows.filter((r) => r.tickets.length).length} sales`} /></div>
        <div className="bg-butter rounded-card p-6"><Stat label="Claimable now" value={rows.reduce((n, r) => n + r.claimable, 0)} sub="tranches" /></div>
        <div className="bg-blush rounded-card p-6"><Stat label="DUST" value={<span data-testid="dash-dust">{balances?.dust != null ? formatUnits(balances.dust, 15) : '—'}</span>}
          sub={session.option.kind === '1am' && !IS_LOCAL ? 'fees sponsored by 1AM' : `pays fees · tNIGHT ${formatUnits(balanceOf(balances?.unshielded, NIGHT), 6)}`} /></div>
      </section>

      <div className="grid lg:grid-cols-[1fr_380px] gap-8 items-start">
        <div className="space-y-8 min-w-0">
          <section className="card p-7">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-[22px] font-bold flex items-center gap-2"><Ticket size={20} className="text-primary" /> Your sales</h2>
              <button className="btn-light !py-2 !px-4 !text-[13px]" onClick={() => void reload()}>Rescan</button>
            </div>
            {rows.length === 0 ? <p className="text-on-surface-variant">No tickets or projects found for this vault. <Link to="/explore" className="underline">Explore sales</Link>.</p> : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-[14px]" data-testid="dash-sales">
                  <thead><tr className="label-mono text-on-surface-variant text-left">
                    <th className="px-2 py-2">Sale</th><th className="px-2">Status</th><th className="px-2">Role</th><th className="px-2">Tickets</th><th className="px-2">Next step</th><th></th>
                  </tr></thead>
                  <tbody>{rows.map((r) => {
                    const st = saleStatus(r.view, now / 1000);
                    const tok = balanceOf(balances?.shielded, saleTokenColor(r.view.tokenDomain, r.meta.address));
                    return (
                      <tr key={r.meta.address} className="border-t border-outline-variant/60">
                        <td className="px-2 py-3"><div className="font-bold">{r.meta.symbol}</div><div className="text-on-surface-variant text-[12px]">{r.meta.name}</div></td>
                        <td className="px-2"><span className="pill bg-surface-high !text-[11px]">{STATUS_LABEL[st]}</span></td>
                        <td className="px-2">{r.isProject ? 'Project' : 'Buyer'}</td>
                        <td className="px-2 font-mono">{r.tickets.length}{tok > 0n && <div className="text-[11px] text-on-surface-variant">{formatUnits(tok)} {r.meta.symbol} held</div>}</td>
                        <td className="px-2 text-[13px]">{r.claimable ? <b className="text-success">{r.claimable} tranche(s) to claim</b> : r.refundable ? <b className="text-error">{r.refundable} to refund</b> : r.isProject && r.view.phase === 'succeeded' && r.view.vault.length ? `${r.view.vault.length} to withdraw` : '—'}</td>
                        <td className="px-2 text-right"><Link className="btn-dark !py-1.5 !px-3 !text-[13px]" to={`/sale/${r.meta.address}`}>Open</Link></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card p-7">
            <h2 className="font-display text-[22px] font-bold mb-4 flex items-center gap-2"><Activity size={20} className="text-primary" /> Private activity log</h2>
            <p className="text-[13px] text-on-surface-variant mb-3">Stored only in this vault (and in your encrypted backups).</p>
            {(vault.data?.activity ?? []).length === 0 ? <p className="text-on-surface-variant">Nothing yet.</p> : (
              <ul className="divide-y divide-outline-variant/60">
                {vault.data!.activity.slice(0, 25).map((a, i) => (
                  <li key={i} className="py-2.5 flex items-center justify-between gap-3 text-[14px]">
                    <span><span className="pill bg-surface-high !text-[11px] mr-2">{a.kind}</span>{a.detail}</span>
                    <span className="text-on-surface-variant text-[12px] shrink-0">{new Date(a.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="bg-ink text-white rounded-card p-7 space-y-4" data-testid="vault-card">
            <div className="flex items-center gap-2"><FolderLock size={18} className="text-terminal" /><h2 className="font-display text-[20px] font-bold">Private vault</h2></div>
            <label className="block"><span className="label-mono text-white/60">Active vault</span>
              <select className="input mt-2 !bg-white/10 !text-white !border-white/20" value={vault.profile?.id ?? ''} onChange={(e) => void vault.select(e.target.value)} data-testid="vault-select">
                {vault.profiles.map((p) => <option key={p.id} value={p.id} className="text-ink">{p.label}</option>)}
              </select>
            </label>
            <div className="text-[13px] text-white/70 space-y-1">
              <div>Created {vault.data ? new Date(vault.data.createdAt).toLocaleDateString() : '—'}</div>
              <div className="flex items-center gap-1.5"><Link2 size={13} /> {vault.profile?.linked.includes(session.shieldedAddress) ? 'Linked to this wallet' : 'Not linked to this wallet'}</div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {!vault.profile?.linked.includes(session.shieldedAddress) && <button className="btn-light !py-2 !px-3 !text-[13px]" onClick={() => void vault.linkToWallet()}><Link2 size={14} /> Use with this wallet</button>}
              <button className="btn-light !py-2 !px-3 !text-[13px]" onClick={() => void vault.create(`Vault ${vault.profiles.length + 1}`)}><Plus size={14} /> New vault</button>
            </div>
            <div className="border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <span className="label-mono text-white/60 flex items-center gap-1.5"><KeyRound size={13} /> Master secret</span>
                <button className="text-white/70 hover:text-white text-[13px] flex items-center gap-1" onClick={() => setShowSecret((s) => !s)}>{showSecret ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Reveal</>}</button>
              </div>
              <div className="font-mono text-[12px] break-all mt-2 text-white/80">{showSecret ? vault.data?.masterSecret : '•'.repeat(64)}</div>
              <p className="text-[12px] text-white/50 mt-2">Derives your holder secret, every receipt and your project admin keys. Anyone with it can claim your tokens.</p>
            </div>
          </section>

          <section className="card p-7 space-y-3">
            <h2 className="font-display text-[19px] font-bold flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /> Credential</h2>
            {vault.data?.credential ? (<>
              <Row k="Level" v={vault.data.credential.attrs.kycLevel} />
              <Row k="Expires" v={fmtDate(vault.data.credential.attrs.expiry)} />
            </>) : <p className="text-on-surface-variant text-[14px]">None yet.</p>}
            <Link to="/credential" className="btn-light w-full">Manage credential</Link>
          </section>

          <section className="card p-7 space-y-3">
            <h2 className="font-display text-[19px] font-bold flex items-center gap-2"><Coins size={18} className="text-primary" /> Test funds</h2>
            <p className="text-on-surface-variant text-[14px]">tUSD is a test stablecoin contract with a faucet ({network ? formatUnits(BigInt(network.tusd.faucetLimit)) : '…'} per mint).</p>
            <button className="btn-dark w-full" onClick={() => void onFaucet()} disabled={flow.running || !network} data-testid="dash-faucet">{flow.running ? <Spinner /> : <Coins size={16} />} Mint 5,000 tUSD</button>
            {!network && !IS_LOCAL && <p className="text-[13px]">tUSD is not deployed on this network yet. <Link className="underline" to="/setup">Run the one-time setup</Link>.</p>}
          </section>

          <section className="card p-7 space-y-2 text-[13px]" data-testid="wallet-diagnostics">
            <h2 className="font-display text-[19px] font-bold">Wallet connection</h2>
            <Row k="Wallet" v={`${session.option.name}${session.caps.apiVersion ? ` · API ${session.caps.apiVersion}` : ''}`} />
            <Row k="Network" v={NETWORK} />
            <Row k="Wallet proving" v={session.caps.getProvingProvider ? 'supported' : 'not offered'} />
            <Row k="Last proof" v={proving ? (proving.mode === 'wallet' ? 'in the wallet' : 'proof server') : '—'} />
            <Row k="Indexer" v={session.endpoints.source?.indexer ?? 'app'} />
            <Row k="Proof server" v={`${session.endpoints.source?.prover ?? 'app'} · ${session.endpoints.prover.replace(/^https?:\/\//, '')}`} />
            {proving?.why && <p className="text-on-surface-variant break-words">Fallback reason: {proving.why}</p>}
          </section>
        </aside>
      </div>

      <BackupDialog mode={backupOpen} onClose={() => setBackupOpen(null)} />
    </div>
  );
}

function BackupDialog({ mode, onClose }: { mode: 'export' | 'import' | null; onClose: () => void }) {
  const vault = useVault();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [label, setLabel] = useState('Restored vault');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const close = () => { setPass(''); setPass2(''); setErr(null); onClose(); };

  async function doExport() {
    setErr(null);
    if (pass.length < 10) return setErr('Use at least 10 characters.');
    if (pass !== pass2) return setErr('Passphrases do not match.');
    setBusy(true);
    try {
      const b = await vault.exportBackup(pass);
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `duskpad-vault-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Encrypted backup downloaded');
      close();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function doImport() {
    setErr(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr('Choose a backup file.');
    setBusy(true);
    try {
      const b = JSON.parse(await file.text()) as EncryptedBackup;
      await vault.importBackup(b, pass, label || 'Restored vault');
      toast.success('Vault restored and linked to this wallet');
      close();
    } catch (e: any) { setErr(e instanceof SyntaxError ? 'Not a DuskPad backup file' : e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!mode} onClose={close} label={mode === 'export' ? 'Export encrypted backup' : 'Import backup'}>
      <div className="bg-white rounded-card border-2 border-ink p-8 space-y-5 w-[min(92vw,480px)]">
        <h2 className="font-display text-[26px] font-bold flex items-center gap-2">{mode === 'export' ? <><Download size={22} /> Export backup</> : <><ArchiveRestore size={22} /> Import backup</>}</h2>
        {mode === 'export' ? (
          <p className="text-on-surface-variant text-[14px]">Encrypted with your passphrase (PBKDF2-SHA256, 310k iterations, AES-256-GCM). Import it in any browser and wallet to claim from there, for example from a fresh wallet that never touched the sale.</p>
        ) : (<>
          <p className="text-on-surface-variant text-[14px]">The restored vault becomes the active vault for the connected wallet.</p>
          <label className="block"><span className="field-label">Backup file</span><input ref={fileRef} type="file" accept="application/json,.json" className="input" data-testid="import-file" /></label>
          <label className="block"><span className="field-label">Name</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        </>)}
        <label className="block"><span className="field-label">Passphrase</span><input className="input" type="password" minLength={10} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" data-testid="backup-pass" /></label>
        {mode === 'export' && <label className="block"><span className="field-label">Repeat passphrase</span><input className="input" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" data-testid="backup-pass2" /></label>}
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <button className="btn-light" onClick={close}>Cancel</button>
          <button className="btn-dark" disabled={busy} onClick={() => void (mode === 'export' ? doExport() : doImport())} data-testid="backup-submit">{busy && <Spinner />}{mode === 'export' ? 'Download' : 'Restore'}</button>
        </div>
      </div>
    </Dialog>
  );
}
