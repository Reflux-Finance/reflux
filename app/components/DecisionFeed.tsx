'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── Demo data (shown when no on-chain AllocationDecision events exist yet) ──
// Replaced automatically once the keeper fires the first vault::roll_demo tx.
const DEMO_DECISIONS: Decision[] = [
  {
    id: 'demo:0',
    txDigest: 'awaiting-first-roll',
    timestampMs: null,
    parsedJson: {
      roll_id: 0,
      regime: 0,
      reason_code: 0,
      atm_iv_e4: 4500,
      iv_low_thresh_e4: 3000,
      iv_high_thresh_e4: 6000,
      plp_bps_before: 3000, range_bps_before: 4000, ml_bps_before: 2000, ib_bps_before: 1000,
      plp_bps_after:  3000, range_bps_after:  4000, ml_bps_after:  2000, ib_bps_after:  1000,
    },
  },
  {
    id: 'demo:1',
    txDigest: 'awaiting-first-roll',
    timestampMs: String(Date.now() - 8 * 60_000),
    parsedJson: {
      roll_id: 1,
      regime: 1,
      reason_code: 1,
      atm_iv_e4: 2700,
      iv_low_thresh_e4: 3000,
      iv_high_thresh_e4: 6000,
      plp_bps_before: 3000, range_bps_before: 4000, ml_bps_before: 2000, ib_bps_before: 1000,
      plp_bps_after:  4500, range_bps_after:  2500, ml_bps_after:  2000, ib_bps_after:  1000,
    },
  },
  {
    id: 'demo:2',
    txDigest: 'awaiting-first-roll',
    timestampMs: String(Date.now() - 20 * 60_000),
    parsedJson: {
      roll_id: 2,
      regime: 2,
      reason_code: 2,
      atm_iv_e4: 6800,
      iv_low_thresh_e4: 3000,
      iv_high_thresh_e4: 6000,
      plp_bps_before: 3000, range_bps_before: 4000, ml_bps_before: 2000, ib_bps_before: 1000,
      plp_bps_after:  2000, range_bps_after:  5000, ml_bps_after:  2000, ib_bps_after:  1000,
    },
  },
];

interface Decision {
  id: string;
  txDigest: string;
  timestampMs: string | null;
  parsedJson: unknown;
}

interface ParsedDecision {
  roll_id?: string | number;
  regime?: string | number;
  reason_code?: string | number;
  atm_iv_e4?: string | number;
  iv_low_thresh_e4?: string | number;
  iv_high_thresh_e4?: string | number;
  // Per-sleeve weights (before / after allocation)
  plp_bps_before?: string | number;
  range_bps_before?: string | number;
  ml_bps_before?: string | number;
  ib_bps_before?: string | number;
  plp_bps_after?: string | number;
  range_bps_after?: string | number;
  ml_bps_after?: string | number;
  ib_bps_after?: string | number;
}

const REGIME_META: Record<string, { label: string; className: string }> = {
  '0': { label: 'Neutral',  className: 'regime-neutral' },
  '1': { label: 'Low IV',   className: 'regime-low'     },
  '2': { label: 'High IV',  className: 'regime-high'    },
};

const REASON_TEXT: Record<string, string> = {
  '0': 'IV in band — holding base policy weights',
  '1': 'IV below threshold — premia too thin; shifted toward PLP + idle yield',
  '2': 'IV above threshold — premia rich relative to crash risk; increased range exposure',
  '3': 'Per-expiry exposure cap reached — overflow parked in Iron Bank',
  '4': 'Withdrawal buffer below floor — refilled before deploying',
};

const SLEEVE_LABELS = ['PLP', 'Range', 'Margin', 'IB'];
const SLEEVE_COLORS = ['#00D4C8', '#F5A623', '#3B82F6', '#8B98A8'];

