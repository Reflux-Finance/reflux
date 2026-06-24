/// Module 12 — deposit_router: user-facing deposit / withdraw entry points.
///
/// Deposit flow:
///   deposit_dusdc → deposit_dusdc_impl directly (NO external deps — works now)
///   deposit_usdc  → spot_router::usdc_to_dusdc (EXTERNAL-PENDING) → mint rfUSD
///   deposit_sui   → spot_router::sui_to_dusdc (EXTERNAL-PENDING) → deposit_dusdc_impl
///   deposit_vsui  → lsd_adapter rate check → leverage::borrow_* (EXTERNAL-PENDING) → mint rfUSD
///   deposit_sui_lsp → staking_adapter (EXTERNAL-PENDING) → deposit_vsui path (Tier 2)
///
/// All production entry points that require EXTERNAL-PENDING calls abort at
/// runtime.  Test-only `*_mock` variants use mock coins and work fully.
///
/// Withdrawal:
///   withdraw      → burn rfUSD → check ib_credit instant-exit buffer → return dUSDC
///                   (caller / PTB converts dUSDC → USDC / SUI if desired)
///
/// `DepositPool` holds all dUSDC between rolls.  vault.move uses
/// `take_capital` / `return_capital` (package-internal) to move funds during
/// the roll cycle.
module reflux::deposit_router;

use reflux::ib_credit::{Self, IBCreditState};
use reflux::lsd_adapter::{Self, LsdRateRegistry};
use reflux::leverage;
use reflux::risk_params::{Self, RiskParams};
use reflux::share_token::{Self, ShareRegistry, SHARE_TOKEN};
use reflux::rfbtc::RFBTC;
use reflux::spot_router::{Self, SpotRouterConfig};
use afsui::afsui::AFSUI;
use dusdc::dusdc::DUSDC;
use reflux::types::{VSUI, HASUI};
use usdc::usdc::USDC;
use openzeppelin_math::rounding;
use openzeppelin_math::u64 as oz_u64;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

// ─── Output-preference constants ─────────────────────────────────────────────

const OUTPUT_ORIGINAL: u8 = 0; // return dUSDC (user swaps themselves)
const OUTPUT_USDC:     u8 = 1; // dUSDC → USDC via spot_router (EXTERNAL-PENDING)
const OUTPUT_SUI:      u8 = 2; // reserved (Tier 2)

// ─── Error codes ─────────────────────────────────────────────────────────────

const EPaused:              u64 = 0;
const ENotOwner:            u64 = 1;
const EInvalidOutputPref:   u64 = 2;
const EBorrowExceedsMaxLtv: u64 = 3;
const EZeroShares:          u64 = 4;
const EExceedsPosition:     u64 = 5;
const ELeveragedNoPartial:  u64 = 6;
const EMathOverflow:        u64 = 7;
const EExternalPending:     u64 = 99;

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Metadata record for the LSD collateral leg of a deposit.
public struct CollateralRecord has store, drop {
    lsd_type:       vector<u8>, // b"vsui" | b"afsui" | b"hasui"
    lsd_amount:     u64,
    entry_price_e9: u64,
}

/// Metadata record for borrowed dUSDC (leverage path only).
public struct DebtRecord has store, drop {
    debt_dusdc: u64,
}

/// Per-user position tracking.  Transferred to the depositor on creation.
/// Consumed (destroyed) on full withdrawal.
public struct VaultPosition has key {
    id:               UID,
    owner:            address,
    collateral:       std::option::Option<CollateralRecord>,
    debt:             std::option::Option<DebtRecord>,
    shares_minted:    u64,
    deposit_ts_ms:    u64,
    preferred_output: u8,
}

/// Shared object holding all deposited dUSDC between rolls.
public struct DepositPool has key {
    id:    UID,
    dusdc: Balance<DUSDC>,
}

