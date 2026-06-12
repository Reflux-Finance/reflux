/// Module 9 — allocator: IV-regime allocation engine.
///
/// Computes capital targets across four arms:
///   plp          — DeepBook Predict PLP supply
///   range        — range-strip option positions
///   margin_loop  — leveraged LSD collateral loop
///   ib_idle      — Iron Bank (or reserve sleeve) idle parking
///
/// Regime logic (ATM IV = atm_iv_e4 / 10_000):
///   atm_iv < iv_low_threshold  → low-IV regime:  shift range → plp + ib_idle
///   atm_iv > iv_high_threshold → high-IV regime: shift plp + ib_idle → range
///   else                       → neutral: base weights, clamp only
///
/// Hard cap enforced: ib_idle >= min_ib_buffer_bps (from RiskParams).
/// max_single_expiry_bps is enforced per-position in predict_strategy; not here.
///
/// Reason codes emitted in AllocationDecision:
///   0 RC_NEUTRAL   — base weights applied unchanged
///   1 RC_IV_LOW    — shifted range → plp + ib_idle
///   2 RC_IV_HIGH   — shifted plp + ib_idle → range
///   3 RC_HARD_CAP  — reserved for future hard-cap overrides (currently unused)
///   4 RC_IB_FLOOR  — ib_idle raised to min_ib_buffer_bps floor
module reflux::allocator;

use reflux::risk_params::{AdminCap, RiskParams};
use sui::clock::Clock;
use sui::event;

// ─── Constants ───────────────────────────────────────────────────────────────

const BPS_DENOM: u64 = 10_000;
const TIMELOCK_MS: u64 = 86_400_000; // 24 h

// Default base weights (must sum to 10_000)
const DEFAULT_BASE_PLP_BPS:         u64 = 3_000;
const DEFAULT_BASE_RANGE_BPS:       u64 = 4_000;
const DEFAULT_BASE_MARGIN_LOOP_BPS: u64 = 2_000;
const DEFAULT_BASE_IB_IDLE_BPS:     u64 = 1_000;

// Default IV thresholds (vol × 10_000; e.g., 3_000 = 30% vol)
const DEFAULT_IV_LOW_E4:        u64 = 3_000;
const DEFAULT_IV_HIGH_E4:       u64 = 6_000;
const DEFAULT_REGIME_SHIFT_BPS: u64 = 1_500;

// Regime + reason-code constants
const REGIME_NEUTRAL:  u8  = 0;
const REGIME_LOW_IV:   u8  = 1;
const REGIME_HIGH_IV:  u8  = 2;

const RC_NEUTRAL:  u64 = 0;
const RC_IV_LOW:   u64 = 1;
const RC_IV_HIGH:  u64 = 2;
const RC_HARD_CAP: u64 = 3; // reserved
const RC_IB_FLOOR: u64 = 4;

// ─── Error codes ─────────────────────────────────────────────────────────────

const EWeightSumInvalid:   u64 = 0;
const EThresholdInvalid:   u64 = 1;
const EShiftBpsInvalid:    u64 = 2;
const EAlreadyPending:     u64 = 3;
const ENoPendingUpdate:    u64 = 4;
const ETimelockNotExpired: u64 = 5;

// ─── Structs ─────────────────────────────────────────────────────────────────

public struct PolicyUpdate has store, drop {
    base_plp_bps:         u64,
    base_range_bps:       u64,
    base_margin_loop_bps: u64,
    base_ib_idle_bps:     u64,
    iv_low_threshold_e4:  u64,
    iv_high_threshold_e4: u64,
    regime_shift_bps:     u64,
    proposed_at_ms:       u64,
}

/// Shared allocation policy — governs base weights and IV thresholds.
/// Hard-coded weights must sum to 10_000.  Updated only via timelock.
public struct AllocationPolicy has key {
    id:                   UID,
    base_plp_bps:         u64,
    base_range_bps:       u64,
    base_margin_loop_bps: u64,
    base_ib_idle_bps:     u64,
    iv_low_threshold_e4:  u64,
    iv_high_threshold_e4: u64,
    regime_shift_bps:     u64,
    roll_counter:         u64,
    pending:              std::option::Option<PolicyUpdate>,
}

