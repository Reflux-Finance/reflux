#[test_only]
module reflux::risk_params_tests;

use reflux::risk_params;
use sui::clock;
use sui::tx_context;

// ─── test_hard_params_are_immutable ──────────────────────────────────────────
// Compile-level proof: there is no `set_absolute_max_ltv_bps` function.
// The test below also verifies the constant is exactly 8000.
#[test]
fun test_hard_params_are_immutable() {
    let mut ctx = tx_context::dummy();
    let params = risk_params::create_for_testing(&mut ctx);
    assert!(risk_params::absolute_max_ltv_bps(&params) == 8_000, 0);
    risk_params::destroy_for_testing(params);
}

// ─── test_timelock_blocks_early_execute ──────────────────────────────────────
#[test]
#[expected_failure(abort_code = risk_params::ETimelockNotExpired)]
fun test_timelock_blocks_early_execute() {
    let mut ctx = tx_context::dummy();
    let admin = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut params = risk_params::create_for_testing(&mut ctx);
    let mut clock = clock::create_for_testing(&mut ctx);

    // Propose at t = 0
    risk_params::propose_update(
        &admin, &mut params,
        7_500, 5_000, 6_500, 2_000, 500, 1_000, 300_000, 60_000,
        &clock,
    );

    // Advance 23 h — timelock is 24 h
    clock::increment_for_testing(&mut clock, 23 * 3_600_000);

    // Must abort with ETimelockNotExpired
    risk_params::execute_update(&mut params, &clock);

    abort 0 // unreachable — keep compiler happy
}

// ─── test_timelock_execute_succeeds_after_24h ────────────────────────────────
#[test]
fun test_timelock_execute_succeeds_after_24h() {
    let mut ctx = tx_context::dummy();
    let admin = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut params = risk_params::create_for_testing(&mut ctx);
    let mut clock = clock::create_for_testing(&mut ctx);

    risk_params::propose_update(
        &admin, &mut params,
        7_000, 4_500, 6_000, 1_500, 600, 900, 200_000, 50_000,
        &clock,
    );

    clock::increment_for_testing(&mut clock, 86_400_000); // exactly 24 h

    risk_params::execute_update(&mut params, &clock);

    assert!(risk_params::liquidation_ltv_bps(&params) == 7_000, 1);
    assert!(risk_params::target_ltv_bps(&params)      == 4_500, 2);

    risk_params::destroy_for_testing(params);
    risk_params::destroy_admin_cap_for_testing(admin);
    clock::destroy_for_testing(clock);
}

// ─── test_no_duplicate_proposal ──────────────────────────────────────────────
#[test]
#[expected_failure(abort_code = risk_params::EAlreadyPending)]
fun test_no_duplicate_proposal() {
    let mut ctx = tx_context::dummy();
    let admin = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut params = risk_params::create_for_testing(&mut ctx);
    let clock = clock::create_for_testing(&mut ctx);

    risk_params::propose_update(
        &admin, &mut params,
        7_500, 5_000, 6_500, 2_000, 500, 1_000, 300_000, 60_000, &clock,
    );
    // Second proposal while one is pending — must abort
    risk_params::propose_update(
        &admin, &mut params,
        7_500, 5_000, 6_500, 2_000, 500, 1_000, 300_000, 60_000, &clock,
    );

    abort 0
}

// ─── test_proposal_exceeds_hard_cap_aborts ───────────────────────────────────
#[test]
#[expected_failure(abort_code = risk_params::EExceedsHardCap)]
fun test_proposal_exceeds_hard_cap_aborts() {
    let mut ctx = tx_context::dummy();
    let admin = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut params = risk_params::create_for_testing(&mut ctx);
    let clock = clock::create_for_testing(&mut ctx);

    // liquidation_ltv = 8001 > hard cap 8000
    risk_params::propose_update(
        &admin, &mut params,
        8_001, 5_000, 6_500, 2_000, 500, 1_000, 300_000, 60_000, &clock,
    );

    abort 0
}

// ─── test_pause_unpause ──────────────────────────────────────────────────────
#[test]
fun test_pause_unpause() {
    let mut ctx = tx_context::dummy();
    let admin = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut params = risk_params::create_for_testing(&mut ctx);

    assert!(!risk_params::paused(&params), 0);
    risk_params::pause(&admin, &mut params);
    assert!(risk_params::paused(&params), 1);
    risk_params::unpause(&admin, &mut params);
    assert!(!risk_params::paused(&params), 2);

    risk_params::destroy_for_testing(params);
    risk_params::destroy_admin_cap_for_testing(admin);
}

// ─── test_cancel_pending_update ──────────────────────────────────────────────
#[test]
fun test_cancel_pending_update() {
    let mut ctx = tx_context::dummy();
    let admin = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut params = risk_params::create_for_testing(&mut ctx);
    let clock = clock::create_for_testing(&mut ctx);

    risk_params::propose_update(
        &admin, &mut params,
        7_500, 5_000, 6_500, 2_000, 500, 1_000, 300_000, 60_000, &clock,
    );
    assert!(risk_params::has_pending_update(&params), 0);
    risk_params::cancel_update(&admin, &mut params);
    assert!(!risk_params::has_pending_update(&params), 1);

    risk_params::destroy_for_testing(params);
    risk_params::destroy_admin_cap_for_testing(admin);
    clock::destroy_for_testing(clock);
}
