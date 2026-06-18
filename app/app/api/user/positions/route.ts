/**
 * GET /api/user/positions?address=0x…
 *
 * Returns the connected user's rfUSD balance and VaultPosition objects.
 * All on-chain reads — no authentication required (read-only, public chain state).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { suiClient, env } from '../../_lib/client';
import { REFLUX_OBJECTS } from '@reflux/lib';

export const dynamic = 'force-dynamic';

const SUI_OBJECT_ID = /^0x[0-9a-fA-F]{1,64}$/;
const addressSchema = z.string().regex(SUI_OBJECT_ID, 'invalid Sui address');

const RFUSD_TYPE =
  env.NEXT_PUBLIC_RFUSD_TYPE ??
  `${env.NEXT_PUBLIC_PACKAGE_ID ?? ''}::share_token::SHARE_TOKEN`;

// Types are always bound to the ORIGINAL (v1) package ID in Sui Move upgrades —
// even objects created by calling the upgraded (v2) package use the original address.
// Derive the original package ID from RFUSD_TYPE which already carries the correct address.
const ORIGINAL_PKG_ID =
  (env.NEXT_PUBLIC_RFUSD_TYPE ?? '').split('::')[0] ||
  env.NEXT_PUBLIC_PACKAGE_ID ||
  '';

const VAULT_POSITION_TYPE = ORIGINAL_PKG_ID
  ? `${ORIGINAL_PKG_ID}::deposit_router::VaultPosition`
  : null;

interface VaultPositionFields {
  owner: string;
  shares_minted: string;
  deposit_ts_ms: string;
  preferred_output: number;
  collateral?: unknown;
  debt?: unknown;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const address = req.nextUrl.searchParams.get('address') ?? '';
  const parsed = addressSchema.safeParse(address);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'address param missing or invalid' },
      { status: 400 },
    );
  }

  try {
    // ── rfUSD balance ─────────────────────────────────────────────────────────
    const balanceResult = RFUSD_TYPE
      ? await suiClient.getBalance({ owner: parsed.data, coinType: RFUSD_TYPE })
      : { totalBalance: '0' };

    const rfusdRaw = balanceResult.totalBalance;

    // ── NAV per share (from share registry, which holds nav_per_share_e9) ─────
    let navPerShareE9 = '1000000000'; // default 1.0 if registry not readable
    try {
      const regObj = await suiClient.getObject({
        id: REFLUX_OBJECTS.shareRegistry,
        options: { showContent: true },
      });
      if (regObj.data?.content?.dataType === 'moveObject') {
        const fields = regObj.data.content.fields as Record<string, unknown>;
        if (fields.nav_per_share_e9) {
          navPerShareE9 = String(fields.nav_per_share_e9);
        }
      }
    } catch {
      // Non-fatal — fall back to 1.0 NAV.
    }

    // rfUSD has 6 decimals; navPerShareE9 is e9-scaled (1e9 = 1.0).
    // dUSDC out (6 dec) = rfusdRaw × navPerShareE9 / 1e9
    const usdValueMicro =
      (BigInt(rfusdRaw) * BigInt(navPerShareE9)) / 1_000_000_000n;
    const usdValue = `$${(Number(usdValueMicro) / 1_000_000).toFixed(2)}`;
    const navDisplay = (Number(navPerShareE9) / 1e9).toFixed(6);

    // ── VaultPosition objects ─────────────────────────────────────────────────
    const positions: Array<{
      objectId: string;
      sharesMinted: string;
      depositTsMs: string;
      hasCollateral: boolean;
      hasDebt: boolean;
      preferredOutput: number;
    }> = [];

    if (VAULT_POSITION_TYPE) {
      const owned = await suiClient.getOwnedObjects({
        owner: parsed.data,
        filter: { StructType: VAULT_POSITION_TYPE },
        options: { showContent: true },
      });

      for (const item of owned.data) {
        if (
          item.data?.content?.dataType !== 'moveObject' ||
          !item.data.objectId
        ) {
          continue;
        }
        const fields = item.data.content.fields as unknown as VaultPositionFields;
        positions.push({
          objectId: item.data.objectId,
          sharesMinted: String(fields.shares_minted ?? '0'),
          depositTsMs: String(fields.deposit_ts_ms ?? '0'),
          hasCollateral: Boolean(fields.collateral),
          hasDebt: Boolean(fields.debt),
          preferredOutput: Number(fields.preferred_output ?? 0),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        rfusdRaw,
        usdValue,
        navPerShare: navDisplay,
        navPerShareE9,
        rfusdBalance: (Number(rfusdRaw) / 1e6).toFixed(3),
        positions,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Failed to fetch positions',
      },
      { status: 500 },
    );
  }
}
