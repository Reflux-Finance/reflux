import type { SuiClient } from '@mysten/sui/client';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { z } from 'zod';
import { withRetry } from '../sui/client.js';
import { PRICE_SCALE_E9 } from '../constants.js';

const HaedalStakingPoolSchema = z.object({
  staked_sui: z.string().transform(BigInt),
  hasui_supply: z.string().transform(BigInt),
});

/**
 * Returns the haSUI → SUI exchange rate, scaled e9.
 */
export async function getHaedalExchangeRateE9(
  client: SuiClient,
  stakingPoolId: string,
): Promise<bigint> {
  const result = await withRetry(() =>
    client.getObject({ id: stakingPoolId, options: { showContent: true } }),
  );
  const content = result.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Haedal staking pool not found: ${stakingPoolId}`);
  }
  const pool = HaedalStakingPoolSchema.parse(content.fields);
  if (pool.hasui_supply === 0n) return PRICE_SCALE_E9;
  return (pool.staked_sui * PRICE_SCALE_E9) / pool.hasui_supply;
}

export const HASUI_MOVE_TYPE =
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI';

export function buildHaedalStakeTx(
  tx: Transaction,
  suiCoin: TransactionArgument,
  stakingPoolId: string,
  packageId: string,
): TransactionArgument {
  const [hasuiOut] = tx.moveCall({
    package: packageId,
    module: 'haedal',
    function: 'stake',
    arguments: [tx.object(stakingPoolId), suiCoin],
    typeArguments: [],
  });
  return hasuiOut as TransactionArgument;
}

export function buildHaedalUnstakeTx(
  tx: Transaction,
  hasuiCoin: TransactionArgument,
  stakingPoolId: string,
  packageId: string,
): TransactionArgument {
  const [suiOut] = tx.moveCall({
    package: packageId,
    module: 'haedal',
    function: 'unstake',
    arguments: [tx.object(stakingPoolId), hasuiCoin],
    typeArguments: [],
  });
  return suiOut as TransactionArgument;
}
