import { describe, expect, it } from 'vitest';
import { computeAtmIvE4, ivRegime, ivToE4, ivFromE4 } from './svi.js';
import type { SviParams } from '../deepbook/predict.js';

// Synthetic SVI params: a=0.04, b=0.4, rho=-0.1, m=0, sigma=0.1
// ATM (k=0): w(0) = 0.04 + 0.4*((-0.1)*0 + sqrt(0+0.01)) = 0.04 + 0.4*0.1 = 0.04 + 0.04 = 0.08
// With TTE = 1 year: IV = sqrt(0.08/1) = sqrt(0.08) ≈ 28.28%
const PARAMS: SviParams = {
  oracle_id: '0xabc',
  a: 0.04,
  b: 0.4,
  rho: -0.1,
  m: 0.0,
  sigma: 0.1,
  timestamp_ms: Date.now(),
};

describe('computeAtmIvE4', () => {
  it('returns correct ATM IV for 1-year expiry', () => {
    const nowMs = 1_000_000_000;
    const oneYearMs = nowMs + 365.25 * 24 * 60 * 60 * 1000;
    const iv = computeAtmIvE4(PARAMS, oneYearMs, nowMs);
    // sqrt(0.08) ≈ 0.2828 → 2828 in e4
    expect(Number(iv)).toBeGreaterThan(2700);
    expect(Number(iv)).toBeLessThan(2950);
  });

  it('returns higher IV for shorter expiry (term-structure effect)', () => {
    const now = 1_000_000_000;
    const oneYear = now + 365.25 * 24 * 60 * 60 * 1000;
    const oneMonth = now + 30 * 24 * 60 * 60 * 1000;
    const ivLong = computeAtmIvE4(PARAMS, oneYear, now);
    const ivShort = computeAtmIvE4(PARAMS, oneMonth, now);
    // Shorter TTE → higher annualised IV (same total variance / smaller T)
    expect(ivShort).toBeGreaterThan(ivLong);
  });

  it('returns 0 for non-positive total variance', () => {
    const negParams: SviParams = { ...PARAMS, a: -1, b: 0 };
    const iv = computeAtmIvE4(negParams, Date.now() + 1_000_000, Date.now());
    expect(iv).toBe(0n);
  });
});

describe('ivRegime', () => {
  it('low-IV regime when below low threshold', () => {
    expect(ivRegime(2_500n, 3_000n, 6_000n)).toBe('low');
  });

  it('neutral regime in range', () => {
    expect(ivRegime(4_500n, 3_000n, 6_000n)).toBe('neutral');
  });

  it('high-IV regime when above high threshold', () => {
    expect(ivRegime(7_000n, 3_000n, 6_000n)).toBe('high');
  });

  it('neutral at exact low threshold', () => {
    expect(ivRegime(3_000n, 3_000n, 6_000n)).toBe('neutral');
  });

  it('neutral at exact high threshold', () => {
    expect(ivRegime(6_000n, 3_000n, 6_000n)).toBe('neutral');
  });
});

describe('ivToE4 / ivFromE4 round-trip', () => {
  it('round-trips 60% IV', () => {
    const e4 = ivToE4(0.60);
    expect(e4).toBe(6_000n);
    expect(ivFromE4(e4)).toBeCloseTo(0.60);
  });

  it('round-trips 28.28% IV', () => {
    const e4 = ivToE4(0.2828);
    expect(Number(e4)).toBeGreaterThan(2820);
    expect(Number(e4)).toBeLessThan(2840);
    expect(ivFromE4(e4)).toBeCloseTo(0.2828, 3);
  });
});
