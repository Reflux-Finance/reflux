import { describe, expect, it } from 'vitest';
import {
  computeLtvBps,
  maxBorrowDusdc,
  collateralValueDusdc,
  isLtvBreached,
  minRepayToTarget,
} from './ltv.js';

describe('computeLtvBps', () => {
  it('returns 0 for zero collateral', () => {
    expect(computeLtvBps(0n, 1_000_000_000n, 100n)).toBe(0n);
  });

  it('returns 0 for zero price', () => {
    expect(computeLtvBps(1_000_000_000n, 0n, 100n)).toBe(0n);
  });

  it('returns 5000 for 50% LTV (1 SUI collateral, price=1, debt=0.5)', () => {
    // 1 SUI = 1e9 units, price = 1e9 (1 dUSDC per SUI)
    // debt = 5e8 dUSDC
    // LTV = 5e8 / (1e9 * 1e9 / 1e9) = 5e8 / 1e9 = 50% = 5000 bps
    const ltv = computeLtvBps(1_000_000_000n, 1_000_000_000n, 500_000_000n);
    expect(ltv).toBe(5_000n);
  });

  it('returns 10000 for 100% LTV', () => {
    const ltv = computeLtvBps(1_000_000_000n, 1_000_000_000n, 1_000_000_000n);
    expect(ltv).toBe(10_000n);
  });

  it('mirrors Move formula for fractional price', () => {
    // collateral = 2e9 SUI, price = 1.5e9 ($1.50 per SUI), debt = 1.5e9 dUSDC
    // collateral value = 2e9 * 1.5e9 / 1e9 = 3e9 dUSDC
    // LTV = 1.5e9 / 3e9 = 50% = 5000 bps
    const ltv = computeLtvBps(2_000_000_000n, 1_500_000_000n, 1_500_000_000n);
    expect(ltv).toBe(5_000n);
  });
});

describe('maxBorrowDusdc', () => {
  it('computes max borrow at 65% LTV', () => {
    // 1 SUI @ $1 → max borrow at 65% = 0.65 dUSDC = 6.5e8
    const max = maxBorrowDusdc(1_000_000_000n, 1_000_000_000n, 6_500n);
    expect(max).toBe(650_000_000n);
  });
});

describe('collateralValueDusdc', () => {
  it('computes value correctly', () => {
    // 2 SUI @ $1.5 = $3.0
    expect(collateralValueDusdc(2_000_000_000n, 1_500_000_000n)).toBe(3_000_000_000n);
  });
});

describe('isLtvBreached', () => {
  it('returns false when below max', () => {
    expect(isLtvBreached(5_000n, 6_500n)).toBe(false);
  });

  it('returns true at exactly max', () => {
    expect(isLtvBreached(6_500n, 6_500n)).toBe(true);
  });

  it('returns true when above max', () => {
    expect(isLtvBreached(7_000n, 6_500n)).toBe(true);
  });
});

describe('minRepayToTarget', () => {
  it('returns 0 when already below target', () => {
    // At 30% LTV, target 65% — no repay needed
    const repay = minRepayToTarget(1_000_000_000n, 1_000_000_000n, 300_000_000n, 6_500n);
    expect(repay).toBe(0n);
  });

  it('computes correct repay for over-leveraged position', () => {
    // 1 SUI @ $1, debt = 0.9 dUSDC, target 65% → max borrow = 0.65 dUSDC
    // repay = 0.9 - 0.65 = 0.25 dUSDC = 2.5e8
    const repay = minRepayToTarget(1_000_000_000n, 1_000_000_000n, 900_000_000n, 6_500n);
    expect(repay).toBe(250_000_000n);
  });
});
