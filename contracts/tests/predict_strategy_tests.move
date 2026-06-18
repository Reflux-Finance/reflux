#[test_only]
module reflux::predict_strategy_tests;

use reflux::predict_strategy;
use reflux::risk_params;
use dusdc::dusdc::DUSDC;
use sui::coin;
use sui::tx_context;

// ─── test_open_range_strip_mock ───────────────────────────────────────────────
#[test]
fun test_open_range_strip_mock() {
    let mut ctx = tx_context::dummy();
    let rp      = risk_params::create_for_testing(&mut ctx);

    let capital   = coin::mint_for_testing<DUSDC>(5_000_000, &mut ctx);
    let oracle_id = object::id_from_address(@0xABC);

    let (pos, capital_back) = predict_strategy::open_range_strip_mock(
        capital, oracle_id, 5, 500, &rp, &mut ctx,
    );

    assert!(predict_strategy::position_capital(&pos) == 5_000_000, 0);
    assert!(predict_strategy::position_type(&pos) == 0, 1);
    assert!(!predict_strategy::is_settled(&pos), 2);
    assert!(capital_back.value() == 5_000_000, 3);

    sui::test_utils::destroy(capital_back);
    predict_strategy::destroy_position_for_testing(pos);
    risk_params::destroy_for_testing(rp);
}

// ─── test_supply_to_plp_mock ──────────────────────────────────────────────────
#[test]
fun test_supply_to_plp_mock() {
    let mut ctx = tx_context::dummy();

    let capital   = coin::mint_for_testing<DUSDC>(10_000_000, &mut ctx);
    let oracle_id = object::id_from_address(@0xDEF);

    let (pos, capital_back) = predict_strategy::supply_to_plp_mock(
        capital, oracle_id, &mut ctx,
    );

    assert!(predict_strategy::position_capital(&pos) == 10_000_000, 0);
    assert!(predict_strategy::position_type(&pos) == 1, 1);
    assert!(capital_back.value() == 10_000_000, 2);

    sui::test_utils::destroy(capital_back);
    predict_strategy::destroy_position_for_testing(pos);
}

// ─── test_settle_and_redeem_mock ──────────────────────────────────────────────
#[test]
fun test_settle_and_redeem_mock() {
    let mut ctx = tx_context::dummy();

    let capital   = coin::mint_for_testing<DUSDC>(3_000_000, &mut ctx);
    let oracle_id = object::id_from_address(@0x111);

    let (mut pos, capital_back) = predict_strategy::supply_to_plp_mock(
        capital, oracle_id, &mut ctx,
    );
    sui::test_utils::destroy(capital_back); // mock: capital not actually locked

    assert!(!predict_strategy::is_settled(&pos), 0);
    predict_strategy::settle_for_testing(&mut pos);
    assert!(predict_strategy::is_settled(&pos), 1);

    let redeemed = predict_strategy::redeem_settled_mock(pos, &mut ctx);
    assert!(redeemed.value() == 3_000_000, 2);

    sui::test_utils::destroy(redeemed);
}

// ─── test_redeem_with_yield_mock ──────────────────────────────────────────────
#[test]
fun test_redeem_with_yield_mock() {
    let mut ctx = tx_context::dummy();
    let rp      = risk_params::create_for_testing(&mut ctx);

    let capital   = coin::mint_for_testing<DUSDC>(10_000_000, &mut ctx);
    let oracle_id = object::id_from_address(@0x222);

    let (mut pos, capital_back) = predict_strategy::open_range_strip_mock(
        capital, oracle_id, 3, 200, &rp, &mut ctx,
    );
    sui::test_utils::destroy(capital_back);

    predict_strategy::settle_for_testing(&mut pos);
    let redeemed = predict_strategy::redeem_settled_mock_with_yield(pos, 500_000, &mut ctx);
    // capital 10M + yield 500K = 10.5M
    assert!(redeemed.value() == 10_500_000, 0);

    sui::test_utils::destroy(redeemed);
    risk_params::destroy_for_testing(rp);
}

// ─── test_unsettled_redeem_aborts ─────────────────────────────────────────────
// ENotSettled = 0; redeem_settled_mock aborts when is_settled = false.
#[test]
#[expected_failure(abort_code = 0)]
fun test_unsettled_redeem_aborts() {
    let mut ctx   = tx_context::dummy();
    let rp        = risk_params::create_for_testing(&mut ctx);
    let capital   = coin::mint_for_testing<DUSDC>(1_000_000, &mut ctx);
    let oracle_id = object::id_from_address(@0x333);

    let (pos, capital_back) = predict_strategy::open_range_strip_mock(
        capital, oracle_id, 2, 100, &rp, &mut ctx,
    );
    sui::test_utils::destroy(capital_back);
    // pos is NOT settled — must abort ENotSettled
    let _coin = predict_strategy::redeem_settled_mock(pos, &mut ctx);
    abort 0 // unreachable
}
