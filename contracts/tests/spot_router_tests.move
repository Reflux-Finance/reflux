#[test_only]
module reflux::spot_router_tests;

use reflux::spot_router;
use reflux::types::USDC;
use sui::coin;
use sui::tx_context;

// ─── test_spot_router_min_out_abort ──────────────────────────────────────────
#[test]
#[expected_failure(abort_code = spot_router::ESlippageExceeded)]
fun test_spot_router_min_out_abort() {
    let mut ctx = tx_context::dummy();
    let config = spot_router::create_for_testing(&mut ctx);
    // 1 000 000 in, but demand 2 000 000 out → slippage abort
    let usdc = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let _coin = spot_router::usdc_to_dusdc_mock(&config, usdc, 2_000_000, &mut ctx);
    abort 0 // unreachable — mock aborts first; _coin and config covered by abort
}

// ─── test_usdc_to_dusdc_1_to_1_mock ──────────────────────────────────────────
#[test]
fun test_usdc_to_dusdc_1_to_1_mock() {
    let mut ctx = tx_context::dummy();
    let config = spot_router::create_for_testing(&mut ctx);
    let usdc = coin::mint_for_testing<USDC>(5_000_000, &mut ctx);
    let dusdc = spot_router::usdc_to_dusdc_mock(&config, usdc, 4_999_999, &mut ctx);
    assert!(dusdc.value() == 5_000_000, 0);
    sui::test_utils::destroy(dusdc);
    spot_router::destroy_for_testing(config);
}

// ─── test_dusdc_to_usdc_1_to_1_mock ──────────────────────────────────────────
#[test]
fun test_dusdc_to_usdc_1_to_1_mock() {
    use reflux::types::DUSDC;
    let mut ctx = tx_context::dummy();
    let config  = spot_router::create_for_testing(&mut ctx);
    let dusdc   = coin::mint_for_testing<DUSDC>(3_000_000, &mut ctx);
    let usdc    = spot_router::dusdc_to_usdc_mock(&config, dusdc, 1, &mut ctx);
    assert!(usdc.value() == 3_000_000, 0);
    sui::test_utils::destroy(usdc);
    spot_router::destroy_for_testing(config);
}

// ─── test_venue_tag_accessor ──────────────────────────────────────────────────
#[test]
fun test_venue_tag_accessor() {
    let mut ctx = tx_context::dummy();
    let config  = spot_router::create_for_testing(&mut ctx);
    assert!(spot_router::venue_tag(&config) == spot_router::venue_spot_pool(), 0);
    spot_router::destroy_for_testing(config);
}
