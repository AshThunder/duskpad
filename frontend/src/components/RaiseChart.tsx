// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// Tickets sold over time, read from public indexer activity, against the soft and hard caps.
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ActivityItem } from '@duskpad/sdk';

export function RaiseChart({ activity, softCap, hardCap, start, end }: { activity: ActivityItem[]; softCap: number; hardCap: number; start: number; end: number }) {
  const buys = activity.filter((a) => a.entryPoint === 'buyTicket' && a.status !== 'FAILURE').sort((a, b) => a.timestamp - b.timestamp);
  const pts: { t: number; sold: number }[] = [{ t: start * 1000, sold: 0 }];
  buys.forEach((b, i) => pts.push({ t: b.timestamp, sold: i + 1 }));
  pts.push({ t: Math.min(Date.now(), end * 1000), sold: buys.length });
  const fmt = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer>
        <AreaChart data={pts} margin={{ top: 16, right: 16, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9a5fb0" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#e7a24b" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1c1c1e14" />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmt} tick={{ fontFamily: 'Space Mono', fontSize: 11 }} />
          <YAxis allowDecimals={false} domain={[0, hardCap]} tick={{ fontFamily: 'Space Mono', fontSize: 11 }} />
          <Tooltip labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={(v) => [`${v} tickets`, 'Sold']} />
          {softCap > 0 && <ReferenceLine y={softCap} stroke="#765b00" strokeDasharray="6 4" label={{ value: 'SOFT CAP', position: 'insideTopLeft', fontSize: 11, fill: '#765b00', fontFamily: 'Space Mono' }} />}
          <ReferenceLine y={hardCap} stroke="#1c1c1e" strokeDasharray="2 4" label={{ value: 'HARD CAP', position: 'insideTopLeft', fontSize: 11, fontFamily: 'Space Mono' }} />
          <Area type="stepAfter" dataKey="sold" stroke="#4f378a" strokeWidth={2.5} fill="url(#dusk)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
