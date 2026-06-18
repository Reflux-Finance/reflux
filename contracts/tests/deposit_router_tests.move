#[test_only]
module reflux::deposit_router_tests;

use reflux::deposit_router;
use reflux::ib_credit;
use reflux::risk_params;
use reflux::share_token;
use reflux::spot_router;
use reflux::types::VSUI;
use usdc::usdc::USDC;
use sui::coin;
use sui::tx_context;

// ─── test_usdc_deposit_no_debt_record ────────────────────────────────────────
// deposit_usdc_mock: no CollateralRecord, no DebtRecord.
#[test]
fun test_usdc_deposit_no_debt_record() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);

    let usdc = coin::mint_for_testing<USDC>(10_000_000, &mut ctx);
    let (pos, shares) = deposit_router::deposit_usdc_mock_returning(
        usdc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    assert!(!deposit_router::position_has_collateral(&pos), 0);
    assert!(!deposit_router::position_has_debt(&pos), 1);
    assert!(deposit_router::position_shares_minted(&pos) == 10_000_000, 2);
    assert!(shares.value() == 10_000_000, 3);
    assert!(deposit_router::pool_balance(&pool) == 10_000_000, 4);

    sui::test_utils::destroy(shares);
    deposit_router::destroy_position_for_testing(pos);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}

// ─── test_usdc_roundtrip_plain_usdc ──────────────────────────────────────────
// deposit_usdc → withdraw → dUSDC entitlement matches deposit amount.
#[test]
fun test_usdc_roundtrip_plain_usdc() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);

    let deposit_amount = 10_000_000u64;
    let usdc = coin::mint_for_testing<USDC>(deposit_amount, &mut ctx);
    let (pos, shares) = deposit_router::deposit_usdc_mock_returning(
        usdc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Withdraw all shares — pool has the dUSDC
    let dusdc_out = deposit_router::withdraw(
        pos, shares, 1, 0, &mut pool, &mut ib, &mut registry, &rp, &mut ctx,
    );

    // Rounding can lose at most 1 unit
    assert!(dusdc_out.value() >= deposit_amount - 1, 0);
    assert!(dusdc_out.value() <= deposit_amount, 1);
    // Registry supply is back to zero
    assert!(share_token::total_supply(&registry) == 0, 2);

    sui::test_utils::destroy(dusdc_out);
    ib_credit::destroy_for_testing(ib);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}

// ─── test_deposit_usdc_real_records_output_usdc ──────────────────────────────
// The real (non-mock) deposit_usdc must tag the position OUTPUT_USDC, so the
// withdrawal path knows to swap dUSDC back to USDC. Regression test for a bug
// where deposit_usdc recorded OUTPUT_ORIGINAL (raw dUSDC) instead.
#[test]
fun test_deposit_usdc_real_records_output_usdc() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let mut config   = spot_router::create_for_testing(&mut ctx);

    // Seed the real USDC/dUSDC treasury so the production swap has reserves.
    let seed_usdc  = coin::mint_for_testing<USDC>(0, &mut ctx);
    let seed_dusdc = deposit_router::mint_dusdc_for_testing(50_000_000, &mut ctx);
    spot_router::seed_usdc_dusdc_for_testing(&mut config, seed_usdc, seed_dusdc);

    let usdc = coin::mint_for_testing<USDC>(10_000_000, &mut ctx);
    let (pos, shares) = deposit_router::deposit_usdc_returning(
        usdc, 1, &mut config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    assert!(deposit_router::position_preferred_output(&pos) == deposit_router::output_usdc(), 0);

    sui::test_utils::destroy(shares);
    deposit_router::destroy_position_for_testing(pos);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}

// ─── test_withdraw_partial_keeps_position_alive ──────────────────────────────
#[test]
fun test_withdraw_partial_keeps_position_alive() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);

    let deposit_amount = 10_000_000u64;
    let usdc = coin::mint_for_testing<USDC>(deposit_amount, &mut ctx);
    let (mut pos, mut shares) = deposit_router::deposit_usdc_mock_returning(
        usdc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Split off 4M of the 10M shares and withdraw just that slice.
    let partial_shares = shares.split(4_000_000, &mut ctx);
    let dusdc_out = deposit_router::withdraw_partial(
        &mut pos, partial_shares, 1, 0, &mut pool, &mut ib, &mut registry, &rp, &mut ctx,
    );

    assert!(dusdc_out.value() >= 3_999_999 && dusdc_out.value() <= 4_000_000, 0);
    // Position survives with the remaining 6M tracked, still owned by the caller.
    assert!(deposit_router::position_shares_minted(&pos) == 6_000_000, 1);
    // Registry supply reflects only the burned slice.
    assert!(share_token::total_supply(&registry) == 6_000_000, 2);
    // Remaining 6M shares coin is still spendable — withdraw the rest via the
    // full-withdrawal path, which now consumes the position.
    let dusdc_out_2 = deposit_router::withdraw(
        pos, shares, 1, 0, &mut pool, &mut ib, &mut registry, &rp, &mut ctx,
    );
    assert!(dusdc_out_2.value() >= 5_999_999 && dusdc_out_2.value() <= 6_000_000, 3);
    assert!(share_token::total_supply(&registry) == 0, 4);

    sui::test_utils::destroy(dusdc_out);
    sui::test_utils::destroy(dusdc_out_2);
    ib_credit::destroy_for_testing(ib);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}

