import { describe, expect, it } from 'vitest';
import {
  computeAllocationTargets,
  navPerShareE9,
  sharesToMint,
  sharesValueDusdc,
  DEFAULT_POLICY,
} from './roll.js';

describe('computeAllocationTargets — neutral', () => {
  it('applies base weights at neutral IV (4500 e4)', () => {
    const targets = computeAllocationTargets(100_000_000n, 4_500n);
    expect(targets.regime).toBe('neutral');
    expect(targets.plpBps).toBe(3_000n);
    expect(targets.rangeBps).toBe(4_000n);
    expect(targets.marginLoopBps).toBe(2_000n);
    expect(targets.ibIdleBps).toBe(1_000n);
    // dUSDC amounts
    expect(targets.plpDusdc).toBe(30_000_000n);
    expect(targets.rangeDusdc).toBe(40_000_000n);
  });
});

describe('computeAllocationTargets — low IV', () => {
  it('shifts range → plp + ib when IV < low threshold (2500 < 3000)', () => {
    const targets = computeAllocationTargets(100_000_000n, 2_500n);
    expect(targets.regime).toBe('low');
    expect(targets.reasonCode).toBe(1);
    // Shift = min(1500, 4000) = 1500; range -= 1500 → 2500
    // plp += 750 → 3750; ib += 750 → 1750
    expect(targets.rangeBps).toBe(2_500n);
    expect(targets.plpBps).toBe(3_750n);
    expect(targets.ibIdleBps).toBe(1_750n);
    // Total weights still sum to 10000
    const total = targets.plpBps + targets.rangeBps + targets.marginLoopBps + targets.ibIdleBps;
    expect(total).toBe(10_000n);
  });
});

describe('computeAllocationTargets — high IV', () => {
  it('shifts plp + ib → range when IV > high threshold (7000 > 6000)', () => {
    const targets = computeAllocationTargets(100_000_000n, 7_000n);
    expect(targets.regime).toBe('high');
    expect(targets.reasonCode).toBe(2);
    // from_plp = min(1500, 3000) = 1500; from_ib = min(0, 1000) = 0
    // range += 1500 → 5500; plp -= 1500 → 1500
    expect(targets.rangeBps).toBe(5_500n);
    expect(targets.plpBps).toBe(1_500n);
    expect(targets.ibIdleBps).toBe(1_000n);
    const total = targets.plpBps + targets.rangeBps + targets.marginLoopBps + targets.ibIdleBps;
    expect(total).toBe(10_000n);
  });
});

describe('IB floor enforcement', () => {
  it('enforces minimum IB buffer when ib would fall below minIbBufferBps', () => {
    const policy = { ...DEFAULT_POLICY, baseIbIdleBps: 0n, minIbBufferBps: 500n };
    const targets = computeAllocationTargets(100_000_000n, 4_500n, policy);
    expect(targets.ibIdleBps).toBeGreaterThanOrEqual(500n);
  });
});

describe('navPerShareE9', () => {
  it('returns 1e9 when supply is 0', () => {
    expect(navPerShareE9(0n, 0n)).toBe(1_000_000_000n);
  });

  it('computes 1.1e9 after 10% yield (nav=110, supply=100)', () => {
    expect(navPerShareE9(110_000_000n, 100_000_000n)).toBe(1_100_000_000n);
  });
});

describe('sharesToMint', () => {
  it('returns deposit amount on first deposit (1:1)', () => {
    expect(sharesToMint(50_000_000n, 0n, 0n)).toBe(50_000_000n);
  });

  it('dilutes correctly: 10M deposit into 110M nav / 100M supply', () => {
    // 10M * 100M / 110M = 9.09M (truncated in integer math)
    const shares = sharesToMint(10_000_000n, 110_000_000n, 100_000_000n);
    expect(shares).toBeGreaterThan(9_000_000n);
    expect(shares).toBeLessThanOrEqual(10_000_000n);
  });
});

describe('sharesValueDusdc', () => {
  it('values shares correctly', () => {
    // 50 shares out of 100 supply in nav=110M → 55M
    expect(sharesValueDusdc(50_000_000n, 110_000_000n, 100_000_000n)).toBe(55_000_000n);
  });
});

describe('Move↔TS fixture cross-check', () => {
  it('allocation math is consistent with Move constants', () => {
    // BPS_DENOMINATOR = 10000 (from constants.ts, mirrors risk_params.move)
    // Neutral regime: all base weights sum to 10000
    const { basePlpBps, baseRangeBps, baseMarginLoopBps, baseIbIdleBps } = DEFAULT_POLICY;
    expect(basePlpBps + baseRangeBps + baseMarginLoopBps + baseIbIdleBps).toBe(10_000n);
  });

  it('regime thresholds match Move defaults', () => {
    // iv_low_threshold = 3000; iv_high_threshold = 6000
    expect(DEFAULT_POLICY.ivLowThreshold).toBe(3_000n);
    expect(DEFAULT_POLICY.ivHighThreshold).toBe(6_000n);
  });
});
