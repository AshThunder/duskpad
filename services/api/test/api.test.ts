// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { credentialFromJSON, verifyCredential, holderCommitment, pad32 } from '@duskpad/sdk';

let server: http.Server; let base = '';
beforeAll(async () => {
  process.env.DUSKPAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'duskpad-api-'));
  const { handle } = await import('../src/server');
  server = http.createServer((q, s) => void handle(q, s));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterAll(() => server.close());

const post = (p: string, b: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('mock issuer', () => {
  it('labels itself as a mock and publishes its key', async () => {
    const j = await (await fetch(base + '/issuer')).json();
    expect(j.mock).toBe(true);
    expect(j.warning).toMatch(/No identity checks/);
    expect(BigInt(j.publicKey.x)).toBeGreaterThan(0n);
  });
  it('issues a credential that verifies against its key', async () => {
    const hc = holderCommitment(pad32('hs'));
    const r = await post('/issuer/credential', { holderCommit: hc.toString(), country: 566, kycLevel: 2 });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.mock).toBe(true);
    const c = credentialFromJSON(j);
    expect(c.attrs.holderCommit).toBe(hc);
    expect(verifyCredential(c)).toBe(true);
  });
  it('validates input', async () => {
    expect((await post('/issuer/credential', { holderCommit: '1', country: 999, kycLevel: 2 })).status).toBe(400);
    expect((await post('/issuer/credential', { holderCommit: '1', country: 566, kycLevel: 7 })).status).toBe(400);
    expect((await post('/issuer/credential', { country: 566, kycLevel: 1 })).status).toBe(400);
  });
});

describe('registry', () => {
  it('rejects malformed entries', async () => {
    expect((await post('/sales', { address: 'xyz', network: 'undeployed', name: 'A', symbol: 'AA' })).status).toBe(400);
    expect((await post('/sales', { address: 'ab'.repeat(32), network: 'mainnet', name: 'A', symbol: 'AA' })).status).toBe(400);
    expect((await post('/sales', { address: 'ab'.repeat(32), network: 'undeployed', name: 'A', symbol: 'a' })).status).toBe(400);
  });
  it('lists an empty registry', async () => {
    expect(await (await fetch(base + '/sales?network=undeployed')).json()).toEqual([]);
  });
});

describe('public network registration', () => {
  it('refuses the local network, unknown networks and malformed input', async () => {
    expect((await post('/networks/undeployed', {})).status).toBe(400);
    expect((await post('/networks/mainnet', {})).status).toBe(400);
    expect((await post('/networks/preprod', { tusd: { address: 'xyz' }, platform: { feeKey: 'ab'.repeat(32) } })).status).toBe(400);
    expect((await post('/networks/preprod', { tusd: { address: 'ab'.repeat(32) }, platform: { feeKey: 'ab'.repeat(32), defaultFeeBps: 5000 } })).status).toBe(400);
  });
  it('has no preprod config until one is registered', async () => {
    expect((await fetch(base + '/networks/preprod')).status).toBe(404);
  });
});
