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

// ─── Deposit dUSDC (direct — no swap, works on testnet today) ────────────────

export interface DepositDusdcParams {
  contracts: RefluxContracts;
  /** Object ID of the dUSDC coin to deposit. */
  dusdcCoinId: string;
  /** Minimum rfUSD shares to receive (slippage guard). */
  minSharesOut: bigint;
  sender: string;
}

/**
 * Build a PTB that calls deposit_router::deposit_dusdc.
 * No external dependencies — dUSDC is accepted directly.
 * Works on testnet today (get dUSDC via https://tally.so/r/Xx102L faucet).
 */
export function buildDepositDusdcTx(params: DepositDusdcParams): Transaction {
  const { contracts, dusdcCoinId, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_dusdc',
    arguments: [
      tx.object(dusdcCoinId),
      tx.pure.u64(minSharesOut),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.depositRouterId),
      tx.object(contracts.riskParamsId),
    ],
    typeArguments: [],
  });

  return tx;
}

// ─── Deposit SUI (direct swap: SUI → dUSDC → rfUSD) ─────────────────────────

export interface DepositSuiDirectParams {
  contracts: RefluxContracts;
  /** SUI coin object ID (unused for splitting — gas coin is used instead). */
  suiCoinId: string;
  /** Exact SUI amount in base units (MIST: 1 SUI = 1_000_000_000). */
  suiAmountBase: bigint;
  /** Minimum rfUSD shares to receive (slippage guard). */
  minSharesOut: bigint;
  sender: string;
}

/**
 * Build a PTB that calls deposit_router::deposit_sui.
 * Splits from tx.gas (the SUI gas coin) so the same coin covers both the
 * deposit amount and gas — avoids "No valid gas coins found" when the user
 * has only one SUI coin object.
 */
export function buildDepositSuiDirectTx(params: DepositSuiDirectParams): Transaction {
  const { contracts, suiAmountBase, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(suiAmountBase)]);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_sui',
    arguments: [
      depositCoin,
      tx.pure.u64(minSharesOut),
      tx.object(contracts.spotRouterConfigId),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.depositRouterId),
      tx.object(contracts.riskParamsId),
    ],
    typeArguments: [],
  });

  return tx;
}

// ─── Deposit USDC ─────────────────────────────────────────────────────────────

export interface DepositUsdcParams {
  contracts: RefluxContracts;
  /** Object ID of the USDC coin (may have a larger balance than the deposit). */
  usdcCoinId: string;
  /** Exact USDC amount to deposit in base units (e.g. 10 USDC = 10_000_000 for 6 decimals). */
  usdcAmountBase: bigint;
  /** Minimum rfUSD shares to receive (slippage guard). */
  minSharesOut: bigint;
  sender: string;
}

/**
 * Build a PTB that calls deposit_router::deposit_usdc.
 *
 * Move signature: deposit_usdc(usdc, min_shares, config, registry, pool, rp, ctx)
 *
 * Splits the exact deposit amount from the user's coin so only `usdcAmountBase`
 * is swapped — prevents EInsufficientReserve when the coin balance > reserve.
 */
