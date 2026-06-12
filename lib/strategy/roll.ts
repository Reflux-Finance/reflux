import { BPS_DENOMINATOR } from '../constants.js';

// ─── Allocation targets (mirrors contracts/sources/allocator.move) ────────────

export interface AllocationTargets {
  plpDusdc: bigint;
  rangeDusdc: bigint;
  marginLoopDusdc: bigint;
  ibIdleDusdc: bigint;
  plpBps: bigint;
  rangeBps: bigint;
  marginLoopBps: bigint;
  ibIdleBps: bigint;
  regime: 'low' | 'neutral' | 'high';
  reasonCode: 0 | 1 | 2 | 3 | 4;
}

export interface AllocationPolicy {
  basePlpBps: bigint;
  baseRangeBps: bigint;
  baseMarginLoopBps: bigint;
  baseIbIdleBps: bigint;
  ivLowThreshold: bigint;
  ivHighThreshold: bigint;
  regimeShiftBps: bigint;
  minIbBufferBps: bigint;
}

// Default policy mirrors risk_params defaults in allocator.move
export const DEFAULT_POLICY: AllocationPolicy = {
  basePlpBps: 3_000n,
  baseRangeBps: 4_000n,
  baseMarginLoopBps: 2_000n,
  baseIbIdleBps: 1_000n,
  ivLowThreshold: 3_000n,
  ivHighThreshold: 6_000n,
  regimeShiftBps: 1_500n,
  minIbBufferBps: 500n,
};

/**
 * Compute allocation targets from NAV and current IV.
 *
 * This function mirrors allocator.move::compute_targets exactly so the
 * simulation harness can replay decisions off-chain.
 *
 * All arithmetic in bigint — no floating-point.
 */
export function computeAllocationTargets(
  totalNavDusdc: bigint,
  atmIvE4: bigint,
  policy: AllocationPolicy = DEFAULT_POLICY,
): AllocationTargets {
  let plp = policy.basePlpBps;
  let range = policy.baseRangeBps;
  const ml = policy.baseMarginLoopBps;
  let ib = policy.baseIbIdleBps;
  let regime: 'low' | 'neutral' | 'high' = 'neutral';
  let reasonCode: 0 | 1 | 2 | 3 | 4 = 0;

  if (atmIvE4 < policy.ivLowThreshold) {
    regime = 'low';
    reasonCode = 1;
    const shift = policy.regimeShiftBps < range ? policy.regimeShiftBps : range;
    range -= shift;
    plp += shift / 2n;
    ib += shift - shift / 2n;
  } else if (atmIvE4 > policy.ivHighThreshold) {
    regime = 'high';
    reasonCode = 2;
    const maxShift = policy.regimeShiftBps;
    const fromPlp = maxShift < plp ? maxShift : plp;
    const fromIb = maxShift - fromPlp < ib ? maxShift - fromPlp : ib;
    range += fromPlp + fromIb;
    plp -= fromPlp;
    ib -= fromIb;
  }

  // IB floor
  if (ib < policy.minIbBufferBps) {
    const needed = policy.minIbBufferBps - ib;
    const fromPlp = needed < plp ? needed : plp;
    plp -= fromPlp;
    const stillNeeded = needed - fromPlp;
    if (stillNeeded > 0n) {
      const fromRange = stillNeeded < range ? stillNeeded : range;
      range -= fromRange;
    }
    ib = policy.minIbBufferBps;
    if (reasonCode === 0) reasonCode = 4;
  }

  const plpDusdc = (totalNavDusdc * plp) / BPS_DENOMINATOR;
  const rangeDusdc = (totalNavDusdc * range) / BPS_DENOMINATOR;
  const marginLoopDusdc = (totalNavDusdc * ml) / BPS_DENOMINATOR;
  const ibIdleDusdc = (totalNavDusdc * ib) / BPS_DENOMINATOR;

  return {
    plpDusdc,
    rangeDusdc,
    marginLoopDusdc,
    ibIdleDusdc,
    plpBps: plp,
    rangeBps: range,
    marginLoopBps: ml,
    ibIdleBps: ib,
    regime,
    reasonCode,
  };
}

/**
 * Compute NAV per share in e9 units.
 * nav_per_share_e9 = (total_nav_dusdc * 1e9) / total_supply
 * Returns 1e9 when supply is zero (1:1 initialisation).
 */
export function navPerShareE9(totalNavDusdc: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n) return 1_000_000_000n;
  return (totalNavDusdc * 1_000_000_000n) / totalSupply;
}

/**
 * Compute how many shares to mint for a new deposit.
 * shares = deposit_dusdc * total_supply / total_nav_dusdc
 * On first deposit (supply=0): shares = deposit_dusdc (1:1).
 */
export function sharesToMint(
  depositDusdc: bigint,
  totalNavDusdc: bigint,
  totalSupply: bigint,
): bigint {
  if (totalSupply === 0n || totalNavDusdc === 0n) return depositDusdc;
  return (depositDusdc * totalSupply) / totalNavDusdc;
}

/**
 * Compute dUSDC value of `shares` being burned.
 * dusdc_out = shares * total_nav_dusdc / total_supply
 */
export function sharesValueDusdc(
  shares: bigint,
  totalNavDusdc: bigint,
  totalSupply: bigint,
): bigint {
  if (totalSupply === 0n) return 0n;
  return (shares * totalNavDusdc) / totalSupply;
}
