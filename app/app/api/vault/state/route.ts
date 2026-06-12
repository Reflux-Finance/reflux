/**
 * GET /api/vault/state
 *
 * Returns current vault NAV, roll count, share supply, and IB credit state.
 * Reads from on-chain objects; uses cached object reads (SuiClient handles caching).
 */

import { NextResponse } from 'next/server';
import { readVaultState, readShareRegistry, readIBCreditState, requireDeployed } from '@reflux/lib';
import { suiClient, env } from '../../_lib/client.js';
import { ok, serverErr, serializeBigInt } from '../../_lib/response.js';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const deployed = requireDeployed(env);

    const [vault, registry, ib] = await Promise.all([
      readVaultState(suiClient, deployed.NEXT_PUBLIC_VAULT_ID),
      readShareRegistry(suiClient, deployed.NEXT_PUBLIC_VAULT_ID),
      readIBCreditState(suiClient, deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID),
    ]);

    return ok(serializeBigInt({
      rollCount: vault.roll_count,
      lastNavDusdc: vault.last_nav_dusdc,
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