export function buildDepositUsdcTx(params: DepositUsdcParams): Transaction {
  const { contracts, usdcCoinId, usdcAmountBase, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  const [depositCoin] = tx.splitCoins(tx.object(usdcCoinId), [tx.pure.u64(usdcAmountBase)]);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_usdc',
    arguments: [
      depositCoin,                              // usdc: Coin<USDC>
      tx.pure.u64(minSharesOut),                // min_shares: u64
      tx.object(contracts.spotRouterConfigId),  // config: &mut SpotRouterConfig
      tx.object(contracts.shareRegistryId),     // registry: &mut ShareRegistry
      tx.object(contracts.depositRouterId),     // pool: &mut DepositPool
      tx.object(contracts.riskParamsId),        // rp: &RiskParams
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
  /** VaultPosition object ID (owned, consumed by the Move call — full withdrawal). */
  positionId: string;
  /** rfUSD coin object ID — split to sharesAmount before burning. */
  sharesCoinId: string;
  /** Exact rfUSD base units to burn (9 decimals; split from sharesCoinId). Must
   *  equal the position's full shares_minted — use buildWithdrawPartialTx for less. */
  sharesAmount: bigint;
  /** Minimum dUSDC to receive (slippage guard, pre-conversion). */
  minDusdcOut: bigint;
  /** Current vault roll_count — used for queued-exit claimable_after_roll. */
  nextRollId: bigint;
  /** If set, chains spot_router::dusdc_to_usdc so the payout is real USDC
   *  instead of raw dUSDC — pass the position's preferred_output asset. */
  payoutAsset?: 'dusdc' | 'usdc';
  /** Minimum USDC out after the dUSDC→USDC leg (only used when payoutAsset is 'usdc'). */
  minUsdcOut?: bigint;
  sender: string;
}

/**
 * Build a PTB that calls deposit_router::withdraw (full withdrawal — closes the position).
 *
 * Move signature:
 *   withdraw(pos, shares, min_out, next_roll_id, pool, ib, registry, rp, clock, ctx) → Coin<DUSDC>
 *
 * Splits `sharesAmount` from the rfUSD coin so it works when the user holds
 * more rfUSD than a single position minted. The returned Coin<DUSDC> is
 * optionally swapped to USDC (when payoutAsset is 'usdc') before being
 * transferred to the sender. `clock` (0x6) drives ib_credit's instant-exit
 * rate limiter (see reflux::ib_credit::configure_exit_limiter).
 */
export function buildWithdrawTx(params: WithdrawParams): Transaction {
  const { contracts, positionId, sharesCoinId, sharesAmount, minDusdcOut, nextRollId, payoutAsset, minUsdcOut, sender } = params;
  const tx = new Transaction();
  tx.setSender(sender);

  // Split exact shares — needed when the coin holds > this position's shares_minted.
  const [sharesCoin] = tx.splitCoins(tx.object(sharesCoinId), [tx.pure.u64(sharesAmount)]);

  const dusdcOut = tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'withdraw',
    arguments: [
      tx.object(positionId),              // pos: VaultPosition (by value, destroyed)
      sharesCoin,                         // shares: Coin<SHARE_TOKEN>
      tx.pure.u64(minDusdcOut),           // min_out: u64
      tx.pure.u64(nextRollId),            // next_roll_id: u64
      tx.object(contracts.depositRouterId),  // pool: &mut DepositPool
      tx.object(contracts.ibCreditStateId),  // ib: &mut IBCreditState
      tx.object(contracts.shareRegistryId),  // registry: &mut ShareRegistry
      tx.object(contracts.riskParamsId),     // rp: &RiskParams
      tx.object('0x6'),                      // clock: &Clock
    ],
    typeArguments: [],
  })[0]!;

  const payout = payoutAsset === 'usdc'
    ? tx.moveCall({
        package: contracts.packageId,
        module: 'spot_router',
        function: 'dusdc_to_usdc',
        arguments: [tx.object(contracts.spotRouterConfigId), dusdcOut, tx.pure.u64(minUsdcOut ?? 0n)],
      })[0]!
    : dusdcOut;

  tx.transferObjects([payout], sender);

  return tx;
}

// ─── Withdraw partial ──────────────────────────────────────────────────────────

export interface WithdrawPartialParams {
  contracts: RefluxContracts;
  /** VaultPosition object ID — passed as &mut, stays owned by the sender afterward. */
  positionId: string;
  /** rfUSD coin object ID — split to sharesAmount before burning. */
  sharesCoinId: string;
  /** Exact rfUSD base units to burn. Must be strictly less than the position's
   *  shares_minted — use buildWithdrawTx for a full redemption. */
  sharesAmount: bigint;
  minDusdcOut: bigint;
  nextRollId: bigint;
  payoutAsset?: 'dusdc' | 'usdc';
  minUsdcOut?: bigint;
  sender: string;
}

