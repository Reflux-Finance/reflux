/**
 * Roller: executes vault::roll_positions when a settlement is confirmed,
 * then rebalances the PLP sleeve in DeepBook Predict.
 *
 * Two-phase flow per settlement:
 *   Phase 1 — vault::roll_positions
 *     Updates the on-chain allocation weights + emits AllocationDecision.
 *     Signed by keeper; keeper holds KeeperCap.
 *
 *   Phase 2 — Predict PLP rebalance (best-effort, non-blocking)
 *     Compares new plpBps weight against currently deployed PLP (estimated
 *     from the keeper's wallet PLP balance) and calls predict::supply or
 *     predict::withdraw accordingly.
 *
 *     CRITICAL (see docs/INTEGRATION_NOTES.md §1.10):
 *     predict::supply / predict::withdraw have NO owner restriction —
 *     any sender holding the coin may call them. The vault CAN hold Coin<PLP>
 *     directly. The keeper acts as the execution agent for the rebalance.
 *
 * Dedup: both phases are keyed separately so a retry of phase 2 (e.g. after
 * a gas failure) doesn't re-trigger phase 1.
 */

import type { SuiClient } from '@mysten/sui/client';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  fetchSviParams,
  computeAtmIvE4,
  buildRollPositionsTx,
  buildPredictSupplyTx,
  buildPredictWithdrawTx,
  PREDICT_PACKAGE_ID,
  PREDICT_OBJECT_ID,
  DUSDC_TYPE,
  PLP_TYPE,
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

const PLP_SLEEVE_TARGET_BPS = 3_000n; // 30% default; overridden by AllocationDecision
const BPS_DENOM = 10_000n;

export class Roller {
  constructor(private readonly cfg: RollerConfig) {}

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
      const { deployed, client, keypair } = this.cfg;
      const sender = keypair.getPublicKey().toSuiAddress();

      // ── Phase 1: vault::roll_positions ──────────────────────────────────────
      const nextOracle = await this.getNextActiveOracle();
      let atmIvE4 = 4_500n; // neutral default when no next oracle

      if (nextOracle) {
        try {
          const svi = await fetchSviParams(nextOracle.id, this.cfg.indexerBaseUrl);
          atmIvE4 = computeAtmIvE4(svi, nextOracle.expiry_ts_ms);
          log.info('SVI ATM IV fetched', { oracleId: nextOracle.id, atmIvE4: atmIvE4.toString() });
        } catch (sviErr) {
          log.warn('SVI fetch failed — using neutral IV default', { error: String(sviErr) });
        }
      } else {
        log.warn('No next oracle — using neutral IV default');
      }

      const rollTx = buildRollPositionsTx({
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
      rollTx.setGasBudget(30_000_000n);

      const rollResult = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: rollTx,
        options: { showEffects: true },
      });

      if (rollResult.effects?.status.status !== 'success') {
        throw new Error(`Roll tx failed: ${rollResult.effects?.status.error ?? 'unknown'}`);
      }

      log.info('Roll executed', { digest: rollResult.digest, oracleId: evt.oracle.id });

