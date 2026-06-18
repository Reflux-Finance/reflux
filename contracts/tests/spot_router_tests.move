#[test_only]
module reflux::spot_router_tests;

use dusdc::dusdc::DUSDC;
use reflux::rfbtc;
use reflux::spot_router;
use usdc::usdc::USDC;
use sui::coin;
use sui::tx_context;

// ─── USDC ↔ dUSDC treasury (1:1) ─────────────────────────────────────────────

#[test]
fun test_usdc_to_dusdc_treasury_1_to_1() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);

    let usdc_seed  = coin::mint_for_testing<USDC>(1_000_000_000, &mut ctx); // 1 000 USDC reserve
    let dusdc_seed = coin::mint_for_testing<DUSDC>(1_000_000_000, &mut ctx);
    spot_router::seed_usdc_dusdc_for_testing(&mut config, usdc_seed, dusdc_seed);

    let usdc_in  = coin::mint_for_testing<USDC>(100_000_000, &mut ctx); // 100 USDC (6 dec)
    let dusdc    = spot_router::usdc_to_dusdc(&mut config, usdc_in, 100_000_000, &mut ctx);
    assert!(dusdc.value() == 100_000_000, 0); // exactly 1:1

    sui::test_utils::destroy(dusdc);
    spot_router::destroy_for_testing(config);
}

#[test]
fun test_dusdc_to_usdc_treasury_1_to_1() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);

    let usdc_seed  = coin::mint_for_testing<USDC>(1_000_000_000, &mut ctx);
    let dusdc_seed = coin::mint_for_testing<DUSDC>(1_000_000_000, &mut ctx);
    spot_router::seed_usdc_dusdc_for_testing(&mut config, usdc_seed, dusdc_seed);

    let dusdc_in = coin::mint_for_testing<DUSDC>(50_000_000, &mut ctx); // 50 dUSDC
    let usdc     = spot_router::dusdc_to_usdc(&mut config, dusdc_in, 50_000_000, &mut ctx);
    assert!(usdc.value() == 50_000_000, 0);

    sui::test_utils::destroy(usdc);
    spot_router::destroy_for_testing(config);
}

#[test]
#[expected_failure(abort_code = spot_router::EInsufficientReserve)]
fun test_usdc_to_dusdc_empty_reserve_aborts() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);
    // No dUSDC reserve seeded → EInsufficientReserve
    let usdc = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let _out = spot_router::usdc_to_dusdc(&mut config, usdc, 0, &mut ctx);
    abort 0
}

#[test]
#[expected_failure(abort_code = spot_router::ESlippageExceeded)]
fun test_usdc_to_dusdc_slippage_abort() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);
    let usdc_seed  = coin::mint_for_testing<USDC>(1_000_000_000, &mut ctx);
    let dusdc_seed = coin::mint_for_testing<DUSDC>(1_000_000_000, &mut ctx);
    spot_router::seed_usdc_dusdc_for_testing(&mut config, usdc_seed, dusdc_seed);

    let usdc = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    // min_out > amount → slippage abort
    let _out = spot_router::usdc_to_dusdc(&mut config, usdc, 2_000_000, &mut ctx);
    abort 0
}

// ─── SUI / dUSDC CPAMM ───────────────────────────────────────────────────────

// Pool: 10 000 SUI (9 dec) + 30 000 dUSDC (6 dec) ≈ $3/SUI
// r_sui   = 10_000_000_000_000
// r_dusdc = 30_000_000_000

#[test]
fun test_sui_to_dusdc_cpamm_price() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);

    let sui_seed   = coin::mint_for_testing<sui::sui::SUI>(10_000_000_000_000, &mut ctx);
    let dusdc_seed = coin::mint_for_testing<DUSDC>(30_000_000_000, &mut ctx);
    spot_router::seed_sui_dusdc_for_testing(&mut config, sui_seed, dusdc_seed);

    // Swap 1 SUI = 1_000_000_000 base units
    // Expected output ≈ 2 990 699 (≈ $2.99 after 0.3% fee and price impact)
    let sui_in  = coin::mint_for_testing<sui::sui::SUI>(1_000_000_000, &mut ctx);
    let dusdc   = spot_router::sui_to_dusdc(&mut config, sui_in, 1, &mut ctx);
    let out_val = dusdc.value();
    // Must be between 2.9 dUSDC and 3.0 dUSDC
    assert!(out_val > 2_900_000 && out_val < 3_000_000, 0);

    sui::test_utils::destroy(dusdc);
    spot_router::destroy_for_testing(config);
}

#[test]
fun test_dusdc_to_sui_cpamm_price() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);

    let sui_seed   = coin::mint_for_testing<sui::sui::SUI>(10_000_000_000_000, &mut ctx);
    let dusdc_seed = coin::mint_for_testing<DUSDC>(30_000_000_000, &mut ctx);
    spot_router::seed_sui_dusdc_for_testing(&mut config, sui_seed, dusdc_seed);

    // Swap 3 dUSDC = 3_000_000 base units → expect ≈ 0.997 SUI (≈ 997_000_000 base units)
    let dusdc_in = coin::mint_for_testing<DUSDC>(3_000_000, &mut ctx);
    let sui_out  = spot_router::dusdc_to_sui(&mut config, dusdc_in, 1, &mut ctx);
    let out_val  = sui_out.value();
    // Must be between 0.99 SUI and 1.0 SUI (9 dec)
    assert!(out_val > 990_000_000 && out_val < 1_000_000_000, 0);

    sui::test_utils::destroy(sui_out);
    spot_router::destroy_for_testing(config);
}