/**
 * Build a PTB that calls deposit_router::withdraw_partial — burns less than
 * the full position balance, leaving the VaultPosition alive (shares_minted
 * decremented) so further partial or final withdrawals remain possible.
 */
export function buildWithdrawPartialTx(params: WithdrawPartialParams): Transaction {
  const { contracts, positionId, sharesCoinId, sharesAmount, minDusdcOut, nextRollId, payoutAsset, minUsdcOut, sender } = params;
  const tx = new Transaction();
  tx.setSender(sender);

  const [sharesCoin] = tx.splitCoins(tx.object(sharesCoinId), [tx.pure.u64(sharesAmount)]);

  const dusdcOut = tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'withdraw_partial',
    arguments: [
      tx.object(positionId),                 // pos: &mut VaultPosition
      sharesCoin,                            // shares: Coin<SHARE_TOKEN>
      tx.pure.u64(minDusdcOut),              // min_out: u64
      tx.pure.u64(nextRollId),               // next_roll_id: u64
      tx.object(contracts.depositRouterId),  // pool: &mut DepositPool
      tx.object(contracts.ibCreditStateId),  // ib: &mut IBCreditState
      tx.object(contracts.shareRegistryId),  // registry: &mut ShareRegistry
      tx.object(contracts.riskParamsId),     // rp: &RiskParams
      tx.object('0x6'),                      // clock: &Clock
    ],
    typeArguments: [],
  })[0]!;

  const payout = payoutAsset === 'usdc'
    ? tx.moveCall({
        package: contracts.packageId,
        module: 'spot_router',
        function: 'dusdc_to_usdc',
        arguments: [tx.object(contracts.spotRouterConfigId), dusdcOut, tx.pure.u64(minUsdcOut ?? 0n)],
      })[0]!
    : dusdcOut;

  tx.transferObjects([payout], sender);

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

// ─── DeepBook Predict — PLP supply / withdraw (any sender) ───────────────────
//
// CRITICAL: predict::supply and predict::withdraw have NO owner restriction —
// any sender holding the coin can call them. This means the Reflux vault
// contract CAN call supply/withdraw directly (Coin<dUSDC> → Coin<PLP> and back).
//
// References (from deepbookv3 @predict-testnet-4-16):
//   predict::supply<Quote>(predict, coin, clock, ctx) -> Coin<PLP>
//   predict::withdraw<Quote>(predict, lp_coin, clock, ctx) -> Coin<Quote>
//
// Predict package: 0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
// Predict shared object: 0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a

export interface PredictContracts {
  /** Predict package ID (0xf5ea...). */
  predictPackageId: string;
  /** Predict shared object ID (0xc873...). */
  predictObjectId: string;
  /** Fully-qualified dUSDC type (0xe950...::dusdc::DUSDC). */
  dusdcType: string;
  /** PLP coin type (0xf5ea...::plp::PLP). */
  plpType: string;
}

export interface PredictSupplyParams {
  contracts: PredictContracts;
  /** Object ID of the dUSDC coin to supply. */
  dusdcCoinId: string;
  sender: string;
}

/**
 * Build a PTB that calls predict::supply<dUSDC>.
 * Returns Coin<PLP> as a PTB result — caller transfers it or uses it in the
 * same transaction.
 */
export function buildPredictSupplyTx(params: PredictSupplyParams): Transaction {
  const { contracts, dusdcCoinId } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  const plpCoin = tx.moveCall({
    package: contracts.predictPackageId,
    module: 'predict',
    function: 'supply',
    typeArguments: [contracts.dusdcType],
    arguments: [
      tx.object(contracts.predictObjectId),
      tx.object(dusdcCoinId),
      tx.object('0x6'), // Clock
    ],
  });

  // Transfer PLP back to sender so it's stored in their wallet
  tx.transferObjects([plpCoin], params.sender);
  return tx;
}

export interface PredictWithdrawParams {
  contracts: PredictContracts;
  /** Object ID of the Coin<PLP> to redeem. */
  plpCoinId: string;
  sender: string;
}

