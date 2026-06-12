/**
 * Settlement watcher: polls the DeepBook Predict indexer every POLL_INTERVAL_MS
 * for newly settled oracles and emits 'settlement' events.
 *
 * Idempotency: each oracle_id is dedup'd in Redis so re-processing is a no-op.
 */

import { EventEmitter } from 'node:events';
import { listOracles, nearestActiveOracle } from '@reflux/lib';
import type { Oracle } from '@reflux/lib';
import { log } from './logger.js';
import type { IDedup } from './dedup.js';

export interface SettlementEvent {
  oracle: Oracle;
}

export declare interface SettlementWatcher {
  on(event: 'settlement', listener: (e: SettlementEvent) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  emit(event: 'settlement', e: SettlementEvent): boolean;
  emit(event: 'error', err: Error): boolean;
}

export class SettlementWatcher extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly indexerBaseUrl: string,
    private readonly dedup: IDedup,
    private readonly pollIntervalMs = 30_000,
  ) {
    super();
  }

  start() {
    if (this.running) return;
    this.running = true;
    log.info('SettlementWatcher started', { intervalMs: this.pollIntervalMs });
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    log.info('SettlementWatcher stopped');
  }

  private async poll() {
    try {
      const oracles = await listOracles(this.indexerBaseUrl);
      const settled = oracles.filter((o) => o.is_settled);
      for (const oracle of settled) {
        const isNew = await this.dedup.markSeen(`settlement:${oracle.id}`);
        if (isNew) {
          log.info('New settlement detected', { oracleId: oracle.id });
          this.emit('settlement', { oracle });
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error('SettlementWatcher poll failed', { error: e.message });
      this.emit('error', e);
    }
  }

  /** Returns the nearest active (non-settled) oracle, or undefined. */
  async getNextOracle(): Promise<Oracle | undefined> {
    const oracles = await listOracles(this.indexerBaseUrl);
    return nearestActiveOracle(oracles);
  }
}
