import { describe, expect, it } from 'vitest';
import { computeMarginLtvBps, isLtvBreached } from './margin.js';

describe('computeMarginLtvBps', () => {
  it('returns 5000 bps for 50% LTV', () => {
    // 1 SUI (1e9) @ price 1 (1e9), debt 0.5 dUSDC (5e8)
    expect(computeMarginLtvBps(1_000_000_000n, 1_000_000_000n, 500_000_000n)).toBe(5_000n);
  });

  it('returns 0 for zero collateral', () => {
    expect(computeMarginLtvBps(0n, 1_000_000_000n, 100n)).toBe(0n);
  });
});

describe('isLtvBreached', () => {
  it('false below max', () => expect(isLtvBreached(5_000n, 6_500n)).toBe(false));
  it('true at max', () => expect(isLtvBreached(6_500n, 6_500n)).toBe(true));
  it('true above max', () => expect(isLtvBreached(7_000n, 6_500n)).toBe(true));
});
