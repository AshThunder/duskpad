// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog, Hex } from './ui';

export function OutcomeModal({ open, onClose, title, txHash, children }: { open: boolean; onClose: () => void; title: string; txHash?: string; children?: ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} label={title}>
      <div className="bg-white rounded-card border-2 border-ink overflow-hidden">
        <div className="dusk-gradient p-8 text-white">
          <CheckCircle2 size={40} />
          <h2 className="font-display text-[30px] font-bold mt-3">{title}</h2>
          {txHash && <div className="mt-2 text-white/85 text-[13px] flex items-center gap-2">Transaction <Hex value={txHash} className="!text-white" /></div>}
        </div>
        <div className="p-7 space-y-4">{children}</div>
        <div className="px-7 pb-7 flex justify-end"><button className="btn-dark" onClick={onClose} data-testid="outcome-close">Done</button></div>
      </div>
    </Dialog>
  );
}
