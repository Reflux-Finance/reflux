#[test_only]
module reflux::lsd_adapter_tests;

use reflux::lsd_adapter;
use reflux::risk_params;
use sui::clock;
use sui::tx_context;

// ─── test_fresh_rate_passes_staleness ────────────────────────────────────────
#[test]
fun test_fresh_rate_passes_staleness() {
    let mut ctx = tx_context::dummy();
    let mut registry = lsd_adapter::create_for_testing(&mut ctx);
    let rp    = risk_params::create_for_testing(&mut ctx);
    let mut clock = clock::create_for_testing(&mut ctx);

    // Push a rate at t=0
    lsd_adapter::set_vsui_rate_for_testing(&mut registry, 1_050_000_000, 0);

    // Check at t = 59_999 ms (just under 60 s default staleness)
    clock::increment_for_testing(&mut clock, 59_999);
    let rate = lsd_adapter::get_vsui_rate_e9(&registry, &rp, &clock);
    assert!(rate == 1_050_000_000, 0);

    lsd_adapter::destroy_for_testing(registry);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}

// ─── test_stale_rate_aborts ───────────────────────────────────────────────────
#[test]
#[expected_failure(abort_code = lsd_adapter::ERateTooStale)]
fun test_stale_rate_aborts() {
    let mut ctx = tx_context::dummy();
    let mut registry = lsd_adapter::create_for_testing(&mut ctx);
    let rp    = risk_params::create_for_testing(&mut ctx);
    let mut clock = clock::create_for_testing(&mut ctx);

    lsd_adapter::set_vsui_rate_for_testing(&mut registry, 1_050_000_000, 0);

    // Advance past default staleness (60_000 ms)
    clock::increment_for_testing(&mut clock, 60_001);
    let _ = lsd_adapter::get_vsui_rate_e9(&registry, &rp, &clock);

    abort 0
}

// ─── test_lsd_to_sui_conversion ──────────────────────────────────────────────
#[test]
fun test_lsd_to_sui_conversion() {
    // 1 vSUI at rate 1.05 → 1.05 SUI
    let sui_amount = lsd_adapter::lsd_to_sui(1_000_000_000, 1_050_000_000);
    assert!(sui_amount == 1_050_000_000, 0);

    // 0 LSD → 0 SUI
    let zero = lsd_adapter::lsd_to_sui(0, 1_050_000_000);
    assert!(zero == 0, 1);
}
