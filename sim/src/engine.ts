/**
 * Simulation engine: replays historical expiries through the allocation logic.
 *
 * Each expiry produces one "roll" step:
 *  1. Apply allocation targets given ATM IV at open.
 *  2. Simulate PnL for each arm based on realised vol vs implied.
 *  3. Update NAV.
 *
 * All arithmetic uses bigint — no floating point in NAV paths.
 */

import {
  computeAllocationTargets,
  navPerShareE9,
  DEFAULT_POLICY,
} from '@reflux/lib';
import type { AllocationPolicy } from '@reflux/lib';
import type { HistoricalExpiry, SimulationStep } from './types.js';

/**
 * PnL model for each allocation arm (greatly simplified):
 *
 * PLP arm: PnL = plpCapital * (realisedVol - atmIv) / 10000
 *   — PLP benefits when realised vol > implied (long vega).
 *
 * Range strip arm: PnL = rangeCapital * (1 - abs(realisedVol - atmIv) / (2 * atmIv))
 *   — range strips earn when vol is close to IV; lose when vol moves far.
 *
 * IB idle arm: PnL = ibCapital * ibYieldBps / 10000
 *   — base yield from parked capital.
 *
 * All in bigint (bps scaled).
 */
export function simulatePnl(
  plpCapital: bigint,
  rangeCapital: bigint,
  ibCapital: bigint,
  atmIvE4: bigint,
  realisedVolE4: bigint,
  ibYieldBps = 300n,
): { plpPnl: bigint; rangePnl: bigint; ibPnl: bigint } {
  // PLP: long vega — benefits from realised > implied
  // Use 0n - x instead of unary minus to avoid BigInt transpiler quirks
  const ivDiff = realisedVolE4 > atmIvE4
    ? (realisedVolE4 - atmIvE4)
    : (0n - (atmIvE4 - realisedVolE4));
  const plpPnl = (plpCapital * ivDiff) / 10_000n;

  // Range strip: earns theta when vol is near implied, loses when vol deviates far.
  // Model: earn baseTheta (= atmIv/10) on capital; lose proportionally to deviation
  // beyond a buffer equal to atmIv/4.  Clamped at -capital (max loss = full notional).
  const absDiff = realisedVolE4 > atmIvE4 ? realisedVolE4 - atmIvE4 : atmIvE4 - realisedVolE4;
  const baseTheta = atmIvE4 > 0n ? atmIvE4 / 10n : 0n;
  const buffer = atmIvE4 > 0n ? atmIvE4 / 4n : 0n;
  const excessDev = absDiff > buffer ? absDiff - buffer : 0n;
  const lossRate = atmIvE4 > 0n ? (excessDev * 10_000n) / atmIvE4 : 0n;
  const netRateBps = baseTheta > lossRate ? baseTheta - lossRate : 0n;
  const rangePnl = (rangeCapital * netRateBps) / 10_000n - (absDiff > buffer ? (rangeCapital * lossRate) / 10_000n : 0n);

  // IB idle: fixed yield
  const ibPnl = (ibCapital * ibYieldBps) / 10_000n;

  return { plpPnl, rangePnl, ibPnl };
}

export interface EngineConfig {
  policy?: AllocationPolicy;
  ibYieldBps?: bigint;
}

/**
 * Replay `expiries` through the allocation engine and return one
 * SimulationStep per expiry.
 */
export function replayExpiries(
  expiries: HistoricalExpiry[],
  initialNavDusdc = 100_000_000n,
  cfg: EngineConfig = {},
): SimulationStep[] {
  const policy = cfg.policy ?? DEFAULT_POLICY;
  const ibYieldBps = cfg.ibYieldBps ?? 300n;

  let navDusdc = initialNavDusdc;
  let totalSupply = initialNavDusdc; // start 1:1
  const steps: SimulationStep[] = [];

  for (let i = 0; i < expiries.length; i++) {
    const expiry = expiries[i];
    if (!expiry) continue;
    const { atmIvE4, realisedVolE4 } = expiry;

    const targets = computeAllocationTargets(navDusdc, atmIvE4, policy);

    const { plpPnl, rangePnl, ibPnl } = simulatePnl(
      targets.plpDusdc,
      targets.rangeDusdc,
      targets.ibIdleDusdc,
      atmIvE4,
      realisedVolE4,
      ibYieldBps,
    );

    const totalPnl = plpPnl + rangePnl + ibPnl;
    navDusdc += totalPnl;

    // NAV floor: never go below 1 (catastrophic scenario guard)
    if (navDusdc < 1n) navDusdc = 1n;

    const navPs = navPerShareE9(navDusdc, totalSupply);

    steps.push({
      rollId: i + 1,
      timestampMs: expiry.expiryTimestampMs,
      navDusdc,
      totalSupply,
      navPerShareE9: navPs,
      atmIvE4: atmIvE4,
      regime: targets.regime,
      plpPnlDusdc: plpPnl,
      rangePnlDusdc: rangePnl,
      ibIdlePnlDusdc: ibPnl,
      totalPnlDusdc: totalPnl,
    });
  }

  return steps;
}
