/**
 * /strategy — SVI surface, allocation targets, and on-chain decision feed.
 */

import { StrategySurface } from '../../components/StrategySurface';
import { DecisionFeed } from '../../components/DecisionFeed';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/* ── Static range position mock (replace post-deployment) ─────────────────── */
const RANGE_POSITIONS = [
  {
    oracle: 'SUI-USD Dec-2026',
    lower: '$3.20',
    upper: '$4.80',
    qty: '10 000',
    pnl: '+$142.80',
    positive: true,
    expiry: '2h 14m',
  },
  {
    oracle: 'SUI-USD Dec-2026',
    lower: '$2.50',
    upper: '$3.20',
    qty: '8 000',
    pnl: '+$54.40',
    positive: true,
    expiry: '2h 14m',
  },
];

function RangeTable() {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
    >
      <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Open Range Strips
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Active predict::mint positions — keeper-owned PredictManager
          </div>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded"
          style={{ background: 'rgba(139,152,168,0.1)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
          Demo · live after deployment
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Oracle', 'Lower strike', 'Upper strike', 'Qty', 'Unrealized PnL', 'Time to expiry'].map((h) => (
                <th key={h} className="text-left px-5 py-3 uppercase tracking-wider font-medium"
                  style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RANGE_POSITIONS.map((p, i) => (
              <tr
                key={i}
                className="tr-hover"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <td className="px-5 py-3.5 font-medium" style={{ color: 'var(--text-primary)' }}>{p.oracle}</td>
                <td className="px-5 py-3.5 font-mono" style={{ color: '#93C5FD' }}>{p.lower}</td>
                <td className="px-5 py-3.5 font-mono" style={{ color: '#93C5FD' }}>{p.upper}</td>
                <td className="px-5 py-3.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{p.qty}</td>
                <td className="px-5 py-3.5 font-mono font-bold" style={{ color: p.positive ? 'var(--green)' : 'var(--red)' }}>
                  {p.pnl}
                </td>
                <td className="px-5 py-3.5 font-mono" style={{ color: 'var(--amber)' }}>{p.expiry}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StrategyPage() {
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Strategy
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Live SVI surface, range strip positions, and the on-chain allocation decision feed.
          </p>
        </div>
        <Link href="/risk" className="btn-ghost text-xs px-4 py-2 flex-shrink-0">
          Risk parameters →
        </Link>
      </div>

      {/* Vol surface + decision feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StrategySurface />
        <DecisionFeed limit={5} />
      </div>

      {/* Range positions table */}
      <RangeTable />

      {/* PLP + margin summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: 'PLP NAV',
            value: '—',
            sub: 'predict::supply receipts',
            color: 'var(--teal)',
          },
          {
            label: 'Margin collateral',
            value: '—',
            sub: 'LSD collateral locked',
            color: 'var(--amber)',
          },
          {
            label: 'Borrowed dUSDC',
            value: '—',
            sub: 'deepbook_margin leverage',
            color: '#93C5FD',
          },
        ].map(({ label, value, sub, color }) => (
          <div
            key={label}
            className="rounded-xl p-5"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
          >
            <div className="metric-label mb-2">{label}</div>
            <div className="text-2xl font-bold font-data" style={{ color }}>
              {value}
            </div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
