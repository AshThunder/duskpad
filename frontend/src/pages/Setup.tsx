// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// One-time operator setup for a public network (Preprod): deploy the tUSD test-token contract
// from the connected wallet, choose the platform fee key, and record both with the API so every
// other page can find them. With 1AM the deploy fee (DUST) is sponsored, so a fresh wallet works.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Download, Rocket, Wallet } from 'lucide-react';
import { adminKeyOf, deployTusd, derivePlatformSecret, fromHex, pad32, toHex, waitForContract } from '@duskpad/sdk';
import { useWallet } from '../state/WalletContext';
import { useApp } from '../state/AppContext';
import { useTxFlow } from '../lib/txflow';
import { api } from '../lib/api';
import { IS_LOCAL, NETWORK, NETWORK_LABEL as LABELS, PLATFORM_MASTER_KEY } from '../lib/config';

const NETWORK_LABEL = LABELS[NETWORK];
import { PrivacyStepper } from '../components/PrivacyStepper';
import { WalletModal } from '../components/WalletModal';
import { Hex, Notice, Spinner } from '../components/ui';

const TUSD_DOMAIN = pad32('duskpad:tUSD');
const FAUCET_LIMIT = 100_000_000_000n; // 100,000 tUSD per mint call (6 decimals)
const PENDING_KEY = `duskpad.setup.pendingTusd.${NETWORK}`;

const random32 = () => crypto.getRandomValues(new Uint8Array(32));