/// Queued withdrawal receipt for when the instant-exit buffer is insufficient.
public struct PendingWithdrawal has key {
    id:                 UID,
    owner:              address,
    dusdc_amount:       u64,
    claimable_after_roll: u64, // vault.roll_counter value after which this is redeemable
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct Deposited has copy, drop {
    owner:        address,
    position_id:  ID,
    dusdc_value:  u64,
    shares_out:   u64,
    has_leverage: bool,
}

public struct Withdrawn has copy, drop {
    owner:       address,
    shares_in:   u64,
    dusdc_out:   u64,
    instant:     bool,
}

public struct WithdrawalQueued has copy, drop {
    owner:               address,
    dusdc_amount:        u64,
    claimable_after_roll: u64,
}

public struct PartialWithdrawn has copy, drop {
    owner:            address,
    position_id:      ID,
    shares_burned:    u64,
    shares_remaining: u64,
    dusdc_out:        u64,
    instant:          bool,
}

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(DepositPool {
        id:    object::new(ctx),
        dusdc: balance::zero<DUSDC>(),
    });
}

// ─── Production deposits ──────────────────────────────────────────────────────

/// Deposit dUSDC directly — no swap required.
/// Works on testnet today: dUSDC is available via the DeepBook faucet.
/// The caller is responsible for any prior asset → dUSDC conversion
/// (e.g. SUI → dUSDC via a DEX in the same PTB before calling this).
public fun deposit_dusdc(
    dusdc:      Coin<DUSDC>,
    min_shares: u64,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
) {
    let (pos, shares) = deposit_dusdc_impl(
        dusdc, min_shares,
        std::option::none(), std::option::none(),
        OUTPUT_ORIGINAL, pool, registry, rp, ctx,
    );
    transfer::public_transfer(shares, ctx.sender());
    transfer::transfer(pos, ctx.sender());
}

/// Deposit native SUI: SUI → dUSDC via the on-chain CPAMM → rfUSD.
/// Requires the SUI/dUSDC pool to be seeded with liquidity (see spot_router).
public fun deposit_sui(
    sui:        Coin<sui::sui::SUI>,
    min_shares: u64,
    config:     &mut SpotRouterConfig,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
) {
    let dusdc = spot_router::sui_to_dusdc(config, sui, 1, ctx);
    let (pos, shares) = deposit_dusdc_impl(
        dusdc, min_shares,
        std::option::none(), std::option::none(),
        OUTPUT_ORIGINAL, pool, registry, rp, ctx,
    );
    transfer::public_transfer(shares, ctx.sender());
    transfer::transfer(pos, ctx.sender());
}

/// Deposit rfBTC: rfBTC → dUSDC via the on-chain CPAMM → rfUSD.
/// Requires the rfBTC/dUSDC pool to be seeded with liquidity (see spot_router).
public fun deposit_rfbtc(
    rfbtc:      Coin<RFBTC>,
    min_shares: u64,
    config:     &mut SpotRouterConfig,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
) {
    let dusdc = spot_router::rfbtc_to_dusdc(config, rfbtc, 1, ctx);
    let (pos, shares) = deposit_dusdc_impl(
        dusdc, min_shares,
        std::option::none(), std::option::none(),
        OUTPUT_ORIGINAL, pool, registry, rp, ctx,
    );
    transfer::public_transfer(shares, ctx.sender());
    transfer::transfer(pos, ctx.sender());
}

/// Deposit plain USDC: USDC → dUSDC via the 1:1 treasury → rfUSD.
/// Requires the USDC/dUSDC treasury to be seeded with dUSDC reserves (see spot_router).
public fun deposit_usdc(
    usdc:       Coin<USDC>,
    min_shares: u64,
    config:     &mut SpotRouterConfig,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
) {
    let dusdc = spot_router::usdc_to_dusdc(config, usdc, 1, ctx);
    let (pos, shares) = deposit_dusdc_impl(
        dusdc, min_shares,
        std::option::none(), std::option::none(),
        OUTPUT_USDC, pool, registry, rp, ctx,
    );
    transfer::public_transfer(shares, ctx.sender());
    transfer::transfer(pos, ctx.sender());
}

