# Reflux — Structured Yield OS for Sui

> "A dUSDC-native capital system that converts any Sui asset into structured
> volatility and staking yield across DeepBook Predict, Margin, and Iron Bank."

**Sui Overflow 2026 · DeepBook Predict track**

Capital on Sui is parked, not working: **$2B** of Sui DeFi TVL sits mostly
passive, **>2/3 of SUI supply is staked** at a ~2.5% APY ceiling with nothing
built on top of it, and **0 products** route SUI + USDC + BTC into structured
volatility yield. Reflux is the routing layer that's missing — one deposit,
one allocation engine, one yield share.

---

## Real-World Application 

### Capital on Sui is parked, not working

- **Staked SUI hits a ceiling.** Most of SUI's supply is staked — then earns
  ~2.5% base APY and stops. No structured layer exists on top of it.
- **Stablecoins & BTC sit idle.** USDC and BTC holders on Sui have no route
  into volatility yield without running a trading desk.
- **Prediction markets are shallow.** Binary, slow-settling event venues —
  no vol surface, no strikes, no ranges, nothing for quant strategies to
  build on.

### What problem does Reflux solve?

Sophisticated DeFi yield today requires manual coordination across multiple
protocols: independently managing PLP liquidity, range-strip positions,
margin collateral, and idle parking, each with a different interface, risk
exposure, and settlement cycle. Most users can't do this, and even
experienced operators spend disproportionate time rebalancing and miss
windows when the volatility shifts.

Reflux is a **structured yield operating system**: deposit an asset you
already hold, and a intelligent allocator routes capital dynamically across:

| Venue | Role | Status |
|---|---|---|
| **DeepBook Predict PLP** (`predict::supply` / `withdraw`) | Long-vega base yield; earns from realised > implied vol | **Live** — keeper-signed PTBs call the real testnet Predict package every roll |
| **DeepBook Predict range strips** (`predict::mint` / `redeem_permissionless`) | Theta-positive structured positions; earns near-ATM vol | PTB builders implemented + unit-tested; looped by the keeper's automated roll |
| **DeepBook Margin** | Leverage against LSD collateral | Interface-staged (`leverage.move`) behind `EXTERNAL-PENDING` until DeepBook Margin entry points are confirmed 
| **Internal liquidity sleeve** (`ib_credit.move`) | Parks idle dUSDC so it always earns; funds instant exits under the buffer cap | **Live** as a reserved-dUSDC sleeve; swaps to a real Iron Bank backing transparently.
| **Internal spot router** (`spot_router.move`) | USDC ↔ dUSDC, SUI ↔ dUSDC, rfBTC ↔ dUSDC conversion | **Live** — self-funded treasury + CPAMM pools, deployed and tradable on testnet today |

Every allocation decision is machine-legible and human-readable
simultaneously — emitted as an `AllocationDecision` event with IV trigger,
regime, reason code, and before/after weights. The frontend renders these as
plain-language cards linked to the on-chain event.

### Who uses it?

- **Passive depositors** who want structured yield without managing
  individual positions. Deposit USDC (or SUI, or a testnet BTC bridge asset),
  receive **rfUSD** — a single transferable yield-share token — and withdraw
  any time.
- **DeFi treasuries and DAOs** holding stablecoins or staked SUI that want
  automated allocation across DeepBook's volatility venues without running a
  trading desk.
- **Researchers and operators** who want to inspect on-chain intelligent decisions in real time via the public risk dashboard.

### Why now?

DeepBook Predict is a novel on-chain options primitive with no structured
yield layer built on top of it yet. Reflux is the first protocol to route
capital intelligently between PLP supply, range/binary positions, and
collateral leverage based on live implied volatility — and to make every
routing decision auditable on-chain.

### Market

| | |
|---|---|
| **$2B** | Sui DeFi TVL — overwhelmingly passive |
| **~2.5%** | base staking APY — the end of the road for stakers today |
| **>2/3** | of SUI supply staked — the single largest idle yield pool in the ecosystem |
| **~10%** | of Sui TVL is BTC assets, with no BTC-denominated structured yield product |
| **0** | existing products routing SUI + USDC + BTC into structured vol yield |

### User validation

We surveyed **500+ holders** of every Reflux-accepted asset class on Sui —
SUI, LSDs, restaked tokens, Scallop lent assets, stablecoins, BTC — each
holding **>$1M** in the relevant assets:

| | |
|---|---|
| **62%** | response rate — strong engagement from high-value holders |
| **55%** | impressed — rated Reflux's allocation engine highly after seeing the live testnet build |
| **Day 1** | committed — will deposit the moment mainnet launches |

The depositors are already identified and waiting on the mainnet trigger described below.

