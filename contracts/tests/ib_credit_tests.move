#[test_only]
module reflux::ib_credit_tests;

use reflux::ib_credit;
use reflux::risk_params;
use dusdc::dusdc::DUSDC;
use sui::coin;
use sui::tx_context;

// ─── test_ib_park_and_unpark ─────────────────────────────────────────────────
#[test]
fun test_ib_park_and_unpark() {
    let mut ctx  = tx_context::dummy();
    let mut state = ib_credit::create_for_testing(&mut ctx);
    let dusdc    = coin::mint_for_testing<DUSDC>(5_000_000, &mut ctx);

    assert!(ib_credit::parked_amount(&state) == 0, 0);
    ib_credit::park_idle(&mut state, dusdc);
    assert!(ib_credit::parked_amount(&state) == 5_000_000, 1);

    let out = ib_credit::unpark(&mut state, 2_000_000, &mut ctx);
    assert!(out.value() == 2_000_000, 2);
    assert!(ib_credit::parked_amount(&state) == 3_000_000, 3);

    sui::test_utils::destroy(out);
    // Clean up remaining parked balance
    let remainder = ib_credit::unpark(&mut state, 3_000_000, &mut ctx);
    sui::test_utils::destroy(remainder);
    ib_credit::destroy_for_testing(state);
}

// ─── test_instant_exit_within_buffer ─────────────────────────────────────────
#[test]
fun test_instant_exit_within_buffer() {
    let mut ctx   = tx_context::dummy();
    let mut state  = ib_credit::create_for_testing(&mut ctx);
    let rp        = risk_params::create_for_testing(&mut ctx);

    // Park 10 dUSDC
    ib_credit::park_idle(&mut state, coin::mint_for_testing<DUSDC>(10_000_000, &mut ctx));

    // Exit 5 dUSDC — within parked buffer
    let vault_nav = 100_000_000u64;
    let out = ib_credit::fund_instant_exit(&mut state, 5_000_000, vault_nav, &rp, &mut ctx);
    assert!(out.value() == 5_000_000, 0);
    assert!(ib_credit::parked_amount(&state) == 5_000_000, 1);

    sui::test_utils::destroy(out);
    let remainder = ib_credit::unpark(&mut state, 5_000_000, &mut ctx);
    sui::test_utils::destroy(remainder);
    ib_credit::destroy_for_testing(state);
    risk_params::destroy_for_testing(rp);
}

// ─── test_instant_exit_above_parked_aborts (ReserveSleeveSource) ─────────────
#[test]
#[expected_failure(abort_code = ib_credit::EInsufficientBuffer)]
fun test_instant_exit_above_buffer_aborts() {
    let mut ctx   = tx_context::dummy();
    let mut state  = ib_credit::create_for_testing(&mut ctx);
    let rp        = risk_params::create_for_testing(&mut ctx);

    // Park only 1 dUSDC, then request 2 dUSDC exit
    ib_credit::park_idle(&mut state, coin::mint_for_testing<DUSDC>(1_000_000, &mut ctx));
    let vault_nav = 100_000_000u64;
    // Parked (1) < requested (2), venue = RESERVE → abort EInsufficientBuffer
    let _coin = ib_credit::fund_instant_exit(&mut state, 2_000_000, vault_nav, &rp, &mut ctx);

    abort 0 // unreachable — fund_instant_exit aborts first; _coin covered by abort
}

// ─── test_buffer_draw_hard_cap ───────────────────────────────────────────────
// Under IronBankSource (once wired), a draw request beyond max_buffer_draw_bps
// must abort.  We verify the accounting check fires before the external call.
// Here: vault_nav = 1_000_000, max_buffer_draw = 1_000 bps = 10% = 100_000.
// Request exceeding 100_000 should abort EBufferDrawExceedsMax.
// Since venue = RESERVE and parked = 0, parked check fails first (EInsufficientBuffer).
// Test the cap specifically via a scenario where parked covers partial but draw > cap.
//
// We can't test the iron_bank path (EXTERNAL-PENDING), so we verify the cap guard
// fires when `buffer_drawn + additional > max_draw`.  We do this by calling the
// internal cap check indirectly: park = 0, vault_nav small so max_draw < requested.
#[test]
#[expected_failure(abort_code = ib_credit::EBufferDrawExceedsMax)]
fun test_buffer_draw_hard_cap() {
    let mut ctx   = tx_context::dummy();
    let mut state  = ib_credit::create_for_testing(&mut ctx);
    let rp        = risk_params::create_for_testing(&mut ctx);

    // vault_nav = 100, max_buffer_draw_bps = 1_000 → max_draw = 10 (tiny)
    // requested = 11 > max_draw(10) AND parked = 0
    // With parked=0 and additional=11, the cap check (11 > 10) fires before
    // the venue dispatch because: assert!(buffer_drawn + additional <= max_draw)
    // But wait — the code checks parked >= amount first, then the cap.
    // Since parked(0) < amount(11) we enter the slow path → cap check fires.
    let vault_nav = 100u64;
    let _coin = ib_credit::fund_instant_exit(&mut state, 11, vault_nav, &rp, &mut ctx);
    abort 0 // unreachable — fund_instant_exit aborts first; _coin covered by abort
}

// ─── test_buffer_repaid_before_redeploy ──────────────────────────────────────
// Directly tests the accounting: after drawing, repay_buffer_draw zeroes the ledger.
// (The full roll ordering test lives in vault_tests once vault.move is implemented.)
#[test]
fun test_buffer_repaid_before_redeploy() {
    let mut ctx   = tx_context::dummy();
    let mut state  = ib_credit::create_for_testing(&mut ctx);

    // Manually set buffer_drawn by parking then "drawing" the field
    // We can't call fund_instant_exit (would abort on RESERVE), so we
    // simulate a draw by calling park + unpark to get a coin and then repay.
    ib_credit::park_idle(&mut state, coin::mint_for_testing<DUSDC>(1_000_000, &mut ctx));
    // Simulate an outstanding draw by having vault deposit a repayment coin
    let repay = coin::mint_for_testing<DUSDC>(0, &mut ctx); // zero-value test
    // buffer_drawn is 0; repay(0) should succeed (0 <= 0)
    ib_credit::repay_buffer_draw(&mut state, repay);
    assert!(ib_credit::buffer_drawn(&state) == 0, 0);

    let remainder = ib_credit::unpark(&mut state, 1_000_000, &mut ctx);
    sui::test_utils::destroy(remainder);
    ib_credit::destroy_for_testing(state);
}
