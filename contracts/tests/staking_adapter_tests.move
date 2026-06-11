#[test_only]
module reflux::staking_adapter_tests;

use reflux::staking_adapter;
use sui::tx_context;

// ─── test_withdrawal_receipt_enforces_epoch ───────────────────────────────────
//
// A receipt created at epoch 0 with redeemable_after_epoch = 5 must:
//   • abort before epoch 5
//   • succeed at epoch 5

#[test]
#[expected_failure(abort_code = staking_adapter::EEpochNotReached)]
fun test_redeem_before_epoch_aborts() {
    // Epoch 0 context
    let mut ctx = tx_context::dummy();
    let receipt = staking_adapter::create_receipt_for_testing(1_000_000_000, 5, &mut ctx);
    // Epoch 0 < 5 → must abort
    let coin = staking_adapter::redeem_receipt(receipt, &mut ctx);
    sui::test_utils::destroy(coin);
    abort 0
}

#[test]
fun test_redeem_at_correct_epoch_succeeds() {
    // Create a context at epoch 5
    let mut ctx = tx_context::new_from_hint(@0x1, 0, 5, 0, 0);
    let receipt = staking_adapter::create_receipt_for_testing(1_000_000_000, 5, &mut ctx);
    assert!(staking_adapter::redeemable_after_epoch(&receipt) == 5, 0);
    // Epoch 5 >= 5 → succeeds
    let coin = staking_adapter::redeem_receipt(receipt, &mut ctx);
    sui::test_utils::destroy(coin);
}

#[test]
fun test_receipt_accessors() {
    let mut ctx = tx_context::dummy();
    let receipt = staking_adapter::create_receipt_for_testing(2_000_000, 10, &mut ctx);
    assert!(staking_adapter::sui_amount(&receipt)             == 2_000_000, 0);
    assert!(staking_adapter::redeemable_after_epoch(&receipt) == 10,        1);
    // Destroy via redeem at epoch >= 10
    let mut ctx2 = tx_context::new_from_hint(@0x1, 0, 10, 0, 0);
    let coin = staking_adapter::redeem_receipt(receipt, &mut ctx2);
    sui::test_utils::destroy(coin);
}
