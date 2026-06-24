/// Module 1 — access: central role-based access control, built on
/// OpenZeppelin's `access_control` (see contracts/deps/openzeppelin_access).
///
/// Replaces the bespoke `AdminCap` (a freely-transferable owned object) and
/// `KeeperAuth` (a shared object with a live `active` flag) with one shared
/// `AccessControl<ACCESS>` registry and two roles minted from it:
///
///   AdminRole  — day-to-day governance: risk-param proposals, pause,
///                pool bootstrap, allocator policy updates.
///   KeeperRole — the off-chain keeper service: `vault::roll_positions`.
///
/// `ACCESS` itself is the root role. It is intentionally never used directly
/// by business logic — only to govern the registry (grant/revoke AdminRole
/// and KeeperRole, transfer or renounce the root role itself). This mirrors
/// the idiomatic usage pattern documented in `access_control.move`.
///
/// Gated entry points across the package take `&Auth<AdminRole>` or
/// `&Auth<KeeperRole>` directly and perform no body check — the type itself
/// is the proof (an `Auth<Role>` can only be minted by `new_auth` against the
/// unique registry rooted at `Role`'s home module, i.e. this one). Callers
/// mint the witness from the shared registry earlier in the same PTB:
///
///   let auth = access::new_admin_auth(&registry, ctx);
///   risk_params::pause(&auth, &mut risk_params);
///
/// `Auth<Role>` has `drop` only (no `store`/`key`), so it cannot be persisted
/// across transactions — a revoked role genuinely blocks all *future* PTBs
/// (the keeper or admin can no longer mint a fresh witness), even though an
/// already-minted witness remains valid for the remainder of the PTB that
/// minted it.
module reflux::access;

use openzeppelin_access::access_control::{Self, AccessControl, Auth};

// ─── Roles ───────────────────────────────────────────────────────────────────

/// One-time witness; also the root role. Governance-only — see module docs.
public struct ACCESS has drop {}

/// Day-to-day protocol admin.
public struct AdminRole has drop {}

/// Off-chain keeper service.
public struct KeeperRole has drop {}

// ─── Constants ───────────────────────────────────────────────────────────────

/// 24 h timelock on root-role transfer/renounce — matches the soft-param
/// timelock convention used elsewhere (risk_params, allocator).
const ROOT_TRANSFER_DELAY_MS: u64 = 86_400_000;

// ─── Init ────────────────────────────────────────────────────────────────────

fun init(otw: ACCESS, ctx: &mut TxContext) {
    let mut registry = access_control::new(otw, ROOT_TRANSFER_DELAY_MS, ctx);
    registry.grant_role<_, AdminRole>(ctx.sender(), ctx);
    transfer::public_share_object(registry);
}

// ─── Auth minting ────────────────────────────────────────────────────────────

/// Mint an `Auth<AdminRole>` for the transaction sender. Aborts if the
/// sender does not currently hold `AdminRole`.
public fun new_admin_auth(registry: &AccessControl<ACCESS>, ctx: &mut TxContext): Auth<AdminRole> {
    access_control::new_auth<ACCESS, AdminRole>(registry, ctx)
}

/// Mint an `Auth<KeeperRole>` for the transaction sender. Aborts if the
/// sender does not currently hold `KeeperRole`.
public fun new_keeper_auth(registry: &AccessControl<ACCESS>, ctx: &mut TxContext): Auth<KeeperRole> {
    access_control::new_auth<ACCESS, KeeperRole>(registry, ctx)
}

// ─── Role management ──────────────────────────────────────────────────────────
//
// `grant_role` / `revoke_role` already self-gate on `ctx.sender()` against the
// role's admin (root, by default, for both AdminRole and KeeperRole below) —
// no extra `Auth` parameter is needed here. These are thin, type-concrete
// wrappers so callers (PTBs, the keeper bootstrap script) don't need to spell
// out `openzeppelin_access::access_control::grant_role<ACCESS, AdminRole>`.

public fun grant_admin(registry: &mut AccessControl<ACCESS>, account: address, ctx: &mut TxContext) {
    registry.grant_role<_, AdminRole>(account, ctx);
}

public fun revoke_admin(registry: &mut AccessControl<ACCESS>, account: address, ctx: &mut TxContext) {
    registry.revoke_role<_, AdminRole>(account, ctx);
}

public fun grant_keeper(registry: &mut AccessControl<ACCESS>, account: address, ctx: &mut TxContext) {
    registry.grant_role<_, KeeperRole>(account, ctx);
}

public fun revoke_keeper(registry: &mut AccessControl<ACCESS>, account: address, ctx: &mut TxContext) {
    registry.revoke_role<_, KeeperRole>(account, ctx);
}

// ─── Read accessors ───────────────────────────────────────────────────────────

public fun is_admin(registry: &AccessControl<ACCESS>, account: address): bool {
    access_control::has_role<ACCESS, AdminRole>(registry, account)
}

public fun is_keeper(registry: &AccessControl<ACCESS>, account: address): bool {
    access_control::has_role<ACCESS, KeeperRole>(registry, account)
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_registry_for_testing(ctx: &mut TxContext): AccessControl<ACCESS> {
    access_control::new(ACCESS {}, ROOT_TRANSFER_DELAY_MS, ctx)
}

#[test_only]
public fun destroy_registry_for_testing(registry: AccessControl<ACCESS>) {
    sui::test_utils::destroy(registry);
}

/// `access_control::new` rejects `@0x0` as the initial admin, but
/// `sui::tx_context::dummy()` (used pervasively by other modules' test
/// helpers) defaults `sender()` to `@0x0`. These throwaway-Auth helpers
/// sidestep that by minting against a self-contained, non-zero-sender
/// context instead of the caller's — the caller's `ctx` parameter is kept
/// only so call sites elsewhere don't need a second context just for this.
#[test_only]
const TEST_SENDER: address = @0xACCE55;

/// Spins up a throwaway registry, grants `AdminRole` to a fixed test sender,
/// mints the witness, and discards the registry — for tests that only need
/// an `Auth<AdminRole>` and don't care about registry lifecycle or identity.
#[test_only]
public fun create_admin_auth_for_testing(_ctx: &mut TxContext): Auth<AdminRole> {
    let mut test_ctx = sui::tx_context::new_from_hint(TEST_SENDER, 0, 0, 0, 0);
    let mut registry = create_registry_for_testing(&mut test_ctx);
    registry.grant_role<_, AdminRole>(TEST_SENDER, &mut test_ctx);
    let auth = new_admin_auth(&registry, &mut test_ctx);
    destroy_registry_for_testing(registry);
    auth
}

/// Same as `create_admin_auth_for_testing`, for `KeeperRole`.
#[test_only]
public fun create_keeper_auth_for_testing(_ctx: &mut TxContext): Auth<KeeperRole> {
    let mut test_ctx = sui::tx_context::new_from_hint(TEST_SENDER, 0, 0, 0, 0);
    let mut registry = create_registry_for_testing(&mut test_ctx);
    registry.grant_role<_, KeeperRole>(TEST_SENDER, &mut test_ctx);
    let auth = new_keeper_auth(&registry, &mut test_ctx);
    destroy_registry_for_testing(registry);
    auth
}
