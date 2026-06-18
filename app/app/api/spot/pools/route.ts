/**
 * GET /api/spot/pools
 *
 * Returns the current reserve amounts from the on-chain SpotRouterConfig shared
 * object. The frontend uses these to compute real CPAMM quotes client-side.
 *
 * Response shape:
 * {
 *   pools: {
 *     usdc_dusdc:   { a: string; b: string }   // USDC reserve, dUSDC reserve (1:1 treasury)
 *     sui_dusdc:    { a: string; b: string }   // SUI base units, dUSDC base units (CPAMM)
 *     rfbtc_dusdc:  { a: string; b: string }   // rfBTC base units, dUSDC base units (CPAMM)
 *   }
 *   funded: boolean   // true when all three pools have non-zero reserves on both sides
 * }
 *
 * Pool decimals:
 *   USDC/dUSDC: both 6 dec (ratio = 1:1)
 *   SUI/dUSDC:  SUI 9 dec, dUSDC 6 dec (ratio encodes $price)
 *   rfBTC/dUSDC: rfBTC 8 dec, dUSDC 6 dec (ratio encodes $price)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { suiClient, env } from '../../_lib/client';

export const dynamic = 'force-dynamic';

interface PoolReserves {
  a: string;
  b: string;
}

interface PoolsResponse {
  pools: {
    usdc_dusdc:  PoolReserves;
    sui_dusdc:   PoolReserves;
    rfbtc_dusdc: PoolReserves;
  };
  funded: boolean;
}

function extractBalance(fields: Record<string, unknown>, key: string): string {
  const raw = fields[key];
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'value' in raw) return String((raw as { value: unknown }).value);
  return '0';
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const configId = env.NEXT_PUBLIC_SPOT_ROUTER_CONFIG_ID ?? '';
  if (!configId) {
    const empty: PoolsResponse = {
      pools: {
        usdc_dusdc:  { a: '0', b: '0' },
        sui_dusdc:   { a: '0', b: '0' },
        rfbtc_dusdc: { a: '0', b: '0' },
      },
      funded: false,
    };
    return NextResponse.json({ ok: true, data: empty });
  }

  try {
    const obj = await suiClient.getObject({ id: configId, options: { showContent: true } });
    const content = obj.data?.content;

    if (!content || content.dataType !== 'moveObject') {
      return NextResponse.json({ ok: false, error: 'SpotRouterConfig not found' }, { status: 404 });
    }

    const fields = (content as { dataType: string; fields: Record<string, unknown> }).fields;

    const pools: PoolsResponse['pools'] = {
      usdc_dusdc:  { a: extractBalance(fields, 'usdc_reserve'), b: extractBalance(fields, 'dusdc_stable') },
      sui_dusdc:   { a: extractBalance(fields, 'sui_reserve'),  b: extractBalance(fields, 'dusdc_sui')    },
      rfbtc_dusdc: { a: extractBalance(fields, 'rfbtc_reserve'), b: extractBalance(fields, 'dusdc_rfbtc') },
    };

    // USDC/dUSDC pool is a treasury 1:1 swap sleeve (not seeded on testnet).
    // Treat as funded if both CPAMM pools (SUI/dUSDC and rfBTC/dUSDC) have liquidity.
    const funded =
      BigInt(pools.sui_dusdc.a) > 0n  && BigInt(pools.sui_dusdc.b) > 0n  &&
      BigInt(pools.rfbtc_dusdc.a) > 0n && BigInt(pools.rfbtc_dusdc.b) > 0n;

    return NextResponse.json({ ok: true, data: { pools, funded } }, {
      headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
