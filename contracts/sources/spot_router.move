/// Module 6 — spot_router: USDC ↔ dUSDC · SUI ↔ dUSDC · rfBTC ↔ dUSDC.
///
/// Three pool types live inside a single shared `SpotRouterConfig`:
///
///   USDC ↔ dUSDC  — 1:1 treasury swap (both 6-decimal test stablecoins).
///                   Admin pre-funds both sides from the dUSDC faucet and the
///                   USDC testnet faucet.  Fee = 0.
///
///   SUI  ↔ dUSDC  — x·y=k CPAMM, fee = 0.3 %.
///                   Price is set by the ratio of initial liquidity the admin
///                   deposits (e.g. 10 000 SUI : 30 000 dUSDC ≈ $3/SUI).
///
///   rfBTC ↔ dUSDC — x·y=k CPAMM, fee = 0.3 %.
///                   Same approach (e.g. 0.5 rfBTC : 50 000 dUSDC ≈ $100k/BTC).
///
/// Both reserve pairs are stored in native base units; the reserve ratio
/// implicitly encodes the decimal-scale difference between the two assets,
/// so no explicit normalisation is needed in the swap formula.
/// u128 intermediates in `cpamm_out` prevent overflow on deep pools.
///
/// BTC (reflux::types::BTC, Tier 3) remains EXTERNAL-PENDING.
module reflux::spot_router;

use dusdc::dusdc::DUSDC;
use reflux::access::AdminRole;
use reflux::rfbtc::RFBTC;
use reflux::types::BTC;
use openzeppelin_access::access_control::Auth;
use usdc::usdc::USDC;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

// ─── Error codes ─────────────────────────────────────────────────────────────

const ESlippageExceeded:    u64 = 0;
const EInsufficientReserve: u64 = 1;
const EZeroAmount:          u64 = 2;
const EExternalPending:     u64 = 99; // BTC (Tier 3) still pending

// ─── Pool fee ─────────────────────────────────────────────────────────────────

/// 0.3 % for SUI/dUSDC and rfBTC/dUSDC AMM pools; zero for the USDC/dUSDC treasury.
const FEE_BPS: u64 = 30;

// ─── Shared config — all three pool types ────────────────────────────────────

public struct SpotRouterConfig has key {
    id:            UID,
    // USDC ↔ dUSDC 1:1 treasury
    usdc_reserve:  Balance<USDC>,
    dusdc_stable:  Balance<DUSDC>,
    // SUI / dUSDC CPAMM
    sui_reserve:   Balance<sui::sui::SUI>,
    dusdc_sui:     Balance<DUSDC>,
    // rfBTC / dUSDC CPAMM
    rfbtc_reserve: Balance<RFBTC>,
    dusdc_rfbtc:   Balance<DUSDC>,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct SwapExecuted has copy, drop {
    direction:  vector<u8>,
    amount_in:  u64,
    amount_out: u64,
}

public struct LiquidityAdded has copy, drop {
    pool:     vector<u8>,
    amount_a: u64,
    amount_b: u64,
}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(SpotRouterConfig {
        id:            object::new(ctx),
        usdc_reserve:  balance::zero(),
        dusdc_stable:  balance::zero(),
        sui_reserve:   balance::zero(),
        dusdc_sui:     balance::zero(),
        rfbtc_reserve: balance::zero(),
        dusdc_rfbtc:   balance::zero(),
    });
}

// ─── CPAMM math ──────────────────────────────────────────────────────────────

/// x·y=k output with the fee (FEE_BPS) deducted from the input side.
/// u128 intermediates prevent overflow even for pools with > 10^9 tokens.
fun cpamm_out(amount_in: u64, reserve_in: u64, reserve_out: u64, fee_bps: u64): u64 {
    assert!(reserve_in > 0 && reserve_out > 0, EInsufficientReserve);
    let fee_num   = 10_000u128 - (fee_bps as u128);
    let aw        = (amount_in as u128) * fee_num;
    let numerator = aw * (reserve_out as u128);
    let denom     = (reserve_in as u128) * 10_000u128 + aw;
    (numerator / denom) as u64
}

// ─── Admin: bootstrap pool liquidity ─────────────────────────────────────────

/// Seed only the dUSDC stable reserve (no USDC required).
/// Useful on testnet where testnet USDC is unavailable but dUSDC is faucet-able.
public fun seed_dusdc_stable(
    _admin: &Auth<AdminRole>,
    config: &mut SpotRouterConfig,
    dusdc:  Coin<DUSDC>,
) {
    let da = dusdc.value();
    config.dusdc_stable.join(dusdc.into_balance());
    event::emit(LiquidityAdded { pool: b"usdc_dusdc", amount_a: 0, amount_b: da });
}

