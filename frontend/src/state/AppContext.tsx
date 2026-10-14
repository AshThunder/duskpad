// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type IssuerInfo, type NetworkConfig } from '../lib/api';
import { publicEndpoints } from '../lib/config';
import { publicDataProvider } from '../lib/providers';

interface AppState {
  network: NetworkConfig | null;
  networkError: string | null;
  issuer: IssuerInfo | null;
  publicData: any;
  reload: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkConfig | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [issuer, setIssuer] = useState<IssuerInfo | null>(null);
  const publicData = useMemo(() => publicDataProvider(publicEndpoints()), []);
  const reload = useCallback(() => {
    api.network().then((n) => { setNetwork(n); setNetworkError(null); }).catch((e) => setNetworkError(String(e.message ?? e)));
    api.issuer().then(setIssuer).catch(() => setIssuer(null));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return <Ctx.Provider value={{ network, networkError, issuer, publicData, reload }}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}
