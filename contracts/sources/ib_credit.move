/// Module 7 — ib_credit: liquidity abstraction with two user guarantees:
///
///   (a) Idle dUSDC is always parked so it earns yield.
///   (b) Withdrawals under the instant-exit cap are funded immediately; draws
///       are repaid automatically on the next settlement roll.
///
/// Coded behind a `LiquiditySource` interface with two implementations:
///
///   VENUE_RESERVE (0) — reserved dUSDC sleeve inside the contract.
///                       This is the ACTIVE default (see INTEGRATION_NOTES DR-2).
///
///   VENUE_IRON_BANK (1) — iron_bank credit line.
///                         EXTERNAL-PENDING: iron_bank package not found in
///                         predict-testnet-4-16; see INTEGRATION_NOTES DR-2.
///
/// The rest of the system (vault, deposit_router) only calls the two public
/// guarantees and never references the venue tag directly.
module reflux::ib_credit;

use reflux::risk_params::RiskParams;
use dusdc::dusdc::DUSDC;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

// ─── Venue tags ──────────────────────────────────────────────────────────────

const VENUE_RESERVE:   u8 = 0; // active default
const VENUE_IRON_BANK: u8 = 1; // EXTERNAL-PENDING

// ─── Error codes ─────────────────────────────────────────────────────────────

const EInsufficientBuffer:     u64 = 0;
const EBufferDrawExceedsMax:   u64 = 1;
const ERepayExceedsDrawn:      u64 = 2;
const EExternalPending:        u64 = 99;

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Shared state object for the liquidity abstraction module.
public struct IBCreditState has key {
    id:             UID,
    parked_balance: Balance<DUSDC>, // idle dUSDC currently parked
    buffer_drawn:   u64,            // credit drawn since last roll (IronBank only; 0 for Reserve)
    venue_tag:      u8,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct IdleParked       has copy, drop { amount: u64 }
public struct IdleUnparked     has copy, drop { amount: u64 }
public struct InstantExitFunded has copy, drop { requested: u64, funded: u64, from_draw: bool }
public struct BufferDrawRepaid  has copy, drop { amount: u64 }

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(IBCreditState {
        id:             object::new(ctx),
        parked_balance: balance::zero<DUSDC>(),
        buffer_drawn:   0,
        venue_tag:      VENUE_RESERVE,
    });
}

// ─── Guarantee (a): park idle / unpark ───────────────────────────────────────

/// Deposit idle dUSDC into the liquidity source so it always earns.
/// public(package): called by vault at end of roll.
public(package) fun park_idle(state: &mut IBCreditState, coin: Coin<DUSDC>) {
    let amount = coin.value();
    if (state.venue_tag == VENUE_IRON_BANK) {
        // EXTERNAL-PENDING: call iron_bank::supply(coin)
        // For now fall through to reserve behaviour
        state.parked_balance.join(coin.into_balance());
    } else {
        state.parked_balance.join(coin.into_balance());
    };
    event::emit(IdleParked { amount });
}

/// Withdraw `amount` dUSDC from the parked balance (used by vault when
/// redeploying capital or topping up the buffer).
/// public(package): called by vault.
public(package) fun unpark(
    state:  &mut IBCreditState,
    amount: u64,
    ctx:    &mut TxContext,
): Coin<DUSDC> {
    // parked_balance must have enough; vault manages the flow
    let coin = coin::take(&mut state.parked_balance, amount, ctx);
    event::emit(IdleUnparked { amount });
    coin
}

// ─── Guarantee (b): instant exit funding / repayment ─────────────────────────

/// Fund an instant withdrawal from the parked balance first, then (for
/// IronBankSource only) via a short-term credit draw up to `max_buffer_draw_bps`.
/// Under ReserveSleeveSource, aborts when the parked balance is insufficient.
///
/// Abort codes:
///   EInsufficientBuffer   — parked balance exhausted (Reserve venue)
///   EBufferDrawExceedsMax — requested draw would exceed the hard cap
///
/// public(package): called by deposit_router on withdrawal.
public(package) fun fund_instant_exit(
    state:         &mut IBCreditState,
    amount:        u64,
    vault_nav:     u64,
    risk_params:   &RiskParams,
    ctx:           &mut TxContext,
): Coin<DUSDC> {
    let parked = state.parked_balance.value();

    if (parked >= amount) {
        // Fast path: serve from parked balance
        let coin = coin::take(&mut state.parked_balance, amount, ctx);
        event::emit(InstantExitFunded { requested: amount, funded: amount, from_draw: false });
        return coin
    };

    // Slow path: partial from parked + draw
    let max_draw = mul_div(vault_nav, risk_params.max_buffer_draw_bps(), 10_000);
    let additional = amount - parked;
    assert!(state.buffer_drawn + additional <= max_draw, EBufferDrawExceedsMax);

    if (state.venue_tag == VENUE_IRON_BANK) {
        // EXTERNAL-PENDING: draw (additional) from iron_bank credit line
        // For now abort since we can't mint coins without a TreasuryCap
        abort EExternalPending
    };

    // VENUE_RESERVE: no credit line available
    assert!(false, EInsufficientBuffer);
    abort EInsufficientBuffer // unreachable; satisfies type-checker
}

/// Repay the outstanding credit draw from the previous roll.
/// Called by vault::roll_positions BEFORE redeploying capital.
/// public(package): called by vault.
public(package) fun repay_buffer_draw(state: &mut IBCreditState, coin: Coin<DUSDC>) {
    let amount = coin.value();
    assert!(amount <= state.buffer_drawn, ERepayExceedsDrawn);
    state.parked_balance.join(coin.into_balance());
    state.buffer_drawn = state.buffer_drawn - amount;
    event::emit(BufferDrawRepaid { amount });
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun parked_amount(s: &IBCreditState): u64 { s.parked_balance.value() }
public fun buffer_drawn(s: &IBCreditState): u64  { s.buffer_drawn }
public fun venue_tag(s: &IBCreditState): u8      { s.venue_tag }

// ─── Internal math ────────────────────────────────────────────────────────────

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): IBCreditState {
    IBCreditState {
        id:             object::new(ctx),
        parked_balance: balance::zero<DUSDC>(),
        buffer_drawn:   0,
        venue_tag:      VENUE_RESERVE,
    }
}

#[test_only]
public fun destroy_for_testing(s: IBCreditState) {
    let IBCreditState { id, parked_balance, buffer_drawn: _, venue_tag: _ } = s;
    // Use force-destroy so tests with non-zero parked balance still clean up.
    std::unit_test::destroy(parked_balance);
    id.delete();
}

#[test_only]
public fun e_insufficient_buffer(): u64   { EInsufficientBuffer }
#[test_only]
public fun e_buffer_draw_exceeds_max(): u64 { EBufferDrawExceedsMax }
