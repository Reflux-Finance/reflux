/**
 * POST /api/vault/deposit
 *
 * Builds an unsigned deposit PTB and returns it as base64.
 * The frontend signs and submits the transaction — the API never touches keys.
 *
 * Body: { usdcCoinId: string, minSharesOut: string, sender: string }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildDepositUsdcTx, requireDeployed } from '@reflux/lib';
import { suiClient, env } from '../../_lib/client.js';
import { ok, validationErr, serverErr } from '../../_lib/response.js';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  usdcCoinId: z.string().min(1),
  minSharesOut: z.string().regex(/^\d+$/).transform(BigInt),
  sender: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return validationErr(parsed.error);

  try {
    const deployed = requireDeployed(env);
    const { usdcCoinId, minSharesOut, sender } = parsed.data;

    const tx = buildDepositUsdcTx({
      contracts: {
        packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
        depositRouterId: deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
        shareRegistryId: deployed.NEXT_PUBLIC_VAULT_ID,
        riskParamsId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
        spotRouterConfigId: deployed.NEXT_PUBLIC_PACKAGE_ID,
        ibCreditStateId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
      },
      usdcCoinId,
      minSharesOut,
      sender,
    });

    const bytes = await tx.build({ client: suiClient });
    const txBase64 = Buffer.from(bytes).toString('base64');

    return ok({ txBase64, kind: 'deposit_usdc' });
  } catch (e) {
    return serverErr(e);
  }
}