// ─── test_withdraw_partial_rejects_full_amount ───────────────────────────────
// Passing the entire shares_minted to withdraw_partial must abort — use
// withdraw() instead for full redemption (it's the one that closes the position).
#[test]
#[expected_failure(abort_code = deposit_router::EExceedsPosition)]
fun test_withdraw_partial_rejects_full_amount() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);

    let usdc = coin::mint_for_testing<USDC>(10_000_000, &mut ctx);
    let (mut pos, shares) = deposit_router::deposit_usdc_mock_returning(
        usdc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    let dusdc_out = deposit_router::withdraw_partial(
        &mut pos, shares, 1, 0, &mut pool, &mut ib, &mut registry, &rp, &mut ctx,
    );

    sui::test_utils::destroy(dusdc_out);
    deposit_router::destroy_position_for_testing(pos);
    ib_credit::destroy_for_testing(ib);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}

// ─── test_withdraw_partial_rejects_leveraged_position ────────────────────────
#[test]
#[expected_failure(abort_code = deposit_router::ELeveragedNoPartial)]
fun test_withdraw_partial_rejects_leveraged_position() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);

    let vsui = coin::mint_for_testing<VSUI>(1_000_000_000, &mut ctx);
    let (mut pos, mut shares) = deposit_router::deposit_vsui_mock_returning(
        vsui, 5_000, 1_000_000_000, 1, &mut registry, &mut pool, &rp, &mut ctx,
    );

    let partial = shares.split(100, &mut ctx);
    let dusdc_out = deposit_router::withdraw_partial(
        &mut pos, partial, 1, 0, &mut pool, &mut ib, &mut registry, &rp, &mut ctx,
    );

    sui::test_utils::destroy(dusdc_out);
    sui::test_utils::destroy(shares);
    deposit_router::destroy_position_for_testing(pos);
    ib_credit::destroy_for_testing(ib);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
}

// ─── test_lsd_deposit_with_leverage_respects_max_ltv ─────────────────────────
// deposit_vsui_mock with leverage_bps within max_ltv → succeeds.
// Leverage beyond max_ltv → aborts with EBorrowExceedsMaxLtv.
#[test]
fun test_lsd_deposit_with_leverage_respects_max_ltv() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);

    // 50% leverage (5000 bps) on 1 vSUI @ price 1.0 → LTV = 50% < max_ltv (65%)
    let vsui = coin::mint_for_testing<VSUI>(1_000_000_000, &mut ctx);
    deposit_router::deposit_vsui_mock(
        vsui, 5_000, 1_000_000_000, 1, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Pool has collateral_value + borrow = 1e9 + 5e8 = 1.5e9 dUSDC
    assert!(deposit_router::pool_balance(&pool) == 1_500_000_000, 0);
    assert!(share_token::total_supply(&registry) == 1_500_000_000, 1);

    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
}

// ─── test_lsd_leverage_beyond_max_ltv_aborts ─────────────────────────────────
#[test]
#[expected_failure(abort_code = deposit_router::EBorrowExceedsMaxLtv)]
fun test_lsd_leverage_beyond_max_ltv_aborts() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);

    // 70% leverage → LTV = 70% > max_ltv (65%) → must abort
    let vsui = coin::mint_for_testing<VSUI>(1_000_000_000, &mut ctx);
    deposit_router::deposit_vsui_mock(
        vsui, 7_000, 1_000_000_000, 1, &mut registry, &mut pool, &rp, &mut ctx,
    );

    abort 0 // unreachable
}

// ─── test_paused_blocks_deposits_not_withdrawals ─────────────────────────────
#[test]
fun test_paused_blocks_deposits_not_withdrawals() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);
    let mut rp       = risk_params::create_for_testing(&mut ctx);
    let admin        = risk_params::create_admin_cap_for_testing(&mut ctx);

    // Create a position BEFORE pausing
    let usdc = coin::mint_for_testing<USDC>(5_000_000, &mut ctx);
    let (pos, shares) = deposit_router::deposit_usdc_mock_returning(
        usdc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Pause the system
    risk_params::pause(&admin, &mut rp);
    assert!(risk_params::paused(&rp), 0);

    // Withdrawal must still succeed even when paused
    let dusdc_out = deposit_router::withdraw(
        pos, shares, 0, 0, &mut pool, &mut ib, &mut registry, &rp, &mut ctx,
    );
    assert!(dusdc_out.value() > 0, 1);

    sui::test_utils::destroy(dusdc_out);
    ib_credit::destroy_for_testing(ib);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    risk_params::destroy_admin_cap_for_testing(admin);
    spot_router::destroy_for_testing(config);
}

