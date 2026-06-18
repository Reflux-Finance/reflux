/**
 * POST /api/swap
 *
 * Builds an unsigned spot swap PTB for any supported asset pair and returns it
 * as base64. The frontend signs and submits — this API never touches keys.
 *
 * Supported assets: sui | usdc | dusdc | rfbtc
 *
 * All swaps route through spot_router.move (all EXTERNAL-PENDING until DeepBook
 * Spot pool DR-1 resolves). The response includes `status: 'external_pending'`
 * so the frontend can surface this to the user before they sign.
 *
 * 2-hop routes (e.g. SUI → USDC) go via dUSDC as the intermediate asset.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  buildSwapTx,
  type SwapAsset,
  requireDeployed,
  REFLUX_OBJECTS,
} from '@reflux/lib';
import { suiClient, env } from '../_lib/client';
import { ok, validationErr, serverErr } from '../_lib/response';

export const dynamic = 'force-dynamic';

const bigintStr = z.string().regex(/^\d+$/).transform(BigInt);
const swapAsset = z.enum(['sui', 'usdc', 'dusdc', 'rfbtc']);

const BodySchema = z.object({
  fromAsset: swapAsset,
  toAsset: swapAsset,
  fromCoinId: z.string().min(1),
  /** Exact input amount in base units. Used to split the coin before swapping. */
  fromAmountBase: bigintStr,
  minAmountOut: bigintStr,
  sender: z.string().min(1),
});

function swapRoute(from: SwapAsset, to: SwapAsset): SwapAsset[] {
  const direct: `${SwapAsset}→${SwapAsset}`[] = [
    'sui→dusdc', 'dusdc→sui',
    'usdc→dusdc', 'dusdc→usdc',
    'rfbtc→dusdc', 'dusdc→rfbtc',
  ];
  if (direct.includes(`${from}→${to}` as `${SwapAsset}→${SwapAsset}`)) return [from, to];
  return [from, 'dusdc', to];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return validationErr(parsed.error);

  const { fromAsset, toAsset, fromCoinId, fromAmountBase, minAmountOut, sender } = parsed.data;

  if (fromAsset === toAsset) {
    return NextResponse.json(
      { ok: false, error: 'Cannot swap same asset' },
      { status: 400 },
    );
  }

  try {
    const deployed = requireDeployed(env);
    const contracts = {
      packageId:          deployed.NEXT_PUBLIC_PACKAGE_ID,
      depositRouterId:    deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
      shareRegistryId:    REFLUX_OBJECTS.shareRegistry,
      riskParamsId:       REFLUX_OBJECTS.riskParams,
      spotRouterConfigId: REFLUX_OBJECTS.spotRouterConfig,
      ibCreditStateId:    deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
    };

    const tx = buildSwapTx({ contracts, fromAsset, toAsset, fromCoinId, fromAmountBase, minAmountOut, sender });
    const bytes = await tx.build({ client: suiClient });
    const txBase64 = Buffer.from(bytes).toString('base64');
    const route = swapRoute(fromAsset, toAsset);

    return ok({ txBase64, route, status: 'external_pending' });
  } catch (e) {
    return serverErr(e);
  }
}
