/// Reflux testnet BTC coin — rfBTC.
///
/// A real Sui coin for testnet BTC that bridges to dBTC once DeepBook deploys
/// the dbtc package on testnet.  The faucet cap (FAUCET_MAX) prevents a single
/// call from draining liquidity.
///
/// Deployment flow:
///   1. `init` runs once at publish time, creating CoinMetadata (frozen) and
///      a shared `RfBtcTreasury` holding the TreasuryCap.
///   2. Anyone calls `faucet` / `faucet_max` to mint up to FAUCET_MAX rfBTC.
///   3. `spot_router::rfbtc_to_dusdc` (DR-1 pending) will handle swaps once
///      a rfBTC/dUSDC DeepBook Spot pool exists.
module reflux::rfbtc;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::url;

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum amount mintable in a single faucet call: 1,000 rfBTC (8 decimals).
/// Generous on purpose — rfBTC is purely synthetic (no real backing), so the
/// only reason for a cap at all is to guard against a fat-fingered amount.
const FAUCET_MAX: u64 = 100_000_000_000;

// ─── Error codes ─────────────────────────────────────────────────────────────

/// Faucet amount exceeds FAUCET_MAX.
const EFaucetCap: u64 = 0;

// ─── OTW ─────────────────────────────────────────────────────────────────────

public struct RFBTC has drop {}

// ─── Shared wrapper ───────────────────────────────────────────────────────────

/// Shared object wrapping the TreasuryCap so anyone can call the faucet
/// without holding the cap directly.
public struct RfBtcTreasury has key {
    id:  UID,
    cap: TreasuryCap<RFBTC>,
}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(witness: RFBTC, ctx: &mut TxContext) {
    let (cap, metadata) = coin::create_currency(
        witness,
        8,
        b"rfBTC",
        b"Reflux BTC",
        b"Reflux Finance testnet BTC. Bridges to dBTC once DeepBook deploys.",
        std::option::none<url::Url>(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::share_object(RfBtcTreasury { id: object::new(ctx), cap });
}

// ─── Public faucet interface ──────────────────────────────────────────────────

/// Mint `amount` rfBTC.  Aborts if `amount` exceeds FAUCET_MAX.
public fun faucet(
    treasury: &mut RfBtcTreasury,
    amount:   u64,
    ctx:      &mut TxContext,
): Coin<RFBTC> {
    assert!(amount <= FAUCET_MAX, EFaucetCap);
    coin::mint(&mut treasury.cap, amount, ctx)
}

/// Mint exactly FAUCET_MAX rfBTC.
public fun faucet_max(
    treasury: &mut RfBtcTreasury,
    ctx:      &mut TxContext,
): Coin<RFBTC> {
    coin::mint(&mut treasury.cap, FAUCET_MAX, ctx)
}

/// Return the maximum amount a single faucet call may mint.
public fun faucet_max_amount(): u64 { FAUCET_MAX }

// ─── Test helpers ─────────────────────────────────────────────────────────────

/// Mint rfBTC directly — bypasses faucet cap; for unit tests only.
#[test_only]
public fun create_for_testing(amount: u64, ctx: &mut TxContext): Coin<RFBTC> {
    coin::mint_for_testing<RFBTC>(amount, ctx)
}

/// Error accessor for expected_failure tests.
#[test_only]
public fun e_faucet_cap(): u64 { EFaucetCap }

/// Create a minimal RfBtcTreasury for unit tests.
/// Uses `coin::create_currency` with the OTW struct — valid in test context.
#[test_only]
public fun create_treasury_for_testing(ctx: &mut TxContext): RfBtcTreasury {
    let (cap, metadata) = coin::create_currency(
        RFBTC {},
        8,
        b"rfBTC",
        b"Reflux BTC",
        b"",
        std::option::none<url::Url>(),
        ctx,
    );
    sui::test_utils::destroy(metadata);
    RfBtcTreasury { id: object::new(ctx), cap }
}

/// Destroy a test treasury (cap + UID).
#[test_only]
public fun destroy_treasury_for_testing(t: RfBtcTreasury) {
    let RfBtcTreasury { id, cap } = t;
    sui::test_utils::destroy(cap);
    id.delete();
}