/// Deposit USDC and dUSDC into the 1:1 treasury.
/// Run once after `sui client publish` using an `Auth<AdminRole>`.
public fun add_liquidity_usdc_dusdc(
    _admin: &Auth<AdminRole>,
    config: &mut SpotRouterConfig,
    usdc:   Coin<USDC>,
    dusdc:  Coin<DUSDC>,
) {
    let ua = usdc.value();
    let da = dusdc.value();
    config.usdc_reserve.join(usdc.into_balance());
    config.dusdc_stable.join(dusdc.into_balance());
    event::emit(LiquidityAdded { pool: b"usdc_dusdc", amount_a: ua, amount_b: da });
}

/// Deposit SUI and dUSDC into the SUI/dUSDC CPAMM.
/// Sets the initial price: e.g. 10 000 SUI + 30 000 dUSDC ≈ $3/SUI.
public fun add_liquidity_sui_dusdc(
    _admin: &Auth<AdminRole>,
    config: &mut SpotRouterConfig,
    sui:    Coin<sui::sui::SUI>,
    dusdc:  Coin<DUSDC>,
) {
    let sa = sui.value();
    let da = dusdc.value();
    config.sui_reserve.join(sui.into_balance());
    config.dusdc_sui.join(dusdc.into_balance());
    event::emit(LiquidityAdded { pool: b"sui_dusdc", amount_a: sa, amount_b: da });
}

/// Deposit rfBTC and dUSDC into the rfBTC/dUSDC CPAMM.
/// Sets the initial price: e.g. 0.5 rfBTC + 50 000 dUSDC ≈ $100 000/BTC.
public fun add_liquidity_rfbtc_dusdc(
    _admin: &Auth<AdminRole>,
    config: &mut SpotRouterConfig,
    rfbtc:  Coin<RFBTC>,
    dusdc:  Coin<DUSDC>,
) {
    let ba = rfbtc.value();
    let da = dusdc.value();
    config.rfbtc_reserve.join(rfbtc.into_balance());
    config.dusdc_rfbtc.join(dusdc.into_balance());
    event::emit(LiquidityAdded { pool: b"rfbtc_dusdc", amount_a: ba, amount_b: da });
}

/// Drain the SUI/dUSDC CPAMM and return all reserves to the caller.
/// Used by the admin to reset pool price after a bad initial seed.
public fun admin_drain_sui_dusdc(
    _admin: &Auth<AdminRole>,
    config:  &mut SpotRouterConfig,
    ctx:     &mut TxContext,
): (Coin<sui::sui::SUI>, Coin<DUSDC>) {
    let sui_amt   = config.sui_reserve.value();
    let dusdc_amt = config.dusdc_sui.value();
    let sui_out   = coin::from_balance(config.sui_reserve.split(sui_amt), ctx);
    let dusdc_out = coin::from_balance(config.dusdc_sui.split(dusdc_amt), ctx);
    (sui_out, dusdc_out)
}

/// Drain the rfBTC/dUSDC CPAMM and return all reserves to the caller.
public fun admin_drain_rfbtc_dusdc(
    _admin: &Auth<AdminRole>,
    config:  &mut SpotRouterConfig,
    ctx:     &mut TxContext,
): (Coin<RFBTC>, Coin<DUSDC>) {
    let rfbtc_amt = config.rfbtc_reserve.value();
    let dusdc_amt = config.dusdc_rfbtc.value();
    let rfbtc_out = coin::from_balance(config.rfbtc_reserve.split(rfbtc_amt), ctx);
    let dusdc_out = coin::from_balance(config.dusdc_rfbtc.split(dusdc_amt), ctx);
    (rfbtc_out, dusdc_out)
}

// ─── Production swaps ─────────────────────────────────────────────────────────

/// USDC → dUSDC: 1:1 treasury swap, fee = 0.
public fun usdc_to_dusdc(
    config:  &mut SpotRouterConfig,
    coin_in: Coin<USDC>,
    min_out: u64,
    ctx:     &mut TxContext,
): Coin<DUSDC> {
    let amount = coin_in.value();
    assert!(amount > 0, EZeroAmount);
    assert!(amount >= min_out, ESlippageExceeded);
    assert!(config.dusdc_stable.value() >= amount, EInsufficientReserve);
    config.usdc_reserve.join(coin_in.into_balance());
    let out = coin::take(&mut config.dusdc_stable, amount, ctx);
    event::emit(SwapExecuted { direction: b"usdc_to_dusdc", amount_in: amount, amount_out: amount });
    out
}

