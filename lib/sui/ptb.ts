/**
 * Pure PTB (Programmable Transaction Block) builder functions.
 *
 * Rules:
 *  - Every exported function is pure: no side effects, no network calls.
 *  - All object IDs are passed in as parameters (testable with mocked IDs).
 *  - All amounts are bigint.
 *  - Slippage protection (min_out) is required on every swap/mint/burn.
 */

import { Transaction } from '@mysten/sui/transactions';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface RefluxContracts {
  packageId: string;
  depositRouterId: string;
  shareRegistryId: string;
  riskParamsId: string;
  spotRouterConfigId: string;
  ibCreditStateId: string;
}

// ─── Deposit USDC ─────────────────────────────────────────────────────────────

export interface DepositUsdcParams {
  contracts: RefluxContracts;
  /** Object ID of the USDC coin to deposit. */
  usdcCoinId: string;
  /** Minimum rfUSD shares to receive (slippage guard). */
  minSharesOut: bigint;
  /** Sender address (used to split gas). */
  sender: string;
}

/**
 * Build a PTB that calls deposit_router::deposit_usdc.
 *
 * Calls (production path, requires external spot_router to swap USDC→dUSDC):
 *   deposit_router::deposit_usdc(deposit_router, usdc_coin, min_out, spot_config, registry, rp, ctx)
 */
export function buildDepositUsdcTx(params: DepositUsdcParams): Transaction {
  const { contracts, usdcCoinId, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_usdc',
    arguments: [
      tx.object(contracts.depositRouterId),
      tx.object(usdcCoinId),
      tx.pure.u64(minSharesOut),
      tx.object(contracts.spotRouterConfigId),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.riskParamsId),
    ],
    typeArguments: [],
  });

  return tx;
}

// ─── Deposit vSUI ─────────────────────────────────────────────────────────────

export interface DepositVsuiParams {
  contracts: RefluxContracts;
  vsuiCoinId: string;
  /** Leverage in basis points (0 = no leverage, 5000 = 50%). */
  leverageBps: bigint;
  /** Current vSUI/SUI price, scaled e9. */
  priceE9: bigint;
  minSharesOut: bigint;
  sender: string;
}

export function buildDepositVsuiTx(params: DepositVsuiParams): Transaction {
  const { contracts, vsuiCoinId, leverageBps, priceE9, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_vsui',
    arguments: [
      tx.object(contracts.depositRouterId),
      tx.object(vsuiCoinId),
      tx.pure.u64(leverageBps),
      tx.pure.u64(priceE9),
      tx.pure.u64(minSharesOut),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.riskParamsId),
    ],
    typeArguments: [],
  });

  return tx;
}

// ─── Withdraw ─────────────────────────────────────────────────────────────────

export interface WithdrawParams {
  contracts: RefluxContracts;
  /** VaultPosition object ID. */
  positionId: string;
  /** rfUSD share coin object ID. */
  sharesCoinId: string;
  /** Minimum dUSDC to receive (slippage guard). */
  minDusdcOut: bigint;
  /** Minimum USDC to receive after dUSDC→USDC swap (0 if keeping dUSDC). */
  minUsdcOut: bigint;
  sender: string;
}

export function buildWithdrawTx(params: WithdrawParams): Transaction {
  const { contracts, positionId, sharesCoinId, minDusdcOut, minUsdcOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'withdraw',
    arguments: [
      tx.object(positionId),
      tx.object(sharesCoinId),
      tx.pure.u64(minDusdcOut),
      tx.pure.u64(minUsdcOut),
      tx.object(contracts.depositRouterId),
      tx.object(contracts.ibCreditStateId),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.riskParamsId),
    ],
    typeArguments: [],
  });

  return tx;
}

// ─── Emergency deleverage ─────────────────────────────────────────────────────

export interface EmergencyDeleverageParams {
  contracts: RefluxContracts & { emergencyModuleId?: string };
  positionId: string;
  repayCoinId: string;
  priceE9: bigint;
  sender: string;
}

export function buildEmergencyDeleverageTx(params: EmergencyDeleverageParams): Transaction {
  const { contracts, positionId, repayCoinId, priceE9 } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'emergency',
    function: 'emergency_deleverage',
    arguments: [
      tx.object(positionId),
      tx.object(repayCoinId),
      tx.pure.u64(priceE9),
      tx.object(contracts.riskParamsId),
    ],
    typeArguments: [],
  });

  return tx;
}

// ─── Keeper: roll positions ────────────────────────────────────────────────────

export interface RollPositionsParams {
  contracts: RefluxContracts & {
    vaultStateId: string;
    keeperAuthId: string;
    allocationPolicyId: string;
    clockId: string;
  };
  atmIvE4: bigint;
  sender: string;
}

export function buildRollPositionsTx(params: RollPositionsParams): Transaction {
  const { contracts, atmIvE4 } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'vault',
    function: 'roll_positions',
    arguments: [
      tx.object(contracts.keeperAuthId),
      tx.object(contracts.vaultStateId),
      tx.object(contracts.depositRouterId),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.allocationPolicyId),
      tx.object(contracts.ibCreditStateId),
      tx.object(contracts.riskParamsId),
      tx.pure.u64(atmIvE4),
      tx.object(contracts.clockId),
    ],
    typeArguments: [],
  });

  return tx;
}
