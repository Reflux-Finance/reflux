# INTEGRATION_NOTES — Phase 0 De-risking

Source of truth for every external signature Reflux depends on.
Captured **2026-06-11** from `MystenLabs/deepbookv3` @ branch
**`predict-testnet-4-16`** (shallow clone at `~/deepbookv3-predict`, sibling of
this repo) and the live testnet indexer.

---

## 1. DeepBook Predict — verbatim Move signatures

All quotes below are copied verbatim from
`packages/predict/sources/` at branch `predict-testnet-4-16`.

### 1.1 `predict::create_manager` (predict.move:192)

```move
public fun create_manager(ctx: &mut TxContext): ID {
    let manager_id = predict_manager::new(ctx);
```

`predict_manager::new` is `public(package)`; it sets
`owner = ctx.sender()` and **shares** the `PredictManager` object
(predict_manager.move:88–110). The returned `ID` is the shared object's ID.

### 1.2 `predict::mint` (predict.move:219)

```move
public fun mint<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
```

Aborts: `ENotOwner` unless `ctx.sender() == manager.owner()`;
`ETradingPaused`; `EZeroQuantity`; quote-asset check; oracle/key match;
live-oracle check. Cost is withdrawn from the manager's balance at the
**post-trade ask**. Emits `PositionMinted`.

### 1.3 `predict::mint_range` (predict.move:331)

```move
public fun mint_range<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: RangeKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
```

Same guards as `mint`. Range premium only is paid up front. Emits
`RangeMinted { predict_id, manager_id, trader, quote_asset, oracle_id,
expiry, lower_strike, higher_strike, quantity, cost, ask_price }`.

### 1.4 `predict::redeem_permissionless` (predict.move:300)

```move
public fun redeem_permissionless<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
```

Aborts `EOracleNotSettled` unless `oracle.is_settled()`. Payout goes into
the manager via `deposit_permissionless` — **any address may call this
after settlement** (our trustless-exit lever).

### 1.5 `predict::redeem_range` (predict.move:380) — owner-gated

```move
public fun redeem_range<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: RangeKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
```

Pre-settlement: pays post-trade bid. Post-settlement: pays `$1·qty` if
settlement landed in `(lower, higher]`. **There is no permissionless range
redeem in this branch** — range exits require the manager owner as sender.

### 1.6 `predict::supply` (PLP entry — predict.move:437)

```move
public fun supply<Quote>(
    predict: &mut Predict,
    coin: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<PLP> {
```

First depositor 1:1; then `shares = amount * total / vault_value`
(round-down). Emits `Supplied { predict_id, supplier, quote_asset, amount,
shares_minted }`. `PLP` is the OTW coin in
`packages/predict/sources/vault/plp.move` (`module deepbook_predict::plp`).

### 1.7 ⚠️ `predict::redeem_supply` DOES NOT EXIST — it is `withdraw`

the actual exit in this branch is:

```move
public fun withdraw<Quote>(
    predict: &mut Predict,
    lp_coin: Coin<PLP>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Quote> {
```

Constraints that shape our buffer math:
- payout capped by `available = balance - total_max_payout` —
  aborts `EWithdrawExceedsAvailable` above it;
- a `withdrawal_limiter` rate-limits outflows (`consume(amount, clock)`).
  PLP liquidity is therefore **not** instant under stress → Iron-Bank/reserve
  buffer remains the instant-exit source, never PLP.

### 1.8 Market keys

```move
// market_key.move:40
public fun new(oracle_id: ID, expiry: u64, strike: u64, is_up: bool): MarketKey {
// range_key.move:28
public fun new(oracle_id: ID, expiry: u64, lower_strike: u64, higher_strike: u64): RangeKey {
```

### 1.9 `PredictManager` (predict_manager.move:31)

```move
public struct PredictManager has key {
    id: UID,
    owner: address,
    balance_manager: BalanceManager,
    deposit_cap: DepositCap,
    withdraw_cap: WithdrawCap,
    positions: Table<MarketKey, u64>,
    range_positions: Table<RangeKey, u64>,
}

public fun deposit<T>(self: &mut PredictManager, coin: Coin<T>, ctx: &TxContext) {
public fun withdraw<T>(self: &mut PredictManager, amount: u64, ctx: &mut TxContext): Coin<T> {
```

Both assert `ctx.sender() == self.owner` (`EInvalidOwner`).

### 1.10 🔴 CRITICAL CONSTRAINT — owner == tx sender everywhere

`mint`, `mint_range`, `redeem`, `redeem_range`, `deposit`, `withdraw` all
require **`ctx.sender() == manager.owner()`**, and `owner` is fixed to the
address that called `create_manager`. A Move contract cannot be a sender, so:

- The Reflux **keeper address must create and own the vault's
  `PredictManager`**; every roll PTB is signed by the keeper.
- The vault contract cannot custody Predict positions directly; it custodies
  dUSDC + rfUSD accounting, and verifies roll effects via events/state.
