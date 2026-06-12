/// Module 11 — emergency: trustless safety valves.
///
/// `emergency_deleverage` is callable by ANY address.  It asserts LTV breach
/// before executing, so calling it on a healthy position is a no-op abort —
/// safe to expose publicly.
///
/// `pause` is admin-gated (via risk_params::pause).  Withdrawals are NEVER
/// blocked by pause (enforced in deposit_router).
///
/// The trustless property: no keeper key required.  Any on-chain observer who
/// sees a breached LTV can trigger deleverage and protect the protocol.
module reflux::emergency;

use reflux::leverage::{Self, CollateralPosition};
use reflux::risk_params::{Self, RiskParams};
use reflux::types::DUSDC;
use sui::coin::Coin;
use sui::event;

// ─── Error codes ─────────────────────────────────────────────────────────────

const ELtvHealthy: u64 = 0; // called when position is not breached
const EZeroRepay:  u64 = 1;

// ─── Events ──────────────────────────────────────────────────────────────────

public struct EmergencyDeleverageTriggered has copy, drop {
    position_id:  ID,
    caller:       address,
    ltv_before:   u64,
    repay_amount: u64,
}

// ─── Public trustless entry points ───────────────────────────────────────────

/// Assert that `position` is currently breached (LTV > liquidation threshold).
/// Aborts with ELtvHealthy when the position is healthy.
/// Read-only — does not mutate state.
public fun assert_ltv_breach(
    position:    &CollateralPosition,
    price_e9:    u64,
    risk_params: &RiskParams,
) {
    let ltv = leverage::compute_ltv_bps(
        leverage::collateral_amount(position),
        leverage::debt_dusdc(position),
        price_e9,
    );
    assert!(ltv > risk_params::liquidation_ltv_bps(risk_params), ELtvHealthy);
}

/// Trustless emergency deleverage — callable by ANY address.
/// Validates breach, then repays `repay_coin` of debt.
/// Aborts with ELtvHealthy when the position is not breached.
/// After this call, the position's LTV is reduced by `repay_coin.value()`.
public fun emergency_deleverage(
    position:    &mut CollateralPosition,
    repay_coin:  Coin<DUSDC>,
    price_e9:    u64,
    risk_params: &RiskParams,
    ctx:         &mut TxContext,
) {
    let ltv_before = leverage::compute_ltv_bps(
        leverage::collateral_amount(position),
        leverage::debt_dusdc(position),
        price_e9,
    );
    assert!(ltv_before > risk_params::liquidation_ltv_bps(risk_params), ELtvHealthy);
    let repay_amount = repay_coin.value();
    assert!(repay_amount > 0, EZeroRepay);
    event::emit(EmergencyDeleverageTriggered {
        position_id:  object::id(position),
        caller:       ctx.sender(),
        ltv_before,
        repay_amount,
    });
    leverage::execute_partial_deleverage(position, repay_coin, price_e9, risk_params, ctx);
}

// ─── Error-code accessors for tests ──────────────────────────────────────────

#[test_only]
public fun e_ltv_healthy(): u64 { ELtvHealthy }
