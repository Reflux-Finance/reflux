/// Module 6 — spot_router: USDC ↔ dUSDC (and BTC ↔ dUSDC) conversion.
///
/// Coded behind a `ConversionVenue` interface with two implementations:
///
///   VENUE_SPOT_POOL (0) — swap via a DeepBook Spot pool (likely, per DR-1).
///                         EXTERNAL-PENDING: pool ID must be confirmed via
///                         DeepBook Telegram (see INTEGRATION_NOTES DR-1).
///
///   VENUE_WRAP (1)      — canonical wrap/unwrap of USDC → dUSDC.
///                         EXTERNAL-PENDING: no wrap module exists in
///                         predict-testnet-4-16 (see INTEGRATION_NOTES DR-1).
///
/// Production functions abort with EExternalPending until DR-1 resolves.
/// Test-only `*_mock` variants provide the 1:1 mock swap for unit tests.
///
/// Every conversion enforces a `min_out` slippage guard.
module reflux::spot_router;

use reflux::types::{USDC, DUSDC, BTC};
use sui::coin::{Self, Coin};
use sui::event;

// ─── Venue tags ──────────────────────────────────────────────────────────────

const VENUE_SPOT_POOL: u8 = 0;
const VENUE_WRAP:      u8 = 1; // EXTERNAL-PENDING

// ─── Error codes ─────────────────────────────────────────────────────────────

const ESlippageExceeded: u64 = 0;
const EExternalPending:  u64 = 99; // EXTERNAL-PENDING

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Shared config that records which venue is active and any pool IDs.
public struct SpotRouterConfig has key {
    id:        UID,
    venue_tag: u8,
    pool_id:   std::option::Option<address>, // USDC/dUSDC pool when venue = SPOT_POOL
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct SwapExecuted has copy, drop {
    direction:  vector<u8>, // b"usdc_to_dusdc" etc.
    amount_in:  u64,
    amount_out: u64,
    venue_tag:  u8,
}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(SpotRouterConfig {
        id:        object::new(ctx),
        venue_tag: VENUE_SPOT_POOL,
        pool_id:   std::option::none(),
    });
}

// ─── Production conversion interface — EXTERNAL-PENDING ──────────────────────

/// Convert plain USDC into dUSDC.
/// EXTERNAL-PENDING: DR-1 must be resolved before this path is live.
public fun usdc_to_dusdc(
    _config:  &SpotRouterConfig,
    _coin_in: Coin<USDC>,
    _min_out: u64,
    _ctx:     &mut TxContext,
): Coin<DUSDC> {
    // EXTERNAL-PENDING: route to real DeepBook Spot pool (DR-1)
    abort EExternalPending
}

/// Convert dUSDC back to plain USDC.
/// EXTERNAL-PENDING: DR-1 must be resolved before this path is live.
public fun dusdc_to_usdc(
    _config:  &SpotRouterConfig,
    _coin_in: Coin<DUSDC>,
    _min_out: u64,
    _ctx:     &mut TxContext,
): Coin<USDC> {
    abort EExternalPending
}

/// Tier-3 path: BTC → dUSDC.
/// EXTERNAL-PENDING: Tier-3 features blocked until Tier 1+2 gates are green.
public fun btc_to_dusdc(
    _config:  &SpotRouterConfig,
    _coin_in: Coin<BTC>,
    _min_out: u64,
    _ctx:     &mut TxContext,
): Coin<DUSDC> {
    abort EExternalPending
}

public fun dusdc_to_btc(
    _config:  &SpotRouterConfig,
    _coin_in: Coin<DUSDC>,
    _min_out: u64,
    _ctx:     &mut TxContext,
): Coin<BTC> {
    abort EExternalPending
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun venue_tag(c: &SpotRouterConfig): u8 { c.venue_tag }

// ─── Test-only mock conversions (1:1, slippage-checked) ──────────────────────

/// Test mock: 1:1 USDC → dUSDC with slippage guard.
/// Uses coin::mint_for_testing — only callable in #[test_only] context.
#[test_only]
public fun usdc_to_dusdc_mock(
    config:   &SpotRouterConfig,
    coin_in:  Coin<USDC>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<DUSDC> {
    let amount_in = coin_in.value();
    assert!(amount_in >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    event::emit(SwapExecuted {
        direction: b"usdc_to_dusdc", amount_in, amount_out: amount_in, venue_tag: config.venue_tag,
    });
    coin::mint_for_testing<DUSDC>(amount_in, ctx)
}

/// Test mock: 1:1 dUSDC → USDC with slippage guard.
#[test_only]
public fun dusdc_to_usdc_mock(
    config:   &SpotRouterConfig,
    coin_in:  Coin<DUSDC>,
    min_out:  u64,
    ctx:      &mut TxContext,
): Coin<USDC> {
    let amount_in = coin_in.value();
    assert!(amount_in >= min_out, ESlippageExceeded);
    sui::test_utils::destroy(coin_in);
    event::emit(SwapExecuted {
        direction: b"dusdc_to_usdc", amount_in, amount_out: amount_in, venue_tag: config.venue_tag,
    });
    coin::mint_for_testing<USDC>(amount_in, ctx)
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): SpotRouterConfig {
    SpotRouterConfig {
        id:        object::new(ctx),
        venue_tag: VENUE_SPOT_POOL,
        pool_id:   std::option::none(),
    }
}

#[test_only]
public fun destroy_for_testing(c: SpotRouterConfig) {
    let SpotRouterConfig { id, venue_tag: _, pool_id: _ } = c;
    id.delete();
}

#[test_only]
public fun venue_spot_pool(): u8 { VENUE_SPOT_POOL }
#[test_only]
public fun venue_wrap(): u8 { VENUE_WRAP }
