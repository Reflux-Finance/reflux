/**
 * POST /api/vault/withdraw
 *
 * Builds an unsigned withdraw PTB and returns it as base64.
 * Reads the live VaultPosition to decide:
 *  - full (withdraw, closes the position) vs partial (withdraw_partial, keeps it alive)
 *  - payout asset: real USDC when preferred_output is OUTPUT_USDC, raw dUSDC otherwise
 *
 * Body: { positionId, sharesCoinId, sharesAmount, minDusdcOut, sender }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  buildWithdrawTx,
  buildWithdrawPartialTx,
  readVaultState,
  readVaultPosition,
  requireDeployed,
  REFLUX_OBJECTS,
  PREFERRED_OUTPUT_USDC,
} from '@reflux/lib';
import { suiClient, env } from '../../_lib/client';
import { ok, err, validationErr, serverErr } from '../../_lib/response';

export const dynamic = 'force-dynamic';

const bigintStr = z.string().regex(/^\d+$/).transform(BigInt);

const BodySchema = z.object({
  positionId: z.string().min(1),
  sharesCoinId: z.string().min(1),
  /** Exact rfUSD base units to burn (9 decimals). Coin is split to this amount. */
  sharesAmount: bigintStr,
  /** Minimum dUSDC to receive (slippage guard). */
  minDusdcOut: bigintStr,
  sender: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return validationErr(parsed.error);

  try {
    const deployed = requireDeployed(env);
    const { positionId, sharesCoinId, sharesAmount, minDusdcOut, sender } = parsed.data;

    const [vaultState, position] = await Promise.all([
      readVaultState(suiClient, deployed.NEXT_PUBLIC_VAULT_ID),
      readVaultPosition(suiClient, positionId),
    ]);
    const nextRollId = vaultState.roll_count;

    if (sharesAmount > position.shares_minted) {
      return err('sharesAmount exceeds the position’s shares_minted', 422);
    }
    const isFull = sharesAmount === position.shares_minted;
    const payoutAsset = position.preferred_output === PREFERRED_OUTPUT_USDC ? 'usdc' : 'dusdc';

    const contracts = {
      packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
      depositRouterId: deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
      shareRegistryId: REFLUX_OBJECTS.shareRegistry,
      riskParamsId: REFLUX_OBJECTS.riskParams,
      spotRouterConfigId: REFLUX_OBJECTS.spotRouterConfig,
      ibCreditStateId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
    };

    // dusdc_to_usdc is a 1:1 zero-fee swap, so the dUSDC slippage bound applies unchanged.
    const tx = isFull
      ? buildWithdrawTx({
          contracts, positionId, sharesCoinId, sharesAmount, minDusdcOut, nextRollId,
          payoutAsset, minUsdcOut: minDusdcOut, sender,
        })
      : buildWithdrawPartialTx({
          contracts, positionId, sharesCoinId, sharesAmount, minDusdcOut, nextRollId,
          payoutAsset, minUsdcOut: minDusdcOut, sender,
        });

    const bytes = await tx.build({ client: suiClient });
    return ok({
      txBase64: Buffer.from(bytes).toString('base64'),
      kind: isFull ? 'withdraw' : 'withdraw_partial',
      payoutAsset,
    });
  } catch (e) {
    return serverErr(e);
  }
}
