// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useMemo, useState } from 'react';
import { Building2, Coins, KeyRound, Wallet } from 'lucide-react';
import { adminKeyOf, derivePlatformSecret, formatUnits, fromHex, toHex } from '@duskpad/sdk';
import { toast } from 'sonner';
import { IS_LOCAL } from '../lib/config';
import { devPlatformMaster } from '../lib/devWallet';
import { useSales, useSaleViews } from '../lib/sales';
import { useTxFlow } from '../lib/txflow';
import { collectFeeCoin, ownPayout } from '../lib/chain';
import { useApp } from '../state/AppContext';
import { useWallet } from '../state/WalletContext';
import { PrivacyStepper } from '../components/PrivacyStepper';
import { WalletModal } from '../components/WalletModal';
import { Empty, Hex, Notice, Spinner, Stat } from '../components/ui';

export function Platform() {
  const { network } = useApp();
  const { session, refreshBalances } = useWallet();
  const { sales } = useSales();
  const { views, reload } = useSaleViews((sales ?? []).map((s) => s.address));
  const flow = useTxFlow();
  const [master, setMaster] = useState('');
  const [walletOpen, setWalletOpen] = useState(false);

  const key = useMemo(() => { try { return /^[0-9a-f]{64}$/i.test(master) ? toHex(adminKeyOf(derivePlatformSecret(fromHex(master)))) : null; } catch { return null; } }, [master]);
  const rows = (sales ?? []).map((m) => ({ meta: m, view: views[m.address]?.view })).filter((r) => r.view && key && r.view.feeKey === key);
  const pending = rows.reduce((n, r) => n + r.view!.feeVault.length, 0);
  const pendingValue = rows.reduce((n, r) => n + r.view!.feeVault.reduce((s, c) => s + c.value, 0n), 0n);
  const collected = rows.reduce((n, r) => n + r.view!.feeCoinsCollected, 0);

  const collect = async (address: string) => {
    const v = views[address]?.view;
    if (!v || !session) return;
    const r = await flow.run('collectFee', (onStage, markLocal) => collectFeeCoin(session, address, fromHex(master), v.feeVault[0], ownPayout(session), onStage, markLocal));
    await Promise.all([reload(), refreshBalances()]);
    if (r) { toast.success(`Collected ${formatUnits(v.feeVault[0].value)} tUSD`); flow.reset(); }
  };

  return (
    <div className="space-y-10">
      <header>
        <span className="tag-terminal">[ PLATFORM OPERATOR ]</span>
        <h1 className="font-display text-display-md md:text-display-lg mt-4">Fee console</h1>
        <p className="text-on-surface-variant mt-2 max-w-2xl">Each withdrawal moves the platform's cut into a per-sale fee vault. The operator proves knowledge of the platform secret behind the sale's fee key to collect it.</p>
      </header>

      <section className="card p-7 space-y-4 max-w-3xl">
        <h2 className="font-display text-[20px] font-bold flex items-center gap-2"><KeyRound size={18} className="text-primary" /> Platform secret</h2>
        <div className="flex gap-2">
          <input className="input font-mono !text-[13px]" type="password" placeholder="64-hex platform master secret" value={master} onChange={(e) => setMaster(e.target.value.trim())} data-testid="platform-master" />
          {IS_LOCAL && <button className="btn-light shrink-0" onClick={async () => { const m = await devPlatformMaster(); if (m) setMaster(m); else toast.error('Dev wallet bridge not running'); }} data-testid="load-dev-master">Load dev key</button>}
        </div>
        {key && (network && key === network.platform.feeKey
          ? <Notice tone="ok">Matches the {network.platform.name} fee key <Hex value={key} /></Notice>
          : <Notice tone="warn">Derived fee key <Hex value={key} /> does not match this network's default platform.</Notice>)}
        <p className="text-[12px] text-on-surface-variant">Held only in memory on this page.{IS_LOCAL && ' On the local devnet the dev bridge exposes a deterministic test key.'}</p>
      </section>

      {flow.action && (flow.running || flow.error) && <div className="max-w-xl"><PrivacyStepper action="collectFee" steps={flow.steps} error={flow.error} />{flow.error && <button className="btn-light mt-3" onClick={flow.reset}>Dismiss</button>}</div>}

      {key && (<>
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-mint rounded-card p-6"><Stat label="Sales using this key" value={rows.length} /></div>
          <div className="bg-butter rounded-card p-6"><Stat label="Pending fees" value={<span data-testid="pending-fees">{formatUnits(pendingValue)}</span>} sub={`${pending} coins`} /></div>
          <div className="bg-lilac rounded-card p-6"><Stat label="Collected" value={collected} sub="coins" /></div>
        </section>
        {!session ? (
          <button className="btn-dark" onClick={() => setWalletOpen(true)}><Wallet size={16} /> Connect the payout wallet</button>
        ) : rows.length === 0 ? <Empty icon={<Building2 size={26} />} title="No sales use this fee key yet" /> : (
          <section className="card p-7">
            <table className="w-full text-[14px]" data-testid="fee-table">
              <thead><tr className="label-mono text-on-surface-variant text-left"><th className="py-2">Sale</th><th>Fee</th><th>Fee vault</th><th>Collected</th><th></th></tr></thead>
              <tbody>{rows.map(({ meta, view }) => (
                <tr key={meta.address} className="border-t border-outline-variant/60">
                  <td className="py-3"><b>{meta.symbol}</b> <span className="text-on-surface-variant">{meta.name}</span></td>
                  <td>{(view!.feeBps / 100).toFixed(2)}%</td>
                  <td className="font-mono">{view!.feeVault.length} × {formatUnits(view!.feePerTicket)}</td>
                  <td className="font-mono">{view!.feeCoinsCollected}</td>
                  <td className="text-right"><button className="btn-dark !py-1.5 !px-3 !text-[13px]" disabled={!view!.feeVault.length || flow.running} onClick={() => void collect(meta.address)} data-testid="collect-fee">{flow.running ? <Spinner size={13} /> : <Coins size={14} />} Collect one</button></td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}
      </>)}
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