- Trustless paths available without the keeper: `redeem_permissionless`
  (settled binaries) and PLP `supply`/`withdraw` (any sender holding the
  `Coin<PLP>` — the **vault can hold `Coin<PLP>` itself**).

This must be reflected in Phase B contract design (vault treats the Predict
sleeve as keeper-operated with on-chain verification, not direct custody).

### 1.11 Oracle events (oracle.move)

```move
public struct OracleSettled has copy, drop, store {
    oracle_id: ID,
    expiry: u64,
    settlement_price: u64,
    timestamp: u64,
}
public struct OracleSVIUpdated has copy, drop, store {
    oracle_id: ID,
    a: u64,
    b: u64,
    rho: i64::I64,
    m: i64::I64,
    sigma: u64,
    timestamp: u64,
}
```

Settlement is emitted from `update_prices` (oracle.move:139–170): the first
price push at/after expiry freezes `settlement_price = prices.spot`,
deactivates the oracle, and emits `OracleSettled`. SVI pushes:

```move
public fun update_svi(oracle: &mut OracleSVI, cap: &OracleSVICap, svi: SVIParams, clock: &Clock) {
```

`SVIParams { a: u64, b: u64, rho: I64, m: I64, sigma: u64 }`; prices in
`PriceData { spot, forward }` scaled **1e9** (`FLOAT_SCALING`).

---

## 2. Predict indexer — REAL routes (CLAUDE.md paths are stale)

Base: `https://predict-server.testnet.mystenlabs.com` — verified live
2026-06-11 (HTTP 200). Routes confirmed from
`crates/predict-server/src/server.rs:41-69`:

| Purpose | ACTUAL route |
|---|---|---|
| List oracles | `/oracles` | `/oracles` ✅ |
| SVI params | `/oracle/{id}/svi` ❌ 404 | `/oracles/{id}/svi` (history), `/oracles/{id}/svi/latest` |
| Positions | `/positions?manager={id}` ❌ 404 | `/managers/{id}/positions` (also `/summary`, `/ranges`, `/pnl`) |
| Prices | — | `/oracles/{id}/prices`, `/oracles/{id}/prices/latest` |
| Oracle state | — | `/oracles/{id}/state`, `/oracles/{id}/ask-bounds` |
| PLP | — | `/lp/supplies`, `/lp/withdrawals`, `/predicts/{id}/vault/summary`, `/predicts/{id}/vault/performance` |
| Trades / mints | — | `/trades/{oracle_id}`, `/positions/minted`, `/positions/redeemed`, `/ranges/minted`, `/ranges/redeemed` |
| Misc | — | `/health`, `/status`, `/config`, `/managers`, `/predicts/{id}/state`, `/predicts/{id}/quote-assets`, `/predicts/{id}/oracles` |

### 2.1 SVI response schema (captured: `docs/fixtures/svi-latest.json`)

```json
{
  "event_digest": "9i6bfyQjSWXa51zw4CkvMvtGpdhB2NRbon4gH2faRxkg35",
  "digest": "9i6bfyQjSWXa51zw4CkvMvtGpdhB2NRbon4gH2faRxkg",
  "sender": "0xcca26f7ae2e40604498294e95bacccc4652cc8cb2aa074d7ee608c7e7bdf0c29",
  "checkpoint": 347084433,
  "checkpoint_timestamp_ms": 1781174982826,
  "tx_index": 5,
  "event_index": 35,
  "package": "f5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138",
  "oracle_id": "0xb5464234b8482767e24bb82a24cf46a202560cb5c5d99629bcdbd6cdea922552",
  "a": 34396,
  "b": 440408,
  "rho": 940166948,
  "rho_negative": true,
  "m": 2371202,
  "m_negative": true,
  "sigma": 2239762,
  "onchain_timestamp": 1781174982758
}
```

**Scaling/encoding rules** (drive `lib/risk/svi.ts`):
- all SVI magnitudes and prices are scaled **1e9** (`FLOAT_SCALING`);
- signed params (`rho`, `m`) are emitted as magnitude + `*_negative: bool`
  (the on-chain type is `i64::I64`) — the zod schema must recombine them;
- `spot`/`forward` (fixture `price-latest.json`): `62899160803391` ≙
  $62,899.16 BTC;
- staleness: compare `onchain_timestamp` (ms) against
  `max_svi_staleness_ms` from `RiskParams`.

### 2.2 Captured fixtures (checked in under `docs/fixtures/`)

| File | Endpoint |
|---|---|
| `oracles.json` | `GET /oracles` |
| `svi-latest.json` | `GET /oracles/{id}/svi/latest` |
| `price-latest.json` | `GET /oracles/{id}/prices/latest` |
| `managers.json` | `GET /managers?limit=2` |
| `manager-positions.json` | `GET /managers/{id}/positions` → `{"minted":[],"redeemed":[]}` |
| `config.json` | `GET /config` |

