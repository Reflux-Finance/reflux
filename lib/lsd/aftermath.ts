import type { SuiClient } from '@mysten/sui/client';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { z } from 'zod';
import { withRetry } from '../sui/client.js';
import { PRICE_SCALE_E9 } from '../constants.js';

const AftermathStakingPoolSchema = z.object({
  sui_amount: z.string().transform(BigInt),
  afsui_supply: z.string().transform(BigInt),
});

/**
 * Returns the afSUI → SUI exchange rate, scaled e9.
 */
export async function getAftermathExchangeRateE9(
  client: SuiClient,
  stakingPoolId: string,
): Promise<bigint> {
  const result = await withRetry(() =>
    client.getObject({ id: stakingPoolId, options: { showContent: true } }),
  );
  const content = result.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Aftermath staking pool not found: ${stakingPoolId}`);
  }
  const pool = AftermathStakingPoolSchema.parse(content.fields);
  if (pool.afsui_supply === 0n) return PRICE_SCALE_E9;
  return (pool.sui_amount * PRICE_SCALE_E9) / pool.afsui_supply;
}

export const AFSUI_MOVE_TYPE =
  '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI';

export function buildAftermathStakeTx(
  tx: Transaction,
  suiCoin: TransactionArgument,
  stakingPoolId: string,
  packageId: string,
): TransactionArgument {
  const [afsuiOut] = tx.moveCall({
    package: packageId,
    module: 'staking',
    function: 'stake',
    arguments: [tx.object(stakingPoolId), suiCoin],
    typeArguments: [],
  });
  return afsuiOut as TransactionArgument;
}

export function buildAftermathUnstakeTx(
  tx: Transaction,
  afsuiCoin: TransactionArgument,
  stakingPoolId: string,
  packageId: string,
): TransactionArgument {
  const [suiOut] = tx.moveCall({
    package: packageId,
    module: 'staking',
    function: 'unstake',
    arguments: [tx.object(stakingPoolId), afsuiCoin],
    typeArguments: [],
  });
  return suiOut as TransactionArgument;
}
