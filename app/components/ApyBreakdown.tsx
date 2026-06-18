'use client';

import { Fragment, useEffect, useState } from 'react';

// ─── Yield model constants ─────────────────────────────────────────────────────
//
// Calibrated against 4,107 replayed expiries (sim/src/engine.ts).
//   PLP ≈ IV × 0.35 × plpWeight       Range ≈ IV × 0.24 × rangeWeight
//   IB ≈ 3% × ibWeight                borrow cost = LTV × 3% per year
//
const PLP_IV_FACTOR   = 0.35;
const RANGE_IV_FACTOR = 0.24;
const IB_YIELD_PCT    = 3.0;
const BORROW_RATE_PCT = 3.0;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RiskData {
  allocation: { plpBps: string; rangeBps: string; marginLoopBps: string; ibIdleBps: string };
  iv: { atmIvPct: number; regime: 'low' | 'neutral' | 'high'; ivLowThreshold: string; ivHighThreshold: string };
}

type AssetGroup = 'stable' | 'lsd' | 'scallop' | 'btc';

interface ApyRow {
  group: AssetGroup;
  label: string;
  sublabel: string;
  staking: number;     // base yield: staking APY for LSDs, supply APY for Scallop, 0 otherwise
  leverageBps: number; // 0 = no leverage
  tier: 1 | 2 | 3;
  active: boolean;
  note?: string;
}

interface ApyComponents {
  staking: number;
  plp: number;
  range: number;
  ib: number;
  interest: number;
  net: number;
}

// ─── Asset paths — mirrors every asset in DepositForm ─────────────────────────

const GROUP_LABELS: Record<AssetGroup, string> = {
  stable:  'Stablecoins & Native',
  lsd:     'Liquid Staking',
  scallop: 'Scallop Lending',
  btc:     'BTC',
};