/// dUSDC → USDC: 1:1 treasury swap, fee = 0.
public fun dusdc_to_usdc(
    config:  &mut SpotRouterConfig,
    coin_in: Coin<DUSDC>,
    min_out: u64,
    ctx:     &mut TxContext,
): Coin<USDC> {
    let amount = coin_in.value();
    assert!(amount > 0, EZeroAmount);
    assert!(amount >= min_out, ESlippageExceeded);
    assert!(config.usdc_reserve.value() >= amount, EInsufficientReserve);
    config.dusdc_stable.join(coin_in.into_balance());
    let out = coin::take(&mut config.usdc_reserve, amount, ctx);
    event::emit(SwapExecuted { direction: b"dusdc_to_usdc", amount_in: amount, amount_out: amount });
    out
}

/// SUI → dUSDC: CPAMM, fee = 0.3 %.
/// Reserves stored in native base units; ratio encodes the SUI/USD price.
public fun sui_to_dusdc(
    config:  &mut SpotRouterConfig,
    coin_in: Coin<sui::sui::SUI>,
    min_out: u64,
    ctx:     &mut TxContext,
): Coin<DUSDC> {
    let amount_in  = coin_in.value();
    assert!(amount_in > 0, EZeroAmount);
    let amount_out = cpamm_out(amount_in, config.sui_reserve.value(), config.dusdc_sui.value(), FEE_BPS);
    assert!(amount_out >= min_out, ESlippageExceeded);
    config.sui_reserve.join(coin_in.into_balance());
    let out = coin::take(&mut config.dusdc_sui, amount_out, ctx);
    event::emit(SwapExecuted { direction: b"sui_to_dusdc", amount_in, amount_out });
    out
}

/// dUSDC → SUI: CPAMM, fee = 0.3 %.
public fun dusdc_to_sui(
    config:  &mut SpotRouterConfig,
    coin_in: Coin<DUSDC>,
    min_out: u64,
    ctx:     &mut TxContext,
): Coin<sui::sui::SUI> {
    let amount_in  = coin_in.value();
    assert!(amount_in > 0, EZeroAmount);
    let amount_out = cpamm_out(amount_in, config.dusdc_sui.value(), config.sui_reserve.value(), FEE_BPS);
    assert!(amount_out >= min_out, ESlippageExceeded);
    config.dusdc_sui.join(coin_in.into_balance());
    let out = coin::take(&mut config.sui_reserve, amount_out, ctx);
    event::emit(SwapExecuted { direction: b"dusdc_to_sui", amount_in, amount_out });
    out
}

/// rfBTC → dUSDC: CPAMM, fee = 0.3 %.
public fun rfbtc_to_dusdc(
    config:  &mut SpotRouterConfig,
    coin_in: Coin<RFBTC>,
    min_out: u64,
    ctx:     &mut TxContext,
): Coin<DUSDC> {
    let amount_in  = coin_in.value();
    assert!(amount_in > 0, EZeroAmount);
    let amount_out = cpamm_out(amount_in, config.rfbtc_reserve.value(), config.dusdc_rfbtc.value(), FEE_BPS);
    assert!(amount_out >= min_out, ESlippageExceeded);
    config.rfbtc_reserve.join(coin_in.into_balance());
    let out = coin::take(&mut config.dusdc_rfbtc, amount_out, ctx);
    event::emit(SwapExecuted { direction: b"rfbtc_to_dusdc", amount_in, amount_out });
    out
}

/// dUSDC → rfBTC: CPAMM, fee = 0.3 %.
public fun dusdc_to_rfbtc(
    config:  &mut SpotRouterConfig,
    coin_in: Coin<DUSDC>,
    min_out: u64,
    ctx:     &mut TxContext,
): Coin<RFBTC> {
    let amount_in  = coin_in.value();
    assert!(amount_in > 0, EZeroAmount);
    let amount_out = cpamm_out(amount_in, config.dusdc_rfbtc.value(), config.rfbtc_reserve.value(), FEE_BPS);
    assert!(amount_out >= min_out, ESlippageExceeded);
    config.dusdc_rfbtc.join(coin_in.into_balance());
    let out = coin::take(&mut config.rfbtc_reserve, amount_out, ctx);
    event::emit(SwapExecuted { direction: b"dusdc_to_rfbtc", amount_in, amount_out });
    out
}

// BTC (Tier 3) — external pending until dBTC deploys on testnet
public fun btc_to_dusdc(
    _config:  &SpotRouterConfig,
    _coin_in: Coin<BTC>,
    _min_out: u64,
    _ctx:     &mut TxContext,
): Coin<DUSDC> {
    abort EExternalPending
}

