// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// DuskPad API (Node, no framework):
//   * MOCK KYC issuer: signs eligibility credentials over a holder commitment. It performs NO
//     identity verification; it exists so the full flow can be demonstrated. Every response
//     carries `mock: true`.
//   * Off-chain sale registry for the Explore page (name, symbol, description). On-chain state
//     stays the source of truth: registration is refused unless the contract exists on the
//     configured indexer.
//   * Network config (tUSD address/color and platform fee key) written by the local bootstrap.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COUNTRIES, KYC_LEVELS, credentialToJSON, pad32, pointOf, saleTokenColor, scalarFrom, signCredential,
} from '@duskpad/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DUSKPAD_DATA_DIR ?? path.join(here, '..', 'data');
const PORT = Number(process.env.PORT ?? 8787);
const INDEXERS: Record<string, string> = {
  undeployed: process.env.INDEXER_UNDEPLOYED ?? 'http://127.0.0.1:8088/api/v4/graphql',
  preprod: process.env.INDEXER_PREPROD ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
};
// Demo issuer key. Deterministic by default so local sales keep working across restarts;
// set ISSUER_SEED to rotate it.
const ISSUER_SK = scalarFrom(pad32(process.env.ISSUER_SEED ?? 'duskpad-mock-issuer-v1'));
const ISSUER_PK = pointOf(ISSUER_SK);
const CREDENTIAL_DAYS = Number(process.env.CREDENTIAL_DAYS ?? 30);
// Optional: lets an operator replace an existing public-network config (x-admin-token header).
const ADMIN_TOKEN = process.env.DUSKPAD_ADMIN_TOKEN ?? '';
const TUSD_DOMAIN_HEX = '6475736b7061643a745553440000000000000000000000000000000000000000'; // pad32('duskpad:tUSD')

fs.mkdirSync(DATA, { recursive: true });
const file = (n: string) => path.join(DATA, n);
function load<T>(n: string, d: T): T {
  try { return JSON.parse(fs.readFileSync(file(n), 'utf8')) as T; } catch { return d; }
}
function save(n: string, v: unknown) {
  const tmp = file(n) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, file(n));
}

