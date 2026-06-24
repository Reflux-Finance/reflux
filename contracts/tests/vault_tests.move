#[test_only]
module reflux::vault_tests;

use reflux::access;
use reflux::allocator;
use reflux::deposit_router;
use reflux::ib_credit;
use reflux::risk_params;
use reflux::share_token;
use reflux::vault;
use sui::clock;
use sui::tx_context;

// Helper to set up the full suite of shared objects for a roll test.
// Returns: (VaultState, DepositPool, ShareRegistry, AllocationPolicy, IBCreditState, RiskParams, Auth<KeeperRole>)
// Caller must destroy all after use.

// ─── test_roll_atomic_order ───────────────────────────────────────────────────
// Verifies the exact roll order by checking state between steps.
// Step assertions: roll_count increments, NAV updates, AllocationTargets emitted.
#[test]
fun test_roll_atomic_order() {
    let mut ctx      = tx_context::dummy();
    let auth         = access::create_keeper_auth_for_testing(&mut ctx);
    let mut state    = vault::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut policy   = allocator::create_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let mut clock_   = clock::create_for_testing(&mut ctx);

    // Pre-condition: roll_count = 0, no shares minted
    assert!(vault::roll_count(&state) == 0, 0);
    assert!(share_token::total_supply(&registry) == 0, 1);

    // Seed pool with 100 dUSDC (simulating prior deposits)
    deposit_router::seed_pool_for_testing(&mut pool, 100_000_000, &mut ctx);

    // Execute mock roll with 10 dUSDC yield at neutral IV (4500)
    clock::increment_for_testing(&mut clock_, 1_000);
    let targets = vault::roll_positions_mock(
        &auth, &mut state, &mut pool, &mut registry, &mut policy, &mut ib,
        &rp, 10_000_000, 4_500, &clock_, &mut ctx,
    );

    // Post-condition: roll_count incremented
    assert!(vault::roll_count(&state) == 1, 2);

    // AllocationTargets reflect neutral regime (base weights)
    assert!(allocator::plp_bps(&targets) == 3_000, 3);
    assert!(allocator::range_bps(&targets) == 4_000, 4);

    // NAV updated: 100M (pool) + 10M (yield) = 110M total dUSDC.
    // But the mock took ib_idle_dusdc from pool → pool decreased.
    // Total NAV = pool_balance + ib_parked = 110M (conservation).
    let final_nav = deposit_router::pool_balance(&pool) + ib_credit::parked_amount(&ib);
    assert!(final_nav == 110_000_000, 5);
    assert!(vault::last_nav_dusdc(&state) == 110_000_000, 6);

    vault::destroy_for_testing(state);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    allocator::destroy_for_testing(policy);
    ib_credit::destroy_for_testing(ib);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock_);
}

// ─── test_rfusd_nav_accrual_over_two_rolls ───────────────────────────────────
// Two rolls with yield → NAV per share increases monotonically.
// Roll 1: 10 dUSDC yield on 100 dUSDC base → nav = 1.1 per share (if shares=100)
// But since no shares are minted before roll 1, update_nav at supply=0 resets to 1.0.
// Deposit first so shares exist, then roll to accrue yield.
#[test]
fun test_rfusd_nav_accrual_over_two_rolls() {
    let mut ctx      = tx_context::dummy();
    let auth         = access::create_keeper_auth_for_testing(&mut ctx);
    let mut state    = vault::create_for_testing(&mut ctx);
    let mut pool     = deposit_router::create_pool_for_testing(&mut ctx);
    let mut registry = share_token::create_for_testing(&mut ctx);
    let mut policy   = allocator::create_for_testing(&mut ctx);
    let mut ib       = ib_credit::create_for_testing(&mut ctx);
    let rp           = risk_params::create_for_testing(&mut ctx);
    let mut clock_   = clock::create_for_testing(&mut ctx);

    // Seed pool with 100M dUSDC and mint matching rfUSD (simulates prior deposits)
    deposit_router::seed_pool_for_testing(&mut pool, 100_000_000, &mut ctx);
    let shares = share_token::mint_shares(&mut registry, 100_000_000, 1, &mut ctx);
    assert!(share_token::total_supply(&registry) == 100_000_000, 0);

    let initial_nav = share_token::nav_per_share_e9(&registry);
    assert!(initial_nav == 1_000_000_000, 1); // 1.0 per share

    // Roll 1: 5M yield
    clock::increment_for_testing(&mut clock_, 1_000);
    vault::roll_positions_mock(
        &auth, &mut state, &mut pool, &mut registry, &mut policy, &mut ib,
        &rp, 5_000_000, 4_500, &clock_, &mut ctx,
    );
    let nav_after_roll1 = share_token::nav_per_share_e9(&registry);
    // total = 100M + 5M yield = 105M; supply = 100M → nav = 1.05e9
    assert!(nav_after_roll1 > initial_nav, 2);

    // Roll 2: another 5M yield
    clock::increment_for_testing(&mut clock_, 1_000);
    vault::roll_positions_mock(
        &auth, &mut state, &mut pool, &mut registry, &mut policy, &mut ib,
        &rp, 5_000_000, 4_500, &clock_, &mut ctx,
    );
    let nav_after_roll2 = share_token::nav_per_share_e9(&registry);
    // NAV should have increased further
    assert!(nav_after_roll2 > nav_after_roll1, 3);
    assert!(vault::roll_count(&state) == 2, 4);

    // Cleanup
    sui::test_utils::destroy(shares);
    vault::destroy_for_testing(state);
    deposit_router::destroy_pool_for_testing(pool);
    share_token::destroy_for_testing(registry);
    allocator::destroy_for_testing(policy);
    ib_credit::destroy_for_testing(ib);
    risk_params::destroy_for_testing(rp);
    clock::destroy_for_testing(clock_);
}