### 2.3 Live testnet IDs discovered (verify at deploy time, then move to .env)

| Constant | Value |
|---|---|
| Predict package | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` |
| `Predict` shared object (`predict_id`) | `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a` |
| dUSDC type | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |
| Active BTC oracle (expiry 1781181900000) | `0xb5464234b8482767e24bb82a24cf46a202560cb5c5d99629bcdbd6cdea922552` |

---

## 3. DeepBook Margin (for `leverage.move`, Phase B)

Package `packages/deepbook_margin/` exists on this branch. Key entries in
`margin_manager.move` (signatures to be quoted verbatim in Phase B before
wiring): `borrow_base<BaseAsset, QuoteAsset>` (:558),
`borrow_quote<…>` (:602), `repay_base<…>` (:647), `repay_quote<…>` (:669),
share accessors `borrowed_shares/borrowed_base_shares/borrowed_quote_shares`
(:1100–1112). Until then `leverage.move` codes against a local interface
(`// EXTERNAL-PENDING`).

---

## 4. Decision records

### DR-1 — USDC ↔ dUSDC conversion path · **DECISION: PENDING**

**Evidence gathered:**
- `packages/dusdc/sources/dusdc.move` is a **plain test coin**: OTW
  `DUSDC`, 6 decimals, "Test USDC token for testnet use only", with
  `TreasuryCap` transferred to the deployer. **There is no wrap/unwrap
  module** — a canonical USDC↔dUSDC wrap does not exist in this branch.
- Distribution is via the manual faucet form (`https://tally.so/r/Xx102L`).

**Candidate A — SpotPoolVenue (likely):** swap USDC↔dUSDC on a DeepBook
Spot pool. *Open item for Telegram: does a canonical USDC/DUSDC spot pool
exist on testnet, and what is its pool ID?* (`NEXT_PUBLIC_USDC_DUSDC_POOL`).

**Candidate B — WrapVenue (effectively dead):** kept as the second
`ConversionVenue` impl only until DR-1 is confirmed, then deleted.

**Interface we code behind:** `spot_router.move` exposes
`usdc_to_dusdc/dusdc_to_usdc` over a `ConversionVenue` with both impls;
deposit/withdraw paths must not care which venue is active.

### DR-2 — Iron Bank contract-caller access · **DECISION: PENDING**

**Evidence gathered:** there is **no `iron_bank` package anywhere in
`deepbookv3@predict-testnet-4-16`** (`grep -ri iron_bank` over .move/.toml/.md
→ zero hits). "USDsui" appears only in margin-pool admin scripts
(`scripts/transactions/marginPrep.ts` registers a SUI_USDSUI margin pool).
Iron Bank is either a separate unpublished repo or accessed purely as a
deployed package — its permissioned USDsui supply for *contract* callers is
unverifiable from source today.

**Consequence:** `ib_credit.move` codes against the `LiquiditySource`
interface with **`ReserveSleeveSource` as the working default** (reserved
dUSDC sleeve, `reserve_weight_bps`) and `IronBankSource` stubbed
(`// EXTERNAL-PENDING`). The two user guarantees (idle funds earn; instant
exits under the buffer cap) are identical under either backing. *Open item
for Telegram: iron_bank repo/package ID + whether `supply` admits a
non-EOA caller.*

---

## 5. deepbook-sandbox bring-up

Cloned to `~/deepbook-sandbox`. One-line bring-up (from its README):

```bash
git clone --recurse-submodules https://github.com/MystenLabs/deepbook-sandbox.git \
  && cd deepbook-sandbox/sandbox && pnpm install && pnpm deploy-all --quick
```

Services after `DeepBook Sandbox Ready!`: localnet RPC :9000, faucet :9123,
oracle service :9010, market maker :3001, DeepBook faucet :9009, REST API
:9008, dashboard :5173, Postgres :5432.

**Deviations recorded this session:**
- our clone was shallow **without** `--recurse-submodules` (DeepBook source
  is a submodule — run `git submodule update --init` before deploying);
- Docker daemon (OrbStack) was not running, so `pnpm deploy-all` was **not
  executed**; prerequisites per README: Docker w/ ≥8 GB, Node 18+, pnpm,
  Sui CLI 1.63.2–1.64.1 (local CLI is 1.73.0 — version skew to watch);
- first run compiles indexer/server from source (slow); `--quick` uses
  pre-built Docker Hub images.

---

## 6. Other constraints worth carrying into Phase B

- `supply`/PLP exit math: shares are minted round-**down** for the supplier
  (system-favoring — matches our own share-math convention).
- `withdraw<Quote>` can pay out in **any** quote asset with concrete vault
  balance, even one disabled for inflows.
- `predict.trade_prices` quotes **post-trade** state on both mint and redeem
  (traders pay for the liability they add) — our sim must replicate this.
- `compact_settled_oracle` is operator-only housekeeping; ignore.
- Oracle cadence: prices ~1 s, SVI ~10–20 s (comments in oracle.move).