export interface SaleEntry {
  address: string;
  network: string;
  name: string;
  symbol: string;
  description: string;
  website?: string;
  category?: string;
  accent?: number;
  txHash?: string;
  createdAt: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

async function contractExists(network: string, address: string): Promise<boolean> {
  const url = INDEXERS[network];
  if (!url) return false;
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query($a: HexEncoded!){ contractAction(address: $a) { address } }', variables: { a: address } }),
  });
  const j: any = await r.json();
  return !!j?.data?.contractAction;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-admin-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function body(req: http.IncomingMessage): Promise<any> {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 64_000) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname.replace(/^\/api/, '');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (p === '/health') return send(res, 200, { ok: true });

    // ---------------- mock issuer ----------------
    if (p === '/issuer' && req.method === 'GET') {
      return send(res, 200, {
        name: 'DuskPad Mock KYC Issuer',
        mock: true,
        warning: 'Demonstration issuer. No identity checks are performed. Do not use for real sales.',
        publicKey: { x: ISSUER_PK.x.toString(), y: ISSUER_PK.y.toString() },
        credentialDays: CREDENTIAL_DAYS,
        levels: KYC_LEVELS,
        countries: COUNTRIES,
      });
    }
    if (p === '/issuer/credential' && req.method === 'POST') {
      const b = await body(req);
      const holderCommit = BigInt(String(b.holderCommit ?? '0'));
      const country = Number(b.country), kycLevel = Number(b.kycLevel);
      const days = Math.min(365, Math.max(1, Number(b.validDays ?? CREDENTIAL_DAYS)));
      if (holderCommit <= 0n) return send(res, 400, { error: 'holderCommit is required' });
      if (!COUNTRIES.some((c) => c.code === country)) return send(res, 400, { error: 'unknown country' });
      if (![1, 2, 3].includes(kycLevel)) return send(res, 400, { error: 'kycLevel must be 1, 2 or 3' });
      const expiry = Math.floor(Date.now() / 1000) + days * 86_400;
      const cred = signCredential(ISSUER_SK, { holderCommit, country, kycLevel, expiry });
      // The issuer learns the holder commitment and attributes, never a wallet address.
      const log = load<any[]>('issued.json', []);
      log.push({ at: Date.now(), holderCommit: holderCommit.toString(), country, kycLevel, expiry });
      save('issued.json', log.slice(-5000));
      return send(res, 200, credentialToJSON(cred, { issuer: 'DuskPad Mock KYC Issuer', mock: true }));
    }

    // ---------------- registry ----------------
    if (p === '/sales' && req.method === 'GET') {
      const network = url.searchParams.get('network');
      const all = load<SaleEntry[]>('registry.json', []);
      return send(res, 200, all.filter((s) => !network || s.network === network).sort((a, b) => b.createdAt - a.createdAt));
    }
    if (p === '/sales' && req.method === 'POST') {
      const b = await body(req);
      const address = str(b.address, 80).toLowerCase().replace(/^0x/, '');
      const network = str(b.network, 20);
      if (!HEX64.test(address)) return send(res, 400, { error: 'address must be 32-byte hex' });
      if (!INDEXERS[network]) return send(res, 400, { error: 'unknown network' });
      const name = str(b.name, 60), symbol = str(b.symbol, 12).toUpperCase();
      if (!name || !/^[A-Z0-9]{2,12}$/.test(symbol)) return send(res, 400, { error: 'name and a 2-12 character symbol are required' });
      if (!(await contractExists(network, address))) return send(res, 400, { error: 'contract not found on-chain' });
      const all = load<SaleEntry[]>('registry.json', []);
      if (all.some((s) => s.address === address)) return send(res, 409, { error: 'already registered' });
      const entry: SaleEntry = {
        address, network, name, symbol,
        description: str(b.description, 600), website: str(b.website, 200) || undefined,
        category: str(b.category, 30) || undefined, accent: Number.isInteger(b.accent) ? b.accent : undefined,
        txHash: str(b.txHash, 80) || undefined, createdAt: Date.now(),
      };
      all.push(entry);
      save('registry.json', all);
      return send(res, 201, entry);
    }
    const m = p.match(/^\/sales\/([0-9a-f]{64})$/);
    if (m && req.method === 'GET') {
      const e = load<SaleEntry[]>('registry.json', []).find((s) => s.address === m[1]);
      return e ? send(res, 200, e) : send(res, 404, { error: 'not registered' });
    }

    // ---------------- network config ----------------
    const n = p.match(/^\/networks\/([a-z]+)$/);
    if (n && req.method === 'GET') {
      const cfg = load<Record<string, unknown>>('networks.json', {})[n[1]];
      return cfg ? send(res, 200, cfg) : send(res, 404, { error: `no DuskPad deployment recorded for ${n[1]}` });
    }
    // Register a public network deployment from the in-app setup page (the browser deploys tUSD
    // with the connected wallet, then records it here). Set-once: replacing needs the admin token.
    // The undeployed config is owned by the local bootstrap and cannot be written here.
    if (n && req.method === 'POST') {
      const network = n[1];
      if (network === 'undeployed' || !INDEXERS[network]) return send(res, 400, { error: 'only public networks can be registered here' });
      const nets = load<Record<string, any>>('networks.json', {});
      const token = String(req.headers['x-admin-token'] ?? '');
      if (nets[network] && !(ADMIN_TOKEN && token === ADMIN_TOKEN)) return send(res, 409, { error: `${network} is already configured` });
      const b = await body(req);
      const address = str(b?.tusd?.address, 80).toLowerCase().replace(/^0x/, '');
      const domain = str(b?.tusd?.domain ?? TUSD_DOMAIN_HEX, 66).toLowerCase().replace(/^0x/, '');
      const feeKey = str(b?.platform?.feeKey, 66).toLowerCase().replace(/^0x/, '');
      const feeBps = Number(b?.platform?.defaultFeeBps ?? 250);
      const faucetLimit = str(String(b?.tusd?.faucetLimit ?? '100000000000'), 30);
      if (!HEX64.test(address) || !HEX64.test(domain) || !HEX64.test(feeKey)) return send(res, 400, { error: 'tusd.address, tusd.domain and platform.feeKey must be 32-byte hex' });
      if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 2000) return send(res, 400, { error: 'defaultFeeBps must be 0..2000' });
      if (!/^\d{1,20}$/.test(faucetLimit)) return send(res, 400, { error: 'faucetLimit must be an integer' });
      if (!(await contractExists(network, address))) return send(res, 400, { error: 'tUSD contract not found on-chain (the indexer may still be catching up; retry shortly)' });
      const cfg = {
        networkId: network,
        tusd: { address, color: saleTokenColor(domain, address), domain, decimals: 6, faucetLimit },
        platform: { feeKey, defaultFeeBps: feeBps, name: str(b?.platform?.name, 40) || `DuskPad (${network})` },
        issuer: { name: 'DuskPad Mock KYC Issuer', mock: true, publicKey: { x: ISSUER_PK.x.toString(), y: ISSUER_PK.y.toString() } },
        updatedAt: new Date().toISOString(),
      };
      nets[network] = cfg;
      save('networks.json', nets);
      return send(res, 201, cfg);
    }
    return send(res, 404, { error: 'not found' });
  } catch (e: any) {
    return send(res, 500, { error: String(e?.message ?? e) });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  http.createServer((req, res) => void handle(req, res)).listen(PORT, () => {
    console.log(`DuskPad API on http://127.0.0.1:${PORT} (data: ${DATA}). Issuer is a MOCK.`);
  });
}