/**
 * Build a PTB that calls predict::withdraw<dUSDC>.
 * Returns Coin<dUSDC> — caller receives the unwound liquidity.
 */
export function buildPredictWithdrawTx(params: PredictWithdrawParams): Transaction {
  const { contracts, plpCoinId } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  const dusdcCoin = tx.moveCall({
    package: contracts.predictPackageId,
    module: 'predict',
    function: 'withdraw',
    typeArguments: [contracts.dusdcType],
    arguments: [
      tx.object(contracts.predictObjectId),
      tx.object(plpCoinId),
      tx.object('0x6'), // Clock
    ],
  });

  tx.transferObjects([dusdcCoin], params.sender);
  return tx;
}

// ─── DeepBook Predict — keeper-owned PredictManager operations ────────────────
//
// CRITICAL: predict::mint, predict::mint_range, predict::redeem_range and
// PredictManager::deposit/withdraw all require ctx.sender() == manager.owner().
// The manager owner is fixed at create_manager time. Therefore these PTBs MUST
// be signed by the keeper keypair that owns the PredictManager.
//
// References:
//   predict::create_manager(ctx) -> ID
//   predict::mint_range<Quote>(predict, manager, oracle, key, qty, clock, ctx)
//   predict::redeem_permissionless<Quote>(predict, manager, oracle, key, qty, clock, ctx)
//   range_key::new(oracle_id, expiry, lower_strike, higher_strike) -> RangeKey
//   market_key::new(oracle_id, expiry, strike, is_up) -> MarketKey

/**
 * Build a PTB that calls predict::create_manager.
 * Run this ONCE to create the keeper's PredictManager; store the resulting ID.
 */
export function buildPredictCreateManagerTx(
  predictPackageId: string,
  sender: string,
): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    package: predictPackageId,
    module: 'predict',
    function: 'create_manager',
    arguments: [],
  });
  return tx;
}

export interface PredictMintRangeParams {
  contracts: PredictContracts;
  /** Keeper's PredictManager object ID. */
  managerId: string;
  /** OracleSVI object ID for the target expiry. */
  oracleObjectId: string;
  /** From oracle: expiry timestamp in ms (u64). */
  expiry: bigint;
  /** Strike bounds for the range strip. */
  lowerStrike: bigint;
  higherStrike: bigint;
  /** Number of contracts. */
  quantity: bigint;
  sender: string;
}

/**
 * Build a PTB that opens a range strip via predict::mint_range.
 * MUST be signed by the keeper that owns `managerId`.
 */
export function buildPredictMintRangeTx(params: PredictMintRangeParams): Transaction {
  const { contracts, managerId, oracleObjectId, expiry, lowerStrike, higherStrike, quantity } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  // 1. Build the RangeKey struct via range_key::new
  const rangeKey = tx.moveCall({
    package: contracts.predictPackageId,
    module: 'range_key',
    function: 'new',
    arguments: [
      tx.pure.id(oracleObjectId),
      tx.pure.u64(expiry),
      tx.pure.u64(lowerStrike),
      tx.pure.u64(higherStrike),
    ],
  });

  // 2. Call predict::mint_range with the composed key
  tx.moveCall({
    package: contracts.predictPackageId,
    module: 'predict',
    function: 'mint_range',
    typeArguments: [contracts.dusdcType],
    arguments: [
      tx.object(contracts.predictObjectId),
      tx.object(managerId),
      tx.object(oracleObjectId),
      rangeKey,
      tx.pure.u64(quantity),
      tx.object('0x6'), // Clock
    ],
  });

  return tx;
}

export interface PredictRedeemPermissionlessParams {
  contracts: PredictContracts;
  /** Keeper's PredictManager that holds the position. */
  managerId: string;
  /** Settled oracle object ID. */
  oracleObjectId: string;
  expiry: bigint;
  strike: bigint;
  /** true = up binary, false = down binary. */
  isUp: boolean;
  quantity: bigint;
  sender: string;
}

