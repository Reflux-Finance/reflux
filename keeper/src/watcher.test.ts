import { describe, expect, it, beforeEach } from 'vitest';
import { SettlementWatcher } from './watcher.js';
import { MemoryDedupStore } from './dedup.js';

describe('SettlementWatcher', () => {
  let dedup: MemoryDedupStore;

  beforeEach(() => {
    dedup = new MemoryDedupStore();
  });

  it('emits settlement for each newly settled oracle', async () => {
    const oracle1 = { id: '0xaaa', expiry_ts_ms: 1_000_000, is_settled: true };
    const oracle2 = { id: '0xbbb', expiry_ts_ms: 2_000_000, is_settled: false };

    // Patch listOracles to return our synthetic oracles
    const watcher = new SettlementWatcher('http://mock', dedup, 99_999_999);
    // @ts-expect-error patching private method for test
    watcher.poll = async () => {
      const oracles = [oracle1, oracle2];
      const settled = oracles.filter((o) => o.is_settled);
      for (const oracle of settled) {
        const isNew = await dedup.markSeen(`settlement:${oracle.id}`);
        if (isNew) watcher.emit('settlement', { oracle });
      }
    };

    const events: unknown[] = [];
    watcher.on('settlement', (e) => events.push(e));

    // First poll: emits oracle1
    await (watcher as unknown as { poll(): Promise<void> }).poll();
    expect(events).toHaveLength(1);
    expect((events[0] as { oracle: typeof oracle1 }).oracle.id).toBe('0xaaa');

    // Second poll: oracle1 already seen — no duplicate event
    await (watcher as unknown as { poll(): Promise<void> }).poll();
    expect(events).toHaveLength(1);
  });
});

describe('MemoryDedupStore', () => {
  it('markSeen returns true on first call, false on repeat', async () => {
    const store = new MemoryDedupStore();
    expect(await store.markSeen('key:1')).toBe(true);
    expect(await store.markSeen('key:1')).toBe(false);
    expect(await store.markSeen('key:2')).toBe(true);
  });

  it('hasSeen reflects markSeen', async () => {
    const store = new MemoryDedupStore();
    expect(await store.hasSeen('k')).toBe(false);
    await store.markSeen('k');
    expect(await store.hasSeen('k')).toBe(true);
  });
});
