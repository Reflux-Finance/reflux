import { BPS_DENOMINATOR } from '../constants.js';

export interface RangeStripParams {
  /** Capital allocated to range strips in dUSDC. */
  capitalDusdc: bigint;
  /** Number of strike tiers. */
  nStrikes: number;
  /** Strike spacing in basis points around ATM. */
  spacingBps: bigint;
  /** ATM IV used to set spacing. */
  atmIvE4: bigint;
}

/**
 * Compute range strip parameters from allocation targets.
 *
 * Spacing heuristic: wider spreads in high-IV regimes.
 *   spacingBps = max(100, atmIvE4 / 10)
 *   (e.g., ATM IV = 5000 e4 = 50% → spacing = 500 bps = 5%)
 *
 * nStrikes is clamped to [2, 10].
 */
export function computeRangeStripParams(
  capitalDusdc: bigint,
  rangeBps: bigint,
  totalNavDusdc: bigint,
  atmIvE4: bigint,
  preferredStrikes = 5,
): RangeStripParams {
  const allocated = (totalNavDusdc * rangeBps) / BPS_DENOMINATOR;

  const spacingBps = atmIvE4 / 10n > 100n ? atmIvE4 / 10n : 100n;
  const nStrikes = Math.min(10, Math.max(2, preferredStrikes));

  return { capitalDusdc: capitalDusdc > 0n ? capitalDusdc : allocated, nStrikes, spacingBps, atmIvE4 };
}

/**
 * Compute breakeven IV for a symmetric range strip.
 *
 * For a fully hedged range, the expected PnL is positive when realised IV
 * exceeds the entry IV (approximated as ATM IV at time of opening).
 *
 * Returns the breakeven ATM IV in e4.
 */
export function rangeBreakevenIvE4(
  capitalDusdc: bigint,
  expectedPayoutDusdc: bigint,
  atmIvE4: bigint,
): bigint {
  if (capitalDusdc === 0n) return 0n;
  const payoutRatioE4 = (expectedPayoutDusdc * 10_000n) / capitalDusdc;
  return atmIvE4 > payoutRatioE4 ? atmIvE4 - payoutRatioE4 : 0n;
}
