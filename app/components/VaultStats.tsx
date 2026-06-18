'use client';

import { useEffect, useState } from 'react';

interface VaultState {
  rollCount: string;
  lastNavDusdc: string;
  liveNavDusdc: string;
  lastRollTs: string;
  totalSupply: string;
  navPerShareE9: string;
  ibParkedDusdc: string;
  ibBufferDrawn: string;
}

function dusdcToUsd(raw: string): string {
  const n = Number(raw) / 1_000_000;
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function navPerShare(e9: string): string {
  return (Number(e9) / 1e9).toFixed(6);
}

function timeAgo(tsMs: string): string {
  if (!tsMs || tsMs === '0') return '—';
  const delta = Date.now() - Number(tsMs);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function Skeleton() {
  return (
    <div
      className="rounded-xl p-6 animate-pulse space-y-6"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="h-3 w-1/3 rounded" style={{ background: 'var(--bg-elevated)' }} />
      <div className="grid grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-2 w-1/2 rounded" style={{ background: 'var(--bg-elevated)' }} />
            <div className="h-6 w-3/4 rounded" style={{ background: 'var(--bg-elevated)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function VaultStats() {
  const [data, setData] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/vault/state')
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: VaultState; error?: string }) => {
        if (j.ok && j.data) setData(j.data);
        else setError(j.error ?? 'Failed to load');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton />;

  if (error) {
    return (
      <div
        className="rounded-xl p-6"
        style={{ background: 'var(--bg-panel)', border: '1px solid rgba(239,68,68,0.25)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: 'var(--red)' }}>⚠</span>
          <span className="text-sm font-medium" style={{ color: 'var(--red)' }}>
            Could not reach on-chain state
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {error.includes('config') || error.includes('not')
            ? 'Deploy contracts and set env IDs to see live data.'
            : error}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const metrics = [
    {
      label: 'Total NAV',
      value: dusdcToUsd(data.liveNavDusdc),
      sub: 'dUSDC denominated · live',
      accent: false,
    },
    {
      label: 'rfUSD Supply',
      value: dusdcToUsd(data.totalSupply),
      sub: 'outstanding shares',
      accent: false,
    },
    {
      label: 'rfUSD Price',
      value: navPerShare(data.navPerShareE9),
      sub: 'dUSDC per rfUSD',
      accent: true,
    },
    {
      label: 'Roll Count',
      value: data.rollCount,
      sub: `last ${timeAgo(data.lastRollTs)}`,
      accent: false,
    },
  ];

  const ibCapacity = Math.max(0, Number(data.ibParkedDusdc) - Number(data.ibBufferDrawn));

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2">
          <span className="status-dot status-dot-green" />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Protocol Overview
          </span>
        </div>
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded-full"
          style={{ background: 'var(--teal-dim)', color: 'var(--teal-light)', border: '1px solid var(--teal-border)' }}
        >
          Live
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 divide-x divide-y"
        style={{ '--tw-divide-color': 'var(--border-subtle)' } as React.CSSProperties}>
        {metrics.map(({ label, value, sub, accent }) => (
          <div key={label} className="px-5 py-4">
            <div className="metric-label mb-1.5">{label}</div>
            <div
              className="text-xl font-bold font-data leading-tight mb-0.5"
              style={{ color: accent ? 'var(--teal)' : 'var(--text-primary)' }}
            >
              {value}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Iron Bank buffer bar */}
      <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex justify-between items-center mb-2">
          <div className="metric-label">Instant-exit buffer</div>
          <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {dusdcToUsd(String(ibCapacity))} available
          </div>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              background: 'linear-gradient(90deg, var(--teal), var(--teal-light))',
              width: Number(data.ibParkedDusdc) > 0
                ? `${Math.min(100, (ibCapacity / Number(data.ibParkedDusdc)) * 100).toFixed(1)}%`
                : '0%',
            }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          <span>Buffer drawn: {dusdcToUsd(data.ibBufferDrawn)}</span>
          <span>Parked: {dusdcToUsd(data.ibParkedDusdc)}</span>
        </div>
      </div>
    </div>
  );
}
