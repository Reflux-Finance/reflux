/**
 * Integration test: USDC deposit end-to-end on testnet.
 *
 * Prerequisites:
 *   1. Contracts deployed to testnet (NEXT_PUBLIC_PACKAGE_ID etc. in .env).
 *   2. KEEPER_PRIVATE_KEY set to a funded testnet keypair (with SUI + USDC).
 *   3. dUSDC obtained from faucet: https://tally.so/r/Xx102L
 *
 * Run:
 *   npx tsx tests/integration/deposit-usdc.ts
 *
 * On success, prints the transaction digest and the rfUSD share balance.
 */

import 'dotenv/config';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { getFullnodeUrl } from '@mysten/sui/client';
import { readEnv, requireDeployed } from '../../lib/constants.js';
import { computeAllocationTargets, DEFAULT_POLICY } from '../../lib/strategy/roll.js';
import { buildDepositUsdcTx } from '../../lib/sui/ptb.js';

async function main() {
  const env = readEnv(process.env as Record<string, string>);
  const deployed = requireDeployed(env);

  if (!env.KEEPER_PRIVATE_KEY) {
    throw new Error('KEEPER_PRIVATE_KEY must be set (testnet funded keypair).');
  }

  const keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  const sender = keypair.getPublicKey().toSuiAddress();
  console.log('Sender address:', sender);

  const client = new SuiClient({ url: getFullnodeUrl(env.NEXT_PUBLIC_SUI_NETWORK) });

  // Fetch USDC coins owned by the sender
  const usdcCoins = await client.getCoins({
    owner: sender,
    coinType: `${deployed.NEXT_PUBLIC_PACKAGE_ID}::types::USDC`,
  });
  if (!usdcCoins.data[0]) {
    throw new Error(
      'No USDC coins found in wallet. Mint testnet USDC first or check coinType.',
    );
  }
  const usdcCoin = usdcCoins.data[0];
  console.log('USDC coin:', usdcCoin.coinObjectId, 'balance:', usdcCoin.balance);

  // Build deposit PTB
  const tx = buildDepositUsdcTx({
    contracts: {
      packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
      depositRouterId: deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
      shareRegistryId: deployed.NEXT_PUBLIC_VAULT_ID,
      riskParamsId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
      spotRouterConfigId: deployed.NEXT_PUBLIC_PACKAGE_ID, // placeholder — update after deploy
      ibCreditStateId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
    },
    usdcCoinId: usdcCoin.coinObjectId,
    minSharesOut: 0n, // 0 for integration test; set slippage in production
    sender,
  });

  tx.setGasBudget(10_000_000n);

  // Dry-run first to catch errors before burning gas
  console.log('Dry-running transaction...');
  const dryRun = await client.dryRunTransactionBlock({
    transactionBlock: await tx.build({ client }),
  });
  if (dryRun.effects.status.status !== 'success') {
    console.error('Dry-run failed:', dryRun.effects.status);
    console.error('Errors:', dryRun.effects.status.error);
    process.exit(1);
  }
  console.log('Dry-run succeeded. Gas used:', dryRun.effects.gasUsed);

  // Sign and submit
  console.log('Signing and submitting transaction...');
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });

  console.log('\n=== Deposit succeeded ===');
  console.log('Digest:', result.digest);
  console.log('Status:', result.effects?.status?.status);

  // Show created rfUSD coins
  const created = result.objectChanges?.filter(
    (c) => c.type === 'created' && 'objectType' in c && c.objectType.includes('SHARE_TOKEN'),
  );
  if (created && created.length > 0) {
    console.log('rfUSD shares created:', JSON.stringify(created, null, 2));
  } else {
    console.log('Object changes:', JSON.stringify(result.objectChanges?.slice(0, 5), null, 2));
  }

  // Off-chain: preview allocation targets for current IV (neutral default)
  const atmIvE4 = 4_500n; // replace with live fetchSviParams() in production
  const targets = computeAllocationTargets(100_000_000n, atmIvE4, DEFAULT_POLICY);
  console.log('\n=== Allocation preview (neutral IV) ===');
  console.log('Regime:', targets.regime);
  console.log('PLP bps:', targets.plpBps.toString());
  console.log('Range bps:', targets.rangeBps.toString());
  console.log('IB idle bps:', targets.ibIdleBps.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
