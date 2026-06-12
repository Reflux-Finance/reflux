/**
 * Redis-backed deduplication for idempotent keeper operations.
 *
 * A settlement or roll keyed by oracle ID is stored for 7 days.
 * Re-processing the same key is a safe no-op.
 */

import Redis from 'ioredis';

export class DedupStore {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }

  /** Returns true if the key was new (first time seen). False = already processed. */
  async markSeen(key: string, ttlSeconds = 7 * 24 * 3600): Promise<boolean> {
    const result = await this.redis.set(`reflux:dedup:${key}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async hasSeen(key: string): Promise<boolean> {
    return (await this.redis.exists(`reflux:dedup:${key}`)) === 1;
  }
}

/** In-memory fallback dedup store (used when Redis is not configured). */
export class MemoryDedupStore {
  private seen = new Set<string>();

  async markSeen(key: string): Promise<boolean> {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  async hasSeen(key: string): Promise<boolean> {
    return this.seen.has(key);
  }

  // No-op lifecycle methods for interface compatibility
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

export type IDedup = {
  markSeen(key: string, ttlSeconds?: number): Promise<boolean>;
  hasSeen(key: string): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
};
