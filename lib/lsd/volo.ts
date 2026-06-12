import type { SuiClient } from '@mysten/sui/client';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { z } from 'zod';
import { withRetry } from '../sui/client.js';
import { PRICE_SCALE_E9 } from '../constants.js';

// ─── On-chain schema ──────────────────────────────────────────────────────────

const VoloStakingPoolSchema = z.object({
  total_sui_supply: z.string().transform(BigInt),
  total_vsui_supply: z.string().transform(BigInt),
});

// ─── Exchange rate ────────────────────────────────────────────────────────────

/**
 * Returns the vSUI → SUI exchange rate, scaled e9.
 * rate_e9 = (total_sui_supply * PRICE_SCALE_E9) / total_vsui_supply
 */
export async function getVoloExchangeRateE9(
  client: SuiClient,
  stakingPoolId: string,
): Promise<bigint> {
  const result = await withRetry(() =>
    client.getObject({ id: stakingPoolId, options: { showContent: true } }),
  );
  const content = result.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Volo staking pool not found: ${stakingPoolId}`);
  }
  const pool = VoloStakingPoolSchema.parse(content.fields);
  if (pool.total_vsui_supply === 0n) return PRICE_SCALE_E9;
  return (pool.total_sui_supply * PRICE_SCALE_E9) / pool.total_vsui_supply;
}

// ─── PTB helpers ─────────────────────────────────────────────────────────────

/** The Move type string for vSUI. */
export const VSUI_MOVE_TYPE = '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT';

/**
 * Adds a Volo stake call to `tx`. Returns the vSUI coin argument.
 * This is an EXTERNAL-PENDING stub — the exact entry-point name must be
 * confirmed against the deployed Volo package on testnet.
 */
export function buildVoloStakeTx(
  tx: Transaction,
  suiCoin: TransactionArgument,
  stakingPoolId: string,
  packageId: string,
): TransactionArgument {
  const [vsuiOut] = tx.moveCall({
    package: packageId,
    module: 'native_pool',
    function: 'stake',
    arguments: [tx.object(stakingPoolId), suiCoin],
    typeArguments: [],
  });
  return vsuiOut as TransactionArgument;
}

/**
 * Adds a Volo unstake call to `tx`. Returns the SUI coin argument.
 */
export function buildVoloUnstakeTx(
  tx: Transaction,
  vsuiCoin: TransactionArgument,
  stakingPoolId: string,
  packageId: string,
): TransactionArgument {
  const [suiOut] = tx.moveCall({
    package: packageId,
    module: 'native_pool',
    function: 'unstake',
    arguments: [tx.object(stakingPoolId), vsuiCoin],
    typeArguments: [],
  });
  return suiOut as TransactionArgument;
}