/// Returned from compute_targets — amounts and bps for each arm.
/// Has copy + drop so callers can pass it freely without consuming it.
public struct AllocationTargets has copy, drop {
    plp_dusdc:         u64,
    range_dusdc:       u64,
    margin_loop_dusdc: u64,
    ib_idle_dusdc:     u64,
    plp_bps:           u64,
    range_bps:         u64,
    margin_loop_bps:   u64,
    ib_idle_bps:       u64,
}

// ─── Events ──────────────────────────────────────────────────────────────────

/// Emitted on every compute_targets call — the transparency surface per CLAUDE.md §rule 4.
public struct AllocationDecision has copy, drop {
    roll_id:           u64,
    timestamp_ms:      u64,
    atm_iv_e4:         u64,
    iv_low_thresh_e4:  u64,
    iv_high_thresh_e4: u64,
    regime:            u8,
    plp_bps_before:    u64,
    range_bps_before:  u64,
    ml_bps_before:     u64,
    ib_bps_before:     u64,
    plp_bps_after:     u64,
    range_bps_after:   u64,
    ml_bps_after:      u64,
    ib_bps_after:      u64,
    reason_code:       u64,
}

public struct PolicyUpdateProposed  has copy, drop { proposed_at_ms: u64 }
public struct PolicyUpdateExecuted  has copy, drop { executed_at_ms: u64 }
public struct PolicyUpdateCancelled has copy, drop {}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(AllocationPolicy {
        id:                   object::new(ctx),
        base_plp_bps:         DEFAULT_BASE_PLP_BPS,
        base_range_bps:       DEFAULT_BASE_RANGE_BPS,
        base_margin_loop_bps: DEFAULT_BASE_MARGIN_LOOP_BPS,
        base_ib_idle_bps:     DEFAULT_BASE_IB_IDLE_BPS,
        iv_low_threshold_e4:  DEFAULT_IV_LOW_E4,
        iv_high_threshold_e4: DEFAULT_IV_HIGH_E4,
        regime_shift_bps:     DEFAULT_REGIME_SHIFT_BPS,
        roll_counter:         0,
        pending:              std::option::none(),
    });
}

// ─── Core: compute allocation targets ────────────────────────────────────────

/// Compute targets for the next roll given current ATM IV and vault NAV.
/// Always emits AllocationDecision with before/after weights and reason_code.
/// `ib_balance` is informational (current parked amount; used by caller to
/// decide whether to park more or draw).
public(package) fun compute_targets(
    policy:      &mut AllocationPolicy,
    nav_dusdc:   u64,
    atm_iv_e4:   u64,
    ib_balance:  u64,
    risk_params: &RiskParams,
    clock:       &Clock,
): AllocationTargets {
    let roll_id = policy.roll_counter;
    policy.roll_counter = policy.roll_counter + 1;

    let mut plp   = policy.base_plp_bps;
    let mut range = policy.base_range_bps;
    let mut ml    = policy.base_margin_loop_bps;
    let mut ib    = policy.base_ib_idle_bps;

    let before_plp   = plp;
    let before_range = range;
    let before_ml    = ml;
    let before_ib    = ib;

    let mut regime      = REGIME_NEUTRAL;
    let mut reason_code = RC_NEUTRAL;

    // ── Regime shift ──────────────────────────────────────────────────────────
    if (atm_iv_e4 < policy.iv_low_threshold_e4) {
        regime = REGIME_LOW_IV;
        // Low IV: shift up to regime_shift_bps from range → split evenly into plp + ib
        let shift = min64(policy.regime_shift_bps, range);
        let half  = shift / 2;
        range = range - shift;
        plp   = plp   + half;
        ib    = ib    + (shift - half); // handles odd shift without losing a bps
        reason_code = RC_IV_LOW;
    } else if (atm_iv_e4 > policy.iv_high_threshold_e4) {
        regime = REGIME_HIGH_IV;
        // High IV: shift up to regime_shift_bps from plp + ib_idle → range
        let max_shift  = min64(policy.regime_shift_bps, plp + ib);
        let from_plp   = min64(max_shift, plp);
        let from_ib    = min64(max_shift - from_plp, ib);
        let act_shift  = from_plp + from_ib;
        plp   = plp   - from_plp;
        ib    = ib    - from_ib;
        range = range + act_shift;
        reason_code = RC_IV_HIGH;
    };

    // ── IB floor hard cap ─────────────────────────────────────────────────────
    let min_ib = risk_params.min_ib_buffer_bps();
    if (ib < min_ib) {
        let deficit   = min_ib - ib;
        let from_plp  = min64(deficit, plp);
        let rem1      = deficit - from_plp;
        let from_rng  = min64(rem1, range);
        let rem2      = rem1 - from_rng;
        let from_ml   = min64(rem2, ml);
        plp   = plp   - from_plp;
        range = range - from_rng;
        ml    = ml    - from_ml;
        ib    = ib    + from_plp + from_rng + from_ml;
        // Only override reason if no regime shift already tagged it
        if (reason_code == RC_NEUTRAL || reason_code == RC_HARD_CAP) {
            reason_code = RC_IB_FLOOR;
        };
    };

    let _ = ib_balance; // informational; caller decides park/draw delta

    event::emit(AllocationDecision {
        roll_id,
        timestamp_ms:      clock.timestamp_ms(),
        atm_iv_e4,
        iv_low_thresh_e4:  policy.iv_low_threshold_e4,
        iv_high_thresh_e4: policy.iv_high_threshold_e4,
        regime,
        plp_bps_before:    before_plp,
        range_bps_before:  before_range,
        ml_bps_before:     before_ml,
        ib_bps_before:     before_ib,
        plp_bps_after:     plp,
        range_bps_after:   range,
        ml_bps_after:      ml,
        ib_bps_after:      ib,
        reason_code,
    });

    AllocationTargets {
        plp_dusdc:         mul_div(nav_dusdc, plp, BPS_DENOM),
        range_dusdc:       mul_div(nav_dusdc, range, BPS_DENOM),
        margin_loop_dusdc: mul_div(nav_dusdc, ml, BPS_DENOM),
        ib_idle_dusdc:     mul_div(nav_dusdc, ib, BPS_DENOM),
        plp_bps:           plp,
        range_bps:         range,
        margin_loop_bps:   ml,
        ib_idle_bps:       ib,
    }
}

