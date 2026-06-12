import { BPS_DENOMINATOR, PRICE_SCALE_E9 } from '../constants.js';

/**
 * Compute LTV in basis points (10_000 = 100%).
 *
 * Formula mirrors contracts/sources/leverage.move:
 *   ltv_bps = debt_dusdc * BPS_DENOMINATOR * PRICE_SCALE_E9
 *             ─────────────────────────────────────────────
 *             collateral_amount * price_e9
 *
 * All arithmetic in bigint — no floating-point.
 */
export function computeLtvBps(
  collateralAmount: bigint,
  priceE9: bigint,
  debtDusdc: bigint,
): bigint {
  if (collateralAmount === 0n || priceE9 === 0n) return 0n;
  const numerator = debtDusdc * BPS_DENOMINATOR * PRICE_SCALE_E9;
  const denominator = collateralAmount * priceE9;
  return numerator / denominator;
}

/**
 * Compute the maximum borrow amount in dUSDC for given collateral at max LTV.
 *
 * max_borrow = collateral_amount * price_e9 * max_ltv_bps
 *              ──────────────────────────────────────────
 *              PRICE_SCALE_E9 * BPS_DENOMINATOR
 */
export function maxBorrowDusdc(
  collateralAmount: bigint,
  priceE9: bigint,
  maxLtvBps: bigint,
): bigint {
  return (collateralAmount * priceE9 * maxLtvBps) / (PRICE_SCALE_E9 * BPS_DENOMINATOR);
}

/**
 * Compute the collateral value in dUSDC.
 *
 * value_dusdc = collateral_amount * price_e9 / PRICE_SCALE_E9
 */
export function collateralValueDusdc(collateralAmount: bigint, priceE9: bigint): bigint {
  return (collateralAmount * priceE9) / PRICE_SCALE_E9;
}

/** True when LTV >= max LTV (emergency deleverage trigger). */
export function isLtvBreached(ltvBps: bigint, maxLtvBps: bigint): boolean {
  return ltvBps >= maxLtvBps;
}

/** Minimum repay needed to bring LTV below target. */
export function minRepayToTarget(
  collateralAmount: bigint,
  priceE9: bigint,
  currentDebt: bigint,
  targetLtvBps: bigint,
): bigint {
  const targetDebt = maxBorrowDusdc(collateralAmount, priceE9, targetLtvBps);
  if (currentDebt <= targetDebt) return 0n;
  return currentDebt - targetDebt;
}