/// Deposit vSUI collateral (with optional leverage).
/// EXTERNAL-PENDING: lsd rate + deepbook_margin borrow not yet wired.
public fun deposit_vsui(
    _vsui:         Coin<VSUI>,
    _leverage_bps: u64,
    _min_shares:   u64,
    _lsd_reg:      &LsdRateRegistry,
    _registry:     &mut ShareRegistry,
    _pool:         &mut DepositPool,
    _rp:           &RiskParams,
    _clock:        &Clock,
    _ctx:          &mut TxContext,
) {
    abort EExternalPending
}

/// Deposit afSUI collateral. EXTERNAL-PENDING.
public fun deposit_afsui(
    _afsui:        Coin<AFSUI>,
    _leverage_bps: u64,
    _min_shares:   u64,
    _lsd_reg:      &LsdRateRegistry,
    _registry:     &mut ShareRegistry,
    _pool:         &mut DepositPool,
    _rp:           &RiskParams,
    _clock:        &Clock,
    _ctx:          &mut TxContext,
) {
    abort EExternalPending
}

/// Deposit native SUI → stake to vSUI → deposit_vsui. EXTERNAL-PENDING (Tier 2).
/// For direct SUI→dUSDC without staking, use deposit_sui above.
public fun deposit_sui_lsp(
    _sui:          Coin<sui::sui::SUI>,
    _leverage_bps: u64,
    _min_shares:   u64,
    _lsd_reg:      &LsdRateRegistry,
    _registry:     &mut ShareRegistry,
    _pool:         &mut DepositPool,
    _rp:           &RiskParams,
    _clock:        &Clock,
    _ctx:          &mut TxContext,
) {
    abort EExternalPending
}

// ─── Universal withdraw ───────────────────────────────────────────────────────

/// Burn rfUSD shares and return the dUSDC entitlement.
/// - Instant path: draws from ib_credit if buffer has capacity.
/// - Queued path: creates PendingWithdrawal transferred to owner (fallback).
/// - Withdrawals are NEVER blocked by pause (per CLAUDE.md rule 5).
/// - VaultPosition is consumed (must be the full position withdrawal).
/// Returns dUSDC on instant exit; returns zero-value Coin<DUSDC> on queued path
/// (the actual amount is in PendingWithdrawal).
public fun withdraw(
    pos:         VaultPosition,
    shares:      Coin<SHARE_TOKEN>,
    min_out:     u64,
    next_roll_id: u64,
    pool:        &mut DepositPool,
    ib:          &mut IBCreditState,
    registry:    &mut ShareRegistry,
    rp:          &RiskParams,
    clock:       &Clock,
    ctx:         &mut TxContext,
): Coin<DUSDC> {
    let owner = pos.owner;
    assert!(ctx.sender() == owner, ENotOwner);

    let shares_in = shares.value();
    // Burn rfUSD and compute dUSDC entitlement
    let dusdc_amount = share_token::burn_shares(registry, shares, min_out, ctx);

    // Destroy VaultPosition (full withdrawal)
    let VaultPosition {
        id, owner: _, collateral, debt, shares_minted: _,
        deposit_ts_ms: _, preferred_output: _,
    } = pos;
    // Collateral and DebtRecord both have `drop` — consumed in destructuring
    let _ = collateral;
    let _ = debt;
    id.delete();

    // Attempt instant exit: try ib_credit first
    let parked = ib_credit::parked_amount(ib);
    let vault_nav = pool.dusdc.value() + parked;
    let coin_out = if (parked >= dusdc_amount) {
        // Fast path: served from ib_credit parked balance
        ib_credit::fund_instant_exit(ib, dusdc_amount, vault_nav, rp, clock, ctx)
    } else if (pool.dusdc.value() >= dusdc_amount) {
        // Pool has enough (pre-first-roll or post-roll residual)
        let out = coin::take(&mut pool.dusdc, dusdc_amount, ctx);
        out
    } else {
        // Queued exit — insufficient instant liquidity
        let pw = PendingWithdrawal {
            id:                   object::new(ctx),
            owner,
            dusdc_amount,
            claimable_after_roll: next_roll_id + 1,
        };
        event::emit(WithdrawalQueued {
            owner,
            dusdc_amount,
            claimable_after_roll: pw.claimable_after_roll,
        });
        transfer::transfer(pw, owner);
        // Return zero-value coin; actual funds come when PendingWithdrawal is claimed
        coin::zero<DUSDC>(ctx)
    };

    let dusdc_out = coin_out.value();
    event::emit(Withdrawn { owner, shares_in, dusdc_out, instant: dusdc_out > 0 });
    coin_out
}