const ASSET_PATHS: ApyRow[] = [
  // ── Stablecoins & Native — Tier 1, live on testnet ──────────────────────────
  { group: 'stable', label: 'USDC',   sublabel: 'Stablecoin · DeepBook Spot → dUSDC',    staking: 0,   leverageBps: 0,    tier: 1, active: true  },
  { group: 'stable', label: 'dUSDC',  sublabel: 'DeepBook USDC · direct deposit',         staking: 0,   leverageBps: 0,    tier: 1, active: true  },
  { group: 'stable', label: 'SUI',    sublabel: 'Native SUI · auto-swap to dUSDC',        staking: 0,   leverageBps: 0,    tier: 1, active: true  },
  { group: 'stable', label: 'rfBTC',  sublabel: 'Reflux testnet BTC · dUSDC-settled exit',staking: 0,   leverageBps: 0,    tier: 1, active: true,  note: 'BTC price exp.' },

  // ── Liquid Staking — Tier 1/3, pending (testnet unavailable) ────────────────
  { group: 'lsd', label: 'vSUI',   sublabel: 'Volo · 4.5% staking · 65% LTV leverage',   staking: 4.5, leverageBps: 6500, tier: 1, active: false },
  { group: 'lsd', label: 'afSUI',  sublabel: 'Aftermath · 4.8% staking · 65% LTV',       staking: 4.8, leverageBps: 6500, tier: 3, active: false },
  { group: 'lsd', label: 'haSUI',  sublabel: 'Haedal · 4.7% staking · 65% LTV',          staking: 4.7, leverageBps: 6500, tier: 3, active: false },

  // ── Scallop Lending — Tier 2, mainnet only ───────────────────────────────────
  { group: 'scallop', label: 'sSUI',   sublabel: 'Scallop · SUI supply yield',            staking: 4.5, leverageBps: 0, tier: 2, active: false },
  { group: 'scallop', label: 'svSUI',  sublabel: 'Scallop · vSUI supply + staking',       staking: 5.5, leverageBps: 0, tier: 2, active: false },
  { group: 'scallop', label: 'safSUI', sublabel: 'Scallop · afSUI supply + staking',      staking: 5.5, leverageBps: 0, tier: 2, active: false },
  { group: 'scallop', label: 'shaSUI', sublabel: 'Scallop · haSUI supply + staking',      staking: 5.5, leverageBps: 0, tier: 2, active: false },
  { group: 'scallop', label: 'sUSDC',  sublabel: 'Scallop · USDC supply yield',           staking: 5.2, leverageBps: 0, tier: 2, active: false },
  { group: 'scallop', label: 'sWUSDC', sublabel: 'Scallop · Wormhole USDC supply',        staking: 5.0, leverageBps: 0, tier: 2, active: false },
  { group: 'scallop', label: 'sWUSDT', sublabel: 'Scallop · Wormhole USDT supply',        staking: 4.8, leverageBps: 0, tier: 2, active: false },
  // Tier 3 Scallop exotics
  { group: 'scallop', label: 'sWETH',  sublabel: 'Scallop · Wormhole ETH supply',         staking: 2.5, leverageBps: 0, tier: 3, active: false },
  { group: 'scallop', label: 'ssbETH', sublabel: 'Scallop · sb-ETH supply',               staking: 2.2, leverageBps: 0, tier: 3, active: false },
  { group: 'scallop', label: 'sSCA',   sublabel: 'Scallop · SCA governance supply',       staking: 8.0, leverageBps: 0, tier: 3, active: false },
  { group: 'scallop', label: 'sCETUS', sublabel: 'Scallop · CETUS supply',                staking: 6.5, leverageBps: 0, tier: 3, active: false },
  { group: 'scallop', label: 'sDEEP',  sublabel: 'Scallop · DEEP supply',                 staking: 7.0, leverageBps: 0, tier: 3, active: false },

  // ── BTC — Tier 3, pending ────────────────────────────────────────────────────
  { group: 'btc', label: 'dBTC',  sublabel: 'DeepBook BTC · auto-swap to dUSDC',          staking: 0, leverageBps: 0, tier: 3, active: false, note: 'BTC price exp.' },
  { group: 'btc', label: 'xBTC',  sublabel: 'Axelar / LayerZero BTC',                     staking: 0, leverageBps: 0, tier: 3, active: false, note: 'BTC price exp.' },
  { group: 'btc', label: 'sBTC',  sublabel: 'Stacks bridge BTC',                          staking: 0, leverageBps: 0, tier: 3, active: false, note: 'BTC price exp.' },
];

// ─── Computation ──────────────────────────────────────────────────────────────

function computeApy(
  atmIvPct: number,
  plpBps: number,
  rangeBps: number,
  ibBps: number,
  stakingPct: number,
  leverageBps: number,
): ApyComponents {
  const lvr    = leverageBps / 10_000;
  const lvrMul = 1 + lvr;

  const plp      = atmIvPct * PLP_IV_FACTOR   * (plpBps   / 10_000) * lvrMul;
  const range    = atmIvPct * RANGE_IV_FACTOR * (rangeBps  / 10_000) * lvrMul;
  const ib       = IB_YIELD_PCT               * (ibBps     / 10_000);
  const interest = lvr * BORROW_RATE_PCT;

  return {
    staking:  stakingPct,
    plp,
    range,
    ib,
    interest,
    net: stakingPct + plp + range + ib - interest,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div
      className="rounded-xl p-6 animate-pulse space-y-4"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
    >
      <div className="h-3 w-1/4 rounded" style={{ background: 'var(--bg-elevated)' }} />
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 rounded" style={{ background: 'var(--bg-elevated)' }} />
        ))}
      </div>
    </div>
  );
}

function RegimeBadge({ regime }: { regime: 'low' | 'neutral' | 'high' }) {
  const map = {
    low:     { label: 'LOW VOL',  color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)'  },
    neutral: { label: 'NEUTRAL',  color: '#00D4C8', bg: 'rgba(0,212,200,0.10)',   border: 'rgba(0,212,200,0.3)'   },
    high:    { label: 'HIGH VOL', color: '#F5A623', bg: 'rgba(245,166,35,0.12)',  border: 'rgba(245,166,35,0.3)'  },
  }[regime];
  return (
    <span
      className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded tracking-widest"
      style={{ background: map.bg, color: map.color, border: `1px solid ${map.border}` }}
    >
      {map.label}
    </span>
  );
}