function bps(s: string | undefined): number { return Number(s ?? 0); }
function relTime(ms: string | null): string {
  if (!ms) return '—';
  const delta = Date.now() - Number(ms);
  const m = Math.floor(delta / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function WeightBar({ values, colors }: { values: number[]; colors: string[] }) {
  const total = values.reduce((a, b) => a + b, 0) || 10_000;
  return (
    <div className="flex h-2 rounded overflow-hidden gap-px">
      {values.map((v, i) => (
        <div
          key={i}
          style={{ width: `${(v / total) * 100}%`, background: colors[i], opacity: 0.85 }}
        />
      ))}
    </div>
  );
}

function DecisionCard({ d, isDemo }: { d: Decision; isDemo?: boolean }) {
  const json = d.parsedJson as ParsedDecision;
  // regime comes as number or "0.0"-style string from the chain
  const regimeKey = String(Math.round(Number(json.regime ?? 0)));
  const regime = REGIME_META[regimeKey] ?? REGIME_META['0'];
  const reasonKey = String(json.reason_code ?? '0');
  const reason = REASON_TEXT[reasonKey] ?? 'Unknown';

  const weightsBefore = [
    bps(String(json.plp_bps_before ?? 0)),
    bps(String(json.range_bps_before ?? 0)),
    bps(String(json.ml_bps_before ?? 0)),
    bps(String(json.ib_bps_before ?? 0)),
  ];
  const weightsAfter = [
    bps(String(json.plp_bps_after ?? 0)),
    bps(String(json.range_bps_after ?? 0)),
    bps(String(json.ml_bps_after ?? 0)),
    bps(String(json.ib_bps_after ?? 0)),
  ];

  const atmIvPct = Number(json.atm_iv_e4 ?? 0) / 100;
  const lowPct   = Number(json.iv_low_thresh_e4 ?? 3000) / 100;
  const highPct  = Number(json.iv_high_thresh_e4 ?? 6000) / 100;

  return (
    <div
      className="rounded-xl p-4 space-y-3 card-interactive"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-mono font-semibold"
            style={{ color: 'var(--text-muted)' }}
          >
            Roll #{json.roll_id ?? '—'}
          </span>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${regime.className}`}
          >
            {regime.label}
          </span>
        </div>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {relTime(d.timestampMs)}
        </span>
      </div>

      {/* IV trigger */}
      <div
        className="rounded-lg px-3 py-2.5 text-sm font-mono space-y-1"
        style={{ background: 'var(--bg-panel)' }}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ color: 'var(--text-secondary)' }}>ATM IV</span>
          <span className="font-semibold" style={{ color: 'var(--teal)' }}>{atmIvPct.toFixed(1)}%</span>
          {atmIvPct > highPct ? (
            <>
              <span style={{ color: 'var(--text-muted)' }}>&gt; threshold</span>
              <span style={{ color: 'var(--amber)' }}>{highPct.toFixed(1)}%</span>
            </>
          ) : atmIvPct < lowPct ? (
            <>
              <span style={{ color: 'var(--text-muted)' }}>&lt; threshold</span>
              <span style={{ color: '#93C5FD' }}>{lowPct.toFixed(1)}%</span>
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>in band [{lowPct.toFixed(1)}–{highPct.toFixed(1)}%]</span>
          )}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {reason}
        </p>
      </div>

      {/* Before / after weight bars */}
      <div className="space-y-2">
        <div>
          <div className="metric-label mb-1">Before</div>
          <WeightBar values={weightsBefore} colors={SLEEVE_COLORS} />
        </div>
        <div>
          <div className="metric-label mb-1">After</div>
          <WeightBar values={weightsAfter} colors={SLEEVE_COLORS} />
        </div>
        <div className="flex gap-3 flex-wrap pt-0.5">
          {SLEEVE_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ background: SLEEVE_COLORS[i] }} />
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {label} {(weightsAfter[i] / 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Explorer link or demo badge */}
      {isDemo ? (
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded"
          style={{ background: 'rgba(245,166,35,0.08)', color: 'var(--amber)', border: '1px solid rgba(245,166,35,0.2)' }}
        >
          Preview — awaiting first live roll
        </span>
      ) : (
        <a
          href={`https://suiexplorer.com/txblock/${d.txDigest}?network=testnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--teal)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <span>View on-chain event</span>
          <span>↗</span>
        </a>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 h-32 animate-pulse"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
        />
      ))}
    </div>
  );
}

export function DecisionFeed({ limit = 8 }: { limit?: number }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/engine/decisions?limit=${limit}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { decisions: Decision[] }; error?: string }) => {
        if (j.ok && j.data) setDecisions(j.data.decisions);
        else setError(j.error ?? 'Unknown error');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

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
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Allocation Decisions
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Every keeper roll · on-chain · verified
          </div>
        </div>
        <button
          onClick={load}
          className="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
          style={{
            color: 'var(--text-muted)',
            border: '1px solid var(--border-subtle)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          Refresh
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3 max-h-[640px] overflow-y-auto">
        {loading && <Skeleton />}

        {!loading && error && (
          <div className="text-center py-8">
            <div className="text-2xl mb-3">📡</div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              No live data yet
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Decision feed populates after the first keeper roll on testnet.
            </p>
          </div>
        )}

        {!loading && !error && decisions.length === 0 && (
          <>
            <div
              className="rounded-lg px-3 py-2 mb-2 text-[10px] font-mono flex items-center gap-2"
              style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.2)', color: 'var(--amber)' }}
            >
              ⏳ Preview — live cards appear after the first keeper roll on testnet
            </div>
            {DEMO_DECISIONS.map((d) => (
              <DecisionCard key={d.id} d={d} isDemo />
            ))}
          </>
        )}

        {decisions.map((d) => (
          <DecisionCard key={d.id} d={d} />
        ))}
      </div>
    </div>
  );
}
