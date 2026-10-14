// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// The private vault: one master secret per profile, linked to the wallets that use it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { decryptBackup, encryptBackup, fromHex, newVault, type EncryptedBackup, type VaultData } from '@duskpad/sdk';
import { ACTIVE_KEY, deleteVault, listProfiles, loadVault, saveVault, type Profile } from '../lib/vaultStore';
import { useWallet } from './WalletContext';

interface VaultState {
  ready: boolean;
  profiles: Profile[];
  profile: Profile | null;
  data: VaultData | null;
  master: Uint8Array | null;
  select: (id: string) => Promise<void>;
  create: (label: string, link?: string) => Promise<void>;
  update: (fn: (d: VaultData) => VaultData) => Promise<void>;
  exportBackup: (passphrase: string) => Promise<EncryptedBackup>;
  importBackup: (b: EncryptedBackup, passphrase: string, label: string) => Promise<void>;
  linkToWallet: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const Ctx = createContext<VaultState | null>(null);
const uid = () => crypto.randomUUID();

export function VaultProvider({ children }: { children: ReactNode }) {
  const { session } = useWallet();
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<VaultData | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const dataRef = useRef<VaultData | null>(null);

  const refresh = useCallback(async () => setProfiles(await listProfiles()), []);

  const select = useCallback(async (id: string) => {
    const ps = await listProfiles();
    const p = ps.find((x) => x.id === id) ?? null;
    const d = p ? await loadVault(p.id) : null;
    profileRef.current = p; dataRef.current = d;
    setProfile(p); setData(d); setProfiles(ps);
    if (p) localStorage.setItem(ACTIVE_KEY, p.id);
  }, []);

  const create = useCallback(async (label: string, link?: string) => {
    const p: Profile = { id: uid(), label, createdAt: Date.now(), linked: link ? [link] : [] };
    await saveVault(p, newVault());
    await select(p.id);
  }, [select]);

  useEffect(() => {
    (async () => {
      const ps = await listProfiles();
      setProfiles(ps);
      const last = localStorage.getItem(ACTIVE_KEY);
      if (last && ps.some((p) => p.id === last)) await select(last);
      setReady(true);
    })();
  }, [select]);

  // On wallet connect: use the vault linked to this wallet, or create one for it.
  useEffect(() => {
    if (!ready || !session) return;
    (async () => {
      const ps = await listProfiles();
      const linked = ps.find((p) => p.linked.includes(session.shieldedAddress));
      if (linked) { if (linked.id !== profileRef.current?.id) await select(linked.id); return; }
      await create(`${session.option.name} vault`, session.shieldedAddress);
    })();
  }, [ready, session, select, create]);

  const update = useCallback(async (fn: (d: VaultData) => VaultData) => {
    const p = profileRef.current, d = dataRef.current;
    if (!p || !d) throw new Error('No vault selected');
    const next = fn(structuredClone(d));
    await saveVault(p, next);
    dataRef.current = next;
    setData(next);
  }, []);

  const exportBackup = useCallback(async (pass: string) => {
    if (!dataRef.current) throw new Error('No vault selected');
    return encryptBackup(dataRef.current, pass);
  }, []);

  const importBackup = useCallback(async (b: EncryptedBackup, pass: string, label: string) => {
    const d = await decryptBackup(b, pass);
    const p: Profile = { id: uid(), label, createdAt: Date.now(), linked: session ? [session.shieldedAddress] : [] };
    // A wallet may be linked to only one vault: unlink it elsewhere.
    for (const other of await listProfiles()) {
      if (session && other.linked.includes(session.shieldedAddress)) {
        const od = await loadVault(other.id);
        if (od) await saveVault({ ...other, linked: other.linked.filter((x) => x !== session.shieldedAddress) }, od);
      }
    }
    await saveVault(p, d);
    await select(p.id);
  }, [session, select]);

  const linkToWallet = useCallback(async () => {
    const p = profileRef.current, d = dataRef.current;
    if (!p || !d || !session) return;
    for (const other of await listProfiles()) {
      if (other.id !== p.id && other.linked.includes(session.shieldedAddress)) {
        const od = await loadVault(other.id);
        if (od) await saveVault({ ...other, linked: other.linked.filter((x) => x !== session.shieldedAddress) }, od);
      }
    }
    const np = { ...p, linked: [...new Set([...p.linked, session.shieldedAddress])] };
    await saveVault(np, d);
    profileRef.current = np; setProfile(np);
    await refresh();
  }, [session, refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteVault(id);
    if (profileRef.current?.id === id) {
      profileRef.current = null; dataRef.current = null; setProfile(null); setData(null);
      localStorage.removeItem(ACTIVE_KEY);
    }
    await refresh();
  }, [refresh]);

  const master = useMemo(() => (data ? fromHex(data.masterSecret) : null), [data]);

  return (
    <Ctx.Provider value={{ ready, profiles, profile, data, master, select, create, update, exportBackup, importBackup, linkToWallet, remove }}>
      {children}
    </Ctx.Provider>
  );
}

export function useVault() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useVault outside VaultProvider');
  return c;
}
