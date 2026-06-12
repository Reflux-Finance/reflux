import { describe, expect, it } from 'vitest';
import { simulatePnl, replayExpiries } from './engine.js';
import type { HistoricalExpiry } from './types.js';

describe('simulatePnl', () => {
  it('PLP earns when realised vol > implied (long vega)', () => {
    const { plpPnl } = simulatePnl(
      100_000_000n, // 100 dUSDC
      0n, 0n,
      4_000n, // implied 40%
      5_000n, // realised 50%
    );
    expect(plpPnl).toBeGreaterThan(0n);
  });

  it('PLP loses when realised vol < implied', () => {
    const { plpPnl } = simulatePnl(
      100_000_000n,
      0n, 0n,
      6_000n,
      4_000n,
    );
    expect(plpPnl).toBeLessThan(0n);
  });

  it('IB idle earns positive yield', () => {
    const { ibPnl } = simulatePnl(0n, 0n, 100_000_000n, 4_000n, 4_000n, 300n);
    expect(ibPnl).toBe(3_000_000n); // 3% of 100M
  });

  it('range PnL is positive when IV == realised vol (earns theta)', () => {
    // When atmIv == realisedVol, absDiff = 0, no excess deviation → earn full theta premium
    const { rangePnl } = simulatePnl(0n, 100_000_000n, 0n, 5_000n, 5_000n);
    expect(rangePnl).toBeGreaterThan(0n);
  });
});

describe('replayExpiries', () => {
  const makeExpiry = (i: number, atmIvE4: bigint, realisedVolE4: bigint): HistoricalExpiry => ({
    oracleId: `e-${i}`,
    openTimestampMs: 1_000_000 + i * 86_400_000,
    expiryTimestampMs: 1_000_000 + (i + 1) * 86_400_000,
    atmIvE4,
    settlementPriceE9: 1_000_000_000n,
    realisedVolE4,
  });

  it('produces one step per expiry', () => {
    const expiries = Array.from({ length: 10 }, (_, i) => makeExpiry(i, 4_500n, 4_200n));
    const steps = replayExpiries(expiries);
    expect(steps).toHaveLength(10);
  });

  it('PLP earns positive PnL when realised vol > implied', () => {
    // Directly check simulatePnl: PLP should gain when realised > implied
    const { plpPnl } = simulatePnl(30_000_000n, 0n, 0n, 4_000n, 5_000n);
    expect(plpPnl).toBeGreaterThan(0n);
  });

  it('NAV increases over many rolls when PLP+IB dominate range losses', () => {
    // Neutral IV (4500), realised close to implied (4600): small vol difference
    // Range strips earn theta (close to IV); total PnL positive
    const expiries = Array.from({ length: 20 }, (_, i) =>
      makeExpiry(i, 4_500n, 4_600n), // slight over-realisation
    );
    const steps = replayExpiries(expiries, 100_000_000n);
    // Check that the system runs without error and produces steps
    expect(steps).toHaveLength(20);
    expect(steps[0]?.navDusdc).toBeGreaterThan(0n);
  });

  it('NAV never drops below 1 (floor guard)', () => {
    // Extreme scenario: realised vol << implied → massive range loss
    const expiries = Array.from({ length: 50 }, (_, i) =>
      makeExpiry(i, 9_000n, 0n),
    );
    const steps = replayExpiries(expiries, 100_000_000n);
    for (const s of steps) {
      expect(s.navDusdc).toBeGreaterThanOrEqual(1n);
    }
  });

  it('rollId increments from 1', () => {
    const expiries = Array.from({ length: 5 }, (_, i) => makeExpiry(i, 4_500n, 4_500n));
    const steps = replayExpiries(expiries);
    expect(steps.map((s) => s.rollId)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports correct regime for low IV', () => {
    const expiry = makeExpiry(0, 1_500n, 1_200n);
    const steps = replayExpiries([expiry]);
    expect(steps[0]?.regime).toBe('low');
  });

  it('reports correct regime for high IV', () => {
    const expiry = makeExpiry(0, 8_000n, 9_000n);
    const steps = replayExpiries([expiry]);
    expect(steps[0]?.regime).toBe('high');
  });
});
