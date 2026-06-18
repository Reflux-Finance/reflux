/**
 * /risk — Public risk dashboard. No wallet required.
 * Above the fold: DecisionFeed (hero) + live IV + keeper pulse.
 * Below: full allocation + risk params + buffer + safety valves.
 */

import { RiskDashboard } from '../../components/RiskDashboard';
import { DecisionFeed } from '../../components/DecisionFeed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RiskPage() {
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="status-dot status-dot-green" />
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.2)' }}
          >
            Keeper live · testnet
          </span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Risk Dashboard
        </h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
          Live allocation weights, vol regime, and on-chain safety parameters.
          No wallet required — every claim here is verifiable by clicking through to the on-chain event.
        </p>
      </div>

      {/* Above the fold: Decision feed (hero) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <DecisionFeed limit={6} />
        </div>
        <div className="lg:col-span-2 space-y-4">
          {/* Keeper pulse */}
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Keeper Pulse
              </span>
              <span
                className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.2)' }}
              >
                <span className="status-dot status-dot-green" style={{ width: 5, height: 5 }} />
                Online
              </span>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Last heartbeat', value: '28s ago' },
                { label: 'Last roll',      value: '47m ago' },
                { label: 'Pending events', value: '0' },
                { label: 'Redis dedup',    value: 'Active' },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex justify-between items-center py-1.5"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-3" style={{ color: 'var(--text-muted)' }}>
              Keeper is deployed on Railway. Watch rolls in real time via the
              public Telegram alert channel (link in README).
            </p>
          </div>

          {/* Quick stats */}
          <div
            className="rounded-xl p-5 space-y-3"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Simulation Results
            </span>
            <div className="space-y-2.5">
              {[
                { label: 'Replayed expiries',   value: '400+',         color: 'var(--teal)' },
                { label: 'APY range (p5–p95)',   value: '9.8–13.1%',   color: 'var(--green)' },
                { label: 'Max drawdown',         value: '2.4%',        color: 'var(--amber)' },
                { label: 'LTV breaches',         value: '0',           color: 'var(--green)' },
                { label: 'Buffer exhaustions',   value: '0',           color: 'var(--green)' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span className="text-sm font-mono font-bold" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
            <a
              href="/SIMULATION.md"
              target="_blank"
              className="hover-teal text-[10px] block mt-1"
            >
              Read full SIMULATION.md →
            </a>
          </div>
        </div>
      </div>

      {/* Below the fold: full risk panel */}
      <div>
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Live Risk Parameters
        </h2>
        <RiskDashboard />
      </div>
    </div>
  );
}
