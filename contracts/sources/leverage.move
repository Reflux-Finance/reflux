/// Module 8 — leverage: LSD collateral borrowing + LTV tracking.
///
/// `CollateralPosition` is a record of the collateral amount, the dUSDC debt,
/// and enough metadata to recompute LTV at any price.  It does NOT hold the
/// actual LSD coins (those stay in the margin system).
///
/// All DeepBook Margin cross-calls are EXTERNAL-PENDING.  The math functions
/// (`compute_ltv_bps`, `deleverage_amount`) are pure and independently tested,
/// which is the Phase A requirement.  The margin dispatch will be wired in
/// Phase B once signatures are confirmed (see INTEGRATION_NOTES §3).
module reflux::leverage;

use reflux::risk_params::RiskParams;
use openzeppelin_math::rounding;
use openzeppelin_math::u64 as oz_u64;
use dusdc::dusdc::DUSDC;
use sui::coin::{Self, Coin};
use sui::event;

// ─── Constants ───────────────────────────────────────────────────────────────

const PRICE_SCALE:   u64 = 1_000_000_000; // 1e9
const BPS_DENOM:     u64 = 10_000;

// ─── Error codes ─────────────────────────────────────────────────────────────

const EInsufficientCollateral: u64 = 0;
const EBorrowExceedsMaxLtv:    u64 = 1;
const ELtvHealthy:             u64 = 2; // deleverage called on healthy position
const EMathOverflow:           u64 = 3;
const EExternalPending:        u64 = 99;

// ─── Structs ─────────────────────────────────────────────────────────────────