/// Burn a partial amount of rfUSD shares against a position, without closing it.
/// - `pos` stays alive with `shares_minted` reduced by the burned amount — use
///   `withdraw` instead once you're redeeming the full remaining balance.
/// - Same instant/queued exit logic as `withdraw`.
/// - Leveraged positions (collateral/debt set) aren't supported yet — partial
///   redemption against borrowed capital needs LTV-aware accounting that
///   doesn't exist until the leverage loop (Tier 2) ships.
public fun withdraw_partial(
    pos:         &mut VaultPosition,
    shares:      Coin<SHARE_TOKEN>,
    min_out:     u64,
    next_roll_id: u64,
    pool:        &mut DepositPool,
    ib:          &mut IBCreditState,
    registry:    &mut ShareRegistry,
    rp:          &RiskParams,
    clock:       &Clock,
    ctx:         &mut TxContext,
): Coin<DUSDC> {
    assert!(ctx.sender() == pos.owner, ENotOwner);
    assert!(pos.collateral.is_none() && pos.debt.is_none(), ELeveragedNoPartial);

    let shares_in = shares.value();
    assert!(shares_in > 0, EZeroShares);
    assert!(shares_in < pos.shares_minted, EExceedsPosition);

    // Burn rfUSD and compute dUSDC entitlement
    let dusdc_amount = share_token::burn_shares(registry, shares, min_out, ctx);
    pos.shares_minted = pos.shares_minted - shares_in;

    // Attempt instant exit: try ib_credit first (identical to `withdraw`)
    let parked = ib_credit::parked_amount(ib);
    let vault_nav = pool.dusdc.value() + parked;
    let coin_out = if (parked >= dusdc_amount) {
        ib_credit::fund_instant_exit(ib, dusdc_amount, vault_nav, rp, clock, ctx)
    } else if (pool.dusdc.value() >= dusdc_amount) {
        coin::take(&mut pool.dusdc, dusdc_amount, ctx)
    } else {
        let pw = PendingWithdrawal {
            id:                   object::new(ctx),
            owner:                pos.owner,
            dusdc_amount,
            claimable_after_roll: next_roll_id + 1,
        };
        event::emit(WithdrawalQueued {
            owner: pos.owner,
            dusdc_amount,
            claimable_after_roll: pw.claimable_after_roll,
        });
        transfer::transfer(pw, pos.owner);
        coin::zero<DUSDC>(ctx)
    };

    let dusdc_out = coin_out.value();
    event::emit(PartialWithdrawn {
        owner:            pos.owner,
        position_id:      object::id(pos),
        shares_burned:    shares_in,
        shares_remaining: pos.shares_minted,
        dusdc_out,
        instant:          dusdc_out > 0,
    });
    coin_out
}

/// Claim a PendingWithdrawal once the roll counter has advanced past claimable_after_roll.
public fun claim_pending_withdrawal(
    pw:         PendingWithdrawal,
    roll_count: u64,
    pool:       &mut DepositPool,
    ctx:        &mut TxContext,
): Coin<DUSDC> {
    let PendingWithdrawal { id, owner, dusdc_amount, claimable_after_roll } = pw;
    assert!(ctx.sender() == owner, ENotOwner);
    assert!(roll_count >= claimable_after_roll, 0);
    id.delete();
    coin::take(&mut pool.dusdc, dusdc_amount, ctx)
}

