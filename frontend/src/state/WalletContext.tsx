// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Wallet discovery and connection through the DApp Connector API v4 (window.midnight).
// 1AM and Lace are detected by key/name; the local dev wallet is injected the same way.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { IS_LOCAL, NETWORK, localEndpoints, type Endpoints } from '../lib/config';
import { installDevWallets, type DevAccount } from '../lib/devWallet';
import { walletProviders, type ContractKind } from '../lib/providers';

export type WalletKind = '1am' | 'lace' | 'dev' | 'other';
export interface WalletOption { key: string; name: string; icon?: string; kind: WalletKind; role?: string; initial: any }

export interface Session {
  option: WalletOption;
  api: ConnectedAPI;
  endpoints: Endpoints;
  shieldedAddress: string;
  coinPublicKey: string;
  encryptionPublicKey: string;
  unshieldedAddress: string;
  providers: (kind: ContractKind) => Promise<any>;
}

export interface Balances { shielded: Record<string, bigint>; dust: bigint | null; updatedAt: number }

interface WalletState {
  options: WalletOption[];
  devAccounts: DevAccount[];
  session: Session | null;
  connecting: string | null;
  error: string | null;
  balances: Balances | null;
  connect: (o: WalletOption) => Promise<Session | null>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  rescan: () => void;
}

const Ctx = createContext<WalletState | null>(null);

function kindOf(key: string, w: any): WalletKind {
  if (key === '1am' || /1am/i.test(w?.name ?? '')) return '1am';
  if (/lace/i.test(key) || /lace/i.test(w?.name ?? '')) return 'lace';
  if (key.startsWith('duskpad-dev-')) return 'dev';
  return 'other';
}

function discover(): WalletOption[] {
  const m = (window as any).midnight ?? {};
  const out: WalletOption[] = [];
  for (const [key, w] of Object.entries<any>(m)) {
    if (!w || typeof w.connect !== 'function') continue;
    out.push({ key, name: w.name ?? key, icon: w.icon, kind: kindOf(key, w), role: w.devRole, initial: w });
  }
  const rank: Record<WalletKind, number> = { '1am': 0, lace: 1, other: 2, dev: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [devAccounts, setDevAccounts] = useState<DevAccount[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const rescan = useCallback(() => {
    installDevWallets().then((accts) => { setDevAccounts(accts); setOptions(discover()); });
    setOptions(discover());
  }, []);

  // Extensions inject asynchronously: poll for a few seconds.
  useEffect(() => {
    rescan();
    let n = 0;
    const id = setInterval(() => { setOptions(discover()); if (++n > 20) clearInterval(id); }, 300);
    return () => clearInterval(id);
  }, [rescan]);

  const refreshBalances = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const [shielded, dust] = await Promise.all([
        s.api.getShieldedBalances(),
        (s.api as any).getDustBalance?.().then((d: any) => d?.balance ?? null).catch(() => null) ?? null,
      ]);
      setBalances({ shielded: shielded as Record<string, bigint>, dust, updatedAt: Date.now() });
    } catch (e) {
      console.warn('balance refresh failed', e);
    }
  }, []);

  const connect = useCallback(async (o: WalletOption) => {
    setConnecting(o.key);
    setError(null);
    try {
      const capi: ConnectedAPI = await o.initial.connect(NETWORK);
      const [cfg, sh, un] = await Promise.all([
        capi.getConfiguration().catch(() => null),
        capi.getShieldedAddresses(),
        capi.getUnshieldedAddress(),
      ]);
      if (cfg && cfg.networkId && cfg.networkId !== NETWORK) throw new Error(`Wallet is on ${cfg.networkId}; DuskPad is configured for ${NETWORK}.`);
      const endpoints: Endpoints = IS_LOCAL || !cfg
        ? localEndpoints()
        : { indexer: cfg.indexerUri, indexerWs: cfg.indexerWsUri, prover: (cfg as any).proverServerUri ?? localEndpoints().prover };
      const cache = new Map<ContractKind, Promise<any>>();
      const s: Session = {
        option: o, api: capi, endpoints,
        shieldedAddress: sh.shieldedAddress, coinPublicKey: sh.shieldedCoinPublicKey, encryptionPublicKey: sh.shieldedEncryptionPublicKey,
        unshieldedAddress: un.unshieldedAddress,
        providers: (kind) => {
          if (!cache.has(kind)) {
            cache.set(kind, walletProviders(capi, { coinPublicKey: sh.shieldedCoinPublicKey, encryptionPublicKey: sh.shieldedEncryptionPublicKey },
              endpoints, NETWORK, kind, { useWalletProver: o.kind !== 'dev' }));
          }
          return cache.get(kind)!;
        },
      };
      sessionRef.current = s;
      setSession(s);
      localStorage.setItem('duskpad.lastWallet', o.key);
      void refreshBalances();
      return s;
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return null;
    } finally {
      setConnecting(null);
    }
  }, [refreshBalances]);

  const disconnect = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    setBalances(null);
    localStorage.removeItem('duskpad.lastWallet');
  }, []);

  // Auto-reconnect to the last wallet once it is detected.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || session) return;
    const last = localStorage.getItem('duskpad.lastWallet');
    const o = last ? options.find((x) => x.key === last) : undefined;
    if (o) { tried.current = true; void connect(o); }
  }, [options, session, connect]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => void refreshBalances(), 8000);
    return () => clearInterval(id);
  }, [session, refreshBalances]);

  return (
    <Ctx.Provider value={{ options, devAccounts, session, connecting, error, balances, connect, disconnect, refreshBalances, rescan }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWallet outside WalletProvider');
  return c;
}
