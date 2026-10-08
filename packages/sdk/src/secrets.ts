// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Master-secret derivation and the encrypted local vault.
//
// A DuskPad user holds ONE 32-byte master secret. Everything private is derived from it:
//   holderSecret            = H("dusk:m:holder:v1", master)                 (credential binding)
//   receiptSecret(sale, i)  = H("dusk:m:receipt:v1", master, saleId, i)     (ticket i of a sale)
//   adminSecret(sale)       = H("dusk:m:admin:v1", master, saleId)          (project owner key)
//   platformSecret          = H("dusk:m:platform:v1", master)               (fee collector key)
// so a backup of the master secret alone is enough to rediscover every ticket, refund and
// claim from public chain state (see recoverTickets in sale.ts). Wallet keys are never used.
import { hashBytes, fieldToBytes32 } from './hash.js';
import { fromHex, pad32, random32, toHex, randomBytes } from './bytes.js';
import type { CredentialJSON } from './credential.js';

const T = {
  holder: pad32('dusk:m:holder:v1'),
  receipt: pad32('dusk:m:receipt:v1'),
  admin: pad32('dusk:m:admin:v1'),
  platform: pad32('dusk:m:platform:v1'),
};

export const newMasterSecret = () => random32();
export const deriveHolderSecret = (master: Uint8Array) => hashBytes([T.holder, master]);
export const deriveReceiptSecret = (master: Uint8Array, saleId: Uint8Array, index: number | bigint) =>
  hashBytes([T.receipt, master, saleId, fieldToBytes32(BigInt(index))]);
export const deriveAdminSecret = (master: Uint8Array, saleId: Uint8Array) => hashBytes([T.admin, master, saleId]);
export const derivePlatformSecret = (master: Uint8Array) => hashBytes([T.platform, master]);

// ---------------------------------------------------------------------------------------
// Vault: what the browser keeps locally. Only the master secret is irreplaceable; the
// rest is a cache (tickets can be recovered from chain state).

export interface TicketRecord {
  sale: string;          // contract address
  index: number;         // ticket index i (< maxTicketsPerPerson)
  boughtAt: number;      // unix ms
  txHash?: string;
}

export interface OwnedSale { address: string; saleId: string; createdAt: number; role: 'project' }

export interface VaultData {
  v: 1;
  masterSecret: string;  // hex
  createdAt: number;
  credential?: CredentialJSON;
  tickets: TicketRecord[];
  ownedSales: OwnedSale[];
  activity: { at: number; kind: string; sale?: string; txHash?: string; detail?: string }[];
}

export function newVault(): VaultData {
  return { v: 1, masterSecret: toHex(newMasterSecret()), createdAt: Date.now(), tickets: [], ownedSales: [], activity: [] };
}

export const vaultMaster = (v: VaultData) => fromHex(v.masterSecret);

// ---------------------------------------------------------------------------------------
// Encrypted backup: PBKDF2-SHA256 (310k iterations) -> AES-256-GCM, via WebCrypto
// (available in browsers and Node >= 20).

export interface EncryptedBackup {
  format: 'duskpad-backup';
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  ciphertext: string;
  createdAt: string;
}

const ITERATIONS = 310_000;

async function keyFrom(passphrase: string, salt: Uint8Array, iterations: number) {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(data: VaultData, passphrase: string): Promise<EncryptedBackup> {
  if (passphrase.length < 10) throw new Error('Use a passphrase of at least 10 characters');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await keyFrom(passphrase, salt, ITERATIONS);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key,
    new TextEncoder().encode(JSON.stringify(data))));
  return {
    format: 'duskpad-backup', v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toHex(salt) },
    cipher: { name: 'AES-GCM', iv: toHex(iv) },
    ciphertext: toHex(ct),
    createdAt: new Date().toISOString(),
  };
}

export async function decryptBackup(b: EncryptedBackup, passphrase: string): Promise<VaultData> {
  if (b.format !== 'duskpad-backup' || b.v !== 1) throw new Error('Not a DuskPad backup file');
  const key = await keyFrom(passphrase, fromHex(b.kdf.salt), b.kdf.iterations);
  let pt: ArrayBuffer;
  try {
    pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(b.cipher.iv) as BufferSource }, key,
      fromHex(b.ciphertext) as BufferSource);
  } catch {
    throw new Error('Wrong passphrase or corrupted backup');
  }
  const data = JSON.parse(new TextDecoder().decode(pt)) as VaultData;
  if (data.v !== 1 || typeof data.masterSecret !== 'string' || data.masterSecret.length !== 64) throw new Error('Backup is malformed');
  return data;
}
