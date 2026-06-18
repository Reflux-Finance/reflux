import { describe, expect, it } from 'vitest';
import { flatIvScenario, ivSpikeScenario, bearMarketScenario, buildAllScenarios } from './scenarios.js';

describe('flatIvScenario', () => {
  it('produces exactly N expiries', () => {
    const { expiries } = flatIvScenario(10, 4_500n, 4_200n, 'test');
    expect(expiries).toHaveLength(10);
  });

  it('all expiries have the specified IV', () => {
    const { expiries } = flatIvScenario(5, 3_000n, 2_800n, 'flat');
    for (const e of expiries) {
      expect(e.atmIvE4).toBe(3_000n);
    }
  });
});

describe('ivSpikeScenario', () => {
  it('produces exactly N expiries', () => {
    const { expiries } = ivSpikeScenario(20);
    expect(expiries).toHaveLength(20);
  });

  it('second half has higher IV than first half', () => {
    const { expiries } = ivSpikeScenario(20);
    const firstHalf = expiries.slice(0, 10).map((e) => e.atmIvE4);
    const secondHalf = expiries.slice(10).map((e) => e.atmIvE4);
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0n) / BigInt(firstHalf.length);
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0n) / BigInt(secondHalf.length);
    expect(avgSecond).toBeGreaterThan(avgFirst);
  });
});

describe('bearMarketScenario', () => {
  it('first two-thirds have low IV', () => {
    const { expiries } = bearMarketScenario(30);
    const firstPart = expiries.slice(0, 20).map((e) => e.atmIvE4);
    for (const iv of firstPart) {
      expect(iv).toBeLessThan(3_000n); // low-IV regime
    }
  });
});

describe('buildAllScenarios', () => {
  it('returns 6 scenarios', () => {
    const scenarios = buildAllScenarios(10);
    expect(scenarios).toHaveLength(6);
  });

  it('each scenario has a unique label', () => {
    const labels = buildAllScenarios(10).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('total expiries across all scenarios ≥ 60 (6 × 10)', () => {
    const scenarios = buildAllScenarios(10);
    const total = scenarios.reduce((a, s) => a + s.expiries.length, 0);
    expect(total).toBeGreaterThanOrEqual(60);
  });
});