// ─── Package-internal: vault.move uses these for roll ────────────────────────

/// Take `amount` dUSDC from the pool for redeployment (called by vault at roll start).
public(package) fun take_capital(pool: &mut DepositPool, amount: u64, ctx: &mut TxContext): Coin<DUSDC> {
    coin::take(&mut pool.dusdc, amount, ctx)
}

/// Return settled/redeemed capital to the pool after predict redemption.
public(package) fun return_capital(pool: &mut DepositPool, coin: Coin<DUSDC>) {
    pool.dusdc.join(coin.into_balance());
}

/// Read total dUSDC in pool (used by vault for NAV computation).
public fun pool_balance(pool: &DepositPool): u64 { pool.dusdc.value() }

// ─── Internal helpers ─────────────────────────────────────────────────────────

fun deposit_dusdc_impl(
    dusdc:      Coin<DUSDC>,
    min_shares: u64,
    collateral: std::option::Option<CollateralRecord>,
    debt:       std::option::Option<DebtRecord>,
    pref:       u8,
    pool:       &mut DepositPool,
    registry:   &mut ShareRegistry,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
): (VaultPosition, Coin<SHARE_TOKEN>) {
    assert!(!risk_params::paused(rp), EPaused);
    assert!(pref <= OUTPUT_SUI, EInvalidOutputPref);
    let dusdc_value = dusdc.value();
    pool.dusdc.join(dusdc.into_balance());
    let has_leverage = debt.is_some();
    let shares = share_token::mint_shares(registry, dusdc_value, min_shares, ctx);
    let shares_minted = shares.value();
    let pos = VaultPosition {
        id:               object::new(ctx),
        owner:            ctx.sender(),
        collateral,
        debt,
        shares_minted,
        deposit_ts_ms:    ctx.epoch_timestamp_ms(),
        preferred_output: pref,
    };
    let position_id = object::id(&pos);
    event::emit(Deposited {
        owner: ctx.sender(), position_id, dusdc_value, shares_out: shares_minted, has_leverage,
    });
    (pos, shares)
}

// ─── Test-only mock deposit variants ─────────────────────────────────────────

/// Mock USDC deposit using spot_router mock (1:1 swap).
#[test_only]
public fun deposit_usdc_mock(
    usdc:       Coin<USDC>,
    min_shares: u64,
    config:     &SpotRouterConfig,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
) {
    let dusdc = spot_router::usdc_to_dusdc_mock(config, usdc, 1, ctx);
    let (pos, shares) = deposit_dusdc_impl(
        dusdc, min_shares,
        std::option::none(), std::option::none(),
        OUTPUT_USDC, pool, registry, rp, ctx,
    );
    transfer::public_transfer(shares, ctx.sender());
    transfer::transfer(pos, ctx.sender());
}

/// Mock rfBTC deposit using spot_router mock (1:1 swap).
#[test_only]
public fun deposit_rfbtc_mock(
    rfbtc:      Coin<RFBTC>,
    min_shares: u64,
    config:     &SpotRouterConfig,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
) {
    let dusdc = spot_router::rfbtc_to_dusdc_mock(config, rfbtc, 1, ctx);
    let (pos, shares) = deposit_dusdc_impl(
        dusdc, min_shares,
        std::option::none(), std::option::none(),
        OUTPUT_ORIGINAL, pool, registry, rp, ctx,
    );
    transfer::public_transfer(shares, ctx.sender());
    transfer::transfer(pos, ctx.sender());
}

