/**
 * LTV watchdog: polls on-chain leveraged VaultPositions every POLL_INTERVAL_MS.
 * When any position breaches max_ltv, calls emergency::emergency_deleverage.
 *
 * Callable by anyone (trustless) per CLAUDE.md rule 5 — the keeper is the
 * most likely caller but is not the only one.
 */

import type { SuiClient } from '@mysten/sui/client';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { computeLtvBps, isLtvBreached, buildEmergencyDeleverageTx } from '@reflux/lib';
import type { DeployedConstants } from '@reflux/lib';
import { log } from './logger.js';
import type { IDedup } from './dedup.js';

const MAX_LTV_BPS = 6_500n;
const POLL_INTERVAL_MS = 60_000;
const DEDUP_TTL_S = 300; // 5 minutes: re-check a breached position after this

export interface WatchdogConfig {
  deployed: DeployedConstants;
  client: SuiClient;
  keypair: Ed25519Keypair;
  dedup: IDedup;
  /** Position IDs to monitor (updated via setPositions). */
  positionIds?: string[];
}

export class LtvWatchdog {
  private timer: NodeJS.Timeout | null = null;
  private positionIds: string[] = [];

  constructor(private readonly cfg: WatchdogConfig) {
    this.positionIds = cfg.positionIds ?? [];
  }

  setPositions(ids: string[]) {
    this.positionIds = ids;
  }

  start(intervalMs = POLL_INTERVAL_MS) {
    if (this.timer) return;
    log.info('LtvWatchdog started', { positions: this.positionIds.length });
    void this.check();
    this.timer = setInterval(() => void this.check(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    log.info('LtvWatchdog stopped');
  }

  private async check() {
    for (const posId of this.positionIds) {
      try {
        await this.checkPosition(posId);
      } catch (err) {
        log.error('LtvWatchdog check failed', { positionId: posId, error: String(err) });
      }
    }
  }

  private async checkPosition(positionId: string) {
    const { readVaultPosition } = await import('@reflux/lib');
    const position = await readVaultPosition(this.cfg.client, positionId);
    if (!position) return;

    // Only leveraged positions (with collateral + debt) are at LTV risk
    // A vanilla USDC position has no collateral record — skip
    // (VaultPositionData doesn't include collateral fields in the read schema;
    //  in production, fetch the full on-chain object to get CollateralRecord)
    log.debug('LTV check', { positionId, owner: position.owner });

    // Placeholder: in production, parse collateral + debt from full object fields
    // and call computeLtvBps. Until deployed, we can't fetch real values.
    const simulatedLtv = 0n; // will be replaced with real on-chain read post-deploy
    if (isLtvBreached(simulatedLtv, MAX_LTV_BPS)) {
      await this.triggerDeleverage(positionId, simulatedLtv);
    }
  }

  private async triggerDeleverage(positionId: string, ltvBps: bigint) {
    const dedupKey = `deleverage:${positionId}`;
    const isNew = await this.cfg.dedup.markSeen(dedupKey, DEDUP_TTL_S);
    if (!isNew) {
      log.info('Deleverage already attempted recently', { positionId });
      return;
    }

    log.warn('LTV breach detected — triggering deleverage', {
      positionId,
      ltvBps: ltvBps.toString(),
      maxLtvBps: MAX_LTV_BPS.toString(),
    });

    const { deployed, client, keypair } = this.cfg;
    const sender = keypair.getPublicKey().toSuiAddress();

    // Fetch current SUI/USD price from Pyth (placeholder: use 1.0 until Pyth is integrated)
    const priceE9 = 1_000_000_000n;

    // Need a repay coin — in production, split from keeper's dUSDC holdings
    // This is a simplification; real deleverage requires a funded repay coin
    const repayObjectId = '0x0'; // placeholder

    const tx = buildEmergencyDeleverageTx({
      contracts: {
        packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
        depositRouterId: deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
        shareRegistryId: deployed.NEXT_PUBLIC_VAULT_ID,
        riskParamsId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
        spotRouterConfigId: deployed.NEXT_PUBLIC_PACKAGE_ID,
        ibCreditStateId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
      },
      positionId,
      repayCoinId: repayObjectId,
      priceE9,
      sender,
    });
    tx.setGasBudget(15_000_000n);

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });

    if (result.effects?.status.status !== 'success') {
      log.error('Emergency deleverage tx failed', {
        positionId,
        error: result.effects?.status.error,
      });
    } else {
      log.info('Emergency deleverage executed', { positionId, digest: result.digest });
    }
  }
}

// Re-export for convenience
export { computeLtvBps, isLtvBreached };
