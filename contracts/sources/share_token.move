/// Module 3 — share_token: rfUSD, the single transferable yield share token.
///
/// Invariant: total_supply * nav_per_share_e9 == total NAV in dUSDC base units
///            ± rounding.  Both mint and burn round DOWN, so rounding always
///            favors the system (not the depositor).
///
/// Mint/burn are public(package) so only vault.move may call them.
module reflux::share_token;

use sui::coin::{Self, Coin, TreasuryCap, CoinMetadata};
use sui::event;
use sui::url;

// ─── Constants ───────────────────────────────────────────────────────────────

/// 1e9 scaling for nav_per_share (price_e9 convention).
const PRICE_SCALE: u64 = 1_000_000_000;

// ─── Error codes ─────────────────────────────────────────────────────────────

const EZeroDeposit:       u64 = 0;
const EZeroShares:        u64 = 1;
const EZeroNav:           u64 = 2;
const EMinSharesNotMet:   u64 = 3;
const EMinAmountNotMet:   u64 = 4;

// ─── OTW ─────────────────────────────────────────────────────────────────────

public struct SHARE_TOKEN has drop {}

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Shared object that wraps the TreasuryCap.
/// Only `vault.move` (public(package)) may mint or burn.
public struct ShareRegistry has key {
    id: UID,
    treasury_cap:     TreasuryCap<SHARE_TOKEN>,
    nav_per_share_e9: u64, // 1 rfUSD = nav_per_share_e9 * 1e-9 dUSDC
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct SharesMinted has copy, drop {
    depositor:    address,
    dusdc_value:  u64,
    shares_out:   u64,
    nav_e9:       u64,
}

public struct SharesBurned has copy, drop {
    redeemer:     address,
    shares_in:    u64,
    dusdc_value:  u64,
    nav_e9:       u64,
}

public struct NavUpdated has copy, drop {
    old_nav_e9:     u64,
    new_nav_e9:     u64,
    total_supply:   u64,
    total_nav_dusdc: u64,
}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(witness: SHARE_TOKEN, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency<SHARE_TOKEN>(
        witness,
        6,
        b"rfUSD",
        b"Reflux USD",
        b"dUSDC-native yield share token — Reflux Structured Yield OS",
        std::option::some(url::new_unsafe_from_bytes(
            b"https://reflux.finance/rfusd-logo.svg",
        )),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::share_object(ShareRegistry {
        id: object::new(ctx),
        treasury_cap,
        nav_per_share_e9: PRICE_SCALE, // starts at 1.0 dUSDC per rfUSD
    });
}

// ─── Package-internal mint / burn ────────────────────────────────────────────

/// Mint rfUSD proportional to `dusdc_value`.  Reverts if shares < `min_shares`.
/// Rounds DOWN — every extra MIST of rounding stays in the vault.
public(package) fun mint_shares(
    registry:    &mut ShareRegistry,
    dusdc_value: u64,
    min_shares:  u64,
    ctx:         &mut TxContext,
): Coin<SHARE_TOKEN> {
    assert!(dusdc_value > 0, EZeroDeposit);
    let nav = registry.nav_per_share_e9;
    assert!(nav > 0, EZeroNav);
    // shares = floor(dusdc_value * PRICE_SCALE / nav)
    let shares = (((dusdc_value as u128) * (PRICE_SCALE as u128)) / (nav as u128)) as u64;
    assert!(shares > 0, EZeroShares);
    assert!(shares >= min_shares, EMinSharesNotMet);
    event::emit(SharesMinted {
        depositor:   ctx.sender(),
        dusdc_value,
        shares_out:  shares,
        nav_e9:      nav,
    });
    coin::mint(&mut registry.treasury_cap, shares, ctx)
}

/// Burn rfUSD and return the dUSDC entitlement.  Rounds DOWN.
/// Caller is responsible for transferring back the dUSDC coin.
public(package) fun burn_shares(
    registry:   &mut ShareRegistry,
    coin_in:    Coin<SHARE_TOKEN>,
    min_amount: u64,
    ctx:        &mut TxContext,
): u64 {
    let shares_in = coin_in.value();
    assert!(shares_in > 0, EZeroShares);
    let nav = registry.nav_per_share_e9;
    // entitlement = floor(shares * nav / PRICE_SCALE) — rounding down favors vault
    let entitlement = (((shares_in as u128) * (nav as u128)) / (PRICE_SCALE as u128)) as u64;
    assert!(entitlement >= min_amount, EMinAmountNotMet);
    coin::burn(&mut registry.treasury_cap, coin_in);
    event::emit(SharesBurned {
        redeemer:    ctx.sender(),
        shares_in,
        dusdc_value: entitlement,
        nav_e9:      nav,
    });
    entitlement
}

/// Recompute nav_per_share from the vault's current total dUSDC NAV.
/// Called at end of every roll.
public(package) fun update_nav(
    registry:        &mut ShareRegistry,
    total_nav_dusdc: u64,
) {
    let supply = registry.treasury_cap.total_supply();
    let new_nav = if (supply == 0) {
        PRICE_SCALE // reset to 1.0 when no shares exist
    } else {
        (((total_nav_dusdc as u128) * (PRICE_SCALE as u128)) / (supply as u128)) as u64
    };
    event::emit(NavUpdated {
        old_nav_e9:     registry.nav_per_share_e9,
        new_nav_e9:     new_nav,
        total_supply:   supply,
        total_nav_dusdc,
    });
    registry.nav_per_share_e9 = new_nav;
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun total_supply(r: &ShareRegistry): u64 { r.treasury_cap.total_supply() }
public fun nav_per_share_e9(r: &ShareRegistry): u64 { r.nav_per_share_e9 }

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): ShareRegistry {
    let (treasury_cap, metadata) = coin::create_currency<SHARE_TOKEN>(
        SHARE_TOKEN {},
        6, b"rfUSD", b"Reflux USD", b"test", std::option::none(), ctx,
    );
    transfer::public_freeze_object(metadata);
    ShareRegistry {
        id: object::new(ctx),
        treasury_cap,
        nav_per_share_e9: PRICE_SCALE,
    }
}

#[test_only]
public fun destroy_for_testing(r: ShareRegistry) {
    let ShareRegistry { id, treasury_cap, nav_per_share_e9: _ } = r;
    sui::test_utils::destroy(treasury_cap);
    id.delete();
}

#[test_only]
public fun price_scale(): u64 { PRICE_SCALE }