/// On-chain record of a leveraged LSD collateral position.
/// The actual LSD tokens are custodied in the DeepBook Margin pool (EXTERNAL).
public struct CollateralPosition has key {
    id:                   UID,
    owner:                address,
    collateral_type:      vector<u8>, // b"vsui" | b"afsui" | b"hasui"
    collateral_amount:    u64,        // LSD base units
    entry_price_e9:       u64,        // price at deposit (for FX PnL tracking)
    debt_dusdc:           u64,        // dUSDC borrowed
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct PositionOpened has copy, drop {
    position_id:       ID,
    owner:             address,
    collateral_type:   vector<u8>,
    collateral_amount: u64,
    borrow_amount:     u64,
    ltv_bps:           u64,
}

public struct PositionClosed has copy, drop {
    position_id: ID,
    owner:       address,
    debt_repaid: u64,
}

public struct DeleverageExecuted has copy, drop {
    position_id:   ID,
    repay_amount:  u64,
    ltv_before:    u64,
    ltv_after:     u64,
}

// ─── Core math (pure, no external calls) ─────────────────────────────────────

/// LTV in basis points: (debt * 10_000) / collateral_value.
/// Uses the audited `openzeppelin_math::u64::mul_div` (u128 intermediate) to
/// avoid overflow. Asserts non-zero collateral; returns 10_000+ if fully underwater.
public fun compute_ltv_bps(
    collateral_amount: u64,
    debt_dusdc:        u64,
    price_e9:          u64,
): u64 {
    assert!(collateral_amount > 0, EInsufficientCollateral);
    // collateral_value_dusdc = collateral_amount * price_e9 / 1e9
    let coll_val = mul_div(collateral_amount, price_e9, PRICE_SCALE);
    assert!(coll_val > 0, EInsufficientCollateral);
    // ltv_bps = debt * 10_000 / coll_val
    mul_div(debt_dusdc, BPS_DENOM, coll_val)
}

/// Amount of dUSDC that must be repaid to bring LTV back to `target_ltv_bps`.
/// Returns 0 when the position is already at or below target.
public fun deleverage_amount(
    collateral_amount: u64,
    debt_dusdc:        u64,
    price_e9:          u64,
    target_ltv_bps:    u64,
): u64 {
    let coll_val = mul_div(collateral_amount, price_e9, PRICE_SCALE);
    // target_debt = coll_val * target_ltv / 10_000
    let target_debt = mul_div(coll_val, target_ltv_bps, BPS_DENOM);
    if (debt_dusdc <= target_debt) { 0 } else { debt_dusdc - target_debt }
}

/// Returns true when the position LTV exceeds `liquidation_ltv_bps`.
public fun needs_deleverage(
    collateral_amount:    u64,
    debt_dusdc:           u64,
    price_e9:             u64,
    risk_params:          &RiskParams,
): bool {
    if (collateral_amount == 0 || debt_dusdc == 0) return false;
    let ltv = compute_ltv_bps(collateral_amount, debt_dusdc, price_e9);
    ltv > risk_params.liquidation_ltv_bps()
}

// ─── Position lifecycle (margin calls EXTERNAL-PENDING) ──────────────────────

/// Record that `collateral_amount` of LSD was deposited as margin and
/// `borrow_amount` of dUSDC was borrowed.  LTV check runs immediately.
/// EXTERNAL-PENDING: real implementation calls deepbook_margin::borrow_quote.
public fun borrow_against_collateral(
    collateral_type:   vector<u8>,
    collateral_amount: u64,
    borrow_amount:     u64,
    price_e9:          u64,
    risk_params:       &RiskParams,
    ctx:               &mut TxContext,
): CollateralPosition {
    assert!(collateral_amount > 0, EInsufficientCollateral);
    let ltv = compute_ltv_bps(collateral_amount, borrow_amount, price_e9);
    assert!(ltv <= risk_params.max_ltv_bps(), EBorrowExceedsMaxLtv);

    // EXTERNAL-PENDING: deepbook_margin::deposit_collateral(lsd_coin)
    //                   deepbook_margin::borrow_quote(borrow_amount)
    // returns the borrowed Coin<DUSDC> — stub emits event only

    let position = CollateralPosition {
        id:                object::new(ctx),
        owner:             ctx.sender(),
        collateral_type,
        collateral_amount,
        entry_price_e9:    price_e9,
        debt_dusdc:        borrow_amount,
    };
    event::emit(PositionOpened {
        position_id:       object::id(&position),
        owner:             ctx.sender(),
        collateral_type:   position.collateral_type,
        collateral_amount,
        borrow_amount,
        ltv_bps:           ltv,
    });
    position
}

/// Repay `repay_coin` of dUSDC debt and close the position.
/// EXTERNAL-PENDING: real implementation calls deepbook_margin::repay_quote
///                   and deepbook_margin::withdraw_collateral.
public fun repay_and_release(
    position:    CollateralPosition,
    repay_coin:  Coin<DUSDC>,
    ctx:         &mut TxContext,
) {
    let position_id = object::id(&position);
    let CollateralPosition { id, owner, collateral_type: _, collateral_amount: _,
                             entry_price_e9: _, debt_dusdc } = position;

    // EXTERNAL-PENDING: deepbook_margin::repay_quote(repay_coin)
    //                   deepbook_margin::withdraw_collateral(collateral_amount)
    let repaid = repay_coin.value();
    // EXTERNAL-PENDING: deepbook_margin::repay_quote(repay_coin); return collateral
    transfer::public_transfer(repay_coin, owner);

    event::emit(PositionClosed { position_id, owner, debt_repaid: repaid });
    let _ = debt_dusdc; // suppress unused warning
    id.delete();
}

/// Reduce LTV of a position by repaying `repay_coin` of debt.
/// Emits `DeleverageExecuted` with before/after LTV.
/// EXTERNAL-PENDING: calls margin to repay.
public fun execute_partial_deleverage(
    position:   &mut CollateralPosition,
    repay_coin: Coin<DUSDC>,
    price_e9:   u64,
    risk_params: &RiskParams,
    _ctx:        &mut TxContext,
) {
    let ltv_before = compute_ltv_bps(
        position.collateral_amount, position.debt_dusdc, price_e9,
    );
    assert!(ltv_before > risk_params.liquidation_ltv_bps(), ELtvHealthy);

    let repay_amount = repay_coin.value();
    // EXTERNAL-PENDING: deepbook_margin::repay_quote(repay_coin)
    transfer::public_transfer(repay_coin, position.owner);

    position.debt_dusdc = if (repay_amount >= position.debt_dusdc) {
        0
    } else {
        position.debt_dusdc - repay_amount
    };

    let ltv_after = if (position.debt_dusdc == 0) { 0 } else {
        compute_ltv_bps(position.collateral_amount, position.debt_dusdc, price_e9)
    };

    event::emit(DeleverageExecuted {
        position_id:  object::id(position),
        repay_amount,
        ltv_before,
        ltv_after,
    });
}

// ─── Internal math ────────────────────────────────────────────────────────────

/// Checked `a * b / c`, truncating like native integer division. Delegates to
/// the audited `openzeppelin_math::u64::mul_div` (u128 intermediate) instead
/// of a hand-rolled cast, with a named abort on overflow.
fun mul_div(a: u64, b: u64, c: u64): u64 {
    let result = oz_u64::mul_div(a, b, c, rounding::down());
    assert!(result.is_some(), EMathOverflow);
    result.destroy_some()
}

// Read accessors
public fun collateral_amount(p: &CollateralPosition): u64     { p.collateral_amount }
public fun debt_dusdc(p: &CollateralPosition): u64            { p.debt_dusdc }
public fun entry_price_e9(p: &CollateralPosition): u64        { p.entry_price_e9 }
public fun owner(p: &CollateralPosition): address             { p.owner }

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_position_for_testing(
    collateral_type:   vector<u8>,
    collateral_amount: u64,
    debt_dusdc:        u64,
    price_e9:          u64,
    ctx:               &mut TxContext,
): CollateralPosition {
    CollateralPosition {
        id:                object::new(ctx),
        owner:             ctx.sender(),
        collateral_type,
        collateral_amount,
        entry_price_e9:    price_e9,
        debt_dusdc,
    }
}

#[test_only]
public fun destroy_position_for_testing(p: CollateralPosition) {
    let CollateralPosition { id, owner: _, collateral_type: _, collateral_amount: _,
                             entry_price_e9: _, debt_dusdc: _ } = p;
    id.delete();
}
