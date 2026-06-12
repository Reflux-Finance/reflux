/**
 * Roller: executes vault::roll_positions when a settlement is confirmed.
 *
 * 1. Fetches current ATM IV from the SVI surface of the next active oracle.
 * 2. Builds and submits the roll PTB.
 * 3. Dedup-guards the oracle ID so duplicate calls are safe no-ops.
 */

import type { SuiClient } from '@mysten/sui/client';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  fetchSviParams,
  computeAtmIvE4,
  buildRollPositionsTx,
} from '@reflux/lib';
import type { DeployedConstants } from '@reflux/lib';
import { log } from './logger.js';
import type { IDedup } from './dedup.js';
import type { SettlementEvent } from './watcher.js';
import type { SettlementWatcher } from './watcher.js';

export interface RollerConfig {
  deployed: DeployedConstants;
  client: SuiClient;
  keypair: Ed25519Keypair;
  dedup: IDedup;
  indexerBaseUrl: string;
}

export class Roller {
  constructor(private readonly cfg: RollerConfig) {}

  /** Attach to a SettlementWatcher and roll on each event. */
  attach(watcher: SettlementWatcher): void {
    watcher.on('settlement', (evt) => void this.onSettlement(evt));
  }

  async onSettlement(evt: SettlementEvent): Promise<void> {
    const rollKey = `roll:${evt.oracle.id}`;
    const isNew = await this.cfg.dedup.markSeen(rollKey);
    if (!isNew) {
      log.info('Roll already processed — skipping', { oracleId: evt.oracle.id });
      return;
    }

    log.info('Starting roll', { oracleId: evt.oracle.id });

    try {
      // Fetch IV from the NEXT active oracle (not the just-settled one)
      const nextOracle = await this.getNextActiveOracle();
      let atmIvE4 = 4_500n; // neutral default when no next oracle

      if (nextOracle) {
        const svi = await fetchSviParams(nextOracle.id, this.cfg.indexerBaseUrl);
        atmIvE4 = computeAtmIvE4(svi, nextOracle.expiry_ts_ms);
        log.info('SVI ATM IV fetched', { oracleId: nextOracle.id, atmIvE4: atmIvE4.toString() });
      } else {
        log.warn('No next oracle — using neutral IV default');
      }

      const { deployed, client, keypair } = this.cfg;
      const sender = keypair.getPublicKey().toSuiAddress();

      const tx = buildRollPositionsTx({
        contracts: {
          packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
          depositRouterId: deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
          shareRegistryId: deployed.NEXT_PUBLIC_VAULT_ID,
          riskParamsId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
          spotRouterConfigId: deployed.NEXT_PUBLIC_PACKAGE_ID,
          ibCreditStateId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
          vaultStateId: deployed.NEXT_PUBLIC_VAULT_ID,
          keeperAuthId: deployed.NEXT_PUBLIC_VAULT_ID,
          allocationPolicyId: deployed.NEXT_PUBLIC_ALLOCATOR_ID,
          clockId: '0x6',
        },
        atmIvE4,
        sender,
      });
      tx.setGasBudget(30_000_000n);

      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status.status !== 'success') {
        throw new Error(`Roll tx failed: ${result.effects?.status.error ?? 'unknown'}`);
      }

      log.info('Roll executed', { digest: result.digest, oracleId: evt.oracle.id });
    } catch (err) {
      // On failure, un-mark so the next watcher poll can retry
      await this.cfg.dedup.markSeen(`${rollKey}:failed`);
      log.error('Roll failed', { oracleId: evt.oracle.id, error: String(err) });
      throw err;
    }
  }

  private async getNextActiveOracle() {
    const { listOracles, nearestActiveOracle } = await import('@reflux/lib');
    const oracles = await listOracles(this.cfg.indexerBaseUrl);
    return nearestActiveOracle(oracles);
  }
}
