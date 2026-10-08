// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Wallet discovery and connection through the DApp Connector API v4 (window.midnight).
// 1AM and Lace are detected by key/name; the local dev wallet is injected the same way.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { isRejection, normalizeBalances, normalizeDust, normalizeShieldedKeys } from '@duskpad/sdk';
import { NETWORK, NETWORK_LABEL, resolveWalletEndpoints, type Endpoints, type WalletConfiguration } from '../lib/config';
import { installDevWallets, type DevAccount } from '../lib/devWallet';
import { walletProviders, type ContractKind, type ProvingMode } from '../lib/providers';

export type WalletKind = '1am' | 'lace' | 'dev' | 'other';
export interface WalletOption { key: string; name: string; icon?: string; kind: WalletKind; role?: string; initial: any }

export interface Session {
  option: WalletOption;
  api: ConnectedAPI;
  endpoints: Endpoints;
  /** Raw getConfiguration() result (null if the wallet does not implement it). */
  config: WalletConfiguration | null;
  /** Wallet capabilities seen at connect time, for the dashboard diagnostics panel. */
  caps: { getProvingProvider: boolean; getDustBalance: boolean; apiVersion: string | null; rdns: string | null };
  shieldedAddress: string;
  coinPublicKey: string;
  encryptionPublicKey: string;
  unshieldedAddress: string;
  providers: (kind: ContractKind) => Promise<any>;
}

export interface Balances { shielded: Record<string, bigint>; unshielded: Record<string, bigint>; dust: bigint | null; dustCap: bigint | null; updatedAt: number }

interface WalletState {
  options: WalletOption[];
  devAccounts: DevAccount[];
  session: Session | null;
  connecting: string | null;
  error: string | null;
  balances: Balances | null;
  /** How the last transaction is being proved: in the wallet, or on the proof server (and why). */
  proving: { mode: ProvingMode; why: string | null } | null;
  connect: (o: WalletOption) => Promise<Session | null>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  rescan: () => void;
}

const Ctx = createContext<WalletState | null>(null);

// 1AM: window.midnight['1am'], name '1AM', rdns 'com.midnight.1am'. Lace: window.midnight.mnLace.
function kindOf(key: string, w: any): WalletKind {
  if (key.startsWith('duskpad-dev-')) return 'dev';
  if (key === '1am' || w?.rdns === 'com.midnight.1am' || /^1am$/i.test(w?.name ?? '')) return '1am';
  if (key === 'mnLace' || /lace/i.test(key) || /lace/i.test(w?.rdns ?? '') || /lace/i.test(w?.name ?? '')) return 'lace';
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
  const [proving, setProving] = useState<{ mode: ProvingMode; why: string | null } | null>(null);
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
      const api: any = s.api;
      const [shielded, unshielded, dust] = await Promise.all([
        api.getShieldedBalances(),
        typeof api.getUnshieldedBalances === 'function' ? api.getUnshieldedBalances().catch(() => ({})) : {},
        typeof api.getDustBalance === 'function' ? api.getDustBalance().catch(() => null) : null,
      ]);
      // Wallets differ in how they encode amounts (bigint, number or decimal string): normalize.
      const d = normalizeDust(dust);
      setBalances({ shielded: normalizeBalances(shielded), unshielded: normalizeBalances(unshielded), dust: d?.balance ?? null, dustCap: d?.cap ?? null, updatedAt: Date.now() });
    } catch (e) {
      console.warn('balance refresh failed', e);
    }
  }, []);

  const connect = useCallback(async (o: WalletOption) => {
    setConnecting(o.key);
    setError(null);
    try {
      // Must be the first await in the click handler: Lace opens a pop-up that browsers block once
      // the user gesture has been consumed.
      let capi: ConnectedAPI;
      try {
        capi = await o.initial.connect(NETWORK);
      } catch (e: any) {
        const why = String(e?.reason ?? e?.message ?? e);
        if (isRejection(e)) throw new Error(`${o.name}: connection request was rejected.`);
        throw new Error(`${o.name} could not connect on "${NETWORK}" (${why}). Make sure the wallet is unlocked and set to the ${NETWORK_LABEL[NETWORK]} network, then try again.`);
      }
      const a: any = capi;
      const [cfg, sh, un] = await Promise.all([
        typeof a.getConfiguration === 'function' ? a.getConfiguration().catch(() => null) : null,
        capi.getShieldedAddresses(),
        capi.getUnshieldedAddress(),
      ]);
      const status = typeof a.getConnectionStatus === 'function' ? await a.getConnectionStatus().catch(() => null) : null;
      const walletNet: string | undefined = cfg?.networkId ?? (status?.status === 'connected' ? status.networkId : undefined);
      if (walletNet && walletNet !== NETWORK) {
        throw new Error(`The wallet is on "${walletNet}" but this DuskPad build is for "${NETWORK}". Switch the wallet's network and reconnect.`);
      }
      // getShieldedAddresses: Bech32m per spec (Lace), raw hex (dev wallet), either accepted.
      const keys = normalizeShieldedKeys(sh);
      if (keys.network && keys.network !== NETWORK) throw new Error(`The wallet's shielded address is for "${keys.network}", expected "${NETWORK}".`);
      const endpoints: Endpoints = await resolveWalletEndpoints(cfg);
      const cache = new Map<ContractKind, Promise<any>>();
      const s: Session = {
        option: o, api: capi, endpoints, config: cfg,
        caps: {
          getProvingProvider: typeof a.getProvingProvider === 'function',
          getDustBalance: typeof a.getDustBalance === 'function',
          apiVersion: o.initial?.apiVersion ?? null, rdns: o.initial?.rdns ?? null,
        },
        shieldedAddress: sh.shieldedAddress, coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey,
        unshieldedAddress: un.unshieldedAddress,
        providers: (kind) => {
          if (!cache.has(kind)) {
            cache.set(kind, walletProviders(capi, { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey },
              endpoints, NETWORK, kind, {
                useWalletProver: o.kind !== 'dev',
                onProvingMode: (m, why) => setProving({ mode: m, why: why ?? null }),
              }));
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
      setError(String(e?.reason ?? e?.message ?? e));
      return null;
    } finally {
      setConnecting(null);
    }
  }, [refreshBalances]);

  const disconnect = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    setBalances(null);
    setProving(null);
    localStorage.removeItem('duskpad.lastWallet');
  }, []);

  // Auto-reconnect to the last wallet once it is detected.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || session) return;
    const last = localStorage.getItem('duskpad.lastWallet');
    const o = last ? options.find((x) => x.key === last) : undefined;
    // Lace's authorization pop-up needs a user gesture, so it is never auto-connected on load.
    if (o && o.kind !== 'lace') { tried.current = true; void connect(o); }
  }, [options, session, connect]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => void refreshBalances(), 8000);
    return () => clearInterval(id);
  }, [session, refreshBalances]);

  return (
    <Ctx.Provider value={{ options, devAccounts, session, connecting, error, balances, proving, connect, disconnect, refreshBalances, rescan }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWallet outside WalletProvider');
  return c;
}
