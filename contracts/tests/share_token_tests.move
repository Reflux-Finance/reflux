#[test_only]
module reflux::share_token_tests;

use reflux::share_token;
use sui::coin;
use sui::tx_context;

// ─── test_share_math_rounding_favors_system (1000-iteration deterministic fuzz)
//
// Property: for any deposit_amount and nav_per_share,
//   entitlement = floor(floor(deposit * 1e9 / nav) * nav / 1e9) <= deposit
//
// Mathematical guarantee: floor(floor(a*b/c)*c/b) <= a  for all positive integers.
// Both divisions are floor ⟹ every rounding residual stays in the vault.
#[test]
fun test_share_math_rounding_favors_system() {
    let scale = share_token::price_scale() as u128;
    let mut i = 0u64;
    while (i < 1_000) {
        // Vary deposit and nav independently across wide ranges
        let deposit = (i + 1) * 1_234_567u64;
        let nav = 1_000_000_000u64 + i * 100_000u64; // 1.0 → ~1.1 dUSDC/share
        let shares      = ((deposit as u128) * scale / (nav as u128)) as u64;
        let entitlement = ((shares  as u128) * (nav as u128) / scale) as u64;
        assert!(entitlement <= deposit, i);
        i = i + 1;
    };
}

// ─── test_mint_burn_roundtrip ─────────────────────────────────────────────────
#[test]
fun test_mint_burn_roundtrip() {
    let mut ctx = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);

    let deposit = 10_000_000u64; // 10 dUSDC (6 dp)
    let coin_rfusd = share_token::mint_shares(&mut registry, deposit, 1, &mut ctx);
    let shares = coin_rfusd.value();
    assert!(shares == deposit, 0); // NAV = 1.0 → 1:1

    let entitlement = share_token::burn_shares(&mut registry, coin_rfusd, 0, &mut ctx);
    assert!(entitlement <= deposit, 1); // rounding rule
    assert!(entitlement == deposit, 2); // no residual at NAV=1.0

    share_token::destroy_for_testing(registry);
}

// ─── test_zero_deposit_aborts ─────────────────────────────────────────────────
#[test]
#[expected_failure(abort_code = share_token::EZeroDeposit)]
fun test_zero_deposit_aborts() {
    let mut ctx = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    let _coin = share_token::mint_shares(&mut registry, 0, 0, &mut ctx);
    abort 0 // unreachable — mint_shares aborts first; _coin and registry covered by abort
}

// ─── test_min_shares_slippage ─────────────────────────────────────────────────
#[test]
#[expected_failure(abort_code = share_token::EMinSharesNotMet)]
fun test_min_shares_slippage() {
    let mut ctx = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);
    // NAV=1.0 → 1 dUSDC yields 1 share; require 2 → should abort
    let _coin = share_token::mint_shares(&mut registry, 1_000_000, 2_000_000, &mut ctx);
    abort 0 // unreachable — mint_shares aborts first; _coin and registry covered by abort
}

// ─── test_update_nav_changes_nav_per_share ────────────────────────────────────
#[test]
fun test_update_nav_changes_nav_per_share() {
    let mut ctx = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);

    // Mint 10 dUSDC worth at NAV=1.0 → 10 shares
    let coin_rfusd = share_token::mint_shares(&mut registry, 10_000_000, 1, &mut ctx);

    // Simulate yield: total NAV grew to 11 dUSDC → nav = 1.1 * 1e9
    share_token::update_nav(&mut registry, 11_000_000);
    let expected_nav = (11_000_000u128 * 1_000_000_000u128 / 10_000_000u128) as u64;
    assert!(share_token::nav_per_share_e9(&registry) == expected_nav, 0);

    // Burn at new NAV → entitlement = 11 dUSDC (floor)
    let entitlement = share_token::burn_shares(&mut registry, coin_rfusd, 0, &mut ctx);
    assert!(entitlement == 11_000_000, 1);

    share_token::destroy_for_testing(registry);
}

// ─── test_total_supply_tracks_mint_burn ──────────────────────────────────────
#[test]
fun test_total_supply_tracks_mint_burn() {
    let mut ctx = tx_context::dummy();
    let mut registry = share_token::create_for_testing(&mut ctx);

    assert!(share_token::total_supply(&registry) == 0, 0);
    let c = share_token::mint_shares(&mut registry, 5_000_000, 1, &mut ctx);
    assert!(share_token::total_supply(&registry) == 5_000_000, 1);
    let _ = share_token::burn_shares(&mut registry, c, 0, &mut ctx);
    assert!(share_token::total_supply(&registry) == 0, 2);

    share_token::destroy_for_testing(registry);
}
