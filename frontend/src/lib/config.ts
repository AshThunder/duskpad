// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
export type NetworkId = 'undeployed' | 'preprod';

export const NETWORK: NetworkId = (import.meta.env.VITE_NETWORK as NetworkId) ?? 'undeployed';
export const API = import.meta.env.VITE_API_URL ?? '/api';
export const IS_LOCAL = NETWORK === 'undeployed';
/** localStorage key for the platform master secret chosen on the Setup page (public networks). */
export const PLATFORM_MASTER_KEY = `duskpad.platformMaster.${NETWORK}`;

export interface Endpoints {
  indexer: string;
  indexerWs: string;
  /** Proof server used when the wallet cannot prove (Lace) or its prover fails. */
  prover: string;
  /** Where each URL came from, shown on the dashboard for testers. */
  source?: { indexer: 'wallet' | 'default' | 'local'; prover: 'wallet' | 'app' | 'local' };
}

export function localEndpoints(): Endpoints {
  const o = window.location.origin;
  return {
    indexer: `${o}/indexer/api/v4/graphql`,
    indexerWs: `${o.replace(/^http/, 'ws')}/indexer/api/v4/graphql/ws`,
    prover: `${o}/prover`,
    source: { indexer: 'local', prover: 'local' },
  };
}

/** Same-origin proof-server proxy served by `vite preview` (-> 127.0.0.1:6300, proof-server 8.1.0 / ledger 8). */
export const appProver = () => import.meta.env.VITE_PREPROD_PROVER ?? `${window.location.origin}/prover`;

/**
 * Public Preprod defaults, used for reads before a wallet connects and whenever the wallet's own
 * indexer does not answer (Lace's built-in default, blockfrost.lw.iog.io/midnight-preprod/, now
 * returns 410 Gone). The Midnight indexer serves `Access-Control-Allow-Origin: *`.
 */
export const PREPROD_DEFAULTS = {
  indexer: import.meta.env.VITE_PREPROD_INDEXER ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWs: import.meta.env.VITE_PREPROD_INDEXER_WS ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
};

export const preprodDefaultEndpoints = (): Endpoints => ({
  ...PREPROD_DEFAULTS, prover: appProver(), source: { indexer: 'default', prover: 'app' },
});

/** Endpoints used for public reads (no wallet needed). */
export const publicEndpoints = (): Endpoints => (IS_LOCAL ? localEndpoints() : preprodDefaultEndpoints());

async function indexerAnswers(url: string, timeoutMs = 6000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ query: '{ block { height } }' }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return typeof j?.data?.block?.height === 'number';
  } catch { return false; } finally { clearTimeout(t); }
}

async function proverAnswers(url: string, timeoutMs = 4000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/version`, { signal: ctl.signal });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

export interface WalletConfiguration { networkId?: string; indexerUri?: string; indexerWsUri?: string; proverServerUri?: string; substrateNodeUri?: string }

/**
 * Preprod endpoints from the wallet's getConfiguration(), each one probed and replaced by a
 * working default if it does not answer from this page.
 */
export async function resolveWalletEndpoints(cfg: WalletConfiguration | null): Promise<Endpoints> {
  if (IS_LOCAL) return localEndpoints();
  const out = preprodDefaultEndpoints();
  const src = { indexer: 'default' as 'wallet' | 'default', prover: 'app' as 'wallet' | 'app' };
  if (cfg?.indexerUri && await indexerAnswers(cfg.indexerUri)) {
    out.indexer = cfg.indexerUri;
    out.indexerWs = cfg.indexerWsUri || cfg.indexerUri.replace(/^http/, 'ws').replace(/\/?$/, '/ws');
    src.indexer = 'wallet';
  }
  // The deprecated proverServerUri is how Lace exposes its "local proof server" setting.
  // Prefer it when it answers from the page; otherwise use the app's same-origin proxy.
  if (cfg?.proverServerUri && /^https?:/.test(cfg.proverServerUri) && await proverAnswers(cfg.proverServerUri)) {
    out.prover = cfg.proverServerUri.replace(/\/$/, '');
    src.prover = 'wallet';
  }
  out.source = src;
  return out;
}

export const NETWORK_LABEL: Record<NetworkId, string> = { undeployed: 'Local devnet', preprod: 'Midnight Preprod' };
