// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { Eye, EyeOff } from 'lucide-react';
import { VISIBILITY } from '@duskpad/sdk';

export function VisibilityTable() {
  return (
    <div className="overflow-x-auto rounded-card border-2 border-ink bg-white">
      <table className="w-full text-left text-[14px]">
        <thead>
          <tr className="bg-ink text-white">
            <th className="p-4 label-mono w-[18%]">Transaction</th>
            <th className="p-4 label-mono"><span className="inline-flex items-center gap-2 text-terminal"><Eye size={14} /> Anyone can see</span></th>
            <th className="p-4 label-mono"><span className="inline-flex items-center gap-2 text-primary-fixed"><EyeOff size={14} /> Hidden</span></th>
          </tr>
        </thead>
        <tbody>
          {VISIBILITY.map((v) => (
            <tr key={v.action} className="border-t border-ink/10 align-top">
              <td className="p-4">
                <div className="font-bold">{v.title}</div>
                <code className="font-mono text-[12px] text-on-surface-variant">{v.circuit}</code>
              </td>
              <td className="p-4"><ul className="list-disc pl-4 space-y-1">{v.public.map((x) => <li key={x}>{x}</li>)}</ul></td>
              <td className="p-4">{v.hidden.length ? <ul className="list-disc pl-4 space-y-1">{v.hidden.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="text-on-surface-variant">Nothing to hide</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
