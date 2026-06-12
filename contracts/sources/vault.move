/// Module 13 — vault: roll orchestrator. Composes all engine modules.
///
/// `roll_positions` (keeper-gated) executes this exact order atomically:
///   1. Assert keeper auth
///   2. Redeem all settled Predict positions → dUSDC  [EXTERNAL-PENDING]
///   3. Return settled dUSDC to DepositPool
///   4. Repay outstanding IB buffer draw
///   5. LTV check + deleverage if needed               [EXTERNAL-PENDING]
///   6. allocator::compute_targets → emits AllocationDecision
///   7. Redeploy: predict positions + IB park          [EXTERNAL-PENDING]
///   8. share_token::update_nav
///   9. Emit RollCompleted
///
/// Steps 2, 5, 7 abort in the current phase (EXTERNAL-PENDING).
/// `roll_positions_mock` (test-only) skips those steps so the full order
/// is exercisable in unit tests.
module reflux::vault;

use reflux::allocator::{Self, AllocationPolicy, AllocationTargets};
use reflux::deposit_router::{Self, DepositPool};
use reflux::ib_credit::{Self, IBCreditState};
use reflux::keeper_auth::{Self, KeeperAuth};
use reflux::predict_strategy;
use reflux::risk_params::RiskParams;
use reflux::share_token::{Self, ShareRegistry};
use reflux::types::DUSDC;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

// ─── Error codes ─────────────────────────────────────────────────────────────

const EExternalPending: u64 = 99;

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Shared state tracking roll progress and last known NAV.
public struct VaultState has key {
    id:             UID,
    roll_count:     u64,
    last_nav_dusdc: u64,
    last_roll_ts:   u64,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct RollCompleted has copy, drop {
    roll_id:       u64,
    timestamp_ms:  u64,
    nav_dusdc:     u64,
    nav_per_share: u64,
    pnl_dusdc:     u64, // signed as i64 would need u128; we track absolute for now
}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(VaultState {
        id:             object::new(ctx),
        roll_count:     0,
        last_nav_dusdc: 0,
        last_roll_ts:   0,
    });
}

// ─── Production roll (EXTERNAL-PENDING) ──────────────────────────────────────

/// Keeper-gated roll.
/// Steps 2, 5, 7 call Predict / Margin functions that abort (EXTERNAL-PENDING).
/// Full production roll is wired once external deps are confirmed.
public fun roll_positions(
    auth:     &KeeperAuth,
    state:    &mut VaultState,
    pool:     &mut DepositPool,
    registry: &mut ShareRegistry,
    policy:   &mut AllocationPolicy,
    ib:       &mut IBCreditState,
    rp:       &RiskParams,
    clock:    &Clock,
    ctx:      &mut TxContext,
) {
    keeper_auth::assert_authorized(auth);

    // Step 2: Redeem all settled Predict positions — EXTERNAL-PENDING
    // predict_strategy::redeem_all_settled aborts; full wiring in Phase 9.
    let _settled: Coin<DUSDC> = predict_strategy::redeem_all_settled(ctx);
    // Unreachable until external dep lands; abort prevents further execution.
    abort EExternalPending
}

// ─── Test-only mock roll ──────────────────────────────────────────────────────

/// Full mock roll: exercises every step except external Predict / Margin calls.
/// `yield_dusdc` simulates the dUSDC returned from predict settlement.
/// `atm_iv_e4` is passed to the allocator for regime determination.
#[test_only]
public fun roll_positions_mock(
    auth:        &KeeperAuth,
    state:       &mut VaultState,
    pool:        &mut DepositPool,
    registry:    &mut ShareRegistry,
    policy:      &mut AllocationPolicy,
    ib:          &mut IBCreditState,
    rp:          &RiskParams,
    yield_dusdc: u64,
    atm_iv_e4:   u64,
    clock:       &Clock,
    ctx:         &mut TxContext,
): AllocationTargets {
    // Step 1
    keeper_auth::assert_authorized(auth);

    // Step 2 (mock): mint simulated settlement proceeds
    let settled = coin::mint_for_testing<DUSDC>(yield_dusdc, ctx);

    // Step 3: return settled dUSDC to pool
    deposit_router::return_capital(pool, settled);

    // Step 4: repay any outstanding IB buffer draw (zero in mock)
    let zero_repay = coin::zero<DUSDC>(ctx);
    ib_credit::repay_buffer_draw(ib, zero_repay);

    // Step 5: LTV check / deleverage — EXTERNAL-PENDING (no live positions in mock)

    // Step 6: compute allocation targets → emits AllocationDecision
    let total_nav  = deposit_router::pool_balance(pool) + ib_credit::parked_amount(ib);
    let ib_balance = ib_credit::parked_amount(ib);
    let targets    = allocator::compute_targets(policy, total_nav, atm_iv_e4, ib_balance, rp, clock);

    // Step 7 (mock): park the ib_idle allocation; leave range/plp/ml in pool
    let idle_amount = allocator::ib_idle_dusdc(&targets);
    if (idle_amount > 0 && deposit_router::pool_balance(pool) >= idle_amount) {
        let idle_coin = deposit_router::take_capital(pool, idle_amount, ctx);
        ib_credit::park_idle(ib, idle_coin);
    };

    // Step 8: update NAV
    let final_nav = deposit_router::pool_balance(pool) + ib_credit::parked_amount(ib);
    share_token::update_nav(registry, final_nav);

    // Step 9: emit RollCompleted
    let prev_nav = state.last_nav_dusdc;
    let pnl = if (final_nav >= prev_nav) { final_nav - prev_nav } else { 0 };
    event::emit(RollCompleted {
        roll_id:       state.roll_count,
        timestamp_ms:  clock.timestamp_ms(),
        nav_dusdc:     final_nav,
        nav_per_share: share_token::nav_per_share_e9(registry),
        pnl_dusdc:     pnl,
    });

    state.last_nav_dusdc = final_nav;
    state.last_roll_ts   = clock.timestamp_ms();
    state.roll_count     = state.roll_count + 1;

    targets
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun roll_count(s: &VaultState): u64     { s.roll_count }
public fun last_nav_dusdc(s: &VaultState): u64 { s.last_nav_dusdc }
public fun last_roll_ts(s: &VaultState): u64   { s.last_roll_ts }

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): VaultState {
    VaultState { id: object::new(ctx), roll_count: 0, last_nav_dusdc: 0, last_roll_ts: 0 }
}

#[test_only]
public fun destroy_for_testing(s: VaultState) {
    let VaultState { id, roll_count: _, last_nav_dusdc: _, last_roll_ts: _ } = s;
    id.delete();
}
