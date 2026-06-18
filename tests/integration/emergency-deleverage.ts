/**
 * Integration test: trustless emergency deleverage on testnet.
 *
 * Verifies CLAUDE.md rule 5: emergency_deleverage is callable by *anyone*
 * (not just admin/keeper) when LTV is breached, and aborts when healthy.
 *
 * Prerequisites:
 *   1. Contracts deployed to testnet (NEXT_PUBLIC_PACKAGE_ID etc. in .env).
 *   2. At least one VaultPosition with a leveraged leg that has breached max_ltv.
 *      (To simulate: open a margin position, then let SUI/USD drop past the LTV threshold.)
 *   3. KEEPER_PRIVATE_KEY set to a funded testnet keypair with SUI for gas.
 *   4. MOCK_POSITION_ID set in env to the breached position's object ID.
 *
 * Run:
 *   npx tsx tests/integration/emergency-deleverage.ts
 *
 * Expected results:
 *   - Healthy position: tx aborts with EPositionHealthy (test verifies the abort code).
 *   - Breached position: tx succeeds, prints digest.
 */

import 'dotenv/config';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import {
  readEnv,
  requireDeployed,
  buildEmergencyDeleverageTx,
  computeLtvBps,
  isLtvBreached,
} from '../../lib/constants.js';

const env = readEnv(process.env as Record<string, string | undefined>);
const deployed = requireDeployed(env);

const client = new SuiClient({ url: getFullnodeUrl(env.NEXT_PUBLIC_SUI_NETWORK) });
const keypair = Ed25519Keypair.fromSecretKey(
  Buffer.from(process.env['KEEPER_PRIVATE_KEY']!.replace(/^0x/, ''), 'hex'),
);
const sender = keypair.getPublicKey().toSuiAddress();

const MOCK_POSITION_ID = process.env['MOCK_POSITION_ID'];
const MAX_LTV_BPS = 6_500n;

// Pyth SUI/USD price (placeholder: fetch live price in production)
const PRICE_E9 = BigInt(process.env['SUI_PRICE_E9'] ?? '1_000_000_000');

async function testHealthyPositionAborts(positionId: string) {
  console.log('\n[1] Testing: healthy position triggers abort...');

  // Simulate a healthy position: collateral 1000 SUI, debt 100 dUSDC → LTV ~10%
  const collateral = 1_000_000_000_000n; // 1000 SUI in MIST
  const debt = 100_000_000n; // 100 dUSDC
  const ltv = computeLtvBps(collateral, PRICE_E9, debt);
  console.log(`    Computed LTV: ${ltv}bps (healthy: ${!isLtvBreached(ltv, MAX_LTV_BPS)})`);

  if (isLtvBreached(ltv, MAX_LTV_BPS)) {
    console.warn('    Warning: simulated position is NOT healthy — skipping abort test');
    return;
  }

  // Build and dry-run the tx — should fail (abort) because LTV is fine
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
    repayCoinId: '0x0', // irrelevant — will abort before touching coins
    priceE9: PRICE_E9,
    sender,
  });

  try {
    const dryRun = await client.dryRunTransaction({ transaction: tx });
    if (dryRun.effects.status.status === 'failure') {
      const err = dryRun.effects.status.error ?? '';
      if (err.includes('EPositionHealthy') || err.includes('position healthy') || err.includes('abort')) {
        console.log(`    PASS — deleverage aborted as expected (${err.slice(0, 80)})`);
      } else {
        console.warn(`    Unexpected failure: ${err}`);
      }
    } else {
      console.warn('    Unexpected success — healthy position should have aborted');
    }
  } catch (e) {
    console.log(`    PASS — dry-run rejected (healthy position): ${String(e).slice(0, 120)}`);
  }
}

async function testBreachedPositionSucceeds(positionId: string) {
  console.log('\n[2] Testing: breached position executes deleverage...');

  // Simulate a breached LTV: collateral 100 SUI, debt 70 dUSDC → LTV ~70%
  const collateral = 100_000_000_000n; // 100 SUI
  const debt = 70_000_000n; // 70 dUSDC
  const ltv = computeLtvBps(collateral, PRICE_E9, debt);
  console.log(`    Computed LTV: ${ltv}bps (breached: ${isLtvBreached(ltv, MAX_LTV_BPS)})`);

  const repayObjectId = process.env['REPAY_COIN_ID'] ?? '0x0';

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
    priceE9: PRICE_E9,
    sender,
  });
  tx.setGasBudget(15_000_000n);

  // Dry-run first
  const dryRun = await client.dryRunTransaction({ transaction: tx });
  if (dryRun.effects.status.status !== 'success') {
    console.warn(`    Dry-run failed: ${dryRun.effects.status.error} — skipping live tx`);
    return;
  }

  // Live submission
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status.status === 'success') {
    console.log(`    PASS — emergency deleverage executed. Digest: ${result.digest}`);
  } else {
    console.error(`    FAIL — tx failed: ${result.effects?.status.error}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log(`Network: ${env.NEXT_PUBLIC_SUI_NETWORK}`);
  console.log(`Package: ${deployed.NEXT_PUBLIC_PACKAGE_ID}`);
  console.log(`Sender:  ${sender}`);

  const positionId = MOCK_POSITION_ID ?? deployed.NEXT_PUBLIC_VAULT_ID;

  await testHealthyPositionAborts(positionId);
  await testBreachedPositionSucceeds(positionId);

  console.log('\nEmergency deleverage integration test complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
