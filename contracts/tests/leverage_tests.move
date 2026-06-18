#[test_only]
module reflux::leverage_tests;

use reflux::leverage;
use reflux::risk_params;
use dusdc::dusdc::DUSDC;
use sui::coin;
use sui::tx_context;

// ─── test_ltv_math_u128_no_overflow ──────────────────────────────────────────
// These values overflow u64 multiplication but fit safely in u128.
// collateral = 10^10, price_e9 = 10^13 → product = 10^23 < u128::MAX (~3.4e38)
#[test]
fun test_ltv_math_u128_no_overflow() {
    // collateral_value = 10^10 * 10^13 / 10^9 = 10^14 dUSDC base units
    // debt = 5 * 10^13 → LTV = 50% = 5_000 bps
    let collateral = 10_000_000_000u64;
    let price_e9   = 10_000_000_000_000u64; // $10_000 in e9 units
    let debt       = 50_000_000_000_000u64; // 5 * 10^13 dUSDC base

    let ltv = leverage::compute_ltv_bps(collateral, debt, price_e9);
    // collateral_value_dusdc = 10^23 / 10^9 = 10^14
    // ltv = 5*10^13 * 10_000 / 10^14 = 5_000 bps
    assert!(ltv == 5_000, 0);
}

// ─── test_borrow_beyond_max_ltv_aborts ───────────────────────────────────────
#[test]
#[expected_failure(abort_code = leverage::EBorrowExceedsMaxLtv)]
fun test_borrow_beyond_max_ltv_aborts() {
    let mut ctx = tx_context::dummy();
    let rp = risk_params::create_for_testing(&mut ctx);

    // max_ltv_bps = 6_500; attempt 70% LTV
    // collateral_value = 1e9 * 1e9 / 1e9 = 1e9 dUSDC
    // debt = 7e8 → LTV = 7_000 bps > 6_500
    let _pos = leverage::borrow_against_collateral(
        b"vsui",
        1_000_000_000,  // 1 vSUI
        700_000_000,    // borrow 700 dUSDC
        1_000_000_000,  // price 1.0
        &rp,
        &mut ctx,
    );
    abort 0 // unreachable — borrow_against_collateral aborts first; _pos covered by abort
}

// ─── test_borrow_within_max_ltv_succeeds ─────────────────────────────────────
#[test]
fun test_borrow_within_max_ltv_succeeds() {
    let mut ctx = tx_context::dummy();
    let rp = risk_params::create_for_testing(&mut ctx);

    // 50% LTV = 5_000 bps ≤ max_ltv (6_500) → should succeed
    let pos = leverage::borrow_against_collateral(
        b"vsui",
        1_000_000_000,
        500_000_000,
        1_000_000_000,
        &rp,
        &mut ctx,
    );
    assert!(leverage::debt_dusdc(&pos) == 500_000_000, 0);
    leverage::destroy_position_for_testing(pos);
    risk_params::destroy_for_testing(rp);
}

// ─── test_deleverage_amount_calc ─────────────────────────────────────────────
#[test]
fun test_deleverage_amount_calc() {
    // collateral = 1_000_000_000, price = 1.0 → coll_val = 1_000_000_000 dUSDC
    // debt = 700_000_000 (70% LTV)
    // target_ltv = 5_000 (50%) → target_debt = 500_000_000
    // repay_needed = 200_000_000
    let repay = leverage::deleverage_amount(
        1_000_000_000,
        700_000_000,
        1_000_000_000,
        5_000,
    );
    assert!(repay == 200_000_000, 0);
}

// ─── test_deleverage_amount_zero_when_healthy ─────────────────────────────────
#[test]
fun test_deleverage_amount_zero_when_healthy() {
    // debt at 40% LTV — already below target 50%
    let repay = leverage::deleverage_amount(
        1_000_000_000,
        400_000_000,
        1_000_000_000,
        5_000,
    );
    assert!(repay == 0, 0);
}

// ─── test_needs_deleverage ────────────────────────────────────────────────────
#[test]
fun test_needs_deleverage() {
    let mut ctx = tx_context::dummy();
    let rp = risk_params::create_for_testing(&mut ctx);
    // liquidation_ltv_bps = 7_500 (default); 80% LTV exceeds it
    let needs = leverage::needs_deleverage(
        1_000_000_000,
        800_000_000,
        1_000_000_000,
        &rp,
    );
    assert!(needs, 0);
    // 50% LTV — healthy
    let healthy = leverage::needs_deleverage(
        1_000_000_000,
        500_000_000,
        1_000_000_000,
        &rp,
    );
    assert!(!healthy, 1);
    risk_params::destroy_for_testing(rp);
}

// ─── test_repay_and_release ───────────────────────────────────────────────────
#[test]
fun test_repay_and_release() {
    let mut ctx = tx_context::dummy();
    let rp = risk_params::create_for_testing(&mut ctx);
    let pos = leverage::borrow_against_collateral(
        b"vsui",
        1_000_000_000,
        500_000_000,
        1_000_000_000,
        &rp,
        &mut ctx,
    );
    let repay_coin = coin::mint_for_testing<DUSDC>(500_000_000, &mut ctx);
    leverage::repay_and_release(pos, repay_coin, &mut ctx);
    risk_params::destroy_for_testing(rp);
}
