/**
 * GET /api/risk
 *
 * Returns the current risk dashboard data:
 *   - Allocation weights (plp/range/ml/ib)
 *   - ATM IV and regime
 *   - Risk parameters (hard caps, max LTV, max buffer draw)
 *   - IB credit state
 *
 * Aggregates on-chain + indexer data into one response for the /risk page.
 */

import { NextResponse } from 'next/server';
import {
  readAllocationPolicy,
  readIBCreditState,
  listOracles,
  fetchSviParams,
  computeAtmIvE4,
  nearestActiveOracle,
  ivRegime,
  requireDeployed,
} from '@reflux/lib';
import { suiClient, env } from '../_lib/client.js';
import { ok, serverErr, serializeBigInt } from '../_lib/response.js';

export const dynamic = 'force-dynamic';

const IV_LOW_THRESHOLD_E4 = 3_000n;
const IV_HIGH_THRESHOLD_E4 = 6_000n;
const MAX_LTV_BPS = 6_500n;
const MAX_BUFFER_DRAW_BPS = 500n;

export async function GET(): Promise<NextResponse> {
  try {
    const deployed = requireDeployed(env);

    const [policy, ib, oracles] = await Promise.all([
      readAllocationPolicy(suiClient, deployed.NEXT_PUBLIC_ALLOCATOR_ID),
      readIBCreditState(suiClient, deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID),
      listOracles(env.NEXT_PUBLIC_PREDICT_SERVER),
    ]);

    const nextOracle = nearestActiveOracle(oracles);
    let atmIvE4 = 4_500n;
    let regime: 'low' | 'neutral' | 'high' = 'neutral';

    if (nextOracle) {
      const svi = await fetchSviParams(nextOracle.id, env.NEXT_PUBLIC_PREDICT_SERVER);
      atmIvE4 = computeAtmIvE4(svi, nextOracle.expiry_ts_ms);
      regime = ivRegime(atmIvE4, IV_LOW_THRESHOLD_E4, IV_HIGH_THRESHOLD_E4);
    }

    return ok(serializeBigInt({
      allocation: {
        plpBps: policy.base_plp_bps,
        rangeBps: policy.base_range_bps,
        marginLoopBps: policy.base_margin_loop_bps,
        ibIdleBps: policy.base_ib_idle_bps,
      },
      iv: {
        atmIvE4,
        atmIvPct: Number(atmIvE4) / 100,
        regime,
        ivLowThreshold: policy.iv_low_threshold,
        ivHighThreshold: policy.iv_high_threshold,
        nextOracleId: nextOracle?.id ?? null,
        nextExpiryTs: nextOracle?.expiry_ts_ms ?? null,
      },
      risk: {
        maxLtvBps: MAX_LTV_BPS,
        maxBufferDrawBps: MAX_BUFFER_DRAW_BPS,
      },
      ib: {
        parkedDusdc: ib.parked_balance ?? 0n,
        bufferDrawn: ib.buffer_drawn,
        venueTag: ib.venue_tag,
      },
    }));
  } catch (e) {
    return serverErr(e);
  }
}