      // ── Phase 2: Predict PLP rebalance (best-effort) ─────────────────────
      await this.rebalancePlp(sender, atmIvE4, evt.oracle.id).catch((err) => {
        log.warn('PLP rebalance failed (non-blocking)', { error: String(err) });
      });
    } catch (err) {
      await this.cfg.dedup.markSeen(`${rollKey}:failed`);
      log.error('Roll failed', { oracleId: evt.oracle.id, error: String(err) });
      throw err;
    }
  }

  /**
   * Rebalance the PLP sleeve.
   *
   * Computes how much dUSDC the keeper should supply to or withdraw from PLP
   * based on the current ATM IV regime. For the demo, we check the keeper's
   * existing Coin<PLP> and Coin<dUSDC> balances and rebalance proportionally.
   *
   * The actual strategy target (`plpBps`) comes from the AllocationDecision
   * event emitted by vault::roll_positions, but for the keeper integration
   * we use a hardcoded default until the on-chain event indexer is wired.
   */
  private async rebalancePlp(sender: string, atmIvE4: bigint, oracleId: string): Promise<void> {
    const rebalanceKey = `plp_rebalance:${oracleId}`;
    const isNew = await this.cfg.dedup.markSeen(rebalanceKey);
    if (!isNew) {
      log.info('PLP rebalance already done for this oracle', { oracleId });
      return;
    }

    const { client, keypair } = this.cfg;

    // Fetch keeper's dUSDC and PLP balances
    const dusdcBalances = await client.getCoins({ owner: sender, coinType: DUSDC_TYPE });
    const plpBalances = await client.getCoins({ owner: sender, coinType: PLP_TYPE });

    const totalDusdc = dusdcBalances.data.reduce(
      (s, c) => s + BigInt(c.balance),
      0n,
    );
    const totalPlp = plpBalances.data.reduce(
      (s, c) => s + BigInt(c.balance),
      0n,
    );

    // Estimate total managed capital = dUSDC + PLP (1:1 approximation)
    const totalCapital = totalDusdc + totalPlp;
    if (totalCapital === 0n) {
      log.info('PLP rebalance: no capital to manage');
      return;
    }

    // Determine target PLP from ATM IV regime
    // Low IV → less PLP, High IV → more PLP (matches allocator.move logic)
    const targetPlpBps = atmIvE4 < 3_000n ? 1_500n
      : atmIvE4 > 6_000n ? 4_500n
      : PLP_SLEEVE_TARGET_BPS;

    const targetPlp = (totalCapital * targetPlpBps) / BPS_DENOM;
    const delta = targetPlp > totalPlp ? targetPlp - totalPlp : 0n;
    const excess = totalPlp > targetPlp ? totalPlp - targetPlp : 0n;

    const predictContracts = {
      predictPackageId: PREDICT_PACKAGE_ID,
      predictObjectId: PREDICT_OBJECT_ID,
      dusdcType: DUSDC_TYPE,
      plpType: PLP_TYPE,
    };

    if (delta > 0n && dusdcBalances.data.length > 0) {
      // Need to supply more dUSDC to PLP
      const supplyAmount = delta < totalDusdc ? delta : totalDusdc;
      log.info('PLP rebalance: supplying dUSDC to PLP', { amount: supplyAmount.toString() });

      // Merge coins if needed, then supply
      const coinToSupply = dusdcBalances.data[0]!.coinObjectId;
      const supplyTx = buildPredictSupplyTx({
        contracts: predictContracts,
        dusdcCoinId: coinToSupply,
        sender,
      });
      supplyTx.setGasBudget(10_000_000n);

      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: supplyTx,
        options: { showEffects: true },
      });
      if (result.effects?.status.status === 'success') {
        log.info('PLP supply executed', { digest: result.digest });
      } else {
        log.warn('PLP supply failed', { error: result.effects?.status.error });
      }
    } else if (excess > 0n && plpBalances.data.length > 0) {
      // Need to withdraw excess PLP back to dUSDC
      log.info('PLP rebalance: withdrawing PLP to dUSDC', { amount: excess.toString() });

      const plpCoin = plpBalances.data[0]!.coinObjectId;
      const withdrawTx = buildPredictWithdrawTx({
        contracts: predictContracts,
        plpCoinId: plpCoin,
        sender,
      });
      withdrawTx.setGasBudget(10_000_000n);

      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: withdrawTx,
        options: { showEffects: true },
      });
      if (result.effects?.status.status === 'success') {
        log.info('PLP withdrawal executed', { digest: result.digest });
      } else {
        log.warn('PLP withdrawal failed', { error: result.effects?.status.error });
      }
    } else {
      log.info('PLP rebalance: allocation within tolerance, no action', {
        totalPlp: totalPlp.toString(),
        targetPlp: targetPlp.toString(),
      });
    }
  }

  private async getNextActiveOracle() {
    const { listOracles, nearestActiveOracle } = await import('@reflux/lib');
    const oracles = await listOracles(this.cfg.indexerBaseUrl);
    return nearestActiveOracle(oracles);
  }
}
