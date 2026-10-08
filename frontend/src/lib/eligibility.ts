// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Local pre-check of the same rules buyTicket enforces in-circuit. Purely a UX courtesy: the
// circuit is the authority, and this check never leaves the browser.
import { countryName, deriveHolderSecret, holderCommitment, type CredentialJSON, type SaleView } from '@duskpad/sdk';

export interface Check { id: string; label: string; ok: boolean; detail?: string }

export function eligibility(cred: CredentialJSON | undefined, view: SaleView, master: Uint8Array | null, nowS: number): { ok: boolean; checks: Check[] } {
  if (!cred || !master) return { ok: false, checks: [{ id: 'cred', label: 'Credential in your vault', ok: false, detail: 'Get a credential first.' }] };
  const issuerOk = BigInt(cred.issuerPk.x) === view.issuerPk.x && BigInt(cred.issuerPk.y) === view.issuerPk.y;
  const bound = BigInt(cred.attrs.holderCommit) === holderCommitment(deriveHolderSecret(master));
  const checks: Check[] = [
    { id: 'issuer', label: 'Signed by this sale\'s issuer', ok: issuerOk, detail: issuerOk ? undefined : 'The credential comes from a different issuer key.' },
    { id: 'bound', label: 'Bound to your vault', ok: bound, detail: bound ? undefined : 'Issued to another vault: get a new credential for this one.' },
    { id: 'country', label: 'Region allowed', ok: !view.blockedCountries.includes(cred.attrs.country), detail: view.blockedCountries.includes(cred.attrs.country) ? `${countryName(cred.attrs.country)} is blocked for this sale.` : undefined },
    { id: 'kyc', label: `KYC level ≥ ${view.minKyc}`, ok: cred.attrs.kycLevel >= view.minKyc, detail: cred.attrs.kycLevel >= view.minKyc ? undefined : `Your credential is level ${cred.attrs.kycLevel}.` },
    { id: 'expiry', label: 'Credential not expired', ok: cred.attrs.expiry > nowS, detail: cred.attrs.expiry > nowS ? undefined : 'Renew your credential.' },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