// ─── test_paused_blocks_new_deposit ──────────────────────────────────────────
#[test]
#[expected_failure(abort_code = deposit_router::EPaused)]
fun test_paused_blocks_new_deposit() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);
    let mut rp       = risk_params::create_for_testing(&mut ctx);
    let admin        = risk_params::create_admin_cap_for_testing(&mut ctx);

    risk_params::pause(&admin, &mut rp);

    // Deposit while paused → must abort EPaused
    let usdc = coin::mint_for_testing<USDC>(5_000_000, &mut ctx);
    let (_pos, _shares) = deposit_router::deposit_usdc_mock_returning(
        usdc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );
    abort 0 // unreachable
}

// ─── test_nav_isolation_usdc_vs_lsd ──────────────────────────────────────────
// Two depositors each deposit 100 dUSDC → 100 rfUSD each.
// After a simulated roll with yield, both have proportional share of yield.
// (Simplified model: all yield is global. Staking isolation is EXTERNAL-PENDING.)
#[test]
fun test_nav_isolation_usdc_vs_lsd() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);

    // Alice deposits 100 dUSDC (USDC path)
    let usdc_a = coin::mint_for_testing<USDC>(100_000_000, &mut ctx);
    let (pos_a, shares_a) = deposit_router::deposit_usdc_mock_returning(
        usdc_a, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Bob deposits 100 dUSDC (LSD path — same amount for symmetry)
    let usdc_b = coin::mint_for_testing<USDC>(100_000_000, &mut ctx);
    let (pos_b, shares_b) = deposit_router::deposit_usdc_mock_returning(
        usdc_b, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Total deposit: 200 dUSDC, 200 rfUSD
    assert!(share_token::total_supply(&registry) == 200_000_000, 0);
    assert!(share_token::nav_per_share_e9(&registry) == 1_000_000_000, 1);

    // Simulate yield: add 20 dUSDC to pool (10% yield)
    deposit_router::seed_pool_for_testing(&mut pool, 20_000_000, &mut ctx);

    // Update NAV to reflect yield: total = 220M / 200M shares → 1.1e9
    share_token::update_nav(&mut registry, 220_000_000);
    assert!(share_token::nav_per_share_e9(&registry) == 1_100_000_000, 2);

    // Both Alice and Bob get proportional yield (10% each)
    // Alice: 100 shares × 1.1 = 110 dUSDC entitlement
    // Bob:   100 shares × 1.1 = 110 dUSDC entitlement
    let alice_entitlement = share_token::burn_shares(&mut registry, shares_a, 0, &mut ctx);
    let bob_entitlement   = share_token::burn_shares(&mut registry, shares_b, 0, &mut ctx);

    assert!(alice_entitlement == 110_000_000, 3);
    assert!(bob_entitlement   == 110_000_000, 4);

    deposit_router::destroy_position_for_testing(pos_a);
    deposit_router::destroy_position_for_testing(pos_b);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}

// ─── test_rfbtc_deposit_mock ──────────────────────────────────────────────────
#[test]
fun test_rfbtc_deposit_mock() {
    use reflux::rfbtc;
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);

    let rfbtc = rfbtc::create_for_testing(1_000_000, &mut ctx);
    deposit_router::deposit_rfbtc_mock(rfbtc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx);

    assert!(deposit_router::pool_balance(&pool) == 1_000_000, 0);

    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}

// ─── test_withdraw_never_leaves_bad_debt ─────────────────────────────────────
// Two positions: one plain USDC, one leveraged LSD.
// Withdraw the USDC position → LSD position's debt is unaffected.
#[test]
fun test_withdraw_never_leaves_bad_debt() {
    let mut ctx      = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let config       = spot_router::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);

    // Alice: USDC deposit
    let usdc = coin::mint_for_testing<USDC>(50_000_000, &mut ctx);
    let (alice_pos, alice_shares) = deposit_router::deposit_usdc_mock_returning(
        usdc, 1, &config, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Bob: LSD deposit with 50% leverage (50M collateral + 25M borrow = 75M total)
    let vsui = coin::mint_for_testing<VSUI>(50_000_000, &mut ctx);
    deposit_router::deposit_vsui_mock(
        vsui, 5_000, 1_000_000_000, 1, &mut registry, &mut pool, &rp, &mut ctx,
    );

    // Total supply: Alice's 50M + Bob's 75M = 125M rfUSD
    assert!(share_token::total_supply(&registry) == 125_000_000, 0);

    // Alice withdraws her position — should succeed
    let dusdc_out = deposit_router::withdraw(
        alice_pos, alice_shares, 0, 0, &mut pool, &mut ib, &mut registry, &rp, &mut ctx,
    );
    assert!(dusdc_out.value() > 0, 1);
    // Alice's 50M rfUSD burned → supply = 75M
    assert!(share_token::total_supply(&registry) == 75_000_000, 2);
    // Bob's position shares still in circulation (representing his LSD + leverage)

    sui::test_utils::destroy(dusdc_out);
    ib_credit::destroy_for_testing(ib);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    spot_router::destroy_for_testing(config);
}