// ─── Admin: timelocked policy update ─────────────────────────────────────────

public fun propose_policy_update(
    _:                    &AdminCap,
    policy:               &mut AllocationPolicy,
    base_plp_bps:         u64,
    base_range_bps:       u64,
    base_margin_loop_bps: u64,
    base_ib_idle_bps:     u64,
    iv_low_threshold_e4:  u64,
    iv_high_threshold_e4: u64,
    regime_shift_bps:     u64,
    clock:                &Clock,
) {
    assert!(policy.pending.is_none(), EAlreadyPending);
    assert!(
        base_plp_bps + base_range_bps + base_margin_loop_bps + base_ib_idle_bps == BPS_DENOM,
        EWeightSumInvalid,
    );
    assert!(iv_low_threshold_e4 < iv_high_threshold_e4, EThresholdInvalid);
    assert!(regime_shift_bps <= BPS_DENOM, EShiftBpsInvalid);
    let now = clock.timestamp_ms();
    policy.pending = std::option::some(PolicyUpdate {
        base_plp_bps, base_range_bps, base_margin_loop_bps, base_ib_idle_bps,
        iv_low_threshold_e4, iv_high_threshold_e4, regime_shift_bps,
        proposed_at_ms: now,
    });
    event::emit(PolicyUpdateProposed { proposed_at_ms: now });
}

public fun execute_policy_update(policy: &mut AllocationPolicy, clock: &Clock) {
    assert!(policy.pending.is_some(), ENoPendingUpdate);
    let update = policy.pending.extract();
    let now    = clock.timestamp_ms();
    assert!(now >= update.proposed_at_ms + TIMELOCK_MS, ETimelockNotExpired);
    policy.base_plp_bps         = update.base_plp_bps;
    policy.base_range_bps       = update.base_range_bps;
    policy.base_margin_loop_bps = update.base_margin_loop_bps;
    policy.base_ib_idle_bps     = update.base_ib_idle_bps;
    policy.iv_low_threshold_e4  = update.iv_low_threshold_e4;
    policy.iv_high_threshold_e4 = update.iv_high_threshold_e4;
    policy.regime_shift_bps     = update.regime_shift_bps;
    event::emit(PolicyUpdateExecuted { executed_at_ms: now });
}