/// Mock vSUI deposit: converts LSD amount via supplied price_e9, optional leverage.
/// LSD coin is consumed (test-only destroy).
#[test_only]
public fun deposit_vsui_mock(
    vsui:          Coin<VSUI>,
    leverage_bps:  u64,
    price_e9:      u64,
    min_shares:    u64,
    registry:      &mut ShareRegistry,
    pool:          &mut DepositPool,
    rp:            &RiskParams,
    ctx:           &mut TxContext,
) {
    let lsd_amount    = vsui.value();
    let coll_val      = mul_div(lsd_amount, price_e9, 1_000_000_000);
    let borrow_dusdc  = if (leverage_bps > 0) { mul_div(coll_val, leverage_bps, 10_000) } else { 0 };

    if (borrow_dusdc > 0) {
        let ltv = leverage::compute_ltv_bps(lsd_amount, borrow_dusdc, price_e9);
        assert!(ltv <= risk_params::max_ltv_bps(rp), EBorrowExceedsMaxLtv);
    };

    let total_dusdc = coll_val + borrow_dusdc;
    let dusdc       = coin::mint_for_testing<DUSDC>(total_dusdc, ctx);

    let coll_rec = std::option::some(CollateralRecord {
        lsd_type:       b"vsui",
        lsd_amount,
        entry_price_e9: price_e9,
    });
    let debt_rec = if (borrow_dusdc > 0) {
        std::option::some(DebtRecord { debt_dusdc: borrow_dusdc })
    } else {
        std::option::none()
    };

    // Consume the LSD coin (mocked — no real custody in tests)
    sui::test_utils::destroy(vsui);

    let (pos, shares) = deposit_dusdc_impl(
        dusdc, min_shares,
        coll_rec, debt_rec,
        OUTPUT_ORIGINAL, pool, registry, rp, ctx,
    );
    transfer::public_transfer(shares, ctx.sender());
    transfer::transfer(pos, ctx.sender());
}

