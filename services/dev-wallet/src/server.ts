// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// LOCAL-ONLY dev wallet bridge.
//
// Runs headless wallets on the local `undeployed` network and exposes each one's DApp
// Connector v4 ConnectedAPI (testkit-js DAppConnectorWalletAdapter) over HTTP. The frontend
// injects these as `window.midnight['duskpad-dev-<id>']`, so the app drives them through the
// exact same code path as 1AM or Lace: getConfiguration, getShieldedAddresses,
// balanceUnsealedTransaction, submitTransaction. Proving goes to the local proof server.
//
// Never expose this beyond localhost: it signs and pays for anything it is asked to.
import http from 'node:http';
import { DAppConnectorWalletAdapter } from '@midnight-ntwrk/testkit-js';
import { toHex } from '@duskpad/sdk';
import { ACCOUNTS, PLATFORM_MASTER, bootstrap } from './bootstrap.js';
import { env, log, type Wallet } from './node.js';

const PORT = Number(process.env.DEV_WALLET_PORT ?? 8797);
const HOST = '127.0.0.1';
const METHODS = new Set([
  'getConfiguration', 'getConnectionStatus', 'getShieldedAddresses', 'getUnshieldedAddress', 'getDustAddress',
  'getShieldedBalances', 'getUnshieldedBalances', 'getDustBalance', 'balanceUnsealedTransaction',
  'balanceSealedTransaction', 'submitTransaction', 'hintUsage',
]);

let ready = false;
let failure: string | null = null;
const wallets: Record<string, Wallet> = {};
const adapters: Record<string, DAppConnectorWalletAdapter> = {};
const queues: Record<string, Promise<unknown>> = {};

/** Serialize balancing per wallet so two requests cannot pick the same coins. */
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues[id] ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues[id] = next;
  return next;
}

const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? { __bigint: x.toString() } : x));

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  res.end(enc(body));
}

async function readBody(req: http.IncomingMessage) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname.replace(/^\/dev-wallet/, '');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (p === '/health') return send(res, 200, { ready, failure, network: 'undeployed' });
    if (p === '/accounts') {
      return send(res, 200, ACCOUNTS.map((a) => ({
        ...a,
        ready: ready && !!wallets[a.id],
        shieldedAddress: wallets[a.id]?.shieldedAddress ?? null,
        unshieldedAddress: wallets[a.id]?.unshieldedAddress ?? null,
      })));
    }
    if (p === '/platform-master') return send(res, 200, { masterSecret: toHex(PLATFORM_MASTER), note: 'local dev platform operator only' });
    const m = p.match(/^\/([a-z]+)\/rpc$/);
    if (m && req.method === 'POST') {
      if (!ready) return send(res, 503, { error: 'dev wallet is still syncing' });
      const a = adapters[m[1]];
      if (!a) return send(res, 404, { error: 'unknown account' });
      const { method, params = [] } = await readBody(req);
      if (!METHODS.has(method)) return send(res, 400, { error: `method ${method} not supported by the dev wallet` });
      const run = () => (a as any)[method](...params);
      const result = method.startsWith('balance') || method === 'submitTransaction' ? await serial(m[1], run) : await run();
      if (method === 'balanceUnsealedTransaction' || method === 'submitTransaction') log(`${m[1]}: ${method}`);
      return send(res, 200, { result: result ?? null });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e: any) {
    log('rpc error', e?.message ?? e);
    return send(res, 500, { error: String(e?.message ?? e).slice(0, 2000) });
  }
});

server.listen(PORT, HOST, () => log(`dev wallet bridge on http://${HOST}:${PORT} (LOCAL ONLY), syncing…`));

try {
  const { wallets: ws } = await bootstrap();
  for (const [id, w] of Object.entries(ws)) {
    wallets[id] = w;
    adapters[id] = new DAppConnectorWalletAdapter(w.provider, env);
  }
  ready = true;
  log(`dev wallet ready: ${Object.keys(wallets).join(', ')}`);
} catch (e: any) {
  failure = String(e?.message ?? e);
  log('bootstrap failed:', failure);
}
