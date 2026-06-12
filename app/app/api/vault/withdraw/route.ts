/**
 * POST /api/vault/withdraw
 *
 * Builds an unsigned withdraw PTB and returns it as base64.
 *
 * Body: { positionId, sharesCoinId, minDusdcOut, minUsdcOut, sender }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildWithdrawTx, requireDeployed } from '@reflux/lib';
import { suiClient, env } from '../../_lib/client.js';
import { ok, validationErr, serverErr } from '../../_lib/response.js';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  positionId: z.string().min(1),
  sharesCoinId: z.string().min(1),
  minDusdcOut: z.string().regex(/^\d+$/).transform(BigInt),
  minUsdcOut: z.string().regex(/^\d+$/).transform(BigInt).optional().default('0'),
  sender: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return validationErr(parsed.error);

  try {
    const deployed = requireDeployed(env);
    const { positionId, sharesCoinId, minDusdcOut, minUsdcOut, sender } = parsed.data;

    const tx = buildWithdrawTx({
      contracts: {
        packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
        depositRouterId: deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
        shareRegistryId: deployed.NEXT_PUBLIC_VAULT_ID,
        riskParamsId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
        spotRouterConfigId: deployed.NEXT_PUBLIC_PACKAGE_ID,
        ibCreditStateId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
      },
      positionId,
      sharesCoinId,
      minDusdcOut,
      minUsdcOut,
      sender,
    });

    const bytes = await tx.build({ client: suiClient });
    return ok({ txBase64: Buffer.from(bytes).toString('base64'), kind: 'withdraw' });
  } catch (e) {
    return serverErr(e);
  }
}
