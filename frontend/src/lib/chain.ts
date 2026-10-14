// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Browser-side transaction recipes. Each one: derive private inputs locally, call the SDK, and
// report real pipeline stages to the stepper. Shared by the sale, dashboard and platform pages.
import {
  callSale, callTusd, credentialFromJSON, deriveAdminSecret, deriveHolderSecret, derivePlatformSecret, deriveReceiptSecret,
  fromHex, nextTicketIndex, paymentCoin, readSaleLedger, type CoinView, type Stage, type TxResult,
} from '@duskpad/sdk';
import type { CredentialJSON } from '@duskpad/sdk';
import type { Session } from '../state/WalletContext';

type Mark = (id: string) => void;
type On = (s: Stage) => void;
const zk = { sale: '/zk/sale', tusd: '/zk/tusd' };

export async function buyTicket(session: Session, address: string, master: Uint8Array, cred: CredentialJSON, onStage: On, markLocal: Mark) {
  const providers = await session.providers('sale');
  const credential = credentialFromJSON(cred);
  const holderSecret = deriveHolderSecret(master);
  markLocal('vault');
  const L = await readSaleLedger(providers.publicDataProvider, address);
  if (!L) throw new Error('Sale contract not found');
  const idx = nextTicketIndex(L, master);
  if (idx === null) throw new Error('You already hold the maximum number of tickets for this sale.');
  markLocal('slot');
  const r = await callSale(providers, address, {
    credential, holderSecret, ticketIndex: BigInt(idx), receiptSecret: deriveReceiptSecret(master, L.config.saleId, idx),
  }, 'buyTicket', [paymentCoin(L.config.payColor, L.config.ticketPrice)], { onStage, assetsPath: zk.sale });
  return { ...r, index: idx };
}

export async function refundTicket(session: Session, address: string, master: Uint8Array, index: number, coin: CoinView, onStage: On, markLocal: Mark) {
  const providers = await session.providers('sale');
  const L = await readSaleLedger(providers.publicDataProvider, address);
  if (!L) throw new Error('Sale contract not found');
  const receiptSecret = deriveReceiptSecret(master, L.config.saleId, index);
  markLocal('vault');
  return callSale(providers, address, { receiptSecret }, 'refund', [coin.raw], { onStage, assetsPath: zk.sale });
}

export async function claimTranche(session: Session, address: string, master: Uint8Array, index: number, tranche: number, onStage: On, markLocal: Mark) {
  const providers = await session.providers('sale');
  const L = await readSaleLedger(providers.publicDataProvider, address);
  if (!L) throw new Error('Sale contract not found');
  const receiptSecret = deriveReceiptSecret(master, L.config.saleId, index);
  markLocal('vault');
  return callSale(providers, address, { receiptSecret }, 'claim', [BigInt(tranche)], { onStage, assetsPath: zk.sale });
}

export interface Payout { coinPublicKey: string; encryptionPublicKey: string }

export async function withdrawCoin(session: Session, address: string, master: Uint8Array, saleId: string, coin: CoinView, to: Payout, onStage: On, markLocal: Mark) {
  const providers = await session.providers('sale');
  const adminSecret = deriveAdminSecret(master, fromHex(saleId));
  markLocal('vault');
  return callSale(providers, address, { adminSecret }, 'withdraw', [coin.raw, { bytes: fromHex(to.coinPublicKey) }], {
    onStage, assetsPath: zk.sale, coinKeyMappings: new Map([[to.coinPublicKey, to.encryptionPublicKey]]),
  });
}

export async function collectFeeCoin(session: Session, address: string, platformMaster: Uint8Array, coin: CoinView, to: Payout, onStage: On, markLocal: Mark) {
  const providers = await session.providers('sale');
  const adminSecret = derivePlatformSecret(platformMaster);
  markLocal('vault');
  return callSale(providers, address, { adminSecret }, 'collectFee', [coin.raw, { bytes: fromHex(to.coinPublicKey) }], {
    onStage, assetsPath: zk.sale, coinKeyMappings: new Map([[to.coinPublicKey, to.encryptionPublicKey]]),
  });
}

export async function finalizeSale(session: Session, address: string, onStage: On): Promise<TxResult> {
  const providers = await session.providers('sale');
  return callSale(providers, address, {}, 'finalize', [], { onStage, assetsPath: zk.sale });
}

export async function mintTusd(session: Session, tusdAddress: string, amount: bigint, onStage: On): Promise<TxResult> {
  const providers = await session.providers('tusd');
  return callTusd(providers, tusdAddress, 'mint', [amount], { onStage, assetsPath: zk.tusd });
}

export const ownPayout = (s: Session): Payout => ({ coinPublicKey: s.coinPublicKey, encryptionPublicKey: s.encryptionPublicKey });
