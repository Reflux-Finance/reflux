/// Module 5 — staking_adapter: SUI → LSD staking and queued exit receipts.
///
/// All LSP pool calls are EXTERNAL-PENDING (the real Volo / Aftermath / Haedal
/// pool object IDs are not yet in Move.toml).  The public interface is stable;
/// only the internal implementation will change when deps land.
///
/// Key types:
///   WithdrawalReceipt — issued on unstake; redeemable only after
///                       `redeemable_after_epoch` to enforce the LSP unbonding delay.
module reflux::staking_adapter;

use reflux::types::{VSUI, AFSUI, HASUI};
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

// ─── Error codes ─────────────────────────────────────────────────────────────

const EEpochNotReached:  u64 = 0;
const EExternalPending:  u64 = 99; // EXTERNAL-PENDING: remove when LSP deps wired

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Proof-of-unstake issued to the user.  Holds the SUI to be released once the
/// LSP unbonding period elapses.
///
/// In the mock implementation `sui_balance` is zero; when real LSP calls land
/// this holds the actual SUI committed by the protocol.  The epoch check
/// enforces the invariant regardless.
public struct WithdrawalReceipt has key {
    id:                     UID,
    sui_amount:             u64,
    redeemable_after_epoch: u64,
    sui_balance:            Balance<sui::sui::SUI>,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct StakeInitiated has copy, drop {
    lsp:        vector<u8>, // b"volo" | b"aftermath" | b"haedal"
    sui_in:     u64,
}

public struct UnstakeQueued has copy, drop {
    lsp:                    vector<u8>,
    lsd_amount:             u64,
    redeemable_after_epoch: u64,
}

public struct ReceiptRedeemed has copy, drop {
    receipt_id: ID,
    sui_amount: u64,
    epoch:      u64,
}

// ─── Staking (SUI → LSD) — EXTERNAL-PENDING ──────────────────────────────────

/// EXTERNAL-PENDING: wire to Volo staking pool once Move.toml dep is confirmed.
public fun stake_to_vsui(
    _sui:  Coin<sui::sui::SUI>,
    _ctx:  &mut TxContext,
): Coin<VSUI> {
    // EXTERNAL-PENDING: volo_liquid_staking::request_stake(sui_pool, sui)
    abort EExternalPending
}

/// EXTERNAL-PENDING: wire to Aftermath staking pool.
public fun stake_to_afsui(
    _sui:  Coin<sui::sui::SUI>,
    _ctx:  &mut TxContext,
): Coin<AFSUI> {
    abort EExternalPending
}

/// EXTERNAL-PENDING: wire to Haedal staking pool.
public fun stake_to_hasui(
    _sui:  Coin<sui::sui::SUI>,
    _ctx:  &mut TxContext,
): Coin<HASUI> {
    abort EExternalPending
}

// ─── Unstaking (LSD → WithdrawalReceipt) — EXTERNAL-PENDING ──────────────────

/// EXTERNAL-PENDING: call Volo's queued-unstake entry and obtain the real
/// unbonding epoch.  Aborts until the Volo dep is wired in Move.toml.
public fun unstake_vsui(
    _vsui: Coin<VSUI>,
    _ctx:  &mut TxContext,
): WithdrawalReceipt {
    // EXTERNAL-PENDING: volo_liquid_staking::request_unstake(_vsui)
    abort EExternalPending
}

public fun unstake_afsui(
    _afsui: Coin<AFSUI>,
    _ctx:   &mut TxContext,
): WithdrawalReceipt {
    abort EExternalPending
}

public fun unstake_hasui(
    _hasui: Coin<HASUI>,
    _ctx:   &mut TxContext,
): WithdrawalReceipt {
    abort EExternalPending
}

// ─── Redemption ───────────────────────────────────────────────────────────────

/// Burn a `WithdrawalReceipt` and release SUI.  Aborts before the unbonding
/// epoch regardless of the implementation backing.
///
/// In the current mock the returned coin is zero-value; once real LSP calls land
/// the `sui_balance` inside the receipt will carry the actual SUI.
public fun redeem_receipt(receipt: WithdrawalReceipt, ctx: &mut TxContext): Coin<sui::sui::SUI> {
    let receipt_id = object::id(&receipt);
    let WithdrawalReceipt { id, sui_amount, redeemable_after_epoch, sui_balance } = receipt;
    assert!(ctx.epoch() >= redeemable_after_epoch, EEpochNotReached);
    let out = coin::from_balance(sui_balance, ctx);
    event::emit(ReceiptRedeemed { receipt_id, sui_amount, epoch: ctx.epoch() });
    id.delete();
    out
}

// Read accessors
public fun sui_amount(r: &WithdrawalReceipt): u64             { r.sui_amount }
public fun redeemable_after_epoch(r: &WithdrawalReceipt): u64 { r.redeemable_after_epoch }

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_receipt_for_testing(
    sui_amount:             u64,
    redeemable_after_epoch: u64,
    ctx:                    &mut TxContext,
): WithdrawalReceipt {
    WithdrawalReceipt {
        id:                     object::new(ctx),
        sui_amount,
        redeemable_after_epoch,
        sui_balance:            balance::zero<sui::sui::SUI>(),
    }
}