/**
 * Build a PTB that calls predict::redeem_permissionless on a settled binary.
 * Any address may call this — no owner restriction.
 * Aborts EOracleNotSettled if oracle is still live.
 */
export function buildPredictRedeemPermissionlessTx(
  params: PredictRedeemPermissionlessParams,
): Transaction {
  const { contracts, managerId, oracleObjectId, expiry, strike, isUp, quantity } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  // Build MarketKey via market_key::new
  const marketKey = tx.moveCall({
    package: contracts.predictPackageId,
    module: 'market_key',
    function: 'new',
    arguments: [
      tx.pure.id(oracleObjectId),
      tx.pure.u64(expiry),
      tx.pure.u64(strike),
      tx.pure.bool(isUp),
    ],
  });

  tx.moveCall({
    package: contracts.predictPackageId,
    module: 'predict',
    function: 'redeem_permissionless',
    typeArguments: [contracts.dusdcType],
    arguments: [
      tx.object(contracts.predictObjectId),
      tx.object(managerId),
      tx.object(oracleObjectId),
      marketKey,
      tx.pure.u64(quantity),
      tx.object('0x6'), // Clock
    ],
  });

  return tx;
}

// ─── Deposit LSD (generic: afSUI, haSUI, or vSUI) ────────────────────────────

export interface DepositLsdParams {
  contracts: RefluxContracts;
  /** Object ID of the LSD coin (afSUI, haSUI, or vSUI). */
  lsdCoinId: string;
  /** Fully-qualified Move type of the LSD, e.g. "0x...::afsui::AFSUI". */
  lsdType: string;
  /** Leverage in basis points (0 = no leverage; max 6500 per risk_params). */
  leverageBps: bigint;
  /** Current LSD/SUI price scaled e9. */
  priceE9: bigint;
  minSharesOut: bigint;
  sender: string;
}

export function buildDepositLsdTx(params: DepositLsdParams): Transaction {
  const { contracts, lsdCoinId, lsdType, leverageBps, priceE9, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_lsd',
    typeArguments: [lsdType],
    arguments: [
      tx.object(contracts.depositRouterId),
      tx.object(lsdCoinId),
      tx.pure.u64(leverageBps),
      tx.pure.u64(priceE9),
      tx.pure.u64(minSharesOut),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.riskParamsId),
    ],
  });

  return tx;
}

// ─── Deposit native SUI ────────────────────────────────────────────────────────

export interface DepositSuiParams {
  contracts: RefluxContracts;
  /** Object ID of the SUI coin to deposit. */
  suiCoinId: string;
  /**
   * LSP choice: 0 = Volo (→ vSUI), 1 = Aftermath (→ afSUI), 2 = Haedal (→ haSUI).
   * Mirrors the u8 enum in deposit_router::deposit_sui.
   */
  lspChoice: number;
  /** Leverage in basis points (0 = no leverage; max 6500). */
  leverageBps: bigint;
  minSharesOut: bigint;
  sender: string;
}

export function buildDepositSuiTx(params: DepositSuiParams): Transaction {
  const { contracts, suiCoinId, lspChoice, leverageBps, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_sui',
    arguments: [
      tx.object(contracts.depositRouterId),
      tx.object(suiCoinId),
      tx.pure.u8(lspChoice),
      tx.pure.u64(leverageBps),
      tx.pure.u64(minSharesOut),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.riskParamsId),
    ],
    typeArguments: [],
  });

  return tx;
}

// ─── Deposit BTC (xBTC / sBTC) — Tier 3 ──────────────────────────────────────

export interface DepositBtcParams {
  contracts: RefluxContracts;
  /** Object ID of the BTC coin (xBTC or sBTC). */
  btcCoinId: string;
  /** Fully-qualified Move type, e.g. "0x...::xbtc::XBTC". */
  btcType: string;
  /** Pyth price info object ID for BTC/USD. */
  pythPriceInfoId: string;
  /** Minimum dUSDC to receive from the spot swap (slippage guard). */
  minDusdcOut: bigint;
  minSharesOut: bigint;
  sender: string;
}

