/// Module 2 — KeeperAuth: revocable capability for the keeper service.
///
/// The admin creates one `KeeperAuth` shared object per keeper address.
/// The keeper passes it (by shared reference) to every gated entry point.
/// Revocation is instant: admin flips `active = false` on the shared object;
/// the next keeper call will abort.
module reflux::keeper_auth;

use reflux::risk_params::AdminCap;
use sui::event;

// ─── Error codes ─────────────────────────────────────────────────────────────

const EKeeperRevoked: u64 = 0;

// ─── Structs ─────────────────────────────────────────────────────────────────

/// Shared capability object held (by reference) by keepers.
public struct KeeperAuth has key {
    id: UID,
    active: bool,
}

// ─── Events ──────────────────────────────────────────────────────────────────

public struct KeeperAuthCreated  has copy, drop { auth_id: ID }
public struct KeeperAuthRevoked  has copy, drop { auth_id: ID }

// ─── Public functions ─────────────────────────────────────────────────────────

/// Admin creates and shares a new `KeeperAuth`.  Returns the object ID so
/// the keeper can look it up on-chain.
public fun create(_: &AdminCap, ctx: &mut TxContext): ID {
    let auth = KeeperAuth { id: object::new(ctx), active: true };
    let id   = object::id(&auth);
    event::emit(KeeperAuthCreated { auth_id: id });
    transfer::share_object(auth);
    id
}

/// Admin sets `active = false`.  Subsequent `assert_authorized` calls will abort.
public fun revoke(_: &AdminCap, auth: &mut KeeperAuth) {
    auth.active = false;
    event::emit(KeeperAuthRevoked { auth_id: object::id(auth) });
}

/// Asserts the auth has not been revoked.  Call at the top of every keeper-
/// gated entry point.
public fun assert_authorized(auth: &KeeperAuth) {
    assert!(auth.active, EKeeperRevoked);
}

public fun is_active(auth: &KeeperAuth): bool { auth.active }

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): KeeperAuth {
    KeeperAuth { id: object::new(ctx), active: true }
}

#[test_only]
public fun destroy_for_testing(auth: KeeperAuth) {
    let KeeperAuth { id, active: _ } = auth;
    id.delete();
}
