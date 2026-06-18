'use client';

import { useEffect, useState } from 'react';

interface VaultStateResponse {
  ok: boolean;
  data?: {
    rollCount: string;
    lastNavDusdc: string;
    liveNavDusdc: string;
    totalSupply: string;
    navPerShareE9: string;
  };
}

interface Stat {
  label: string;
  value: string;
  unit: string;
  note: string;
}

const STATIC_STATS: Stat[] = [
  { label: 'Base APY',        value: '9.8–13.1', unit: '%', note: 'simulated · 400 expiries' },
  { label: 'Max Drawdown',    value: '2.4',       unit: '%', note: 'sim · 400 expiries' },
  { label: 'LTV Breaches',    value: '0',         unit: '',  note: 'default params' },
];

function fmt(raw: string): string {
  const n = Number(BigInt(raw)) / 1_000_000;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

export function ProtocolStats() {
  const [tvl,  setTvl]  = useState<string>('—');
  const [note, setNote] = useState<string>('loading…');

  useEffect(() => {
    fetch('/api/vault/state')
      .then((r) => r.json())
      .then((j: VaultStateResponse) => {
        const nav = j.ok && j.data?.liveNavDusdc ? BigInt(j.data.liveNavDusdc) : 0n;
        if (nav > 0n) {
          setTvl(fmt(j.data!.liveNavDusdc));
          setNote('live · testnet');
        } else {
          setTvl('—');
          setNote('testnet · be first');
        }
      })
      .catch(() => { setNote('testnet'); });
  }, []);

  const allStats: Stat[] = [
    { label: 'Total Value Locked', value: tvl, unit: tvl !== '—' ? ' USDC' : '', note },
    ...STATIC_STATS,
  ];

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {allStats.map(({ label, value, unit, note }) => (
        <div
          key={label}
          className="card text-center space-y-1"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          <div className="metric-label">{label}</div>
          <div className="text-2xl font-bold font-data" style={{ color: 'var(--teal)' }}>
            {value}<span className="text-lg">{unit}</span>
          </div>
          <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{note}</div>
        </div>
      ))}
    </section>
  );
}
