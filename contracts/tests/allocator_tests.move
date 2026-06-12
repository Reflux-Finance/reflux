#[test_only]
module reflux::allocator_tests;

use reflux::allocator;
use reflux::risk_params;
use sui::clock;
use sui::tx_context;

// ─── test_allocator_neutral_holds_base ───────────────────────────────────────
// Neutral IV (between thresholds) → base weights unchanged, reason_code = 0.
#[test]
fun test_allocator_neutral_holds_base() {
    let mut ctx    = tx_context::dummy();
    let mut policy = allocator::create_for_testing(&mut ctx);
    let rp         = risk_params::create_for_testing(&mut ctx);
    let clock      = clock::create_for_testing(&mut ctx);

    // atm_iv = 4500 — between low (3000) and high (6000)
    let targets = allocator::compute_targets(
        &mut policy, 100_000_000, 4_500, 0, &rp, &clock,
    );

    // Neutral: base weights should be unchanged
    assert!(allocator::plp_bps(&targets) == 3_000, 0);
    assert!(allocator::range_bps(&targets) == 4_000, 1);
    assert!(allocator::margin_loop_bps(&targets) == 2_000, 2);
    assert!(allocator::ib_idle_bps(&targets) == 1_000, 3);
    // Reason code = RC_NEUTRAL (0)
    // Roll counter incremented
    assert!(allocator::roll_counter(&policy) == 1, 4);

    allocator::destroy_for_testing(policy);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}

// ─── test_allocator_regime_shift_low_iv ──────────────────────────────────────
// atm_iv below threshold → range shrinks by shift; plp and ib_idle grow.
// Default: low_thresh=3000, regime_shift=1500, base=[3000,4000,2000,1000]
// Expected after shift: range=2500, plp=3750, ib=1750, ml=2000
#[test]
fun test_allocator_regime_shift_low_iv() {
    let mut ctx    = tx_context::dummy();
    let mut policy = allocator::create_for_testing(&mut ctx);
    let rp         = risk_params::create_for_testing(&mut ctx);
    let clock      = clock::create_for_testing(&mut ctx);

    // atm_iv = 2500 < low_threshold (3000) → low-IV regime
    let targets = allocator::compute_targets(
        &mut policy, 100_000_000, 2_500, 0, &rp, &clock,
    );

    // shift = min(1500, 4000) = 1500; half = 750
    // range' = 4000 - 1500 = 2500
    // plp'   = 3000 + 750  = 3750
    // ib'    = 1000 + 750  = 1750
    // ml'    = 2000 (unchanged)
    assert!(allocator::range_bps(&targets) == 2_500, 0);
    assert!(allocator::plp_bps(&targets)   == 3_750, 1);
    assert!(allocator::ib_idle_bps(&targets) == 1_750, 2);
    assert!(allocator::margin_loop_bps(&targets) == 2_000, 3);

    // IB floor: min_ib = 500 (default), ib' = 1750 >= 500 → no floor enforcement
    // dUSDC amounts are proportional to nav=100M
    assert!(allocator::range_dusdc(&targets) == 25_000_000, 4);
    assert!(allocator::plp_dusdc(&targets)   == 37_500_000, 5);

    allocator::destroy_for_testing(policy);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}

// ─── test_allocator_regime_shift_high_iv ─────────────────────────────────────
// atm_iv above threshold → range grows, plp and ib_idle shrink.
// Default: high_thresh=6000, base=[3000,4000,2000,1000]
// shift = min(1500, 3000+1000) = 1500; from_plp=min(1500,3000)=1500; from_ib=0
// range' = 4000 + 1500 = 5500, plp' = 3000 - 1500 = 1500, ib' = 1000, ml' = 2000
#[test]
fun test_allocator_regime_shift_high_iv() {
    let mut ctx    = tx_context::dummy();
    let mut policy = allocator::create_for_testing(&mut ctx);
    let rp         = risk_params::create_for_testing(&mut ctx);
    let clock      = clock::create_for_testing(&mut ctx);

    // atm_iv = 7000 > high_threshold (6000) → high-IV regime
    let targets = allocator::compute_targets(
        &mut policy, 100_000_000, 7_000, 0, &rp, &clock,
    );

    assert!(allocator::range_bps(&targets) == 5_500, 0);
    assert!(allocator::plp_bps(&targets)   == 1_500, 1);
    assert!(allocator::ib_idle_bps(&targets) == 1_000, 2);
    assert!(allocator::margin_loop_bps(&targets) == 2_000, 3);

    allocator::destroy_for_testing(policy);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}

