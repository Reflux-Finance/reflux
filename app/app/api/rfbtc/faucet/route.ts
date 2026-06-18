/**
 * POST /api/rfbtc/faucet
 *
 * Builds an unsigned PTB that calls rfbtc::faucet (or faucet_max when no
 * amount is given) to mint rfBTC to the sender. rfBTC is Reflux's own coin
 * with a shared treasury object — no external dependencies.
 *
 * After contracts are republished with rfbtc.move, set in .env:
 *   NEXT_PUBLIC_RFBTC_TREASURY_ID=<shared RfBtcTreasury object ID>
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildRfBtcFaucetTx, requireDeployed } from '@reflux/lib';
import { suiClient, env } from '../../_lib/client';
import { ok, validationErr, serverErr } from '../../_lib/response';

export const dynamic = 'force-dynamic';

// rfBTC has 8 decimals. FAUCET_MAX on-chain is 100_000_000_000 (1,000 rfBTC) —
// mirror that ceiling here so bad input fails fast with a clear message
// instead of a contract abort.
const FAUCET_MAX = 100_000_000_000n;

const BodySchema = z.object({
  sender: z.string().min(1),
  /** Base units (8 decimals) to mint. Defaults to FAUCET_MAX if omitted. */
  amount: z.coerce.bigint().positive().max(FAUCET_MAX).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return validationErr(parsed.error);

  const { sender, amount } = parsed.data;
  const treasuryId = env.NEXT_PUBLIC_RFBTC_TREASURY_ID;

  if (!treasuryId) {
    return NextResponse.json(
      { ok: false, error: 'rfBTC treasury not configured — republish contracts with rfbtc.move and set NEXT_PUBLIC_RFBTC_TREASURY_ID' },
      { status: 503 },
    );
  }

  try {
    const deployed = requireDeployed(env);
    const tx = buildRfBtcFaucetTx({
      packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
      rfBtcTreasuryId: treasuryId,
      sender,
      amount: amount?.toString(),
    });
    const bytes = await tx.build({ client: suiClient });
    const txBase64 = Buffer.from(bytes).toString('base64');

    return ok({ txBase64, amount: (amount ?? FAUCET_MAX).toString(), decimals: 8, symbol: 'rfBTC' });
  } catch (e) {
    return serverErr(e);
  }
}