public fun cancel_policy_update(_: &AdminCap, policy: &mut AllocationPolicy) {
    assert!(policy.pending.is_some(), ENoPendingUpdate);
    let _ = policy.pending.extract();
    event::emit(PolicyUpdateCancelled {});
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun plp_dusdc(t: &AllocationTargets): u64         { t.plp_dusdc }
public fun range_dusdc(t: &AllocationTargets): u64       { t.range_dusdc }
public fun margin_loop_dusdc(t: &AllocationTargets): u64 { t.margin_loop_dusdc }
public fun ib_idle_dusdc(t: &AllocationTargets): u64     { t.ib_idle_dusdc }
public fun plp_bps(t: &AllocationTargets): u64           { t.plp_bps }
public fun range_bps(t: &AllocationTargets): u64         { t.range_bps }
public fun margin_loop_bps(t: &AllocationTargets): u64   { t.margin_loop_bps }
public fun ib_idle_bps(t: &AllocationTargets): u64       { t.ib_idle_bps }

public fun base_plp_bps(p: &AllocationPolicy): u64         { p.base_plp_bps }
public fun base_range_bps(p: &AllocationPolicy): u64       { p.base_range_bps }
public fun base_margin_loop_bps(p: &AllocationPolicy): u64 { p.base_margin_loop_bps }
public fun base_ib_idle_bps(p: &AllocationPolicy): u64     { p.base_ib_idle_bps }
public fun iv_low_threshold_e4(p: &AllocationPolicy): u64  { p.iv_low_threshold_e4 }
public fun iv_high_threshold_e4(p: &AllocationPolicy): u64 { p.iv_high_threshold_e4 }
public fun regime_shift_bps(p: &AllocationPolicy): u64     { p.regime_shift_bps }
public fun roll_counter(p: &AllocationPolicy): u64         { p.roll_counter }

// ─── Internal math ────────────────────────────────────────────────────────────

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}

fun min64(a: u64, b: u64): u64 { if (a < b) { a } else { b } }

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): AllocationPolicy {
    AllocationPolicy {
        id:                   object::new(ctx),
        base_plp_bps:         DEFAULT_BASE_PLP_BPS,
        base_range_bps:       DEFAULT_BASE_RANGE_BPS,
        base_margin_loop_bps: DEFAULT_BASE_MARGIN_LOOP_BPS,
        base_ib_idle_bps:     DEFAULT_BASE_IB_IDLE_BPS,
        iv_low_threshold_e4:  DEFAULT_IV_LOW_E4,
        iv_high_threshold_e4: DEFAULT_IV_HIGH_E4,
        regime_shift_bps:     DEFAULT_REGIME_SHIFT_BPS,
        roll_counter:         0,
        pending:              std::option::none(),
    }
}

#[test_only]
public fun destroy_for_testing(p: AllocationPolicy) {
    let AllocationPolicy {
        id, base_plp_bps: _, base_range_bps: _, base_margin_loop_bps: _,
        base_ib_idle_bps: _, iv_low_threshold_e4: _, iv_high_threshold_e4: _,
        regime_shift_bps: _, roll_counter: _, pending,
    } = p;
    if (pending.is_some()) { let _ = pending.destroy_some(); }
    else { pending.destroy_none(); };
    id.delete();
}

/// Create a policy with custom weights for testing specific scenarios.
#[test_only]
public fun create_custom_for_testing(
    base_plp_bps:         u64,
    base_range_bps:       u64,
    base_margin_loop_bps: u64,
    base_ib_idle_bps:     u64,
    iv_low_threshold_e4:  u64,
    iv_high_threshold_e4: u64,
    regime_shift_bps:     u64,
    ctx:                  &mut TxContext,
): AllocationPolicy {
    AllocationPolicy {
        id:                   object::new(ctx),
        base_plp_bps,
        base_range_bps,
        base_margin_loop_bps,
        base_ib_idle_bps,
        iv_low_threshold_e4,
        iv_high_threshold_e4,
        regime_shift_bps,
        roll_counter:         0,
        pending:              std::option::none(),
    }
}

#[test_only]
public fun default_iv_low_e4():        u64 { DEFAULT_IV_LOW_E4 }
#[test_only]
public fun default_iv_high_e4():       u64 { DEFAULT_IV_HIGH_E4 }
#[test_only]
public fun default_regime_shift_bps(): u64 { DEFAULT_REGIME_SHIFT_BPS }
#[test_only]
public fun rc_neutral():  u64 { RC_NEUTRAL }
#[test_only]
public fun rc_iv_low():   u64 { RC_IV_LOW }
#[test_only]
public fun rc_iv_high():  u64 { RC_IV_HIGH }
#[test_only]
public fun rc_ib_floor(): u64 { RC_IB_FLOOR }