export function buildDepositBtcTx(params: DepositBtcParams): Transaction {
  const { contracts, btcCoinId, btcType, pythPriceInfoId, minDusdcOut, minSharesOut } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_btc',
    typeArguments: [btcType],
    arguments: [
      tx.object(contracts.depositRouterId),
      tx.object(btcCoinId),
      tx.object(contracts.spotRouterConfigId),
      tx.object(pythPriceInfoId),
      tx.pure.u64(minDusdcOut),
      tx.pure.u64(minSharesOut),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.riskParamsId),
    ],
  });

  return tx;
}

// ─── Deposit rfBTC (rfBTC → dUSDC → rfUSD) ───────────────────────────────────

export interface DepositRfBtcParams {
  contracts: RefluxContracts;
  rfbtcCoinId: string;
  minSharesOut: bigint;
  sender: string;
}

/** EXTERNAL-PENDING: spot_router::rfbtc_to_dusdc aborts until rfBTC/dUSDC pool is confirmed. */
export function buildDepositRfBtcTx(params: DepositRfBtcParams): Transaction {
  const { contracts, rfbtcCoinId, minSharesOut, sender } = params;
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    package: contracts.packageId,
    module: 'deposit_router',
    function: 'deposit_rfbtc',
    arguments: [
      tx.object(rfbtcCoinId),
      tx.pure.u64(minSharesOut),
      tx.object(contracts.spotRouterConfigId),
      tx.object(contracts.shareRegistryId),
      tx.object(contracts.depositRouterId),
      tx.object(contracts.riskParamsId),
    ],
  });
  return tx;
}

// ─── rfBTC faucet (works on testnet — no external deps) ──────────────────────

export interface RfBtcFaucetParams {
  packageId: string;
  /** Shared RfBtcTreasury object ID (set in env after publish). */
  rfBtcTreasuryId: string;
  sender: string;
  /** Base units (8 decimals) to mint. Defaults to FAUCET_MAX if omitted. */
  amount?: string;
}

/** Mints `amount` rfBTC (defaults to FAUCET_MAX) from the shared treasury to the sender. */
export function buildRfBtcFaucetTx(params: RfBtcFaucetParams): Transaction {
  const { packageId, rfBtcTreasuryId, sender, amount } = params;
  const tx = new Transaction();
  tx.setSender(sender);
  const rfbtc = amount
    ? tx.moveCall({
        package: packageId,
        module: 'rfbtc',
        function: 'faucet',
        arguments: [tx.object(rfBtcTreasuryId), tx.pure.u64(amount)],
      })[0]!
    : tx.moveCall({
        package: packageId,
        module: 'rfbtc',
        function: 'faucet_max',
        arguments: [tx.object(rfBtcTreasuryId)],
      })[0]!;
  tx.transferObjects([rfbtc], sender);
  return tx;
}

// ─── Admin: bootstrap spot-router pool liquidity ─────────────────────────────
//
// These are one-shot admin transactions run immediately after `sui client publish`
// to seed the on-chain CPAMM pools so user swaps work.
//
// USDC/dUSDC: 1:1 treasury (same decimal scale — fee = 0).
// SUI/dUSDC:  CPAMM; initial ratio sets the SUI/USD price.
// rfBTC/dUSDC: CPAMM; initial ratio sets the BTC/USD price.
//
// Admin gating is `openzeppelin_access::access_control::Auth<AdminRole>` (see
// reflux::access), not a persistent capability object — `Auth` has no
// `store`/`key`, so it must be minted fresh in the same PTB via
// `access::new_admin_auth` and is consumed immediately by the gated call.

/** Mints `Auth<AdminRole>` from the shared access-control registry, for use
 *  later in the same PTB by an admin-gated moveCall. */
function mintAdminAuth(tx: Transaction, packageId: string, accessControlId: string) {
  return tx.moveCall({
    package: packageId,
    module: 'access',
    function: 'new_admin_auth',
    arguments: [tx.object(accessControlId)],
  })[0]!;
}

