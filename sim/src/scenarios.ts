/**
 * Stress scenarios for the simulation harness.
 *
 * Each scenario builds a synthetic expiry history that stresses specific
 * edge cases: low-IV regime, high-IV crash, sustained bear, recovery.
 */

import type { HistoricalExpiry } from './types.js';

/** Generates N expiries with a given constant ATM IV. */
export function flatIvScenario(
  n: number,
  atmIvE4: bigint,
  realisedVolE4: bigint,
  label: string,
): { label: string; expiries: HistoricalExpiry[] } {
  const now = Date.now();
  const window = 30 * 24 * 60 * 60 * 1000;
  return {
    label,
    expiries: Array.from({ length: n }, (_, i) => ({
      oracleId: `${label}-${i}`,
      openTimestampMs: now - (n - i) * window,
      expiryTimestampMs: now - (n - i - 1) * window,
      atmIvE4,
      settlementPriceE9: 1_000_000_000n,
      realisedVolE4,
    })),
  };
}

/**
 * IV spike scenario: N/2 neutral rolls, then N/2 high-IV rolls.
 * Simulates a volatility regime transition (e.g. market shock).
 */
export function ivSpikeScenario(n: number): { label: string; expiries: HistoricalExpiry[] } {
  const label = 'iv_spike';
  const half = Math.floor(n / 2);
  const now = Date.now();
  const window = 30 * 24 * 60 * 60 * 1000;

  const pre: HistoricalExpiry[] = Array.from({ length: half }, (_, i) => ({
    oracleId: `${label}-pre-${i}`,
    openTimestampMs: now - n * window + i * window,
    expiryTimestampMs: now - n * window + (i + 1) * window,
    atmIvE4: 4_000n,
    settlementPriceE9: 1_000_000_000n,
    realisedVolE4: 4_200n,
  }));

  const spike: HistoricalExpiry[] = Array.from({ length: n - half }, (_, i) => ({
    oracleId: `${label}-spike-${i}`,
    openTimestampMs: now - (n - half - i) * window,
    expiryTimestampMs: now - (n - half - i - 1) * window,
    atmIvE4: 8_000n, // high IV
    settlementPriceE9: 1_000_000_000n,
    realisedVolE4: 9_500n, // realised > implied → PLP profits
  }));

  return { label, expiries: [...pre, ...spike] };
}

/**
 * Bear-market scenario: IV compressed for a long time then normalises.
 * Tests IB floor enforcement over many rolls.
 */
export function bearMarketScenario(n: number): { label: string; expiries: HistoricalExpiry[] } {
  const label = 'bear_market';
  const now = Date.now();
  const window = 30 * 24 * 60 * 60 * 1000;

  return {
    label,
    expiries: Array.from({ length: n }, (_, i) => ({
      oracleId: `${label}-${i}`,
      openTimestampMs: now - (n - i) * window,
      expiryTimestampMs: now - (n - i - 1) * window,
      // First 2/3 compressed; last 1/3 normalises
      atmIvE4: i < Math.floor(n * 2 / 3) ? 1_500n : 4_500n,
      settlementPriceE9: 1_000_000_000n,
      realisedVolE4: i < Math.floor(n * 2 / 3) ? 1_200n : 4_000n,
    })),
  };
}

/** Alternating high/low scenario — regime-switch every window. */
export function oscillatingIvScenario(n: number): { label: string; expiries: HistoricalExpiry[] } {
  const label = 'oscillating_iv';
  const now = Date.now();
  const window = 30 * 24 * 60 * 60 * 1000;

  return {
    label,
    expiries: Array.from({ length: n }, (_, i) => ({
      oracleId: `${label}-${i}`,
      openTimestampMs: now - (n - i) * window,
      expiryTimestampMs: now - (n - i - 1) * window,
      atmIvE4: i % 2 === 0 ? 2_000n : 7_000n, // alternates low/high
      settlementPriceE9: 1_000_000_000n,
      realisedVolE4: i % 2 === 0 ? 1_800n : 7_500n,
    })),
  };
}

/** All built-in scenarios for the report. */
export function buildAllScenarios(nPerScenario = 50) {
  return [
    flatIvScenario(nPerScenario, 4_500n, 4_200n, 'neutral_baseline'),
    flatIvScenario(nPerScenario, 2_000n, 1_800n, 'persistent_low_iv'),
    flatIvScenario(nPerScenario, 7_500n, 8_000n, 'persistent_high_iv'),
    ivSpikeScenario(nPerScenario),
    bearMarketScenario(nPerScenario),
    oscillatingIvScenario(nPerScenario),
  ];
}