#[test]
#[expected_failure(abort_code = spot_router::EInsufficientReserve)]
fun test_sui_to_dusdc_empty_pool_aborts() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);
    let sui_in     = coin::mint_for_testing<sui::sui::SUI>(1_000_000_000, &mut ctx);
    let _out       = spot_router::sui_to_dusdc(&mut config, sui_in, 0, &mut ctx);
    abort 0
}

#[test]
#[expected_failure(abort_code = spot_router::ESlippageExceeded)]
fun test_sui_to_dusdc_slippage_abort() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);

    let sui_seed   = coin::mint_for_testing<sui::sui::SUI>(10_000_000_000_000, &mut ctx);
    let dusdc_seed = coin::mint_for_testing<DUSDC>(30_000_000_000, &mut ctx);
    spot_router::seed_sui_dusdc_for_testing(&mut config, sui_seed, dusdc_seed);

    let sui_in = coin::mint_for_testing<sui::sui::SUI>(1_000_000_000, &mut ctx); // 1 SUI
    // min_out = 10 dUSDC → way above the real output (≈ 2.99) → abort
    let _out   = spot_router::sui_to_dusdc(&mut config, sui_in, 10_000_000, &mut ctx);
    abort 0
}

// ─── rfBTC / dUSDC CPAMM ──────────────────────────────────────────────────────

// Pool: 0.5 rfBTC (8 dec) + 50 000 dUSDC (6 dec) ≈ $100 000/BTC
// r_rfbtc = 50_000_000
// r_dusdc = 50_000_000_000

#[test]
fun test_rfbtc_to_dusdc_cpamm_price() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);

    let rfbtc_seed = rfbtc::create_for_testing(50_000_000, &mut ctx); // 0.5 rfBTC
    let dusdc_seed = coin::mint_for_testing<DUSDC>(50_000_000_000, &mut ctx); // 50 000 dUSDC
    spot_router::seed_rfbtc_dusdc_for_testing(&mut config, rfbtc_seed, dusdc_seed);

    // Swap 0.01 rfBTC = 1_000_000 base units → expect ≈ 977 dUSDC (≈ 977_000_000 base units)
    let rfbtc_in = rfbtc::create_for_testing(1_000_000, &mut ctx);
    let dusdc    = spot_router::rfbtc_to_dusdc(&mut config, rfbtc_in, 1, &mut ctx);
    let out_val  = dusdc.value();
    // Must be between 970 dUSDC and 990 dUSDC
    assert!(out_val > 970_000_000 && out_val < 990_000_000, 0);

    sui::test_utils::destroy(dusdc);
    spot_router::destroy_for_testing(config);
}

#[test]
fun test_dusdc_to_rfbtc_cpamm_price() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);

    let rfbtc_seed = rfbtc::create_for_testing(50_000_000, &mut ctx);
    let dusdc_seed = coin::mint_for_testing<DUSDC>(50_000_000_000, &mut ctx);
    spot_router::seed_rfbtc_dusdc_for_testing(&mut config, rfbtc_seed, dusdc_seed);

    // Swap 1 000 dUSDC = 1_000_000_000 base units → expect ≈ 0.0099 rfBTC (≈ 990_000 base units)
    let dusdc_in = coin::mint_for_testing<DUSDC>(1_000_000_000, &mut ctx);
    let rfbtc    = spot_router::dusdc_to_rfbtc(&mut config, dusdc_in, 1, &mut ctx);
    let out_val  = rfbtc.value();
    // Must be between 9 700 and 10 000 (rfBTC 8 dec units for ≈0.0097–0.01 rfBTC)
    assert!(out_val > 970_000 && out_val < 1_000_000, 0);

    sui::test_utils::destroy(rfbtc);
    spot_router::destroy_for_testing(config);
}

#[test]
#[expected_failure(abort_code = spot_router::EInsufficientReserve)]
fun test_rfbtc_to_dusdc_empty_pool_aborts() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);
    let rfbtc_in   = rfbtc::create_for_testing(1_000_000, &mut ctx);
    let _out       = spot_router::rfbtc_to_dusdc(&mut config, rfbtc_in, 0, &mut ctx);
    abort 0
}

// ─── Zero-amount guards ───────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = spot_router::EZeroAmount)]
fun test_zero_usdc_aborts() {
    let mut ctx    = tx_context::dummy();
    let mut config = spot_router::create_for_testing(&mut ctx);
    let usdc_seed  = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let dusdc_seed = coin::mint_for_testing<DUSDC>(1_000_000, &mut ctx);
    spot_router::seed_usdc_dusdc_for_testing(&mut config, usdc_seed, dusdc_seed);
    let usdc = coin::mint_for_testing<USDC>(0, &mut ctx);
    let _out = spot_router::usdc_to_dusdc(&mut config, usdc, 0, &mut ctx);
    abort 0
}

// ─── Mock slippage guard (for backward compat with deposit_router tests) ──────

#[test]
#[expected_failure(abort_code = spot_router::ESlippageExceeded)]
fun test_mock_slippage_abort() {
    let mut ctx = tx_context::dummy();
    let config  = spot_router::create_for_testing(&mut ctx);
    let usdc    = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let _out    = spot_router::usdc_to_dusdc_mock(&config, usdc, 2_000_000, &mut ctx);
    abort 0
}
