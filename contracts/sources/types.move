/// Stub coin-type witnesses for external assets.
///
/// EXTERNAL-PENDING: each type here must be replaced with the real import once
/// the corresponding package is added to Move.toml (see CLAUDE.md §External deps
/// and docs/INTEGRATION_NOTES.md DR-1/DR-2).
///
/// Deletion checklist:
///   USDC  — replace with canonical Sui USDC type
///   DUSDC — replace with 0xe95040...::dusdc::DUSDC (testnet ID in INTEGRATION_NOTES §2.3)
///   BTC   — Tier-3 asset; add when BTC path is wired (never before Tier 1+2 gates pass)
///   VSUI  — replace with Volo vSUI type
///   AFSUI — replace with Aftermath afSUI type
///   HASUI — replace with Haedal haSUI type
module reflux::types;

public struct USDC  has drop {}
public struct DUSDC has drop {}
public struct BTC   has drop {}
public struct VSUI  has drop {}
public struct AFSUI has drop {}
public struct HASUI has drop {}