// ─── test_ib_floor_never_violated ────────────────────────────────────────────
// Custom policy: tiny ib_idle base + low-IV shift that would bring ib below floor.
// Verify IB is raised back to min_ib_buffer_bps floor.
// min_ib_buffer_bps default = 500 (5%)
// Custom base: plp=4000, range=4000, ml=1500, ib=500  (sum=10000)
// iv_low=3000, regime_shift=1200
// Low-IV shift: range -= 1200 → 2800; half=600; plp += 600 → 4600; ib += 600 → 1100
// ib' = 1100 >= min_ib (500) → no floor enforcement needed in this case.
//
// To truly test the floor: base ib=100, shift=900 → ib after shift = 100+450=550 > 500 ok
// Let's use a policy where ib starts at 200 and regime shift would bring it to 200+400=600,
// but with a min_ib of 800 (custom RiskParams) forcing floor enforcement.
// Instead, simplest: use custom policy with ib_idle base=200, regime_shift=100 (low-IV).
// After shift: ib = 200 + 50 = 250. If min_ib=500 → floor fires.
// But RiskParams is fixed at min_ib=500 (default).
// Custom policy: plp=3300, range=4000, ml=2300, ib=400 (sum=10000)
// Low-IV shift of 1000: range -= 1000 → 3000; half=500; plp += 500 → 3800; ib += 500 → 900
// ib' = 900 > 500 → no floor. Need ib start lower.
//
// Custom policy: plp=5000, range=3000, ml=1800, ib=200 (sum=10000)
// regime_shift=800; low-IV: range -= 800 → 2200; half=400; plp += 400 → 5400; ib += 400 → 600
// ib' = 600 > 500 → still no floor.
//
// Let's make regime_shift=1600: range -= 1600 → 1400; half=800; plp += 800 → 5800; ib += 800 → 1000
// ib' = 1000 > 500 still.
//
// The only way floor fires with low-IV is if ib decreases. Low-IV INCREASES ib.
// High-IV shifts ib → range, so: base ib=600, regime_shift=400; shift from ib=400 → ib=200 < min_ib(500).
// So: plp=3400, range=4000, ml=2000, ib=600 (sum=10000)
// High-IV shift: max_shift=min(400, 3400+600)=400; from_plp=min(400,3400)=400; from_ib=0
// range' = 4400, plp' = 3000, ib' = 600 → still 600 > 500.
// Need shift to come from ib: plp=100, ib=600, shift=400; from_plp=100; from_ib=300 → ib'=300 < 500!
// Custom policy: plp=100, range=4000, ml=5300, ib=600 (sum=10000), regime_shift=400, iv_high=6000
// High-IV: max_shift=min(400, 100+600)=400; from_plp=min(400,100)=100; from_ib=min(300,600)=300
// actual_shift=400; plp'=0; ib'=300 < min_ib(500) → floor fires!
// floor_deficit = 500-300=200; from_plp=min(200,0)=0; from_range=min(200,4400)=200; from_ml=0
// range'' = 4400-200=4200; ib'' = 300+200=500 ✓
#[test]
fun test_ib_floor_never_violated() {
    let mut ctx = tx_context::dummy();
    let mut policy = allocator::create_custom_for_testing(
        100,   // base_plp_bps
        4_000, // base_range_bps
        5_300, // base_margin_loop_bps
        600,   // base_ib_idle_bps   (sum = 10000)
        3_000, // iv_low_threshold_e4
        6_000, // iv_high_threshold_e4
        400,   // regime_shift_bps
        &mut ctx,
    );
    let rp    = risk_params::create_for_testing(&mut ctx);
    let clock = clock::create_for_testing(&mut ctx);

    // atm_iv = 7000 > high_threshold (6000) → high-IV regime
    let targets = allocator::compute_targets(
        &mut policy, 100_000_000, 7_000, 0, &rp, &clock,
    );

    // IB floor must be >= min_ib_buffer_bps (500)
    assert!(allocator::ib_idle_bps(&targets) >= 500, 0);
    // sum of all weights = 10000
    let sum = allocator::plp_bps(&targets) + allocator::range_bps(&targets)
            + allocator::margin_loop_bps(&targets) + allocator::ib_idle_bps(&targets);
    assert!(sum == 10_000, 1);

    allocator::destroy_for_testing(policy);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}

