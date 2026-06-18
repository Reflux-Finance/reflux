'use client';

import { useEffect, useState, useCallback } from 'react';

interface RiskData {
  allocation: {
    plpBps: string;
    rangeBps: string;
    marginLoopBps: string;
    ibIdleBps: string;
  };
  iv: {
    atmIvE4: string;
    atmIvPct: number;
    regime: 'low' | 'neutral' | 'high';
    ivLowThreshold: string;
    ivHighThreshold: string;
    nextOracleId: string | null;
    nextExpiryTs: number | null;
  };
  risk: { maxLtvBps: string; maxBufferDrawBps: string };
  ib: { parkedDusdc: string; bufferDrawn: string; venueTag: number };
}

const REGIME_CONFIG = {
  low:     { label: 'Low IV',  className: 'regime-low',     narrative: 'Premia thin — capital shifted toward PLP and idle yield.' },
  neutral: { label: 'Neutral', className: 'regime-neutral', narrative: 'Vol regime neutral — holding base policy weights.' },
  high:    { label: 'High IV', className: 'regime-high',    narrative: 'Premia rich relative to implied crash risk — increased range exposure.' },
} as const;

const SLEEVES = [
  { key: 'plpBps',         label: 'PLP supply',     color: '#00D4C8' },
  { key: 'rangeBps',       label: 'Range strips',   color: '#F5A623' },
  { key: 'marginLoopBps',  label: 'Margin loop',    color: '#3B82F6' },
  { key: 'ibIdleBps',      label: 'Iron Bank idle', color: '#6B7280' },
] as const;