public fun dusdc_to_btc(
    _config:  &SpotRouterConfig,
    _coin_in: Coin<DUSDC>,
    _min_out: u64,
    _ctx:     &mut TxContext,
): Coin<BTC> {
    abort EExternalPending
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun usdc_reserve(c: &SpotRouterConfig): u64  { c.usdc_reserve.value()  }
public fun dusdc_stable(c: &SpotRouterConfig): u64  { c.dusdc_stable.value()  }
public fun sui_reserve(c: &SpotRouterConfig): u64   { c.sui_reserve.value()   }
public fun dusdc_sui(c: &SpotRouterConfig): u64     { c.dusdc_sui.value()     }
public fun rfbtc_reserve(c: &SpotRouterConfig): u64 { c.rfbtc_reserve.value() }
public fun dusdc_rfbtc(c: &SpotRouterConfig): u64   { c.dusdc_rfbtc.value()   }

// ─── Test-only pool seeding (bypasses Auth<AdminRole>) ────────────────────────

#[test_only]
public fun seed_usdc_dusdc_for_testing(
    config: &mut SpotRouterConfig,
    usdc:   Coin<USDC>,
    dusdc:  Coin<DUSDC>,
) {
    config.usdc_reserve.join(usdc.into_balance());
    config.dusdc_stable.join(dusdc.into_balance());
}

#[test_only]
public fun seed_sui_dusdc_for_testing(
    config: &mut SpotRouterConfig,
    sui:    Coin<sui::sui::SUI>,
    dusdc:  Coin<DUSDC>,
) {
    config.sui_reserve.join(sui.into_balance());
    config.dusdc_sui.join(dusdc.into_balance());
}

#[test_only]
public fun seed_rfbtc_dusdc_for_testing(
    config: &mut SpotRouterConfig,
    rfbtc:  Coin<RFBTC>,
    dusdc:  Coin<DUSDC>,
) {
    config.rfbtc_reserve.join(rfbtc.into_balance());
    config.dusdc_rfbtc.join(dusdc.into_balance());
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): SpotRouterConfig {
    SpotRouterConfig {
        id:            object::new(ctx),
        usdc_reserve:  balance::zero(),
        dusdc_stable:  balance::zero(),
        sui_reserve:   balance::zero(),
        dusdc_sui:     balance::zero(),
        rfbtc_reserve: balance::zero(),
        dusdc_rfbtc:   balance::zero(),
    }
}

#[test_only]
public fun destroy_for_testing(c: SpotRouterConfig) {
    let SpotRouterConfig { id, usdc_reserve, dusdc_stable, sui_reserve, dusdc_sui, rfbtc_reserve, dusdc_rfbtc } = c;
    id.delete();
    // sui::test_utils::destroy handles both zero and non-zero balances
    sui::test_utils::destroy(usdc_reserve);
    sui::test_utils::destroy(dusdc_stable);
    sui::test_utils::destroy(sui_reserve);
    sui::test_utils::destroy(dusdc_sui);
    sui::test_utils::destroy(rfbtc_reserve);
    sui::test_utils::destroy(dusdc_rfbtc);
}

// ─── Mock functions — 1:1 with no pool needed (for deposit_router tests) ──────
//
// These use coin::mint_for_testing to produce outputs without requiring seeded
// pool reserves. deposit_router tests call these to isolate the deposit logic
// from swap logic. The real swap functions are tested in spot_router_tests.move.

#[test_only]
public fun usdc_to_dusdc_mock(
    _config:  &SpotRouterConfig,
    coin_in:  Coin<USDC>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<DUSDC> {
    let amount = coin_in.value();
    assert!(amount >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    coin::mint_for_testing(amount, ctx)
}

#[test_only]
public fun dusdc_to_usdc_mock(
    _config:  &SpotRouterConfig,
    coin_in:  Coin<DUSDC>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<USDC> {
    let amount = coin_in.value();
    assert!(amount >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    coin::mint_for_testing(amount, ctx)
}

#[test_only]
public fun sui_to_dusdc_mock(
    _config:  &SpotRouterConfig,
    coin_in:  Coin<sui::sui::SUI>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<DUSDC> {
    let amount = coin_in.value();
    assert!(amount >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    coin::mint_for_testing(amount, ctx)
}

#[test_only]
public fun rfbtc_to_dusdc_mock(
    _config:  &SpotRouterConfig,
    coin_in:  Coin<RFBTC>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<DUSDC> {
    let amount = coin_in.value();
    assert!(amount >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    coin::mint_for_testing(amount, ctx)
}

#[test_only]
public fun dusdc_to_rfbtc_mock(
    _config:  &SpotRouterConfig,
    coin_in:  Coin<DUSDC>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<RFBTC> {
    let amount = coin_in.value();
    assert!(amount >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    coin::mint_for_testing(amount, ctx)
}

#[test_only]
public fun dusdc_to_sui_mock(
    _config:  &SpotRouterConfig,
    coin_in:  Coin<DUSDC>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<sui::sui::SUI> {
    let amount = coin_in.value();
    assert!(amount >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    coin::mint_for_testing(amount, ctx)
}