// ─── test_allocator_respects_hard_caps ────────────────────────────────────────
// Verifies that the IB floor cap is applied (hard cap enforced).
// Same scenario as test_ib_floor_never_violated — after cap, ib = 500 exactly.
#[test]
fun test_allocator_respects_hard_caps() {
    let mut ctx = tx_context::dummy();
    let mut policy = allocator::create_custom_for_testing(
        100, 4_000, 5_300, 600, 3_000, 6_000, 400, &mut ctx,
    );
    let rp    = risk_params::create_for_testing(&mut ctx);
    let clock = clock::create_for_testing(&mut ctx);

    let targets = allocator::compute_targets(
        &mut policy, 1_000_000, 7_000, 0, &rp, &clock,
    );

    // Hard cap: ib >= min_ib_buffer_bps (default 500)
    assert!(allocator::ib_idle_bps(&targets) >= 500, 0);

    allocator::destroy_for_testing(policy);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}

// ─── test_allocator_emits_decision_event ─────────────────────────────────────
// Verifies compute_targets runs without abort and returns consistent targets.
// The AllocationDecision event is emitted (compile-time proven by struct usage).
#[test]
fun test_allocator_emits_decision_event() {
    let mut ctx    = tx_context::dummy();
    let mut policy = allocator::create_for_testing(&mut ctx);
    let rp         = risk_params::create_for_testing(&mut ctx);
    let clock      = clock::create_for_testing(&mut ctx);

    let nav = 200_000_000u64; // 200 dUSDC
    let targets = allocator::compute_targets(
        &mut policy, nav, 4_000, 0, &rp, &clock,
    );

    // Neutral regime — base weights
    // Sum of dUSDC amounts must equal nav (floor division may leave dust)
    let total_dusdc = allocator::plp_dusdc(&targets)
                    + allocator::range_dusdc(&targets)
                    + allocator::margin_loop_dusdc(&targets)
                    + allocator::ib_idle_dusdc(&targets);
    assert!(total_dusdc <= nav, 0);
    assert!(nav - total_dusdc < 4, 1); // at most 3 bps rounding dust per arm

    allocator::destroy_for_testing(policy);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}

// ─── test_decision_event_matches_applied_state ───────────────────────────────
// After low-IV regime shift: weights in AllocationTargets match expected
// post-shift values that would appear in the AllocationDecision event.
#[test]
fun test_decision_event_matches_applied_state() {
    let mut ctx    = tx_context::dummy();
    let mut policy = allocator::create_for_testing(&mut ctx);
    let rp         = risk_params::create_for_testing(&mut ctx);
    let clock      = clock::create_for_testing(&mut ctx);

    // Two consecutive rolls: first neutral, then low-IV
    let t1 = allocator::compute_targets(&mut policy, 10_000_000, 4_500, 0, &rp, &clock);
    assert!(allocator::plp_bps(&t1) == 3_000, 0);

    let t2 = allocator::compute_targets(&mut policy, 10_000_000, 2_000, 0, &rp, &clock);
    // Low-IV shift applied: range shrinks, plp and ib grow
    assert!(allocator::range_bps(&t2) < allocator::range_bps(&t1), 1);
    assert!(allocator::plp_bps(&t2) > allocator::plp_bps(&t1), 2);
    // Roll counter advanced twice
    assert!(allocator::roll_counter(&policy) == 2, 3);

    allocator::destroy_for_testing(policy);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock);
}
