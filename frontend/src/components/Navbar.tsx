// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { KeyRound, LogOut, Menu, X } from 'lucide-react';
import { formatUnits } from '@duskpad/sdk';
import { Logo } from './Logo';
import { WalletModal } from './WalletModal';
import { useWallet } from '../state/WalletContext';
import { useVault } from '../state/VaultContext';
import { useApp } from '../state/AppContext';
import { NETWORK, NETWORK_LABEL } from '../lib/config';
import { shortHex } from '../lib/hex';

const LINKS = [
  { to: '/explore', label: 'Sales' },
  { to: '/create', label: 'Launch' },
  { to: '/credential', label: 'Get verified' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/dashboard', label: 'Dashboard' },
];

export function Navbar() {
  const { session, disconnect, balances } = useWallet();
  const { profile } = useVault();
  const { network } = useApp();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const tusd = network && balances ? balances.shielded[network.tusd.color] ?? 0n : null;
  const cls = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'px-4 py-2 font-bold text-ink border-b-2 border-ink' : 'px-4 py-2 rounded-full text-on-surface-variant hover:bg-surface-high transition-colors';

  return (
    <nav className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-outline-variant/30">
      <div className="max-w-page mx-auto flex items-center justify-between gap-4 px-4 md:px-10 py-3.5">
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <Logo />
          <span className="font-display text-[22px] font-extrabold tracking-tight">Dusk<span className="dusk-text">Pad</span></span>
        </Link>
        <div className="hidden lg:flex items-center gap-1 font-display text-[17px]">
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} className={cls}>{l.label}</NavLink>)}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex pill bg-surface-high text-on-surface-variant" title="Network">
            <span className={`w-2 h-2 rounded-full ${NETWORK === 'undeployed' ? 'bg-terminal' : 'bg-primary'}`} /> {NETWORK_LABEL[NETWORK]}
          </span>
          {session ? (
            <div className="flex items-center gap-2">
              {profile && (
                <Link to="/dashboard" className="hidden xl:inline-flex pill bg-primary-fixed text-primary" title="Private vault in use">
                  <KeyRound size={12} /> {profile.label}
                </Link>
              )}
              <div className="hidden sm:flex flex-col items-end leading-tight bg-surface-high rounded-full px-4 py-1.5">
                <span className="font-mono text-[12px] font-bold">{session.option.name}</span>
                <span className="font-mono text-[11px] text-on-surface-variant">
                  {tusd !== null ? `${formatUnits(tusd)} tUSD` : shortHex(session.shieldedAddress, 6)}
                </span>
              </div>
              <button className="btn-light btn-sm" onClick={disconnect} aria-label="Disconnect wallet"><LogOut size={14} /></button>
            </div>
          ) : (
            <button className="btn-dark btn-sm md:px-6 md:py-3" onClick={() => setOpen(true)} data-testid="connect-wallet">Connect wallet</button>
          )}
          <button className="lg:hidden p-2" onClick={() => setMobile(!mobile)} aria-label="Toggle menu">{mobile ? <X /> : <Menu />}</button>
        </div>
      </div>
      {mobile && (
        <div className="lg:hidden px-4 pb-4 space-y-1 font-display text-lg">
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} onClick={() => setMobile(false)} className="block px-4 py-3 rounded-xl hover:bg-surface-high">{l.label}</NavLink>)}
        </div>
      )}
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </nav>
  );
}
