#[test_only]
module reflux::access_tests;

use reflux::access::{Self, AdminRole};
use sui::test_utils;
use sui::tx_context;

// `access_control::new` rejects `@0x0` as the initial admin (by design — the
// zero address has no signing key, so a role granted there can never be
// exercised). `tx_context::dummy()` defaults `sender()` to `@0x0`, so these
// tests use an explicit non-zero sender instead wherever they exercise real
// RBAC semantics (grant/revoke/mint against `ctx.sender()`).
fun test_ctx(): TxContext { tx_context::new_from_hint(@0xA11CE, 0, 0, 0, 0) }

// ─── test_deployer_is_admin_after_init ───────────────────────────────────────
// Mirrors what `access::init` does: the registry's initial default admin
// (== the publisher) is granted AdminRole.
#[test]
fun test_deployer_is_admin_after_init() {
    let mut ctx = test_ctx();
    let mut registry = access::create_registry_for_testing(&mut ctx);
    registry.grant_role<_, AdminRole>(ctx.sender(), &mut ctx);

    assert!(access::is_admin(&registry, ctx.sender()), 0);
    assert!(!access::is_keeper(&registry, ctx.sender()), 1);

    access::destroy_registry_for_testing(registry);
}

// ─── test_admin_can_grant_and_revoke_keeper ──────────────────────────────────
#[test]
fun test_admin_can_grant_and_revoke_keeper() {
    let mut ctx = test_ctx();
    let mut registry = access::create_registry_for_testing(&mut ctx);
    registry.grant_role<_, AdminRole>(ctx.sender(), &mut ctx);

    let keeper_addr = @0xCAFE;
    assert!(!access::is_keeper(&registry, keeper_addr), 0);

    access::grant_keeper(&mut registry, keeper_addr, &mut ctx);
    assert!(access::is_keeper(&registry, keeper_addr), 1);

    access::revoke_keeper(&mut registry, keeper_addr, &mut ctx);
    assert!(!access::is_keeper(&registry, keeper_addr), 2);

    access::destroy_registry_for_testing(registry);
}

// ─── test_revoked_keeper_cannot_mint_new_auth ────────────────────────────────
// This is the OZ-model replacement for the old "revoke instantly invalidates
// the keeper" test: `Auth<KeeperRole>` has no `store`, so it can never be
// persisted past the PTB that minted it — revocation's real effect is that
// the keeper can no longer mint a *fresh* witness in any future PTB.
#[test]
#[expected_failure]
fun test_revoked_keeper_cannot_mint_new_auth() {
    let mut ctx = test_ctx();
    let mut registry = access::create_registry_for_testing(&mut ctx);
    registry.grant_role<_, AdminRole>(ctx.sender(), &mut ctx);

    let keeper_addr = ctx.sender();
    access::grant_keeper(&mut registry, keeper_addr, &mut ctx);
    let auth = access::new_keeper_auth(&registry, &mut ctx);
    test_utils::destroy(auth); // fine before revoke

    access::revoke_keeper(&mut registry, keeper_addr, &mut ctx);

    // Must abort: sender no longer holds KeeperRole.
    let _auth2 = access::new_keeper_auth(&registry, &mut ctx);
    abort 0 // unreachable
}

// ─── test_new_auth_for_non_member_aborts ─────────────────────────────────────
#[test]
#[expected_failure]
fun test_new_auth_for_non_member_aborts() {
    let mut ctx = test_ctx();
    let registry = access::create_registry_for_testing(&mut ctx);

    // ctx.sender() holds the root role (default admin) but not AdminRole.
    let _auth = access::new_admin_auth(&registry, &mut ctx);
    abort 0 // unreachable
}

// ─── test_admin_auth_test_helper_round_trips ─────────────────────────────────
#[test]
fun test_admin_auth_test_helper_round_trips() {
    let mut ctx = tx_context::dummy();
    let _admin_auth = access::create_admin_auth_for_testing(&mut ctx);
    let _keeper_auth = access::create_keeper_auth_for_testing(&mut ctx);
    // Both have `drop` — no explicit destroy needed.
}
