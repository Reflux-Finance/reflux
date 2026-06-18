/// Module 4 — lsd_adapter: uniform exchange-rate oracle for vSUI / afSUI / haSUI.
///
/// Each LSD has a `rate_e9` (1 LSD = rate_e9 * 1e-9 SUI) and an `updated_at_ms`
/// timestamp.  Callers check staleness against `RiskParams.max_pyth_staleness_ms`
/// (reused for LSD rates since they are also oracle-sourced).
///
/// Rates are seeded via the admin `update_rates` entry; in production these will
/// be pushed by a keeper or a price-feed service.
///
/// EXTERNAL-PENDING: production read implementations for each LSP pool will
/// replace the stored-rate approach once pool object IDs are confirmed.
module reflux::lsd_adapter;

use reflux::risk_params::RiskParams;
use afsui::afsui::AFSUI;
use reflux::types::{VSUI, HASUI};
use sui::clock::Clock;
use sui::event;

// ─── Error codes ─────────────────────────────────────────────────────────────

const ERateTooStale: u64 = 0;
const ERateIsZero:   u64 = 1;

// ─── Structs ─────────────────────────────────────────────────────────────────

public struct RateEntry has store, copy, drop {
    rate_e9:        u64, // 1 LSD = rate_e9 * 1e-9 SUI
    updated_at_ms:  u64,
}

/// Shared registry — stores the latest pushed rates for each supported LSD.
public struct LsdRateRegistry has key {
    id:     UID,
    vsui:   RateEntry,
    afsui:  RateEntry,
    hasui:  RateEntry,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct RateUpdated has copy, drop {
    lsd:           vector<u8>, // b"vsui" | b"afsui" | b"hasui"
    new_rate_e9:   u64,
    updated_at_ms: u64,
}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    let zero = RateEntry { rate_e9: 1_000_000_000, updated_at_ms: 0 }; // 1.0 placeholder
    transfer::share_object(LsdRateRegistry {
        id: object::new(ctx),
        vsui:  zero,
        afsui: zero,
        hasui: zero,
    });
}

// ─── Rate updates (keeper / admin) ───────────────────────────────────────────

public fun update_vsui_rate(
    registry:   &mut LsdRateRegistry,
    rate_e9:    u64,
    clock:      &Clock,
) {
    assert!(rate_e9 > 0, ERateIsZero);
    let now = clock.timestamp_ms();
    registry.vsui = RateEntry { rate_e9, updated_at_ms: now };
    event::emit(RateUpdated { lsd: b"vsui", new_rate_e9: rate_e9, updated_at_ms: now });
}

public fun update_afsui_rate(
    registry:   &mut LsdRateRegistry,
    rate_e9:    u64,
    clock:      &Clock,
) {
    assert!(rate_e9 > 0, ERateIsZero);
    let now = clock.timestamp_ms();
    registry.afsui = RateEntry { rate_e9, updated_at_ms: now };
    event::emit(RateUpdated { lsd: b"afsui", new_rate_e9: rate_e9, updated_at_ms: now });
}

public fun update_hasui_rate(
    registry:   &mut LsdRateRegistry,
    rate_e9:    u64,
    clock:      &Clock,
) {
    assert!(rate_e9 > 0, ERateIsZero);
    let now = clock.timestamp_ms();
    registry.hasui = RateEntry { rate_e9, updated_at_ms: now };
    event::emit(RateUpdated { lsd: b"hasui", new_rate_e9: rate_e9, updated_at_ms: now });
}

// ─── Checked rate reads ───────────────────────────────────────────────────────

/// Returns the vSUI → SUI exchange rate (scaled 1e9), asserting freshness.
public fun get_vsui_rate_e9(
    registry:    &LsdRateRegistry,
    risk_params: &RiskParams,
    clock:       &Clock,
): u64 {
    check_staleness(&registry.vsui, risk_params, clock);
    registry.vsui.rate_e9
}

public fun get_afsui_rate_e9(
    registry:    &LsdRateRegistry,
    risk_params: &RiskParams,
    clock:       &Clock,
): u64 {
    check_staleness(&registry.afsui, risk_params, clock);
    registry.afsui.rate_e9
}

public fun get_hasui_rate_e9(
    registry:    &LsdRateRegistry,
    risk_params: &RiskParams,
    clock:       &Clock,
): u64 {
    check_staleness(&registry.hasui, risk_params, clock);
    registry.hasui.rate_e9
}

/// Convert an LSD amount to SUI using the stored rate (no staleness check —
/// use the checked variants above unless you've already verified freshness).
public fun lsd_to_sui(lsd_amount: u64, rate_e9: u64): u64 {
    (((lsd_amount as u128) * (rate_e9 as u128)) / 1_000_000_000u128) as u64
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fun check_staleness(entry: &RateEntry, rp: &RiskParams, clock: &Clock) {
    let age = clock.timestamp_ms() - entry.updated_at_ms;
    assert!(age <= rp.max_pyth_staleness_ms(), ERateTooStale);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): LsdRateRegistry {
    let entry = RateEntry { rate_e9: 1_050_000_000, updated_at_ms: 0 }; // 1.05
    LsdRateRegistry {
        id: object::new(ctx),
        vsui:  entry,
        afsui: entry,
        hasui: entry,
    }
}

#[test_only]
public fun set_vsui_rate_for_testing(r: &mut LsdRateRegistry, rate_e9: u64, ts_ms: u64) {
    r.vsui = RateEntry { rate_e9, updated_at_ms: ts_ms };
}

#[test_only]
public fun destroy_for_testing(r: LsdRateRegistry) {
    let LsdRateRegistry { id, vsui: _, afsui: _, hasui: _ } = r;
    id.delete();
}
