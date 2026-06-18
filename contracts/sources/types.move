/// Stub coin-type witnesses for assets not yet deployed on Sui testnet.
///
/// Live types (wired via Move.toml deps + address overrides):
///   USDC  → 0xa1ec7fc00...::usdc::USDC   (Circle canonical USDC)
///   DUSDC → 0xe95040085...::dusdc::DUSDC  (DeepBook synthetic stable)
///   AFSUI → 0x5783fa229...::afsui::AFSUI  (Aftermath Finance testnet afSUI)
///
/// Remaining stubs (no testnet deployment found):
///   VSUI  — Volo vSUI is mainnet-only; stub until testnet is live
///   HASUI — Haedal haSUI is mainnet-only; stub until testnet is live
///   BTC   — Replace with dbtc::dbtc::DBTC once deepbookv3/packages/dbtc deploys on testnet
module reflux::types;

// vSUI (Volo): mainnet 0x549e8b69...::cert::CERT — no testnet deployment found
public struct VSUI  has drop {}
// haSUI (Haedal): mainnet 0xbde4ba4c...::hasui::HASUI — no testnet deployment found
public struct HASUI has drop {}
// BTC: swap to dbtc::dbtc::DBTC when deps/dbtc skeleton gets a real published-at address
public struct BTC   has drop {}
