import { z } from 'zod';
import type { SuiClient } from '@mysten/sui/client';
import { withRetry } from '../sui/client.js';
import { BPS_DENOMINATOR, PRICE_SCALE_E9 } from '../constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export const MarginPositionSchema = z.object({
  id: z.string(),
  collateral_type: z.string(),
  collateral_amount: z.string().transform(BigInt),
  debt_dusdc: z.string().transform(BigInt),
});
export type MarginPosition = z.infer<typeof MarginPositionSchema>;

// ─── LTV math (bigint only) ───────────────────────────────────────────────────

/**
 * Compute LTV in basis points (10000 = 100%).
 *
 * ltv_bps = (debt_dusdc * 10000 * PRICE_SCALE_E9) / (collateral_amount * price_e9)
 *
 * Intermediate multiplication uses u128-equivalent (bigint) to avoid overflow.
 */
export function computeMarginLtvBps(
  collateralAmount: bigint,
  priceE9: bigint,
  debtDusdc: bigint,
): bigint {
  if (collateralAmount === 0n || priceE9 === 0n) return 0n;
  const numerator = debtDusdc * BPS_DENOMINATOR * PRICE_SCALE_E9;
  const denominator = collateralAmount * priceE9;
  return numerator / denominator;
}

// ─── On-chain read ────────────────────────────────────────────────────────────

export async function readMarginPosition(
  client: SuiClient,
  positionId: string,
): Promise<MarginPosition> {
  const result = await withRetry(() =>
    client.getObject({ id: positionId, options: { showContent: true } }),
  );
  const content = result.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Not a Move object: ${positionId}`);
  }
  return MarginPositionSchema.parse(content.fields);
}