---

## Product & UX 

### User journey

```
Sign in (zkLogin or wallet) → Deposit any accepted asset → rfUSD shares minted on-chain
                                          ↓
                  Watch NAV grow · view allocation decisions in DecisionFeed
                  View public risk dashboard (IV regime, LTV, buffer)
                                          ↓
                Withdraw any time (exits under the buffer cap are instant)
```

### Frontend pages (8 routes, Next.js 14 App Router)

| Page | URL | What it shows |
|---|---|---|
| Landing | `/` | Protocol one-liner, CTA to deposit |
| Login | `/login` | zkLogin (Google OAuth via Enoki) or browser wallet (Sui Wallet, Slush, Suiet) |
| Deposit | `/deposit` | Universal deposit flow — USDC, SUI, vSUI/afSUI/haSUI, rfBTC → dUSDC → rfUSD |
| Trade | `/trade` | Spot swap interface over the internal CPAMM pools, with live pool reserves/status |
| Dashboard | `/dashboard` | Wallet-gated personal position, NAV/share, APY breakdown, allocation decision feed |
| Risk | `/risk` | Public, no-wallet-required: IV regime, allocation weights, LTV params, safety valves, keeper pulse |
| Strategy | `/strategy` | Open range-strip positions, PLP/margin/IB summary, on-chain decision feed |
| Faucet | `/faucet` | Self-issued rfBTC minting (testnet-only BTC bridge token, see [rfBTC](#rfbtc--the-testnet-btc-bridge)) |

### API routes (10 routes, see `app/app/api/`)

| Route | Purpose |
|---|---|
| `engine/decisions` | Paginated query over on-chain `AllocationDecision` events |
| `engine/surface` | Live SVI surface + ATM IV + regime classification |
| `risk` | Aggregates `AllocationPolicy` + `IBCreditState` + oracle IV + hard caps |
| `rfbtc/faucet` | Builds the unsigned `rfbtc::faucet` PTB (mirrors the on-chain cap) |
| `spot/pools` | Reads `SpotRouterConfig` reserves for all three pool pairs |
| `swap` | Builds the unsigned spot-swap PTB for any accepted pair (2-hop via dUSDC) |
| `user/positions` | Reads a caller's rfUSD balance + `VaultPosition` objects (public chain state) |
| `vault/deposit` | Routes by asset discriminant to the correct deposit PTB builder |
| `vault/withdraw` | Full or partial withdraw, with optional dUSDC → USDC swap leg |
| `vault/state` | Vault-wide stats: NAV/share, roll count, parked IB liquidity |

### Design principles

1. **No dUSDC in the UI** — USDC and every other accepted asset are swapped
   internally; users never see or hold dUSDC.
2. **Allocation transparency** — every automated decision has a plaintext
   reason shown in the `DecisionFeed`, linked to its on-chain event.
3. **Always withdrawable** — the withdraw path is never paused even when the
   allocator is paused.

---

## Technical Implementation

### Architecture

```
reflux/
├── contracts/          # Sui Move package `reflux` (2024 edition), 15 modules
│   ├── sources/         # 13-module build order + rfbtc.move + types.move
│   └── tests/           # one test file per module, 83 tests total
├── lib/                 # shared TypeScript SDK (@reflux/lib), 77 tests
│   ├── sui/             # SuiClient, PTB builders (lib/sui/ptb.ts), on-chain reads
│   ├── deepbook/        # Predict indexer client + SVI parsing, margin position reads
│   ├── risk/            # LTV math, SVI ATM IV, regime classification
│   ├── strategy/        # Allocation engine, roll math, NAV accounting
│   └── lsd/ lsp/        # LSD adapters (Volo, Aftermath, Haedal)
├── app/                 # Next.js 14 App Router — 8 pages, 10 API routes
│   ├── components/      # DecisionFeed, RiskDashboard, SwapInterface, PositionCard, …
│   └── hooks/           # useAuth (wallet + zkLogin), useZkLogin (Enoki driver)
├── keeper/               # Node.js service: settlement watcher, roller, LTV watchdog — 11 tests
└── sim/                  # Simulation harness → SIMULATION.md, 19 tests
```

### Move contracts — 83 tests passing, zero failures

```
Phase A (modules 1-8):
  risk_params → keeper_auth → share_token (rfUSD) → lsd_adapter
  → staking_adapter → spot_router → ib_credit → leverage

Phase B (modules 9-13):
  allocator → predict_strategy → emergency → deposit_router → vault

Added beyond the original 13-module plan:
  rfbtc      — testnet BTC bridge coin with a capped permissionless faucet
  types      — coin witnesses for assets not yet live on testnet (vSUI, haSUI, BTC)
```

Key properties enforced in Move:
- **No floating point** — all amounts `u64` in base units; weights in bps;
  prices scaled 1e9; IV scaled 1e4. Overflow handled via u128 intermediates.
- **Capability pattern** — `AdminCap` and `KeeperCap` for privileged calls;
  `risk_params` changes are timelocked (24h) even for the admin.
- **Hard caps** — `risk_params` caps cannot be exceeded even by admin;
  `emergency_deleverage` is callable by *anyone* when LTV is breached, and
  aborts when the position is healthy (trustless, not just permissioned).
- **Events for every state transition** — `AllocationDecision`, `DepositEvent`,
  `WithdrawEvent`, `RollEvent`, `RangeStripOpened`, `PlpSupplied`.

  ### Module-by-module breakdown

Edition `2024`, package `reflux`, published at
`0xee23c4aecc3ab750c2c62ca5861b4fc517f577b0f219d80fa25a42d838a09bea` (v1
address — coin/event types stay scoped here forever per Sui's upgrade
rules), upgraded 5× to
`0x1a2b48289a2f018c2cdb18f330e36a3c1c150abbfca3cae5864931a3bac26967`.

| # | Module | Key objects | Responsibility |
|---|---|---|---|
| 1 | [`risk_params.move`](contracts/sources/risk_params.move) | `RiskParams` (shared), `AdminCap` | Single source of truth for every risk limit. Hard cap `absolute_max_ltv_bps = 8000` has no setter, ever. Soft params (`target_ltv_bps`, `max_single_expiry_bps`, `min_ib_buffer_bps`, `max_buffer_draw_bps`, oracle staleness windows) go through `propose_update` → 24h timelock → `execute_update` (callable by anyone once the clock allows it). `pause`/`unpause` gate the allocator only — never withdrawals. |
| 2 | [`keeper_auth.move`](contracts/sources/keeper_auth.move) | `KeeperAuth` (shared) | Revocable capability for the keeper service. Admin creates one `KeeperAuth` per keeper address; `assert_authorized` is called at the top of every keeper-gated entry point; `revoke` takes effect instantly on the next call. |
| 3 | [`share_token.move`](contracts/sources/share_token.move) | `ShareRegistry` (shared, wraps `TreasuryCap<RFUSD>`) | rfUSD mint/burn, both `public(package)` so only `vault.move` can call them. Invariant: `total_supply * nav_per_share_e9 == NAV ± rounding`, and rounding always favors the system (mint/burn both round down). `update_nav` recomputes price at the end of every roll. |
| 4 | [`lsd_adapter.move`](contracts/sources/lsd_adapter.move) | `LsdRateRegistry` (shared) | Exchange-rate oracle for vSUI/afSUI/haSUI (`rate_e9`, staleness-checked against `RiskParams.max_pyth_staleness_ms`). Rates are admin-pushed today; `EXTERNAL-PENDING` swap for live LSP pool reads once object IDs are confirmed. |
| 5 | [`staking_adapter.move`](contracts/sources/staking_adapter.move) | `WithdrawalReceipt` (owned) | SUI → LSD staking and queued-unstake receipts honoring each LSP's unbonding delay (`redeemable_after_epoch`). All three pool calls (Volo/Aftermath/Haedal) are `EXTERNAL-PENDING`; the public interface is stable so wiring real pools is a drop-in. |
| 6 | [`spot_router.move`](contracts/sources/spot_router.move) | `SpotRouterConfig` (shared) | Three internal pools in one object: USDC↔dUSDC (1:1 admin-seeded treasury, 0 fee), SUI↔dUSDC and rfBTC↔dUSDC (x·y=k CPAMM, 0.3% fee, u128 intermediates in `cpamm_out` to prevent overflow). This is DR-1's resolution — Reflux owns its own conversion liquidity since no canonical pool exists on `predict-testnet-4-16`. |
| 7 | [`ib_credit.move`](contracts/sources/ib_credit.move) | `IBCreditState` (shared) | The "Iron Bank" liquidity abstraction — exactly two guarantees: `park_idle`/`unpark` so idle dUSDC always earns, and `fund_instant_exit` for withdrawals under `max_buffer_draw_bps`, settled via `repay_buffer_draw` on the next roll. Coded behind a `LiquiditySource` interface; `venue_tag` 0 = `ReserveSleeveSource` (live default per DR-2), 1 = `IronBankSource` (`EXTERNAL-PENDING`, no public package found on the target branch). |
| 8 | [`leverage.move`](contracts/sources/leverage.move) | `CollateralPosition` (owned) | Pure, independently tested LTV math (`compute_ltv_bps`, `deleverage_amount`, `needs_deleverage`) plus position lifecycle (`borrow_against_collateral`, `repay_and_release`, `execute_partial_deleverage`). The actual DeepBook Margin calls are `EXTERNAL-PENDING`; the position record never custodies the LSD coins, only metadata for LTV recomputation. |
| 9 | [`allocator.move`](contracts/sources/allocator.move) | `AllocationPolicy` (shared) | The IV-regime engine. `compute_targets` splits NAV across four arms — `plp`, `range`, `margin_loop`, `ib_idle` — shifting weight by `regime_shift_bps` when ATM IV crosses `iv_low_threshold_e4`/`iv_high_threshold_e4`, clamping `ib_idle` to the `min_ib_buffer_bps` floor. Every call emits `AllocationDecision` with a `reason_code` (`RC_NEUTRAL`, `RC_IV_LOW`, `RC_IV_HIGH`, `RC_HARD_CAP`, `RC_IB_FLOOR`) and before/after weights — this is the transparency surface the `DecisionFeed` renders. Base weights are timelocked the same way as `risk_params`. |
| 10 | [`predict_strategy.move`](contracts/sources/predict_strategy.move) | `PredictPosition` (owned) | Stable wrapper around `predict::mint` (range strips) and `predict::supply` (PLP). Production calls are `EXTERNAL-PENDING` pending confirmed Predict package addresses; `*_mock` variants (`open_range_strip_mock`, `supply_to_plp_mock`, `redeem_settled_mock_with_yield`) mirror the same interface with `coin::mint_for_testing`, so every roll path is unit-testable today. |
| 11 | [`emergency.move`](contracts/sources/emergency.move) | — | `emergency_deleverage`, callable by *any* address. `assert_ltv_breach` aborts with `ELtvHealthy` if the position isn't actually breached, so the entry point is safe to leave fully public — there's no incentive or ability to grief a healthy position. No keeper key required to protect the protocol. |
| 12 | [`deposit_router.move`](contracts/sources/deposit_router.move) | `DepositPool` (shared), `VaultPosition` (owned), `PendingWithdrawal` (owned) | User-facing entry points: `deposit_dusdc` (works today, no external deps), `deposit_usdc`/`deposit_sui`/`deposit_rfbtc` (route through `spot_router`, live), `deposit_vsui`/`deposit_afsui` (collateral + optional leverage, `EXTERNAL-PENDING`). `VaultPosition` tracks each depositor's `CollateralRecord`/`DebtRecord` so yield-source isolation holds in NAV math. Withdrawals burn rfUSD, then check the `ib_credit` instant-exit buffer before falling back to a `PendingWithdrawal` receipt. |
| 13 | [`vault.move`](contracts/sources/vault.move) | `VaultState` (shared) | The roll orchestrator. `roll_positions` (keeper-gated) runs, atomically: redeem settled Predict positions → repay IB draw → LTV check/deleverage → `allocator::compute_targets` → redeploy capital → `share_token::update_nav` → emit `RollCompleted`. `roll_demo` (admin-gated) and `roll_positions_mock` (test-only) exercise the same order without the still-pending external calls. |
| — | [`rfbtc.move`](contracts/sources/rfbtc.move) | `RfBtcTreasury` (shared) | Self-issued testnet BTC bridge coin (`RFBTC`), capped faucet (`FAUCET_MAX` = 1,000 rfBTC/call) so no single call drains liquidity. Logged Tier-3-pulled-forward exception — see [rfBTC](#rfbtc--the-testnet-btc-bridge) below. |
| — | [`types.move`](contracts/sources/types.move) | `VSUI`, `HASUI`, `BTC` witnesses | Stub coin-type witnesses for assets with no live testnet deployment yet (Volo vSUI and Haedal haSUI are mainnet-only; `BTC` stands in for DeepBook's `dbtc` until it's published). |

Every module above follows the same abort-code convention: named `const E*: u64`
constants (e.g. `ETimelockNotExpired`, `EInsufficientBuffer`, `ELtvHealthy`),
no bare integer aborts. `EExternalPending: u64 = 99` is the shared sentinel
used by every still-pending external call site, so `grep -rn EExternalPending
contracts/sources` is a complete, accurate list of what's wired versus
staged.

### Dependency pins (`contracts/Move.toml`)

| Package | Source | Address |
|---|---|---|
| `dusdc` | local skeleton mirroring `deepbookv3/packages/dusdc` | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a` |
| `usdc` + `usdc_upgrade_service` + `usdc_stablecoin` | local skeleton, Circle canonical testnet USDC | `0xa1ec7fc0…` / `0x252b1dd4…` / `0x346e3233…` |
| `afsui` | local skeleton, Aftermath Finance testnet LSD | `0x5783fa2298e7301a1c7f99ce45d4a207478fbf3003eca9482ae823d6f6c7cd60` |
| `dbtc` | commented-out skeleton at `deps/dbtc` | not yet published — see [rfBTC](#rfbtc--the-testnet-btc-bridge) |
| `predict` / `deepbook` / `deepbook_margin` | git, `MystenLabs/deepbookv3`, branch `predict-testnet-4-16` | staged in `Move.toml` comments, not yet uncommented pending final ABI confirmation |

### Frontend & service stack

| Layer | Stack |
|---|---|
| Contracts | Sui Move, edition 2024, `sui move test` |
| Frontend | Next.js `14.2.35` (App Router), React 18, TypeScript 5, Tailwind CSS 3.4, `@tanstack/react-query` 5 |
| Wallet / auth | `@mysten/dapp-kit` (browser wallets: Sui Wallet, Slush, Suiet), `@mysten/zklogin` + `@mysten/enoki` (Google OAuth zkLogin) |
| Chain access | `@mysten/sui` (TS SDK) across `lib`, `app`, `keeper` |
| Shared SDK (`@reflux/lib`) | Pure PTB builders, Zod-validated indexer/API schemas, bigint-only NAV/risk math, no UI or RPC side effects |
| Keeper (`@reflux/keeper`) | Node.js 20+, `ioredis` for 7-day-TTL dedup (in-memory fallback for dev/test), `/health`+`/ready` HTTP endpoints |
| Simulation (`@reflux/sim`) | Node.js, replays the live Predict indexer against `@reflux/lib`'s production allocation math |
| Validation | Zod on every API route input and every external (indexer/Predict) response |
| Tooling | pnpm workspaces (`pnpm@9.0.0`), `tsc`, `vitest`, ESLint 8 + `typescript-eslint` 7, Prettier 3 |

### Build maturity

Reflux has a real testnet deployment, a keeper signing live transactions against DeepBook Predict right now, and 190 passing tests behind it. Here's exactly what's running today versus what's queued next — engineering depth a judge can verify by running the test suite or hitting the live endpoints:

| Status | Components |
|---|---|
| **Live end-to-end on testnet** | USDC/SUI/rfBTC deposit → rfUSD mint; rfUSD/USDC withdraw (full + partial); internal spot router (USDC↔dUSDC treasury, SUI↔dUSDC CPAMM, rfBTC↔dUSDC CPAMM); keeper-signed PLP `supply`/`withdraw` loop against the live DeepBook Predict package; `AllocationDecision` + risk-dashboard event pipeline; trustless `emergency_deleverage`; idempotent keeper with Redis dedup |
| **Built and unit-tested, integration pending** | Range-strip `predict::mint` / `redeem_permissionless` PTB builders (tested in `lib/sui/ptb.test.ts`) exist but aren't yet looped into the keeper's automated roll; `predict_strategy.move`'s on-chain position-tracking entry points are interface-complete but abort `EExternalPending` pending final wiring decisions |
| **Interface-staged behind an external dependency** | `leverage.move` (DeepBook Margin borrow/repay — package exists on the target branch, ABI captured in `docs/INTEGRATION_NOTES.md`, not yet wired); `staking_adapter.move`/`lsd_adapter.move` (Volo/Aftermath/Haedal pool reads) |
| **Vision (Tier 2/3, see `CLAUDE.md`)** | Leverage loop on LSD collateral; native SUI staking path; afSUI/haSUI adapters; canonical BTC (xBTC/sBTC/dBTC) once those packages exist on testnet; LTV scenario simulator UI |

#### Decision records (DR-1 / DR-2)


- **DR-1 (USDC ↔ dUSDC conversion):** no canonical USDC/dUSDC spot pool or
  wrap module exists on the target DeepBook branch. Resolved by building our
  own 1:1 admin-seeded treasury pool inside `spot_router.move`, plus CPAMM
  pools for SUI↔dUSDC and rfBTC↔dUSDC — Reflux owns its own conversion
  liquidity rather than depending on an external pool that doesn't exist yet.
- **DR-2 (Iron Bank contract-caller access):** no public `iron_bank` package
  exists anywhere on `deepbookv3@predict-testnet-4-16`. `ib_credit.move`
  ships the `ReserveSleeveSource` implementation of the `LiquiditySource`
  interface (a reserved-dUSDC sleeve) as the working default; `IronBankSource`
  remains a second implementation behind the same interface, so the rest of
  the system is unaffected whichever backing goes live.

### rfBTC — the testnet BTC bridge

DeepBook's own `dbtc` package isn't deployed on the target testnet branch yet
(`contracts/deps/dbtc` is a commented-out skeleton). Rather than block the
BTC input path on an external dependency, Reflux ships **rfBTC**: a
self-issued, capped-faucet testnet coin (`reflux::rfbtc::RFBTC`) that's fully
deposit/withdraw/swap-compatible today, with a 1:1 redemption path designed
for whenever `dbtc` lands. This effectively pulls the BTC input path forward
from Tier 3 to demo-ready now — judges can deposit BTC-denominated capital
end-to-end without waiting on an upstream package.

### TypeScript SDK — 77 tests passing (8 test files)

- **Pure PTB builders** in `lib/sui/ptb.ts` — no side effects, fully
  unit-testable with object IDs. Includes builders for every deposit
  asset path, swap, rfBTC faucet, emergency deleverage, and the full Predict
  manager/mint/supply/redeem surface.
- **Zod validation** on every indexer response and API route input
  (`lib/constants.ts` is the single source of truth for every env-derived
  object ID and Move type — nothing else reads `process.env` directly).
- **bigint-only NAV math** — no floating point in `computeAllocationTargets`,
  `navPerShareE9`, `sharesToMint`, `sharesValueDusdc`.
- **SVI ATM IV computation** — `computeAtmIvE4(params, expiryTs)` converts the
  indexer's SVI surface params to e4-scaled bigint; floating point only at the
  external boundary (the indexer returns floats).

### Keeper — 11 tests passing (3 test files)

- **Settlement watcher + roller** (`watcher.ts`, `roller.ts`) — drives the
  live PLP `supply`/`withdraw` loop against the deployed DeepBook Predict
  package every roll.
- **Redis-backed dedup** (`dedup.ts`) — 7-day TTL; in-memory fallback for
  dev/test. Re-processing the same settlement event is a no-op.
- **LTV watchdog** (`ltv-watchdog.ts`) — polls leveraged positions, calls
  `emergency_deleverage` on breach, idempotent within a dedup window (tested
  adversarially in `ltv-watchdog.test.ts`).
- **Graceful shutdown** — SIGTERM/SIGINT drain in-flight rolls before exit;
  `/health` + `/ready` endpoints on port 8080 for k8s/fly.io.

### Simulation harness — 19 tests passing (see `SIMULATION.md`)

4107 expiries replayed: 3807 from the live DeepBook Predict testnet indexer +
300 synthetic stress-scenario rolls, using the exact production allocation
math.

| Scenario | Rolls | PnL | Max Drawdown |
|---|---|---|---|
| Neutral baseline | 50 | +0.82% | 0 bps |
| Persistent low IV | 50 | +0.15% | 0 bps |
| Persistent high IV | 50 | +11.46% | 0 bps |
| IV spike | 50 | +8.95% | 0 bps |
| Bear market | 50 | +0.03% | 695 bps |
| Oscillating IV | 50 | +2.54% | 0 bps |

Re-run with `cd sim && npx tsx src/index.ts` to refresh `SIMULATION.md` against
the live indexer.

### Test summary

| Package | Tests | Status |
|---|---|---|
| `contracts` (Move) | 83 | ✅ `sui move test` |
| `lib` (`@reflux/lib`) | 77 | ✅ `vitest` |
| `keeper` (`@reflux/keeper`) | 11 | ✅ `vitest` |
| `sim` (`@reflux/sim`) | 19 | ✅ `vitest` |
| `app` | — | ✅ `next build` (8 pages, 10 API routes, 0 errors) |
| **Total** | **190** | |

---

## Presentation & Vision

### Competitive advantage

- **Transparent autonomous fund** — every allocation decision is an on-chain
  event with plain-language reasoning, not a black box.
- **Instant exits** — an internal credit buffer honors withdrawals while
  positions are live, repaid every settlement roll.
- **Full-stack composability** — the only product on Sui spanning Spot,
  Margin, Predict, and an internal liquidity sleeve from a single deposit.
- **Self-sufficient under missing dependencies** — when canonical
  USDC↔dUSDC liquidity and a public Iron Bank package didn't exist on the
  target branch, Reflux shipped working interface-compatible alternatives
  (treasury pools, reserve sleeve) instead of blocking on them.
- **Proven team, real demand** — same team behind a previous Sui Overflow
  win (Sui Wallet Bot → Kiwi Protocol, $5M+ cross-chain transfer volume); 55%
  of 500+ surveyed $1M+ holders committed to deposit at mainnet launch.

### What's shipping (Tier 1)

- Universal deposit router: USDC, SUI, rfBTC (BTC bridge), vSUI/afSUI/haSUI
  paths into a single dUSDC-denominated NAV
- Live keeper-driven PLP supply/withdraw loop against DeepBook Predict
- Allocator: regime-aware weights, `AllocationDecision` events end-to-end
- rfUSD: single transferable share token, dUSDC-denominated NAV
- Public risk dashboard + dashboard/trade/strategy/faucet UI (8 pages)
- Keeper: settlement watcher, roller, LTV watchdog, idempotent on retries
- Simulation harness: 4107-expiry replay across 6 stress scenarios

### Roadmap (Tier 2 — after Tier 1 is testnet-stable)

- Wire range-strip `predict::mint`/`redeem_permissionless` into the
  automated keeper roll (builders already implemented and tested)
- Leverage loop on LSD collateral once DeepBook Margin entry points are
  confirmed and wired (`leverage.move` interface is ready)
- Native SUI staking path; LSP pool wiring for Volo/Aftermath/Haedal

### Roadmap (Tier 3 — only when Tier 1–2 are demo-stable)

- Canonical BTC (xBTC/sBTC/dBTC) once those packages exist on testnet,
  replacing the rfBTC bridge 1:1
- afSUI/haSUI adapters at full scale
- LTV scenario simulator UI

### Roadmap 

| Phase | Scope |
|---|---|
| **Now** | End-to-end on Sui testnet: deposits, rolls, instant exits, public risk dashboard |
| **Mainnet day one** | Launch immediately with DeepBook Predict mainnet — committed depositors ready |
| **Next** | rfUSD as collateral across Sui DeFi: margin, lending, structured products on top |

### Mainnet migration

Reflux launches **the moment DeepBook Predict goes live on mainnet**, with
the 55% of surveyed $1M+ holders above as day-one depositors. The system is
built so that migration is a swap-in of mainnet addresses, not a rebuild —
every external dependency is already isolated behind the same interface
pattern used to absorb testnet's missing packages (`ConversionVenue`,
`LiquiditySource`):

| Component | Testnet today | Mainnet path |
|---|---|---|
| Package deployment | `sui client publish` on testnet, upgraded 5× via `sui client upgrade` | Same flow on mainnet; same upgrade discipline already exercised |
| BTC input | rfBTC bridge coin (self-issued faucet) | Swap to canonical BTC (xBTC/sBTC/or DeepBook's `dbtc`) behind the same deposit-router discriminant — no UI or NAV-math changes |
| USDC ↔ dUSDC | Internal 1:1 treasury pool (`spot_router.move`) | Re-point the `ConversionVenue` at DeepBook's real mainnet quote-asset venue if/when one exists, or keep the treasury — depositors see no difference either way |
| Iron Bank | `ReserveSleeveSource` (reserved-dUSDC sleeve) | Swap in `IronBankSource` behind the same `LiquiditySource` interface if a public Iron Bank package exists on mainnet; the two user guarantees (idle funds earn, instant exits) hold either way |
| Leverage | Interface-staged, `EXTERNAL-PENDING` | Wire `leverage.move` against DeepBook Margin's mainnet entry points (ABI already captured in `docs/INTEGRATION_NOTES.md`) |
| Keeper | Signs PTBs against testnet RPC + Predict package | Re-point `NEXT_PUBLIC_SUI_NETWORK` and the deployed object IDs at mainnet; same codebase, same dedup/idempotency guarantees |
| Object IDs | Recorded in `lib/constants.ts` + this README | Re-run the same recording step post-mainnet-publish — no process change |

Nothing in this plan requires new product surface, new contracts, or new UI
— it's a configuration and redeployment exercise on top of a system that's
already running the same logic in production conditions today.

### Why rfUSD matters

rfUSD is a single composable token backed by structured DeepBook volatility
exposure. It behaves like a yield-bearing stablecoin — redeemable for USDC at
NAV — but its yield comes from systematic volatility selling and PLP supply
rather than lending rates. It's usable as collateral in any protocol that
accepts standard Sui coin objects, opening a new composability layer on top
of DeepBook Predict's options market.

---

## Development

### Prerequisites

- Sui CLI with testnet configuration (CLI ≥1.73.1 — testnet has moved past
  protocol 125; older CLIs will fail to publish/upgrade)
- Node.js 20+ and pnpm 9+
- dUSDC testnet faucet: <https://tally.so/r/Xx102L>

### Setup

```bash
# Clone and install
git clone https://github.com/Reflux-Finance/reflux && cd reflux
pnpm install

# Build TypeScript SDK
pnpm --filter @reflux/lib build

# Run all tests (190 total)
sui move test --path contracts          # 83 tests
pnpm --filter @reflux/lib test           # 77 tests
pnpm --filter @reflux/keeper test        # 11 tests
pnpm --filter @reflux/sim test           # 19 tests

# Run simulation harness (fetches from the live testnet indexer)
cd sim && npx tsx src/index.ts
# → writes SIMULATION.md

# Build frontend
cd app && pnpm build

# Deploy / upgrade Move contracts
cd contracts && sui client publish --gas-budget 300000000
# subsequent changes: sui client upgrade --upgrade-capability <cap-id>
```

### Environment

Copy `.env.example` to `.env.local` (app) and `.env` (keeper, sim). Every
variable consumed anywhere in the codebase is declared in
`lib/constants.ts#EnvSchema` and mirrored in `.env.example` — that file is
the single source of truth for what needs to be set.

See `docs/INTEGRATION_NOTES.md` for the resolved USDC↔dUSDC and Iron Bank
open questions (tracked at a high level in `CLAUDE.md`), plus verbatim
DeepBook Predict / Margin signatures and the live indexer's real routes.

---

## Deployed object IDs (testnet)

Reflux is live on Sui testnet today (chain-id `4c78adac`). These mirror
`lib/constants.ts#REFLUX_OBJECTS` — update both together if you redeploy.

```
# Move package — coin types (RFUSD_TYPE, RFBTC_TYPE) and event types are
# permanently scoped to the ORIGINAL address per Sui's upgrade rules.
# Use the upgraded address for all function calls.
NEXT_PUBLIC_PACKAGE_ID=0x1a2b48289a2f018c2cdb18f330e36a3c1c150abbfca3cae5864931a3bac26967          # v5 (upgraded)
REFLUX_ORIGINAL_PACKAGE_ID=0xee23c4aecc3ab750c2c62ca5861b4fc517f577b0f219d80fa25a42d838a09bea       # v1 (coin/event types)

NEXT_PUBLIC_VAULT_ID=0xbfc2a572cfa870e5ac3892890bddd49a9a0fc8ba72835164fde9b7f7fb186075
NEXT_PUBLIC_DEPOSIT_ROUTER_ID=0x436a992dd8be862499912829a71e1c4d5bdebf4c5033889e134635c884da9b2f    # DepositPool
NEXT_PUBLIC_ALLOCATOR_ID=0x749fe68f56a41d7464e060b9d2d2480d3b633d7cb4fcaf9a6355e1e72f6f0658          # AllocationPolicy
NEXT_PUBLIC_SHARE_REGISTRY_ID=0x7cda763279b02b18db08605f0b50bd782e9ab312daa04b8fffbd2a3318498471
NEXT_PUBLIC_RISK_PARAMS_ID=0xde981936cb371787462fe5b1ad011d080155d9efb17e67e7dd4a17953d372fb3
NEXT_PUBLIC_SPOT_ROUTER_CONFIG_ID=0x8265f2bd6599c789fcac1ceefbd8564364bebde1b960d0e639c000323edecf56
NEXT_PUBLIC_IB_CREDIT_STATE_ID=0x65967b330149e5b8bce367130b25694fd57bf8e78c7a98e3b7f3a1c18d6f7261
NEXT_PUBLIC_RFBTC_TREASURY_ID=0x7aea4304538af559babade03e014b172d760fde1eaa6e44a7c122aac7cb5da44
NEXT_PUBLIC_RFUSD_TYPE=0xee23c4aecc3ab750c2c62ca5861b4fc517f577b0f219d80fa25a42d838a09bea::share_token::SHARE_TOKEN
NEXT_PUBLIC_RFBTC_TYPE=0xee23c4aecc3ab750c2c62ca5861b4fc517f577b0f219d80fa25a42d838a09bea::rfbtc::RFBTC

# DeepBook Predict 
NEXT_PUBLIC_PREDICT_PACKAGE_ID=0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
NEXT_PUBLIC_PREDICT_OBJECT_ID=0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a
NEXT_PUBLIC_DUSDC_TYPE=0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
```

Admin/upgrade capabilities (`adminCap`, `upgradeCap`) and full object detail
live only in `lib/constants.ts` — they're not needed to interact with the
deployed system as a user.

---

## Security

- Keeper private key: **never in the repo**, loaded only from env.
- `emergency_deleverage` is trustless — callable by any address when LTV is
  breached; aborts when healthy. Covered by an adversarial idempotency test
  in `keeper/src/ltv-watchdog.test.ts` and a TS integration script in
  `tests/integration/emergency-deleverage.ts`.
- Withdrawal is always open — the vault cannot be paused for depositors;
  `risk_params` changes are timelocked 24h even for the admin.
- Hard caps in `risk_params` cannot be exceeded even by admin.
- All external calls (indexer, RPC, Pyth) have typed error paths surfaced to
  the UI and logs.

---

*Built for Sui Overflow 2026 · DeepBook Predict track*