export interface AddLiquidityUsdcDusdcParams {
  packageId: string;
  accessControlId: string;
  spotRouterConfigId: string;
  usdcCoinId: string;
  dusdcCoinId: string;
  sender: string;
}

export function buildAddLiquidityUsdcDusdcTx(params: AddLiquidityUsdcDusdcParams): Transaction {
  const { packageId, accessControlId, spotRouterConfigId, usdcCoinId, dusdcCoinId, sender } = params;
  const tx = new Transaction();
  tx.setSender(sender);
  const adminAuth = mintAdminAuth(tx, packageId, accessControlId);
  tx.moveCall({
    package: packageId,
    module: 'spot_router',
    function: 'add_liquidity_usdc_dusdc',
    arguments: [
      adminAuth,
      tx.object(spotRouterConfigId),
      tx.object(usdcCoinId),
      tx.object(dusdcCoinId),
    ],
  });
  return tx;
}

export interface AddLiquiditySuiDusdcParams {
  packageId: string;
  accessControlId: string;
  spotRouterConfigId: string;
  suiCoinId: string;
  dusdcCoinId: string;
  sender: string;
}

export function buildAddLiquiditySuiDusdcTx(params: AddLiquiditySuiDusdcParams): Transaction {
  const { packageId, accessControlId, spotRouterConfigId, suiCoinId, dusdcCoinId, sender } = params;
  const tx = new Transaction();
  tx.setSender(sender);
  const adminAuth = mintAdminAuth(tx, packageId, accessControlId);
  tx.moveCall({
    package: packageId,
    module: 'spot_router',
    function: 'add_liquidity_sui_dusdc',
    arguments: [
      adminAuth,
      tx.object(spotRouterConfigId),
      tx.object(suiCoinId),
      tx.object(dusdcCoinId),
    ],
  });
  return tx;
}

export interface AddLiquidityRfBtcDusdcParams {
  packageId: string;
  accessControlId: string;
  spotRouterConfigId: string;
  rfbtcCoinId: string;
  dusdcCoinId: string;
  sender: string;
}

export function buildAddLiquidityRfBtcDusdcTx(params: AddLiquidityRfBtcDusdcParams): Transaction {
  const { packageId, accessControlId, spotRouterConfigId, rfbtcCoinId, dusdcCoinId, sender } = params;
  const tx = new Transaction();
  tx.setSender(sender);
  const adminAuth = mintAdminAuth(tx, packageId, accessControlId);
  tx.moveCall({
    package: packageId,
    module: 'spot_router',
    function: 'add_liquidity_rfbtc_dusdc',
    arguments: [
      adminAuth,
      tx.object(spotRouterConfigId),
      tx.object(rfbtcCoinId),
      tx.object(dusdcCoinId),
    ],
  });
  return tx;
}

// ─── Spot swap ────────────────────────────────────────────────────────────────

export type SwapAsset = 'sui' | 'usdc' | 'dusdc' | 'rfbtc';

export interface SwapParams {
  contracts: RefluxContracts;
  fromAsset: SwapAsset;
  toAsset: SwapAsset;
  fromCoinId: string;
  /** Exact amount to swap in base units. The coin is split to this amount so
   *  a partial swap is possible even when the coin holds a larger balance. */
  fromAmountBase: bigint;
  /** Minimum output base units (slippage guard applied to final leg). */
  minAmountOut: bigint;
  sender: string;
}

/** Move function name for each direct pair in spot_router. */
const DIRECT_FN: Partial<Record<string, string>> = {
  'sui→dusdc':   'sui_to_dusdc',
  'dusdc→sui':   'dusdc_to_sui',
  'usdc→dusdc':  'usdc_to_dusdc',
  'dusdc→usdc':  'dusdc_to_usdc',
  'rfbtc→dusdc': 'rfbtc_to_dusdc',
  'dusdc→rfbtc': 'dusdc_to_rfbtc',
};

