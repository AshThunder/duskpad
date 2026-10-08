// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { ExternalLink, FlaskConical, Wallet } from 'lucide-react';
import { useWallet, type WalletOption } from '../state/WalletContext';
import { IS_LOCAL, NETWORK_LABEL, NETWORK } from '../lib/config';
import { Dialog, Notice, Spinner } from './ui';

const INSTALL = [
  { name: '1AM', kind: '1am', url: 'https://1am.xyz', blurb: 'Recommended. Proves in the wallet and sponsors DUST fees.' },
  { name: 'Lace', kind: 'lace', url: 'https://www.lace.io', blurb: 'Midnight-enabled Lace wallet.' },
] as const;

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { options, connect, connecting, error, devAccounts } = useWallet();
  const real = options.filter((o) => o.kind !== 'dev');
  const dev = options.filter((o) => o.kind === 'dev');
  const pick = async (o: WalletOption) => { if (await connect(o)) onClose(); };

  return (
    <Dialog open={open} onClose={onClose} label="Connect a wallet">
      <div className="bg-white rounded-card p-6 md:p-8 border-2 border-ink">
        <div className="flex items-center gap-3 mb-1">
          <Wallet size={22} />
          <h2 className="font-display text-[24px] font-bold">Connect a wallet</h2>
        </div>
        <p className="text-on-surface-variant mb-6">DuskPad talks to wallets through the Midnight DApp Connector API · {NETWORK_LABEL[NETWORK]}</p>

        <div className="space-y-3">
          {INSTALL.map((w) => {
            const found = real.find((o) => o.kind === w.kind);
            return found ? (
              <button key={w.kind} onClick={() => pick(found)} disabled={!!connecting}
                className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-ink/10 hover:border-ink transition-colors text-left">
                {found.icon ? <img src={found.icon} alt="" className="w-10 h-10 rounded-xl" /> : <div className="w-10 h-10 rounded-xl bg-ink" />}
                <div className="flex-1">
                  <div className="font-bold">{found.name}</div>
                  <div className="text-[13px] text-on-surface-variant">{w.blurb}</div>
                </div>
                {connecting === found.key ? <Spinner /> : <span className="pill bg-success-container text-[#0b3d21]">Detected</span>}
              </button>
            ) : (
              <a key={w.kind} href={w.url} target="_blank" rel="noreferrer"
                className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-dashed border-ink/15 hover:border-ink/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-surface-high flex items-center justify-center font-mono text-[12px] font-bold">{w.name}</div>
                <div className="flex-1">
                  <div className="font-bold">{w.name} <span className="text-on-surface-variant font-normal">not detected</span></div>
                  <div className="text-[13px] text-on-surface-variant">Install the extension, then reload this page.</div>
                </div>
                <ExternalLink size={16} />
              </a>
            );
          })}
          {real.filter((o) => o.kind === 'other').map((o) => (
            <button key={o.key} onClick={() => pick(o)} className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-ink/10 hover:border-ink text-left">
              <div className="w-10 h-10 rounded-xl bg-surface-high" />
              <div className="flex-1 font-bold">{o.name}</div>
              {connecting === o.key && <Spinner />}
            </button>
          ))}
        </div>

        {IS_LOCAL && (
          <div className="mt-7">
            <div className="flex items-center gap-2 mb-3">
              <FlaskConical size={16} />
              <span className="label-mono">Local dev wallets · undeployed network only</span>
            </div>
            {dev.length === 0 ? (
              <Notice tone="warn">Dev wallet bridge not reachable. Start it with <code className="font-mono">npm run dev:wallet</code>.</Notice>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {dev.map((o) => {
                  const acct = devAccounts.find((a) => `duskpad-dev-${a.id}` === o.key);
                  return (
                    <button key={o.key} onClick={() => pick(o)} disabled={!!connecting || acct?.ready === false} data-testid={`wallet-${o.key}`}
                      className="flex items-center gap-3 p-3 rounded-2xl bg-surface-low hover:bg-surface-high border border-outline-variant/40 text-left disabled:opacity-50">
                      <img src={o.icon} alt="" className="w-8 h-8 rounded-lg" />
                      <div className="min-w-0">
                        <div className="font-bold text-[14px] truncate">{o.name}</div>
                        <div className="text-[12px] text-on-surface-variant truncate">{acct?.ready === false ? 'syncing…' : o.role}</div>
                      </div>
                      {connecting === o.key && <Spinner size={14} />}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[12px] text-on-surface-variant mt-2">Headless wallets exposed through the same ConnectedAPI the extensions implement. They sign anything asked, so they never run outside localhost.</p>
          </div>
        )}
        {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
        <div className="mt-6 flex justify-end"><button className="btn-ghost" onClick={onClose}>Close</button></div>
      </div>
    </Dialog>
  );
}
