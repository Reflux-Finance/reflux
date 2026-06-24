/// Module 1 — RiskParams: governance object for all system risk limits.
///
/// Hard params (immutable after init):
///   `absolute_max_ltv_bps` = 8000 bps (80%) — no setter ever exists.
///
/// Soft params: admin proposes via `propose_update`; a 24 h timelock guards
/// execution.  Any proposed values that would exceed the hard cap are rejected
/// at proposal time, not execution time.
module reflux::risk_params;

use reflux::access::AdminRole;
use openzeppelin_access::access_control::Auth;
use sui::clock::Clock;
use sui::event;

// ─── Constants ──────────────────────────────────────────────────────────────

/// Hard cap on any LTV parameter.  No function sets this after init.
const ABSOLUTE_MAX_LTV_BPS: u64 = 8_000;

/// 24-hour timelock on soft-param changes (in milliseconds).
const TIMELOCK_MS: u64 = 86_400_000;

// Default values for soft params
const DEFAULT_LIQUIDATION_LTV: u64 = 7_500;
const DEFAULT_TARGET_LTV:      u64 = 5_000;
const DEFAULT_MAX_LTV:         u64 = 6_500;
const DEFAULT_MAX_EXPIRY:      u64 = 2_000;
const DEFAULT_MIN_IB_BUF:      u64 = 500;
const DEFAULT_MAX_BUF_DRAW:    u64 = 1_000;
const DEFAULT_SVI_STALE:       u64 = 300_000; // 5 min
const DEFAULT_PYTH_STALE:      u64 = 60_000;  // 1 min

// ─── Error codes ─────────────────────────────────────────────────────────────

const ETimelockNotExpired: u64 = 0;
const ENoPendingUpdate:    u64 = 1;
const EAlreadyPending:     u64 = 2;
const EExceedsHardCap:     u64 = 3;
const EInvalidParams:      u64 = 4;

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Staged soft-parameter update waiting out the 24 h timelock.
public struct ParamUpdate has store, drop {
    liquidation_ltv_bps:   u64,
    target_ltv_bps:        u64,
    max_ltv_bps:           u64,
    max_single_expiry_bps: u64,
    min_ib_buffer_bps:     u64,
    max_buffer_draw_bps:   u64,
    max_svi_staleness_ms:  u64,
    max_pyth_staleness_ms: u64,
    proposed_at_ms:        u64,
}

/// Shared governance object.  All risk limits live here so every module
/// reads from a single source of truth.
public struct RiskParams has key {
    id: UID,
    // ── Hard params ────────────────────────────────────────────────
    absolute_max_ltv_bps: u64,   // 8000 — immutable, NO setter
    // ── Soft params ────────────────────────────────────────────────
    liquidation_ltv_bps:   u64,
    target_ltv_bps:        u64,
    max_ltv_bps:           u64,
    max_single_expiry_bps: u64,  // max % of NAV in a single expiry
    min_ib_buffer_bps:     u64,  // min idle buffer as % of NAV
    max_buffer_draw_bps:   u64,  // max instant-exit draw as % of NAV
    max_svi_staleness_ms:  u64,
    max_pyth_staleness_ms: u64,
    // ── State ──────────────────────────────────────────────────────
    paused:  bool,
    pending: std::option::Option<ParamUpdate>,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct ParamUpdateProposed has copy, drop {
    proposed_at_ms:      u64,
    liquidation_ltv_bps: u64,
    target_ltv_bps:      u64,
    max_ltv_bps:         u64,
}

public struct ParamUpdateExecuted has copy, drop { executed_at_ms: u64 }
public struct ParamUpdateCancelled has copy, drop {}
public struct VaultPaused   has copy, drop {}
public struct VaultUnpaused has copy, drop {}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(RiskParams {
        id: object::new(ctx),
        absolute_max_ltv_bps:  ABSOLUTE_MAX_LTV_BPS,
        liquidation_ltv_bps:   DEFAULT_LIQUIDATION_LTV,
        target_ltv_bps:        DEFAULT_TARGET_LTV,
        max_ltv_bps:           DEFAULT_MAX_LTV,
        max_single_expiry_bps: DEFAULT_MAX_EXPIRY,
        min_ib_buffer_bps:     DEFAULT_MIN_IB_BUF,
        max_buffer_draw_bps:   DEFAULT_MAX_BUF_DRAW,
        max_svi_staleness_ms:  DEFAULT_SVI_STALE,
        max_pyth_staleness_ms: DEFAULT_PYTH_STALE,
        paused:  false,
        pending: std::option::none(),
    });
}

// ─── Admin: timelock propose / execute / cancel ───────────────────────────────

public fun propose_update(
    _: &Auth<AdminRole>,
    params: &mut RiskParams,
    liquidation_ltv_bps:   u64,
    target_ltv_bps:        u64,
    max_ltv_bps:           u64,
    max_single_expiry_bps: u64,
    min_ib_buffer_bps:     u64,
    max_buffer_draw_bps:   u64,
    max_svi_staleness_ms:  u64,
    max_pyth_staleness_ms: u64,
    clock: &Clock,
) {
    assert!(params.pending.is_none(), EAlreadyPending);
    validate_soft_params(
        params.absolute_max_ltv_bps,
        liquidation_ltv_bps, target_ltv_bps, max_ltv_bps,
        max_single_expiry_bps, min_ib_buffer_bps, max_buffer_draw_bps,
    );
    let now = clock.timestamp_ms();
    params.pending = std::option::some(ParamUpdate {
        liquidation_ltv_bps, target_ltv_bps, max_ltv_bps,
        max_single_expiry_bps, min_ib_buffer_bps, max_buffer_draw_bps,
        max_svi_staleness_ms, max_pyth_staleness_ms,
        proposed_at_ms: now,
    });
    event::emit(ParamUpdateProposed {
        proposed_at_ms: now,
        liquidation_ltv_bps,
        target_ltv_bps,
        max_ltv_bps,
    });
}

