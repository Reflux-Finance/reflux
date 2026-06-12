import type { SviParams } from '../deepbook/predict.js';
import { IV_SCALE_E4 } from '../constants.js';

/**
 * SVI (Stochastic Volatility Inspired) total-variance surface.
 *
 * w(k) = a + b * (rho * (k - m) + sqrt((k - m)^2 + sigma^2))
 *
 * ATM means k = log(K/F) = 0.
 * ATM total variance: w(0) = a + b * (rho * (-m) + sqrt(m^2 + sigma^2))
 * ATM annualised IV:  iv   = sqrt(w(0) / T)   where T is time in years.
 *
 * The SVI params from the indexer are floating-point. We compute ATM IV as a
 * number, then convert to bigint scaled e4 (10_000 = 100%).
 *
 * Floating-point is acceptable here because:
 *  (a) SVI params come from an external HTTP API (already float).
 *  (b) The result is converted to bigint e4 before being used in any
 *      allocation decision — it never enters on-chain NAV math.
 */
export function computeAtmIvE4(params: SviParams, expiryTsMs: number, nowMs = Date.now()): bigint {
  const { a, b, rho, m, sigma } = params;

  const tte = Math.max((expiryTsMs - nowMs) / (365.25 * 24 * 60 * 60 * 1000), 1e-6);

  const inner = Math.sqrt(m * m + sigma * sigma);
  const w0 = a + b * (rho * -m + inner);
  if (w0 <= 0) return 0n;

  const iv = Math.sqrt(w0 / tte);
  // iv is annualised vol, e.g. 0.60 = 60%. Scale to e4: 6000.
  return BigInt(Math.round(iv * Number(IV_SCALE_E4)));
}

/**
 * Determine the IV regime label from ATM IV vs thresholds.
 * Matches allocator.move regime logic:
 *   atm_iv < iv_low  → 'low'
 *   atm_iv > iv_high → 'high'
 *   otherwise        → 'neutral'
 */
export function ivRegime(
  atmIvE4: bigint,
  ivLowE4: bigint,
  ivHighE4: bigint,
): 'low' | 'neutral' | 'high' {
  if (atmIvE4 < ivLowE4) return 'low';
  if (atmIvE4 > ivHighE4) return 'high';
  return 'neutral';
}

/** Scale a raw (float) IV (e.g. 0.60) to the e4 bigint representation (6000). */
export function ivToE4(rawIv: number): bigint {
  return BigInt(Math.round(rawIv * Number(IV_SCALE_E4)));
}

/** Convert an e4 bigint IV back to a float (for display only). */
export function ivFromE4(ivE4: bigint): number {
  return Number(ivE4) / Number(IV_SCALE_E4);
}
