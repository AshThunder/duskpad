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
 * indexer does not answer. Midnight's own Preprod indexer was shut down on 9 Oct 2026 and Blockfrost,
 * which replaced it, needs a project id, so reads go to a same-origin `/indexer` proxy (the Vercel
 * function or the local API) that adds the id server-side. Only HTTP queries are needed: Midnight.js
 * waits for transactions and deploys by polling, so the WS URL is never dialled on these paths.
 */
const origin = typeof window === 'undefined' ? '' : window.location.origin;
export const PREPROD_DEFAULTS = {
  indexer: import.meta.env.VITE_PREPROD_INDEXER ?? `${origin}/indexer/api/v4/graphql`,
  indexerWs: import.meta.env.VITE_PREPROD_INDEXER_WS ?? `${origin.replace(/^http/, 'ws')}/indexer/api/v4/graphql/ws`,
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
/**
 * True for prover URLs that are not a Midnight proof server and must not be probed: 1AM reports its
 * ProofStation (api*.1am.xyz, API-key protected, no /version) as proverServerUri, and its docs say the
 * field is not needed with getProvingProvider. Probing it only produces a 404 in the console.
 */
export function skipProverProbe(url: string, walletProves = false): boolean {
  if (walletProves) return true;
  try { return /(^|\.)1am\.xyz$/i.test(new URL(url).hostname); } catch { return true; }
}

export async function resolveWalletEndpoints(cfg: WalletConfiguration | null, opts: { walletProves?: boolean } = {}): Promise<Endpoints> {
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
  if (cfg?.proverServerUri && /^https?:/.test(cfg.proverServerUri) && !skipProverProbe(cfg.proverServerUri, opts.walletProves)
    && await proverAnswers(cfg.proverServerUri)) {
    out.prover = cfg.proverServerUri.replace(/\/$/, '');
    src.prover = 'wallet';
  }
  out.source = src;
  return out;
}

export const NETWORK_LABEL: Record<NetworkId, string> = { undeployed: 'Local devnet', preprod: 'Midnight Preprod' };

/** Block explorer for the active network. Local devnet has none, so no links are shown there.
 *  Override with VITE_EXPLORER_URL (empty string disables). Patterns: /transactions/<hash>, /contracts/<address>. */
const EXPLORERS: Record<NetworkId, string> = { undeployed: '', preprod: 'https://preprod.midnightexplorer.com' };
export const EXPLORER: string = (import.meta.env.VITE_EXPLORER_URL ?? EXPLORERS[NETWORK]).replace(/\/$/, '');
export type ExplorerKind = 'tx' | 'contract';
export function explorerUrl(kind: ExplorerKind, id: string | undefined, base: string = EXPLORER): string | null {
  if (!base || !id) return null;
  const hex = id.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{16,}$/.test(hex)) return null;
  return `${base}/${kind === 'tx' ? 'transactions' : 'contracts'}/${hex}`;
}
