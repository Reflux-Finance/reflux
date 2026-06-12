/**
 * Reflux keeper service entrypoint.
 *
 * Wires together:
 *  - SettlementWatcher  — polls predict indexer for settled oracles
 *  - Roller             — executes vault::roll_positions on settlement
 *  - LtvWatchdog        — monitors leveraged positions for LTV breaches
 *  - Healthcheck HTTP   — GET /health and GET /ready
 *
 * Required env vars (see .env.example):
 *   NEXT_PUBLIC_PACKAGE_ID, NEXT_PUBLIC_VAULT_ID, NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
 *   NEXT_PUBLIC_ALLOCATOR_ID, NEXT_PUBLIC_IB_CREDIT_STATE_ID, NEXT_PUBLIC_RFUSD_TYPE,
 *   KEEPER_PRIVATE_KEY
 *
 * Optional:
 *   UPSTASH_REDIS_URL     — Redis for dedup (falls back to in-memory)
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID — alerts
 */

import { readEnv, requireDeployed } from '@reflux/lib';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { SettlementWatcher } from './watcher.js';
import { Roller } from './roller.js';
import { LtvWatchdog } from './ltv-watchdog.js';
import { startHealthcheck, updateStatus } from './healthcheck.js';
import { DedupStore, MemoryDedupStore } from './dedup.js';
import type { IDedup } from './dedup.js';
import { log } from './logger.js';

async function main() {
  log.info('reflux-keeper starting');

  const env = readEnv(process.env as Record<string, string>);
  const deployed = requireDeployed(env);

  if (!env.KEEPER_PRIVATE_KEY) {
    log.error('KEEPER_PRIVATE_KEY is required');
    process.exit(1);
  }

  const keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  const sender = keypair.getPublicKey().toSuiAddress();
  log.info('Keeper address', { sender });

  const client = new SuiClient({ url: getFullnodeUrl(env.NEXT_PUBLIC_SUI_NETWORK) });

  // Dedup store: Redis if configured, in-memory fallback
  let dedup: IDedup;
  if (env.UPSTASH_REDIS_URL) {
    const store = new DedupStore(env.UPSTASH_REDIS_URL);
    await store.connect();
    updateStatus({ redis: 'connected' });
    log.info('Redis connected');
    dedup = store;
  } else {
    log.warn('UPSTASH_REDIS_URL not set — using in-memory dedup (not safe for multi-instance)');
    dedup = new MemoryDedupStore();
  }

  // Settlement watcher
  const watcher = new SettlementWatcher(
    env.NEXT_PUBLIC_PREDICT_SERVER,
    dedup,
    30_000,
  );

  // Roller
  const roller = new Roller({
    deployed,
    client,
    keypair,
    dedup,
    indexerBaseUrl: env.NEXT_PUBLIC_PREDICT_SERVER,
  });
  roller.attach(watcher);

  // LTV watchdog
  const watchdog = new LtvWatchdog({ deployed, client, keypair, dedup });

  // Healthcheck
  const stopHealthcheck = startHealthcheck(8080);

  // Start services
  watcher.start();
  updateStatus({ watcher: 'running' });

  watchdog.start(60_000);
  updateStatus({ ltvWatchdog: 'running' });

  log.info('reflux-keeper running');

  // Graceful shutdown
  async function shutdown(signal: string) {
    log.info('Shutting down', { signal });
    watcher.stop();
    watchdog.stop();
    stopHealthcheck();
    await dedup.disconnect();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Error resilience: log but keep running
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch((err) => {
  log.error('Fatal keeper error', { error: String(err) });
  process.exit(1);
});
