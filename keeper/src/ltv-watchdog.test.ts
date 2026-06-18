import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LtvWatchdog } from './ltv-watchdog.js';
import { MemoryDedupStore } from './dedup.js';

const MOCK_ID = '0x' + 'a'.repeat(64);
const MOCK_POS_ID = '0x' + 'b'.repeat(64);

function makeConfig(dedup: MemoryDedupStore, signAndExecute: ReturnType<typeof vi.fn>) {
  return {
    deployed: {
      NEXT_PUBLIC_PACKAGE_ID: MOCK_ID,
      NEXT_PUBLIC_VAULT_ID: MOCK_ID,
      NEXT_PUBLIC_DEPOSIT_ROUTER_ID: MOCK_ID,
      NEXT_PUBLIC_ALLOCATOR_ID: MOCK_ID,
      NEXT_PUBLIC_IB_CREDIT_STATE_ID: MOCK_ID,
      NEXT_PUBLIC_RFUSD_TYPE: `${MOCK_ID}::share_token::SHARE_TOKEN`,
    },
    client: { signAndExecuteTransaction: signAndExecute } as never,
    keypair: { getPublicKey: () => ({ toSuiAddress: () => MOCK_ID }) } as never,
    dedup,
  };
}

describe('LtvWatchdog.triggerDeleverage', () => {
  it('calls signAndExecuteTransaction on first breach', async () => {
    const dedup = new MemoryDedupStore();
    const tx = vi.fn(async () => ({
      digest: '0xdig',
      effects: { status: { status: 'success' } },
    }));
    const watchdog = new LtvWatchdog(makeConfig(dedup, tx));

    // Access private method via cast for adversarial test
    await (watchdog as unknown as { triggerDeleverage(id: string, ltv: bigint): Promise<void> })
      .triggerDeleverage(MOCK_POS_ID, 7_000n);

    expect(tx).toHaveBeenCalledOnce();
  });

  it('is idempotent — does NOT re-trigger within dedup window', async () => {
    const dedup = new MemoryDedupStore();
    const tx = vi.fn(async () => ({
      digest: '0xdig',
      effects: { status: { status: 'success' } },
    }));
    const watchdog = new LtvWatchdog(makeConfig(dedup, tx));
    const trigger = (watchdog as unknown as { triggerDeleverage(id: string, ltv: bigint): Promise<void> })
      .triggerDeleverage.bind(watchdog);

    await trigger(MOCK_POS_ID, 7_000n);
    await trigger(MOCK_POS_ID, 7_500n); // second call same position
    await trigger(MOCK_POS_ID, 8_000n); // third call same position

    // Only the first call should have gone through
    expect(tx).toHaveBeenCalledOnce();
  });

  it('triggers independently for different positions', async () => {
    const dedup = new MemoryDedupStore();
    const tx = vi.fn(async () => ({
      digest: '0xdig',
      effects: { status: { status: 'success' } },
    }));
    const watchdog = new LtvWatchdog(makeConfig(dedup, tx));
    const trigger = (watchdog as unknown as { triggerDeleverage(id: string, ltv: bigint): Promise<void> })
      .triggerDeleverage.bind(watchdog);

    const posA = '0x' + 'a'.repeat(64);
    const posB = '0x' + 'c'.repeat(64);

    await trigger(posA, 7_000n);
    await trigger(posB, 7_100n);

    expect(tx).toHaveBeenCalledTimes(2);
  });

  it('logs error and continues when tx fails', async () => {
    const dedup = new MemoryDedupStore();
    const tx = vi.fn(async () => ({
      digest: '0xdig',
      effects: { status: { status: 'failure', error: 'abort' } },
    }));
    const watchdog = new LtvWatchdog(makeConfig(dedup, tx));
    const trigger = (watchdog as unknown as { triggerDeleverage(id: string, ltv: bigint): Promise<void> })
      .triggerDeleverage.bind(watchdog);

    // Should not throw even if tx failed
    await expect(trigger(MOCK_POS_ID, 9_000n)).resolves.not.toThrow();
    expect(tx).toHaveBeenCalledOnce();
  });
});

describe('LtvWatchdog lifecycle', () => {
  it('start/stop does not throw', () => {
    const dedup = new MemoryDedupStore();
    const watchdog = new LtvWatchdog(makeConfig(dedup, vi.fn()));
    expect(() => watchdog.start(9_999_999)).not.toThrow();
    expect(() => watchdog.stop()).not.toThrow();
  });

  it('setPositions updates monitored list', () => {
    const dedup = new MemoryDedupStore();
    const watchdog = new LtvWatchdog(makeConfig(dedup, vi.fn()));
    watchdog.setPositions([MOCK_POS_ID, '0x' + 'f'.repeat(64)]);
    // @ts-expect-error accessing private field for assertion
    expect(watchdog.positionIds).toHaveLength(2);
  });

  it('double start is a no-op (does not create two intervals)', () => {
    const dedup = new MemoryDedupStore();
    const watchdog = new LtvWatchdog(makeConfig(dedup, vi.fn()));
    watchdog.start(9_999_999);
    const timerBefore = (watchdog as unknown as { timer: NodeJS.Timeout | null }).timer;
    watchdog.start(9_999_999); // second start
    const timerAfter = (watchdog as unknown as { timer: NodeJS.Timeout | null }).timer;
    expect(timerBefore).toBe(timerAfter);
    watchdog.stop();
  });
});