/// Executable by anyone after the timelock has elapsed.
public fun execute_update(params: &mut RiskParams, clock: &Clock) {
    assert!(params.pending.is_some(), ENoPendingUpdate);
    let update = params.pending.extract();
    let now = clock.timestamp_ms();
    assert!(now >= update.proposed_at_ms + TIMELOCK_MS, ETimelockNotExpired);
    params.liquidation_ltv_bps   = update.liquidation_ltv_bps;
    params.target_ltv_bps        = update.target_ltv_bps;
    params.max_ltv_bps           = update.max_ltv_bps;
    params.max_single_expiry_bps = update.max_single_expiry_bps;
    params.min_ib_buffer_bps     = update.min_ib_buffer_bps;
    params.max_buffer_draw_bps   = update.max_buffer_draw_bps;
    params.max_svi_staleness_ms  = update.max_svi_staleness_ms;
    params.max_pyth_staleness_ms = update.max_pyth_staleness_ms;
    event::emit(ParamUpdateExecuted { executed_at_ms: now });
}

public fun cancel_update(_: &Auth<AdminRole>, params: &mut RiskParams) {
    assert!(params.pending.is_some(), ENoPendingUpdate);
    let _ = params.pending.extract();
    event::emit(ParamUpdateCancelled {});
}

// ─── Admin: pause / unpause ───────────────────────────────────────────────────

public fun pause(_: &Auth<AdminRole>, params: &mut RiskParams) {
    params.paused = true;
    event::emit(VaultPaused {});
}

public fun unpause(_: &Auth<AdminRole>, params: &mut RiskParams) {
    params.paused = false;
    event::emit(VaultUnpaused {});
}

/// Emergency pause callable by-package (vault, emergency module).
public(package) fun pause_internal(params: &mut RiskParams) {
    params.paused = true;
    event::emit(VaultPaused {});
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun absolute_max_ltv_bps(p: &RiskParams): u64   { p.absolute_max_ltv_bps }
public fun liquidation_ltv_bps(p: &RiskParams): u64    { p.liquidation_ltv_bps }
public fun target_ltv_bps(p: &RiskParams): u64         { p.target_ltv_bps }
public fun max_ltv_bps(p: &RiskParams): u64            { p.max_ltv_bps }
public fun max_single_expiry_bps(p: &RiskParams): u64  { p.max_single_expiry_bps }
public fun min_ib_buffer_bps(p: &RiskParams): u64      { p.min_ib_buffer_bps }
public fun max_buffer_draw_bps(p: &RiskParams): u64    { p.max_buffer_draw_bps }
public fun max_svi_staleness_ms(p: &RiskParams): u64   { p.max_svi_staleness_ms }
public fun max_pyth_staleness_ms(p: &RiskParams): u64  { p.max_pyth_staleness_ms }
public fun paused(p: &RiskParams): bool                { p.paused }
public fun has_pending_update(p: &RiskParams): bool    { p.pending.is_some() }

public fun assert_not_paused(p: &RiskParams) {
    assert!(!p.paused, 0);
}

// ─── Internal validation ──────────────────────────────────────────────────────

fun validate_soft_params(
    hard_cap:              u64,
    liquidation_ltv_bps:   u64,
    target_ltv_bps:        u64,
    max_ltv_bps:           u64,
    max_single_expiry_bps: u64,
    min_ib_buffer_bps:     u64,
    max_buffer_draw_bps:   u64,
) {
    assert!(liquidation_ltv_bps <= hard_cap,             EExceedsHardCap);
    assert!(max_ltv_bps         <= liquidation_ltv_bps,  EInvalidParams);
    assert!(target_ltv_bps      <= max_ltv_bps,          EInvalidParams);
    assert!(max_single_expiry_bps <= 10_000,             EInvalidParams);
    assert!(min_ib_buffer_bps + max_buffer_draw_bps <= 10_000, EInvalidParams);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): RiskParams {
    RiskParams {
        id: object::new(ctx),
        absolute_max_ltv_bps:  ABSOLUTE_MAX_LTV_BPS,
        liquidation_ltv_bps:   DEFAULT_LIQUIDATION_LTV,
        target_ltv_bps:        DEFAULT_TARGET_LTV,
        max_ltv_bps:           DEFAULT_MAX_LTV,
        max_single_expiry_bps: DEFAULT_MAX_EXPIRY,
        min_ib_buffer_bps:     DEFAULT_MIN_IB_BUF,
        max_buffer_draw_bps:   DEFAULT_MAX_BUF_DRAW,
        max_svi_staleness_ms:  DEFAULT_SVI_STALE,
        max_pyth_staleness_ms: DEFAULT_PYTH_STALE,
        paused:  false,
        pending: std::option::none(),
    }
}

#[test_only]
public fun destroy_for_testing(p: RiskParams) {
    let RiskParams {
        id, absolute_max_ltv_bps: _, liquidation_ltv_bps: _, target_ltv_bps: _,
        max_ltv_bps: _, max_single_expiry_bps: _, min_ib_buffer_bps: _,
        max_buffer_draw_bps: _, max_svi_staleness_ms: _, max_pyth_staleness_ms: _,
        paused: _, pending,
    } = p;
    if (pending.is_some()) {
        let _ = pending.destroy_some();
    } else {
        pending.destroy_none();
    };
    id.delete();
}

