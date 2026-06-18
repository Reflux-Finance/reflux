/// Module 10 — predict_strategy: DeepBook Predict position management.
///
/// Wraps predict::mint (range strips) and predict::supply (PLP) behind a
/// stable interface.  All external Predict calls are EXTERNAL-PENDING until
/// the package addresses in Move.toml are confirmed (see INTEGRATION_NOTES DR-1).
///
/// Test-only mock functions (`*_mock`) mirror the production interface but use
/// coin::mint_for_testing, making every test path exercisable without a live
/// Predict deployment.
module reflux::predict_strategy;

use reflux::risk_params::RiskParams;
use dusdc::dusdc::DUSDC;
use sui::coin::{Self, Coin};
use sui::event;

// ─── Error codes ─────────────────────────────────────────────────────────────

const EExternalPending:    u64 = 99;
const ENotSettled:         u64 = 0;
const EInvalidStrikeCount: u64 = 1;

// Position type discriminant
const POS_RANGE_STRIP: u8 = 0;
const POS_PLP:         u8 = 1;

// ─── Structs ─────────────────────────────────────────────────────────────────

/// On-chain tracking record for an open range-strip or PLP position.
/// The actual Predict position IDs (returned by predict::mint / supply) are
/// stored as `predict_position_ids` once wired.
public struct PredictPosition has key {
    id:                   UID,
    oracle_id:            ID,
    position_type:        u8,   // POS_RANGE_STRIP or POS_PLP
    capital_dusdc:        u64,
    n_strikes:            u64,
    spacing_bps:          u64,
    is_settled:           bool,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct RangeStripOpened has copy, drop {
    position_id:   ID,
    oracle_id:     ID,
    capital_dusdc: u64,
    n_strikes:     u64,
    spacing_bps:   u64,
}

public struct PlpSupplied has copy, drop {
    position_id:   ID,
    oracle_id:     ID,
    capital_dusdc: u64,
}

public struct PositionRedeemed has copy, drop {
    position_id: ID,
    dusdc_out:   u64,
}

// ─── Production stubs (EXTERNAL-PENDING) ─────────────────────────────────────

/// Open N range strips centered on ATM from OracleSVI.
/// EXTERNAL-PENDING: predict::mint(oracle, strike_list, coin) via PTB.
public fun open_range_strip(
    _capital:     Coin<DUSDC>,
    _oracle_id:   ID,
    _n_strikes:   u64,
    _spacing_bps: u64,
    _rp:          &RiskParams,
    _ctx:         &mut TxContext,
): PredictPosition {
    // EXTERNAL-PENDING: predict::mint dispatched in PTB builder
    abort EExternalPending
}

/// Supply capital to the PLP.
/// EXTERNAL-PENDING: predict::supply(oracle, coin) via PTB.
public fun supply_to_plp(
    _capital:   Coin<DUSDC>,
    _oracle_id: ID,
    _ctx:       &mut TxContext,
): PredictPosition {
    // EXTERNAL-PENDING: predict::supply dispatched in PTB builder
    abort EExternalPending
}

/// Redeem all settled positions for this vault manager, returning dUSDC.
/// EXTERNAL-PENDING: predict::redeem_permissionless + redeem_supply per position.
public fun redeem_all_settled(_ctx: &mut TxContext): Coin<DUSDC> {
    abort EExternalPending
}

/// Read-only estimate of unrealized PnL on a position.
/// EXTERNAL-PENDING: queries Predict indexer marks.
public fun unrealized_pnl(_position: &PredictPosition): u64 { 0 }

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun position_capital(p: &PredictPosition): u64 { p.capital_dusdc }
public fun position_type(p: &PredictPosition): u8     { p.position_type }
public fun is_settled(p: &PredictPosition): bool      { p.is_settled }
public fun oracle_id(p: &PredictPosition): ID         { p.oracle_id }

// ─── Test-only mock implementations ──────────────────────────────────────────

/// Mock range strip: records capital and returns position + coin back (no escrow in mock).
#[test_only]
public fun open_range_strip_mock(
    capital:      Coin<DUSDC>,
    oracle_id:    ID,
    n_strikes:    u64,
    spacing_bps:  u64,
    _rp:          &RiskParams,
    ctx:          &mut TxContext,
): (PredictPosition, Coin<DUSDC>) {
    assert!(n_strikes > 0, EInvalidStrikeCount);
    let capital_dusdc = capital.value();
    let pos = PredictPosition {
        id:            object::new(ctx),
        oracle_id,
        position_type: POS_RANGE_STRIP,
        capital_dusdc,
        n_strikes,
        spacing_bps,
        is_settled:    false,
    };
    event::emit(RangeStripOpened {
        position_id: object::id(&pos), oracle_id, capital_dusdc, n_strikes, spacing_bps,
    });
    // Return capital unchanged — mock does not physically lock coins
    (pos, capital)
}

/// Mock PLP supply: records capital and returns position + coin back.
#[test_only]
public fun supply_to_plp_mock(
    capital:    Coin<DUSDC>,
    oracle_id:  ID,
    ctx:        &mut TxContext,
): (PredictPosition, Coin<DUSDC>) {
    let capital_dusdc = capital.value();
    let pos = PredictPosition {
        id:            object::new(ctx),
        oracle_id,
        position_type: POS_PLP,
        capital_dusdc,
        n_strikes:     0,
        spacing_bps:   0,
        is_settled:    false,
    };
    event::emit(PlpSupplied { position_id: object::id(&pos), oracle_id, capital_dusdc });
    (pos, capital)
}

/// Mark a position as settled (simulate oracle expiry).
#[test_only]
public fun settle_for_testing(position: &mut PredictPosition) {
    position.is_settled = true;
}

/// Redeem a settled mock position and return its capital as a fresh coin.
/// Simulates PnL = 0 (returned capital = original capital).
#[test_only]
public fun redeem_settled_mock(
    position: PredictPosition,
    ctx:      &mut TxContext,
): Coin<DUSDC> {
    assert!(position.is_settled, ENotSettled);
    let PredictPosition {
        id, oracle_id: _, position_type: _, capital_dusdc,
        n_strikes: _, spacing_bps: _, is_settled: _,
    } = position;
    event::emit(PositionRedeemed { position_id: id.to_inner(), dusdc_out: capital_dusdc });
    id.delete();
    coin::mint_for_testing<DUSDC>(capital_dusdc, ctx)
}

/// Redeem a settled mock position with explicit yield (pnl added on top of capital).
#[test_only]
public fun redeem_settled_mock_with_yield(
    position:    PredictPosition,
    yield_dusdc: u64,
    ctx:         &mut TxContext,
): Coin<DUSDC> {
    assert!(position.is_settled, ENotSettled);
    let PredictPosition {
        id, oracle_id: _, position_type: _, capital_dusdc,
        n_strikes: _, spacing_bps: _, is_settled: _,
    } = position;
    let total = capital_dusdc + yield_dusdc;
    event::emit(PositionRedeemed { position_id: id.to_inner(), dusdc_out: total });
    id.delete();
    coin::mint_for_testing<DUSDC>(total, ctx)
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun destroy_position_for_testing(p: PredictPosition) {
    let PredictPosition {
        id, oracle_id: _, position_type: _, capital_dusdc: _,
        n_strikes: _, spacing_bps: _, is_settled: _,
    } = p;
    id.delete();
}