/// Same as `deposit_vsui_mock` but returns the position/shares instead of
/// transferring — for tests that need to hold both in the same call frame.
#[test_only]
public fun deposit_vsui_mock_returning(
    vsui:          Coin<VSUI>,
    leverage_bps:  u64,
    price_e9:      u64,
    min_shares:    u64,
    registry:      &mut ShareRegistry,
    pool:          &mut DepositPool,
    rp:            &RiskParams,
    ctx:           &mut TxContext,
): (VaultPosition, Coin<SHARE_TOKEN>) {
    let lsd_amount    = vsui.value();
    let coll_val      = mul_div(lsd_amount, price_e9, 1_000_000_000);
    let borrow_dusdc  = if (leverage_bps > 0) { mul_div(coll_val, leverage_bps, 10_000) } else { 0 };

    if (borrow_dusdc > 0) {
        let ltv = leverage::compute_ltv_bps(lsd_amount, borrow_dusdc, price_e9);
        assert!(ltv <= risk_params::max_ltv_bps(rp), EBorrowExceedsMaxLtv);
    };

    let total_dusdc = coll_val + borrow_dusdc;
    let dusdc       = coin::mint_for_testing<DUSDC>(total_dusdc, ctx);

    let coll_rec = std::option::some(CollateralRecord {
        lsd_type:       b"vsui",
        lsd_amount,
        entry_price_e9: price_e9,
    });
    let debt_rec = if (borrow_dusdc > 0) {
        std::option::some(DebtRecord { debt_dusdc: borrow_dusdc })
    } else {
        std::option::none()
    };

    sui::test_utils::destroy(vsui);

    deposit_dusdc_impl(
        dusdc, min_shares,
        coll_rec, debt_rec,
        OUTPUT_ORIGINAL, pool, registry, rp, ctx,
    )
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

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_pool_for_testing(ctx: &mut TxContext): DepositPool {
    DepositPool { id: object::new(ctx), dusdc: balance::zero<DUSDC>() }
}

#[test_only]
public fun destroy_pool_for_testing(p: DepositPool) {
    let DepositPool { id, dusdc } = p;
    std::unit_test::destroy(dusdc);
    id.delete();
}

#[test_only]
public fun destroy_position_for_testing(p: VaultPosition) {
    let VaultPosition { id, owner: _, collateral, debt, shares_minted: _,
                        deposit_ts_ms: _, preferred_output: _ } = p;
    let _ = collateral;
    let _ = debt;
    id.delete();
}

#[test_only]
public fun position_has_collateral(p: &VaultPosition): bool { p.collateral.is_some() }

#[test_only]
public fun position_has_debt(p: &VaultPosition): bool { p.debt.is_some() }

#[test_only]
public fun position_shares_minted(p: &VaultPosition): u64 { p.shares_minted }

#[test_only]
public fun output_usdc(): u8 { OUTPUT_USDC }
#[test_only]
public fun output_original(): u8 { OUTPUT_ORIGINAL }

#[test_only]
public fun pending_withdrawal_amount(pw: &PendingWithdrawal): u64 { pw.dusdc_amount }

#[test_only]
public fun destroy_pending_withdrawal_for_testing(pw: PendingWithdrawal) {
    let PendingWithdrawal { id, owner: _, dusdc_amount: _, claimable_after_roll: _ } = pw;
    id.delete();
}

/// Variant that returns objects instead of transferring to sender — for tests
/// where you need to hold the position and shares in the same call frame.
#[test_only]
public fun deposit_usdc_mock_returning(
    usdc:       Coin<USDC>,
    min_shares: u64,
    config:     &SpotRouterConfig,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
): (VaultPosition, Coin<SHARE_TOKEN>) {
    assert!(!risk_params::paused(rp), EPaused);
    let dusdc       = spot_router::usdc_to_dusdc_mock(config, usdc, 1, ctx);
    let dusdc_value = dusdc.value();
    pool.dusdc.join(dusdc.into_balance());
    let shares = share_token::mint_shares(registry, dusdc_value, min_shares, ctx);
    let shares_minted = shares.value();
    let pos = VaultPosition {
        id:               object::new(ctx),
        owner:            ctx.sender(),
        collateral:       std::option::none(),
        debt:             std::option::none(),
        shares_minted,
        deposit_ts_ms:    ctx.epoch_timestamp_ms(),
        preferred_output: OUTPUT_USDC,
    };
    (pos, shares)
}

/// Same as `deposit_usdc` (the real, non-mock production function — exercises
/// the actual `spot_router::usdc_to_dusdc` swap) but returns the position and
/// shares instead of transferring, so tests can assert on `preferred_output`.
#[test_only]
public fun deposit_usdc_returning(
    usdc:       Coin<USDC>,
    min_shares: u64,
    config:     &mut SpotRouterConfig,
    registry:   &mut ShareRegistry,
    pool:       &mut DepositPool,
    rp:         &RiskParams,
    ctx:        &mut TxContext,
): (VaultPosition, Coin<SHARE_TOKEN>) {
    let dusdc = spot_router::usdc_to_dusdc(config, usdc, 1, ctx);
    deposit_dusdc_impl(
        dusdc, min_shares,
        std::option::none(), std::option::none(),
        OUTPUT_USDC, pool, registry, rp, ctx,
    )
}

/// Seed the pool directly with minted dUSDC — for vault roll tests.
#[test_only]
public fun seed_pool_for_testing(pool: &mut DepositPool, amount: u64, ctx: &mut TxContext) {
    let coin = coin::mint_for_testing<DUSDC>(amount, ctx);
    pool.dusdc.join(coin.into_balance());
}

#[test_only]
public fun mint_dusdc_for_testing(amount: u64, ctx: &mut TxContext): Coin<DUSDC> {
    coin::mint_for_testing<DUSDC>(amount, ctx)
}

#[test_only]
public fun e_paused(): u64 { EPaused }
#[test_only]
public fun e_borrow_exceeds_max_ltv(): u64 { EBorrowExceedsMaxLtv }
#[test_only]
public fun e_zero_shares(): u64 { EZeroShares }
#[test_only]
public fun e_exceeds_position(): u64 { EExceedsPosition }
#[test_only]
public fun e_leveraged_no_partial(): u64 { ELeveragedNoPartial }
#[test_only]
public fun position_preferred_output(p: &VaultPosition): u8 { p.preferred_output }
