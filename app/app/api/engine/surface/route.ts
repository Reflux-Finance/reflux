/**
 * GET /api/engine/surface
 *
 * Returns the current SVI surface parameters and ATM IV for the nearest oracle.
 * Used by the strategy dashboard and the keeper to price positions.
 *
 * Query params:
 *   oracleId — optional; if omitted, uses the nearest active oracle
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listOracles, fetchSviParams, computeAtmIvE4, nearestActiveOracle, readEnv } from '@reflux/lib';
import { ok, serverErr, serializeBigInt } from '../../_lib/response.js';
import { env } from '../../_lib/client.js';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  oracleId: z.string().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const { oracleId } = QuerySchema.parse(params);

  try {
    const baseUrl = env.NEXT_PUBLIC_PREDICT_SERVER;
    let targetOracleId = oracleId;

    if (!targetOracleId) {
      const oracles = await listOracles(baseUrl);
      const next = nearestActiveOracle(oracles);
      if (!next) {
        return ok({ surface: null, message: 'No active oracles' });
      }
      targetOracleId = next.id;
    }

    const [oracles, svi] = await Promise.all([
      listOracles(baseUrl),
      fetchSviParams(targetOracleId, baseUrl),
    ]);

    const oracle = oracles.find((o) => o.id === targetOracleId);
    const expiryTs = oracle?.expiry_ts_ms ?? Date.now() + 30 * 24 * 60 * 60 * 1000;
    const atmIvE4 = computeAtmIvE4(svi, expiryTs);

    return ok(serializeBigInt({
      oracleId: targetOracleId,
      expiryTs,
      svi: {
        a: svi.a,
        b: svi.b,
        rho: svi.rho,
        m: svi.m,
        sigma: svi.sigma,
      },
      atmIvE4,
      atmIvPct: Number(atmIvE4) / 100, // human-readable: 4500 → 45.00%
    }));
  } catch (e) {
    return serverErr(e);
  }
}