/**
 * Build a swap PTB for any supported pair.
 * Splits the exact `fromAmountBase` from the input coin so only the entered
 * amount is swapped — the remainder stays in the user's wallet.
 */
export function buildSwapTx(params: SwapParams): Transaction {
  const { contracts, fromAsset, toAsset, fromCoinId, fromAmountBase, minAmountOut, sender } = params;
  if (fromAsset === toAsset) throw new Error('Cannot swap same asset');

  const tx = new Transaction();
  tx.setSender(sender);
  const config = tx.object(contracts.spotRouterConfigId);

  // SUI is the gas coin — split from tx.gas so the same coin covers both gas
  // and the swap input without needing a second SUI object for gas.
  // For all other assets, split from the coin object directly.
  const [coinIn] = fromAsset === 'sui'
    ? tx.splitCoins(tx.gas, [tx.pure.u64(fromAmountBase)])
    : tx.splitCoins(tx.object(fromCoinId), [tx.pure.u64(fromAmountBase)]);

  const routeKey = `${fromAsset}→${toAsset}`;
  const directFn = DIRECT_FN[routeKey];

  if (directFn) {
    const outCoin = tx.moveCall({
      package: contracts.packageId,
      module: 'spot_router',
      function: directFn,
      arguments: [config, coinIn, tx.pure.u64(minAmountOut)],
    })[0]!;
    tx.transferObjects([outCoin], sender);
  } else {
    const leg1 = DIRECT_FN[`${fromAsset}→dusdc`];
    const leg2 = DIRECT_FN[`dusdc→${toAsset}`];
    if (!leg1 || !leg2) throw new Error(`No swap route: ${fromAsset} → ${toAsset}`);
    const dusdc = tx.moveCall({
      package: contracts.packageId,
      module: 'spot_router',
      function: leg1,
      arguments: [config, coinIn, tx.pure.u64(1n)],
    })[0]!;
    const outCoin = tx.moveCall({
      package: contracts.packageId,
      module: 'spot_router',
      function: leg2,
      arguments: [config, dusdc, tx.pure.u64(minAmountOut)],
    })[0]!;
    tx.transferObjects([outCoin], sender);
  }

  return tx;
}

// ─── Keeper: roll positions ────────────────────────────────────────────────────
//
// Keeper gating is `Auth<KeeperRole>` (see reflux::access), minted fresh in
// this PTB from the shared access-control registry rather than referencing a
// persistent `KeeperAuth` object — see the module doc on reflux::access for why.

export interface RollPositionsParams {
  contracts: RefluxContracts & {
    vaultStateId: string;
    accessControlId: string;
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

  const keeperAuth = tx.moveCall({
    package: contracts.packageId,
    module: 'access',
    function: 'new_keeper_auth',
    arguments: [tx.object(contracts.accessControlId)],
  })[0]!;

  tx.moveCall({
    package: contracts.packageId,
    module: 'vault',
    function: 'roll_positions',
    arguments: [
      keeperAuth,
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

// ─── Admin demo roll (testnet) ────────────────────────────────────────────────

export interface RollDemoParams {
  contracts: RefluxContracts & {
    vaultStateId: string;
    allocationPolicyId: string;
    accessControlId: string;
    clockId: string;
  };
  atmIvE4: bigint;
  sender: string;
}

/** Builds a tx that calls `vault::roll_demo` — admin-gated testnet roll that
 *  exercises the allocator and emits AllocationDecision without needing a
 *  settled Predict oracle (predict_strategy stubs are EXTERNAL-PENDING). */
export function buildRollDemoTx(params: RollDemoParams): Transaction {
  const { contracts, atmIvE4 } = params;
  const tx = new Transaction();
  tx.setSender(params.sender);

  const adminAuth = mintAdminAuth(tx, contracts.packageId, contracts.accessControlId);

  tx.moveCall({
    package: contracts.packageId,
    module: 'vault',
    function: 'roll_demo',
    arguments: [
      adminAuth,
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