function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const map: Record<number, { bg: string; color: string }> = {
    1: { bg: 'rgba(0,212,200,0.08)',  color: 'var(--teal-light)' },
    2: { bg: 'rgba(99,102,241,0.1)',  color: '#A5B4FC'           },
    3: { bg: 'rgba(139,92,246,0.1)',  color: '#C4B5FD'           },
  };
  const s = map[tier]!;
  return (
    <span
      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.color }}
    >
      T{tier}
    </span>
  );
}

function Pct({ v, color }: { v: number; color: string }) {
  if (v === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return <span style={{ color }}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</span>;
}

function AllocationBar({
  plpBps, rangeBps, marginBps, ibBps,
}: { plpBps: number; rangeBps: number; marginBps: number; ibBps: number }) {
  const total = plpBps + rangeBps + marginBps + ibBps;
  const pct = (v: number) => `${((v / total) * 100).toFixed(0)}%`;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded overflow-hidden gap-px">
        <div title={`PLP ${plpBps / 100}%`}    className="transition-all" style={{ width: pct(plpBps),    background: '#93C5FD' }} />
        <div title={`Range ${rangeBps / 100}%`} className="transition-all" style={{ width: pct(rangeBps),  background: '#F5A623' }} />
        <div title={`Margin ${marginBps/100}%`} className="transition-all" style={{ width: pct(marginBps), background: '#00D4C8' }} />
        <div title={`IB ${ibBps / 100}%`}       className="transition-all" style={{ width: pct(ibBps),     background: 'var(--bg-elevated)', opacity: 0.6 }} />
      </div>
      <div className="flex gap-4 text-[10px] font-mono flex-wrap" style={{ color: 'var(--text-muted)' }}>
        <span><span style={{ color: '#93C5FD' }}>■</span> PLP {plpBps / 100}%</span>
        <span><span style={{ color: '#F5A623' }}>■</span> Range {rangeBps / 100}%</span>
        <span><span style={{ color: '#00D4C8' }}>■</span> Margin {marginBps / 100}%</span>
        <span><span style={{ color: 'var(--text-muted)' }}>■</span> IB {ibBps / 100}%</span>
      </div>
    </div>
  );
}

