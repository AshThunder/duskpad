// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Local private state. Each vault (profile) holds one master secret plus a cache of tickets and
// the credential. Vaults are stored in IndexedDB, encrypted with AES-GCM under a NON-EXTRACTABLE
// device key (also in IndexedDB), so the raw secret is never written to disk in plaintext.
// Moving to another device or wallet = export an encrypted backup (passphrase) and import it.
import type { VaultData } from '@duskpad/sdk';

const DB = 'duskpad';
const VERSION = 1;

export interface Profile { id: string; label: string; createdAt: number; linked: string[] }
interface Row extends Profile { iv: Uint8Array; ct: ArrayBuffer }

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('vaults')) db.createObjectStore('vaults', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function deviceKey(): Promise<CryptoKey> {
  const existing = await tx<CryptoKey | undefined>('keys', 'readonly', (s) => s.get('device'));
  if (existing) return existing;
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await tx('keys', 'readwrite', (s) => s.put(k, 'device'));
  return k;
}

export async function listProfiles(): Promise<Profile[]> {
  const rows = await tx<Row[]>('vaults', 'readonly', (s) => s.getAll());
  return rows.map(({ id, label, createdAt, linked }) => ({ id, label, createdAt, linked })).sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadVault(id: string): Promise<VaultData | null> {
  const row = await tx<Row | undefined>('vaults', 'readonly', (s) => s.get(id));
  if (!row) return null;
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv as BufferSource }, await deviceKey(), row.ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function saveVault(p: Profile, data: VaultData): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), new TextEncoder().encode(JSON.stringify(data)));
  await tx('vaults', 'readwrite', (s) => s.put({ ...p, iv, ct } satisfies Row));
}

export async function deleteVault(id: string): Promise<void> {
  await tx('vaults', 'readwrite', (s) => s.delete(id));
}

export const ACTIVE_KEY = 'duskpad.activeVault';