function bpsToPct(s: string): number { return Number(s) / 100; }
function dusdcFmt(s: string): string {
  const n = Number(s) / 1_000_000;
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}
function expiryCountdown(ts: number): string {
  const delta = ts - Date.now();
  if (delta <= 0) return 'Settling…';
  const h = Math.floor(delta / 3_600_000);
  const m = Math.floor((delta % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function AllocationBar({ data }: { data: RiskData['allocation'] }) {
  const total = SLEEVES.reduce((s, sl) => s + Number(data[sl.key as keyof typeof data]), 0) || 10_000;
  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {SLEEVES.map((sl) => {
          const pct = (Number(data[sl.key as keyof typeof data]) / total) * 100;
          return (
            <div
              key={sl.key}
              style={{ width: `${pct}%`, background: sl.color, borderRadius: '2px', opacity: 0.85 }}
              title={`${sl.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      {/* Legend rows */}
      <div className="space-y-2">
        {SLEEVES.map((sl) => {
          const pct = bpsToPct(data[sl.key as keyof typeof data]);
          return (
            <div key={sl.key} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: sl.color }} />
              <div className="flex-1 flex justify-between">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{sl.label}</span>
                <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IVGauge({ atmPct, lowPct, highPct }: { atmPct: number; lowPct: number; highPct: number }) {
  /* Simple horizontal IV bar: 0–100% scale with threshold markers */
  const cap = 100;
  const pos  = Math.min(cap, atmPct);
  const posL = Math.min(cap, lowPct);
  const posH = Math.min(cap, highPct);

  return (
    <div className="relative h-4 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
      {/* Low-vol zone (0→lowPct) */}
      <div
        className="absolute left-0 top-0 h-full opacity-30"
        style={{ width: `${posL}%`, background: '#3B82F6' }}
      />
      {/* Neutral zone (lowPct→highPct) */}
      <div
        className="absolute top-0 h-full opacity-20"
        style={{ left: `${posL}%`, width: `${posH - posL}%`, background: '#8B98A8' }}
      />
      {/* High-vol zone (highPct→cap) */}
      <div
        className="absolute top-0 right-0 h-full opacity-30"
        style={{ width: `${cap - posH}%`, background: '#F5A623' }}
      />
      {/* ATM IV needle */}
      <div
        className="absolute top-0 bottom-0 w-0.5 rounded-full"
        style={{ left: `${pos}%`, background: 'var(--teal)', boxShadow: '0 0 6px var(--teal)' }}
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl h-48 animate-pulse"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}
        />
      ))}
    </div>
  );
}

export function RiskDashboard() {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/risk')
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: RiskData; error?: string }) => {
        if (j.ok && j.data) setData(j.data);
        else setError(j.error ?? 'Error');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <Skeleton />;

  if (error || !data) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{ background: 'var(--bg-panel)', border: '1px solid rgba(239,68,68,0.2)' }}
      >
        <div className="text-2xl mb-3">📡</div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Risk data unavailable
        </p>
        <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
          {error?.includes('config') || error?.includes('not')
            ? 'Deploy contracts and set env IDs to see live data.'
            : (error ?? '')}
        </p>
        <button
          onClick={load}
          className="text-xs btn-ghost px-4 py-2"
        >
          Retry
        </button>
      </div>
    );
  }

  const regime = REGIME_CONFIG[data.iv.regime];
  const atmPct  = data.iv.atmIvPct;
  const lowPct  = bpsToPct(data.iv.ivLowThreshold);
  const highPct = bpsToPct(data.iv.ivHighThreshold);
  const ibTotal = Number(data.ib.parkedDusdc);
  const ibFree  = Math.max(0, ibTotal - Number(data.ib.bufferDrawn));

  return (
    <div className="space-y-4">
      {/* ── Row 1: IV + Allocation ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* IV & Regime */}
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Volatility Regime
            </span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${regime.className}`}>
              {regime.label}
            </span>
          </div>

          {/* ATM IV hero */}
          <div>
            <div className="metric-label mb-1">ATM Implied Volatility</div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold font-data" style={{ color: 'var(--teal)' }}>
                {atmPct.toFixed(1)}%
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>annualized</span>
            </div>
          </div>

          {/* Gauge */}
          <div className="space-y-1.5">
            <IVGauge atmPct={atmPct} lowPct={lowPct} highPct={highPct} />
            <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              <span>0%</span>
              <span style={{ color: '#93C5FD' }}>low {lowPct.toFixed(0)}%</span>
              <span style={{ color: '#FCD34D' }}>high {highPct.toFixed(0)}%</span>
              <span>100%</span>
            </div>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {regime.narrative}
          </p>

          {data.iv.nextExpiryTs && (
            <div
              className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <span style={{ color: 'var(--text-muted)' }}>Next expiry</span>
              <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>
                {expiryCountdown(data.iv.nextExpiryTs)}
              </span>
            </div>
          )}
        </div>

        {/* Allocation weights */}
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Allocation Weights
            </span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              current targets
            </span>
          </div>
          <AllocationBar data={data.allocation} />
        </div>
      </div>

      {/* ── Row 2: Risk params + Iron Bank + Safety ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Risk params */}
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Risk Parameters
          </span>
          <div className="space-y-3">
            {[
              { label: 'Max LTV', value: bpsToPct(data.risk.maxLtvBps).toFixed(0) + '%', sub: 'on-chain enforced' },
              { label: 'Max buffer draw', value: bpsToPct(data.risk.maxBufferDrawBps).toFixed(0) + '%', sub: 'of NAV' },
              { label: 'Oracle staleness', value: '15 min', sub: 'max SVI age' },
            ].map(({ label, value, sub }) => (
              <div
                key={label}
                className="flex items-center justify-between py-2"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sub}</div>
                </div>
                <span className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Iron Bank / buffer */}
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Instant-exit buffer
            </span>
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full"
              style={{
                background: ibFree > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: ibFree > 0 ? 'var(--green)' : 'var(--red)',
                border: `1px solid ${ibFree > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
              }}
            >
              {ibFree > 0 ? 'Available' : 'Depleted'}
            </span>
          </div>

          <div>
            <div className="metric-label mb-1">Free capacity</div>
            <div className="text-2xl font-bold font-data" style={{ color: ibFree > 0 ? 'var(--green)' : 'var(--red)' }}>
              {dusdcFmt(String(ibFree))}
            </div>
          </div>

          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: ibTotal > 0 ? `${Math.min(100, (ibFree / ibTotal) * 100)}%` : '0%',
                background: 'linear-gradient(90deg, var(--green), var(--teal))',
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="metric-label">Parked</div>
              <div className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                {dusdcFmt(data.ib.parkedDusdc)}
              </div>
            </div>
            <div>
              <div className="metric-label">Drawn</div>
              <div className="font-mono font-semibold" style={{ color: Number(data.ib.bufferDrawn) > 0 ? 'var(--amber)' : 'var(--text-primary)' }}>
                {dusdcFmt(data.ib.bufferDrawn)}
              </div>
            </div>
          </div>
        </div>

        {/* Safety valves */}
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Safety Valves
          </span>
          <div className="space-y-2.5">
            {[
              'Withdrawals always open — pause-immune',
              'Emergency deleverage callable by anyone',
              'Hard caps cannot be exceeded by admin',
              'Slippage protection on every swap',
              'Max staleness check on every oracle read',
            ].map((s) => (
              <div key={s} className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex-shrink-0 text-xs font-bold"
                  style={{ color: 'var(--green)' }}
                >
                  ✓
                </span>
                <span className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {s}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
