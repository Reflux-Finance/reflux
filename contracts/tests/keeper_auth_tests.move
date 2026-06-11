#[test_only]
module reflux::keeper_auth_tests;

use reflux::keeper_auth;
use reflux::risk_params;

// ─── test_keeper_revoke_blocks_assert ────────────────────────────────────────
#[test]
#[expected_failure(abort_code = keeper_auth::EKeeperRevoked)]
fun test_keeper_revoke_blocks_assert() {
    let mut ctx = sui::tx_context::dummy();
    let admin = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut auth = keeper_auth::create_for_testing(&mut ctx);

    // Should pass before revoke
    keeper_auth::assert_authorized(&auth);

    // Revoke
    keeper_auth::revoke(&admin, &mut auth);

    // Must abort
    keeper_auth::assert_authorized(&auth);

    abort 0 // unreachable
}

// ─── test_active_before_revoke ───────────────────────────────────────────────
#[test]
fun test_active_before_revoke() {
    let mut ctx = sui::tx_context::dummy();
    let auth = keeper_auth::create_for_testing(&mut ctx);
    assert!(keeper_auth::is_active(&auth), 0);
    keeper_auth::destroy_for_testing(auth);
}

// ─── test_inactive_after_revoke ──────────────────────────────────────────────
#[test]
fun test_inactive_after_revoke() {
    let mut ctx = sui::tx_context::dummy();
    let admin  = risk_params::create_admin_cap_for_testing(&mut ctx);
    let mut auth = keeper_auth::create_for_testing(&mut ctx);

    keeper_auth::revoke(&admin, &mut auth);
    assert!(!keeper_auth::is_active(&auth), 0);

    keeper_auth::destroy_for_testing(auth);
    risk_params::destroy_admin_cap_for_testing(admin);
}
