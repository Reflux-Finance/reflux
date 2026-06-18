'use client';

import { useEffect, useState } from 'react';

interface SurfaceData {
  oracleId: string;
  expiryTs: number;
  svi: { a: number; b: number; rho: number; m: number; sigma: number };
  atmIvE4: string;
  atmIvPct: number;
}

/* Compute approximate SVI smile at a log-moneyness grid */
function computeSmile(svi: SurfaceData['svi'], points = 20): { x: number; y: number }[] {
  const xs = Array.from({ length: points }, (_, i) => -0.5 + (i / (points - 1)));
  return xs.map((k) => {
    const { a, b, rho, m, sigma } = svi;
    const w = a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sigma ** 2));
    return { x: k, y: Math.max(0, Math.sqrt(Math.abs(w)) * 100) };
  });
}

/* Map smile points to SVG coordinates */
function smileToPath(points: { x: number; y: number }[], W: number, H: number): string {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = Math.max(...ys, 1);
  const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * W;
  const sy = (y: number) => H - ((y - yMin) / (yMax - yMin)) * H * 0.9;
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
}

const SVI_PARAMS: { key: keyof SurfaceData['svi']; label: string; desc: string }[] = [
  { key: 'a',     label: 'a',     desc: 'Level' },
  { key: 'b',     label: 'b',     desc: 'Slope' },
  { key: 'rho',   label: 'ρ',     desc: 'Skew' },
  { key: 'm',     label: 'm',     desc: 'Center' },
  { key: 'sigma', label: 'σ',     desc: 'Smile' },
];

function Skeleton() {
  return (
    <div
      className="rounded-xl animate-pulse"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', height: 360 }}
    />
  );
}

export function StrategySurface() {
  const [data, setData] = useState<SurfaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/engine/surface')
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: SurfaceData; error?: string }) => {
        if (j.ok && j.data) setData(j.data);
        else setError(j.error ?? 'Error');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton />;

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
            SVI Volatility Surface
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Stochastic Volatility Inspired · live from DeepBook Predict indexer
          </div>
        </div>
        {data && (
          <div
            className="text-right"
          >
            <div className="metric-label">ATM IV</div>
            <div className="text-xl font-bold font-data" style={{ color: 'var(--teal)' }}>
              {data.atmIvPct.toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        {error && !data && (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">📉</div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              No active oracle
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Surface data populates once an oracle is live on testnet.
            </p>
          </div>
        )}

        {data && (
          <>
            {/* Vol smile chart */}
            <div>
              <div className="metric-label mb-2">Implied vol smile (log-moneyness)</div>
              <div
                className="rounded-lg overflow-hidden"
                style={{ background: 'var(--bg-elevated)', padding: '12px' }}
              >
                {(() => {
                  const W = 400, H = 120;
                  const pts = computeSmile(data.svi);
                  const path = smileToPath(pts, W, H);
                  const atmX = W / 2;
                  return (
                    <svg
                      viewBox={`0 0 ${W} ${H}`}
                      className="w-full"
                      style={{ height: 120 }}
                      aria-label="Volatility smile curve"
                    >
                      {/* Grid lines */}
                      {[0.25, 0.5, 0.75].map((r) => (
                        <line
                          key={r}
                          x1={0} y1={H * r} x2={W} y2={H * r}
                          stroke="rgba(255,255,255,0.04)" strokeWidth="1"
                        />
                      ))}
                      {/* ATM marker */}
                      <line
                        x1={atmX} y1={0} x2={atmX} y2={H}
                        stroke="rgba(0,212,200,0.2)" strokeWidth="1" strokeDasharray="4 4"
                      />
                      {/* Smile curve gradient fill */}
                      <defs>
                        <linearGradient id="smileGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00D4C8" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#00D4C8" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <path
                        d={path + ` L ${W} ${H} L 0 ${H} Z`}
                        fill="url(#smileGrad)"
                      />
                      {/* Smile curve line */}
                      <path
                        d={path}
                        fill="none"
                        stroke="#00D4C8"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* ATM dot */}
                      <circle cx={atmX} cy={H / 2} r="3" fill="#00D4C8" />
                      {/* X-axis labels */}
                      <text x="4" y={H - 4} fill="rgba(139,152,168,0.6)" fontSize="9" fontFamily="monospace">OTM put</text>
                      <text x={atmX - 14} y={H - 4} fill="rgba(0,212,200,0.6)" fontSize="9" fontFamily="monospace">ATM</text>
                      <text x={W - 44} y={H - 4} fill="rgba(139,152,168,0.6)" fontSize="9" fontFamily="monospace">OTM call</text>
                    </svg>
                  );
                })()}
              </div>
            </div>

            {/* SVI params grid */}
            <div>
              <div className="metric-label mb-2">SVI parameters</div>
              <div className="grid grid-cols-5 gap-2">
                {SVI_PARAMS.map(({ key, label, desc }) => (
                  <div
                    key={key}
                    className="text-center rounded-lg py-2.5 px-1"
                    style={{ background: 'var(--bg-elevated)' }}
                  >
                    <div className="text-[10px] font-mono mb-0.5" style={{ color: 'var(--text-muted)' }}>
                      {label}
                    </div>
                    <div className="text-xs font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {data.svi[key].toFixed(4)}
                    </div>
                    <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Oracle info */}
            <div
              className="rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <div>
                <div className="metric-label mb-0.5">Oracle</div>
                <div className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {data.oracleId?.slice(0, 16)}…{data.oracleId?.slice(-8)}
                </div>
              </div>
              {data.expiryTs && (
                <div className="sm:text-right">
                  <div className="metric-label mb-0.5">Expiry</div>
                  <div className="text-[11px] font-mono" style={{ color: 'var(--amber)' }}>
                    {new Date(data.expiryTs).toUTCString().replace(' GMT', ' UTC')}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
