/**
 * GET /api/vault/state
 *
 * Returns current vault NAV, roll count, share supply, and IB credit state.
 * Reads from on-chain objects; uses cached object reads (SuiClient handles caching).
 */

import { NextResponse } from 'next/server';
import { readVaultState, readShareRegistry, readIBCreditState, readDepositPool, requireDeployed, REFLUX_OBJECTS } from '@reflux/lib';
import { suiClient, env } from '../../_lib/client';
import { ok, serverErr, serializeBigInt } from '../../_lib/response';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const deployed = requireDeployed(env);

    const [vault, registry, ib, pool] = await Promise.all([
      readVaultState(suiClient, deployed.NEXT_PUBLIC_VAULT_ID),
      readShareRegistry(suiClient, REFLUX_OBJECTS.shareRegistry),
      readIBCreditState(suiClient, deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID),
      readDepositPool(suiClient, REFLUX_OBJECTS.depositPool),
    ]);

    // last_nav_dusdc is a snapshot only refreshed by the keeper roll — it goes
    // stale the moment a deposit/withdrawal lands after the last roll. Compute
    // the live figure the same way roll_demo does (pool balance + IB parked)
    // so the dashboard/landing TVL reflect deposits before the next roll fires.
    const liveNavDusdc = pool.dusdc + (ib.parked_balance ?? 0n);

    return ok(serializeBigInt({
      rollCount: vault.roll_count,
      lastNavDusdc: vault.last_nav_dusdc,
      liveNavDusdc,
      lastRollTs: vault.last_roll_ts,
      totalSupply: registry.total_supply,
      navPerShareE9: registry.nav_per_share_e9,
      ibParkedDusdc: ib.parked_balance ?? 0n,
      ibBufferDrawn: ib.buffer_drawn,
    }));
  } catch (e) {
    return serverErr(e);
  }
}