export function Setup() {
  const { session, proving } = useWallet();
  const { network, networkError, reload } = useApp();
  const flow = useTxFlow();
  const [walletOpen, setWalletOpen] = useState(false);
  const [master, setMaster] = useState(() => localStorage.getItem(PLATFORM_MASTER_KEY) ?? '');
  const [pending, setPending] = useState<string | null>(() => localStorage.getItem(PENDING_KEY));
  const [feeBps, setFeeBps] = useState(250);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (master) localStorage.setItem(PLATFORM_MASTER_KEY, master); }, [master]);
  const validMaster = /^[0-9a-f]{64}$/i.test(master);
  const feeKey = validMaster ? toHex(adminKeyOf(derivePlatformSecret(fromHex(master)))) : null;

  if (IS_LOCAL) {
    return <div className="max-w-2xl mx-auto py-10"><Notice>The local devnet is set up by <code>npm run stack:up</code>; this page is only for public networks.</Notice></div>;
  }

  const saveMaster = () => {
    const blob = new Blob([JSON.stringify({ network: NETWORK, platformMaster: master, feeKey, savedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `duskpad-platform-${NETWORK}.json`; a.click();
  };

  async function register(address: string) {
    setErr(null);
    setBusy('Waiting for the indexer to see the tUSD contract');
    const pub = (await session!.providers('tusd')).publicDataProvider;
    if (!(await waitForContract(pub, address, 600_000))) throw new Error('The indexer has not seen the tUSD contract yet. Wait a minute and press "Register" again.');
    setBusy('Recording the deployment with the DuskPad API');
    for (let i = 0; ; i++) {
      try {
        await api.registerNetwork({ tusd: { address, domain: toHex(TUSD_DOMAIN), faucetLimit: FAUCET_LIMIT.toString() }, platform: { feeKey: feeKey!, defaultFeeBps: feeBps } });
        break;
      } catch (e: any) {
        if (i >= 10 || !/not found/i.test(String(e.message))) throw e;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    localStorage.removeItem(PENDING_KEY); setPending(null);
    reload();
    toast.success(`${NETWORK_LABEL} is ready: tUSD deployed and registered`);
  }

  async function deployAndRegister() {
    if (!session || !feeKey) return;
    setErr(null);
    const r = await flow.run('setup', async (onStage, markLocal) => {
      markLocal('key');
      const providers = await session.providers('tusd');
      return deployTusd(providers, TUSD_DOMAIN, random32(), FAUCET_LIMIT, { onStage, mode: 'async', assetsPath: '/zk/tusd' });
    });
    if (!r) return;
    localStorage.setItem(PENDING_KEY, r.address); setPending(r.address);
    try { await register(r.address); } catch (e: any) { setErr(String(e.message ?? e)); } finally { setBusy(null); }
  }

  async function retryRegister() {
    if (!pending || !session || !feeKey) return;
    try { await register(pending); } catch (e: any) { setErr(String(e.message ?? e)); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header>
        <span className="tag-terminal">[ OPERATOR · ONE-TIME ]</span>
        <h1 className="font-display text-display-md mt-4">Set up DuskPad on {NETWORK_LABEL}</h1>
        <p className="text-on-surface-variant mt-2">Deploys the tUSD test-token contract from your wallet and records it, with the platform fee key, so sales on {NETWORK_LABEL} can use it. Done once per network.</p>
      </header>

      {network ? (
        <Notice tone="ok">
          <div className="space-y-1" data-testid="setup-done">
            <p className="font-bold flex items-center gap-2"><CheckCircle2 size={16} /> {NETWORK_LABEL} is configured.</p>
            <p>tUSD contract: <Hex value={network.tusd.address} /> · token color <Hex value={network.tusd.color} /></p>
            <p>Platform fee key: <Hex value={network.platform.feeKey} /> · default fee {network.platform.defaultFeeBps / 100}%</p>
            <p className="pt-1"><Link className="underline" to="/dashboard">Mint test tUSD on the dashboard</Link> · <Link className="underline" to="/create">Launch a sale</Link></p>
          </div>
        </Notice>
      ) : (
        <Notice tone="warn">No DuskPad deployment is recorded for {NETWORK_LABEL} yet{networkError ? ` (${networkError})` : ''}.</Notice>
      )}

      {!network && (
        <>
          <section className="card p-7 space-y-3">
            <h2 className="font-display text-[20px] font-bold">1. Connect a wallet</h2>
            {session ? (
              <p className="text-[14px]">Connected with <b>{session.option.name}</b> on <code>{NETWORK}</code>. {session.option.kind === '1am' ? '1AM sponsors the DUST fee for this deploy.' : 'This wallet pays the DUST fee, so it needs registered DUST.'}</p>
            ) : (
              <><p className="text-[14px] text-on-surface-variant">1AM is easiest: it sponsors the DUST fee, so even an empty Preprod wallet can deploy.</p>
                <button className="btn-dark" onClick={() => setWalletOpen(true)}><Wallet size={16} /> Connect wallet</button></>
            )}
          </section>

          <section className="card p-7 space-y-3">
            <h2 className="font-display text-[20px] font-bold">2. Platform master secret</h2>
            <p className="text-[14px] text-on-surface-variant">Sales send their platform fee to whoever proves knowledge of this secret (only a hash, the fee key, goes on-chain). Save it: the Platform page needs it to collect fees. It is also kept in this browser's local storage.</p>
            <div className="flex gap-2">
              <input className="input font-mono !text-[13px]" type="password" placeholder="64-hex platform master secret" value={master} onChange={(e) => setMaster(e.target.value.trim().toLowerCase())} data-testid="setup-master" />
              <button className="btn-light shrink-0" onClick={() => setMaster(toHex(random32()))}>Generate</button>
            </div>
            {feeKey && (
              <div className="flex flex-wrap gap-2 items-center text-[13px]">
                <span>Fee key <Hex value={feeKey} /></span>
                <button className="btn-light !py-1.5 !px-3 !text-[12px]" onClick={() => { void navigator.clipboard.writeText(master); toast.success('Secret copied'); }}><Copy size={13} /> Copy secret</button>
                <button className="btn-light !py-1.5 !px-3 !text-[12px]" onClick={saveMaster}><Download size={13} /> Download</button>
              </div>
            )}
            <label className="text-[14px] flex items-center gap-2">Default platform fee
              <input className="input !w-24" type="number" min={0} max={2000} value={feeBps} onChange={(e) => setFeeBps(Math.max(0, Math.min(2000, Number(e.target.value) || 0)))} /> bps ({feeBps / 100}%)
            </label>
          </section>

          <section className="card p-7 space-y-4">
            <h2 className="font-display text-[20px] font-bold">3. Deploy tUSD and register</h2>
            {pending && !flow.running && (
              <Notice>A tUSD contract was already submitted from this browser: <Hex value={pending} />. Register it instead of deploying again.
                <div className="mt-2 flex gap-2"><button className="btn-dark !py-2" disabled={!session || !feeKey || !!busy} onClick={() => void retryRegister()} data-testid="setup-register">Register</button>
                  <button className="btn-light !py-2" disabled={!!busy} onClick={() => { localStorage.removeItem(PENDING_KEY); setPending(null); }}>Forget it</button></div>
              </Notice>
            )}
            {flow.action && <PrivacyStepper action="setup" steps={flow.steps} error={flow.error} compact />}
            {busy && <p className="text-[14px] flex items-center gap-2"><Spinner /> {busy}…</p>}
            {err && <Notice tone="error">{err}</Notice>}
            {proving && <p className="label-mono text-on-surface-variant">Proving: {proving.mode === 'wallet' ? 'in the wallet' : `proof server${proving.why ? ` (${proving.why})` : ''}`}</p>}
            {!pending && (
              <button className="btn-dark" disabled={!session || !feeKey || flow.running || !!busy} onClick={() => void deployAndRegister()} data-testid="setup-deploy">
                <Rocket size={16} /> Deploy tUSD on {NETWORK_LABEL}
              </button>
            )}
          </section>
        </>
      )}
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
