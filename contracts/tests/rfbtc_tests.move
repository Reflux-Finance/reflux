#[test_only]
module reflux::rfbtc_tests;

use reflux::rfbtc;
use sui::tx_context;

// ─── test_rfbtc_faucet_max_amount ─────────────────────────────────────────────
#[test]
fun test_rfbtc_faucet_max_amount() {
    assert!(rfbtc::faucet_max_amount() == 100_000_000_000, 0);
}

// ─── test_rfbtc_faucet_under_cap ─────────────────────────────────────────────
#[test]
fun test_rfbtc_faucet_under_cap() {
    let mut ctx      = tx_context::dummy();
    let mut treasury = rfbtc::create_treasury_for_testing(&mut ctx);
    let coin         = rfbtc::faucet(&mut treasury, 500_000, &mut ctx);
    assert!(coin.value() == 500_000, 0);
    sui::test_utils::destroy(coin);
    rfbtc::destroy_treasury_for_testing(treasury);
}

// ─── test_rfbtc_faucet_at_cap ────────────────────────────────────────────────
#[test]
fun test_rfbtc_faucet_at_cap() {
    let mut ctx      = tx_context::dummy();
    let mut treasury = rfbtc::create_treasury_for_testing(&mut ctx);
    let coin         = rfbtc::faucet_max(&mut treasury, &mut ctx);
    assert!(coin.value() == rfbtc::faucet_max_amount(), 0);
    sui::test_utils::destroy(coin);
    rfbtc::destroy_treasury_for_testing(treasury);
}

// ─── test_rfbtc_faucet_over_cap_abort ────────────────────────────────────────
#[test]
#[expected_failure(abort_code = 0)]
fun test_rfbtc_faucet_over_cap_abort() {
    let mut ctx      = tx_context::dummy();
    let mut treasury = rfbtc::create_treasury_for_testing(&mut ctx);
    // 100_000_000_001 > FAUCET_MAX (100_000_000_000) → abort EFaucetCap (= 0)
    let coin         = rfbtc::faucet(&mut treasury, 100_000_000_001, &mut ctx);
    sui::test_utils::destroy(coin);
    rfbtc::destroy_treasury_for_testing(treasury);
}