function GroupHeaderRow({ label }: { label: string }) {
  return (
    <tr style={{ background: 'var(--bg-elevated)' }}>
      <td
        colSpan={7}
        className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest"
        style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        {label}
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ApyBreakdown() {
  const [data, setData]       = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/risk')
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: RiskData; error?: string }) => {
        if (j.ok && j.data) setData(j.data);
        else setError(j.error ?? 'Could not load risk data');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton />;

  const plpBps    = Number(data?.allocation?.plpBps        ?? 3000);
  const rangeBps  = Number(data?.allocation?.rangeBps       ?? 4000);
  const marginBps = Number(data?.allocation?.marginLoopBps  ?? 2000);
  const ibBps     = Number(data?.allocation?.ibIdleBps      ?? 1000);
  const atmIvPct  = data?.iv?.atmIvPct  ?? 45;
  const regime    = data?.iv?.regime    ?? 'neutral';
  const ivLow     = Number(data?.iv?.ivLowThreshold  ?? 3000) / 100;
  const ivHigh    = Number(data?.iv?.ivHighThreshold ?? 6000) / 100;

  const rows = ASSET_PATHS.map((path) => ({
    ...path,
    apy: computeApy(atmIvPct, plpBps, rangeBps, ibBps, path.staking, path.leverageBps),
  }));

  const columnHeaders = ['Asset', 'Base Yield', 'PLP', 'Range Premia', 'Interest', 'Net APY', 'Status'];

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 space-y-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              APY Breakdown by Asset
            </div>
            <div className="text-[10px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
              Live DeepBook SVI · ATM IV {atmIvPct.toFixed(2)}% · low &lt;{ivLow}% · high &gt;{ivHigh}%
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {error && (
              <span className="text-[10px] font-mono" style={{ color: 'var(--red)' }}>
                ⚠ using defaults
              </span>
            )}
            <RegimeBadge regime={regime} />
          </div>
        </div>
        <AllocationBar plpBps={plpBps} rangeBps={rangeBps} marginBps={marginBps} ibBps={ibBps} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {columnHeaders.map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 font-medium uppercase tracking-wider whitespace-nowrap"
                  style={{ color: 'var(--text-muted)', fontSize: '10px' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const prev = rows[idx - 1];
              const isNewGroup = !prev || prev.group !== row.group;
              const { label, sublabel, tier, active, group, leverageBps: lvBps, note, apy } = row;
              return (
                <Fragment key={label}>
                  {isNewGroup && <GroupHeaderRow label={GROUP_LABELS[group]} />}
                  <tr
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: active ? 'rgba(0,212,200,0.03)' : 'transparent',
                      opacity: active ? 1 : 0.72,
                    }}
                  >
                    {/* Asset */}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span style={{ color: 'var(--text-primary)', fontWeight: active ? 600 : 400 }}>
                            {label}
                          </span>
                          <TierBadge tier={tier} />
                        </div>
                        <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {sublabel}
                        </div>
                      </div>
                    </td>

                    {/* Base yield (staking / Scallop supply) */}
                    <td className="px-4 py-2.5 font-mono">
                      <Pct v={apy.staking} color="var(--teal)" />
                    </td>

                    {/* PLP */}
                    <td className="px-4 py-2.5 font-mono">
                      <Pct v={apy.plp} color="#93C5FD" />
                    </td>

                    {/* Range premia */}
                    <td className="px-4 py-2.5 font-mono">
                      <Pct v={apy.range} color="#F5A623" />
                    </td>

                    {/* Interest cost */}
                    <td className="px-4 py-2.5 font-mono">
                      {apy.interest > 0
                        ? <span style={{ color: 'var(--red)' }}>−{apy.interest.toFixed(1)}%</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>
                      }
                    </td>

                    {/* Net APY */}
                    <td className="px-4 py-2.5 font-mono font-bold">
                      <span style={{ color: 'var(--green)', fontSize: '13px' }}>
                        {apy.net.toFixed(1)}%
                      </span>
                      {lvBps > 0 && (
                        <span className="text-[9px] ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>
                          est.
                        </span>
                      )}
                      {note && (
                        <div className="text-[9px] font-normal mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {note}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      {active ? (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold"
                          style={{ background: 'var(--teal-dim)', color: 'var(--teal-light)', border: '1px solid var(--teal-border)' }}
                        >
                          live
                        </span>
                      ) : (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                        >
                          pending
                        </span>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        className="px-6 py-3 space-y-1 text-[10px] font-mono"
        style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}
      >
        <div>
          PLP and range premia scale with live ATM IV ({atmIvPct.toFixed(2)}%).
          Model: PLP ≈ IV × 0.35 × weight; Range ≈ IV × 0.24 × weight.
          Calibrated against {'>'}4,000 replayed expiries.
        </div>
        <div>
          LSD staking: Volo 4.5% · Aftermath 4.8% · Haedal 4.7%.
          Scallop supply yields: SUI 4.5% · vSUI/afSUI/haSUI 5.5% · USDC 5.2% · WUSDC 5.0% · WUSDT 4.8% · WETH 2.5% · sbETH 2.2% · SCA 8% · CETUS 6.5% · DEEP 7%.
          Borrow rate: {BORROW_RATE_PCT.toFixed(1)}% · max LTV 65% · IB idle {IB_YIELD_PCT.toFixed(1)}%.
        </div>
        <div style={{ color: 'rgba(107,114,128,0.7)' }}>
          Staking and Scallop supply yield is isolated to respective depositors via per-position NAV tracking.
          BTC-denominated inputs exit as dUSDC — depositors retain BTC price exposure on entry.
          All figures are estimates; actual returns depend on realised vol vs implied.
        </div>
      </div>
    </div>
  );
}
