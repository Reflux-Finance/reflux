import { describe, expect, it, vi } from 'vitest';
import { MemoryDedupStore } from './dedup.js';
import { Roller } from './roller.js';
import type { SettlementEvent } from './watcher.js';

const MOCK_ID = '0x' + 'a'.repeat(64);

describe('Roller dedup', () => {
  it('skips a settlement already processed (idempotent)', async () => {
    const dedup = new MemoryDedupStore();
    const oracleId = MOCK_ID;

    // Pre-seed the dedup key as if a previous run already processed it
    await dedup.markSeen(`roll:${oracleId}`);

    let callCount = 0;

    // Spy to verify the real roll logic is never reached
    const deployed: Record<string, string> = {
      NEXT_PUBLIC_PACKAGE_ID: MOCK_ID,
      NEXT_PUBLIC_VAULT_ID: MOCK_ID,
      NEXT_PUBLIC_DEPOSIT_ROUTER_ID: MOCK_ID,
      NEXT_PUBLIC_ALLOCATOR_ID: MOCK_ID,
      NEXT_PUBLIC_IB_CREDIT_STATE_ID: MOCK_ID,
      NEXT_PUBLIC_RFUSD_TYPE: `${MOCK_ID}::share_token::SHARE_TOKEN`,
    };

    const mockClient = { signAndExecuteTransaction: vi.fn(async () => { callCount++; return { digest: '0x1', effects: { status: { status: 'success' } } }; }) };
    const mockKeypair = { getPublicKey: () => ({ toSuiAddress: () => MOCK_ID }) };

    const roller = new Roller({
      // @ts-expect-error partial mock
      deployed,
      // @ts-expect-error partial mock
      client: mockClient,
      // @ts-expect-error partial mock
      keypair: mockKeypair,
      dedup,
      indexerBaseUrl: 'http://mock',
    });

    const evt: SettlementEvent = {
      oracle: { id: oracleId, expiry_ts_ms: 1_000_000, is_settled: true },
    };

    await roller.onSettlement(evt);

    // signAndExecuteTransaction should NOT have been called
    expect(callCount).toBe(0);
  });
});
