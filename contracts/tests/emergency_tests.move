#[test_only]
module reflux::emergency_tests;

use reflux::emergency;
use reflux::leverage;
use reflux::risk_params;
use dusdc::dusdc::DUSDC;
use sui::coin;
use sui::tx_context;

// ─── test_emergency_deleverage_trustless ─────────────────────────────────────
// Anyone can deleverage a breached position (no keeper auth required).
// LTV = 80% (8000 bps) > liquidation_ltv (7500 bps) → breach → deleverage succeeds.
#[test]
fun test_emergency_deleverage_trustless() {
    let mut ctx = tx_context::dummy();
    let rp      = risk_params::create_for_testing(&mut ctx);

    // Build a position: collateral=1e9, debt=8e8, price=1e9 → LTV = 80% = 8000 bps
    // liquidation_ltv default = 7500 bps → breached
    let mut pos = leverage::create_position_for_testing(
        b"vsui",
        1_000_000_000,  // collateral
        800_000_000,    // debt (80% LTV)
        1_000_000_000,  // price 1.0
        &mut ctx,
    );

    // assert_ltv_breach should NOT abort
    emergency::assert_ltv_breach(&pos, 1_000_000_000, &rp);

    // Repay 400M → LTV drops to 40%
    let repay = coin::mint_for_testing<DUSDC>(400_000_000, &mut ctx);
    emergency::emergency_deleverage(&mut pos, repay, 1_000_000_000, &rp, &mut ctx);

    // Position debt reduced
    assert!(leverage::debt_dusdc(&pos) == 400_000_000, 0);

    leverage::destroy_position_for_testing(pos);
    risk_params::destroy_for_testing(rp);
}

// ─── test_emergency_deleverage_rejects_healthy ────────────────────────────────
// Deleverage on a healthy position must abort (ELtvHealthy).
// LTV = 50% (5000 bps) < liquidation_ltv (7500 bps) → healthy → rejects.
#[test]
#[expected_failure(abort_code = emergency::ELtvHealthy)]
fun test_emergency_deleverage_rejects_healthy() {
    let mut ctx = tx_context::dummy();
    let rp      = risk_params::create_for_testing(&mut ctx);

    let mut pos = leverage::create_position_for_testing(
        b"vsui",
        1_000_000_000,
        500_000_000, // 50% LTV — healthy
        1_000_000_000,
        &mut ctx,
    );

    let repay = coin::mint_for_testing<DUSDC>(100_000_000, &mut ctx);
    // Must abort
    emergency::emergency_deleverage(&mut pos, repay, 1_000_000_000, &rp, &mut ctx);

    abort 0 // unreachable
}

// ─── test_assert_ltv_breach_rejects_healthy ──────────────────────────────────
#[test]
#[expected_failure(abort_code = emergency::ELtvHealthy)]
fun test_assert_ltv_breach_rejects_healthy() {
    let mut ctx = tx_context::dummy();
    let rp      = risk_params::create_for_testing(&mut ctx);

    let pos = leverage::create_position_for_testing(
        b"vsui", 1_000_000_000, 500_000_000, 1_000_000_000, &mut ctx,
    );

    // LTV = 50% < liquidation_ltv (75%) → must abort
    emergency::assert_ltv_breach(&pos, 1_000_000_000, &rp);

    abort 0 // unreachable
}
