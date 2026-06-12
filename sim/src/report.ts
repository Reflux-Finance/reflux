/**
 * Build the SIMULATION.md report from simulation results.
 */

import type { ScenarioResult, SimulationReport } from './types.js';
import { replayExpiries } from './engine.js';
import type { HistoricalExpiry, SimulationStep } from './types.js';

/** Compute Sharpe ratio: mean(returns) / stddev(returns), scaled e4. */
function sharpeRatioE4(steps: SimulationStep[]): bigint {
  if (steps.length < 2) return 0n;
  const pnls = steps.map((s) => s.totalPnlDusdc);
  const n = BigInt(pnls.length);
  const sum = pnls.reduce((a, b) => a + b, 0n);
  const mean = sum / n;
  const variance = pnls.reduce((acc, p) => {
    const diff = p - mean;
    return acc + diff * diff;
  }, 0n) / n;
  // Integer sqrt via Newton's method
  if (variance === 0n) return 0n;
  const stddev = isqrt(variance);
  if (stddev === 0n) return 0n;
  // Sharpe = mean / stddev * 10000 (scaled e4)
  return (mean * 10_000n) / stddev;
}

function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('sqrt of negative');
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Maximum drawdown in basis points over the NAV series. */
function maxDrawdownBps(steps: SimulationStep[]): bigint {
  if (steps.length === 0) return 0n;
  let peak = steps[0]?.navDusdc ?? 0n;
  let maxDD = 0n;
  for (const s of steps) {
    if (s.navDusdc > peak) peak = s.navDusdc;
    if (peak > 0n) {
      const dd = ((peak - s.navDusdc) * 10_000n) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

export function buildScenarioResult(
  scenarioName: string,
  expiries: HistoricalExpiry[],
  initialNavDusdc = 100_000_000n,
): ScenarioResult {
  const steps = replayExpiries(expiries, initialNavDusdc);
  const finalStep = steps[steps.length - 1];
  const finalNavDusdc = finalStep?.navDusdc ?? initialNavDusdc;
  const totalPnlDusdc = finalNavDusdc - initialNavDusdc;

  return {
    scenarioName,
    steps,
    finalNavDusdc,
    totalPnlDusdc,
    sharpeRatioE4: sharpeRatioE4(steps),
    maxDrawdownBps: maxDrawdownBps(steps),
    nRolls: steps.length,
  };
}

export function buildReport(results: ScenarioResult[], nExpiriesReplayed: number): SimulationReport {
  return {
    generatedAt: new Date().toISOString(),
    nExpiriesReplayed,
    scenarios: results,
  };
}

export function renderMarkdown(report: SimulationReport): string {
  const lines: string[] = [];
  lines.push('# Reflux Simulation Report');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Expiries replayed:** ${report.nExpiriesReplayed}`);
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push('| Scenario | Rolls | Final NAV (dUSDC) | Total PnL (dUSDC) | Sharpe ×10⁴ | Max Drawdown (bps) |');
  lines.push('|---|---|---|---|---|---|');

  for (const r of report.scenarios) {
    const nav = Number(r.finalNavDusdc) / 1e6;
    const pnl = Number(r.totalPnlDusdc) / 1e6;
    lines.push(
      `| ${r.scenarioName} | ${r.nRolls} | ${nav.toFixed(2)} | ${pnl.toFixed(2)} | ${r.sharpeRatioE4} | ${r.maxDrawdownBps} |`,
    );
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- All amounts in dUSDC (USDC-equivalent), base-unit (1e6 = $1 at USDC peg).');
  lines.push('- PnL model is a simplified volatility model; does not include fees, slippage, or gas.');
  lines.push('- Sharpe is computed on per-roll PnL; annualisation omitted for readability.');
  lines.push('- IB idle yield assumed 3% annualised (300 bps).');
  lines.push('- `EXTERNAL-PENDING`: PLP and range strip PnL are approximations until on-chain oracle prices are available.');
  lines.push('');

  lines.push('## Regime Distribution');
  lines.push('');
  for (const r of report.scenarios) {
    const low = r.steps.filter((s) => s.regime === 'low').length;
    const neutral = r.steps.filter((s) => s.regime === 'neutral').length;
    const high = r.steps.filter((s) => s.regime === 'high').length;
    lines.push(`**${r.scenarioName}:** low=${low} neutral=${neutral} high=${high}`);
  }

  lines.push('');
  return lines.join('\n');
}
