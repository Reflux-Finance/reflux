# CLAUDE.md — Reflux Project Brain

You are building **Reflux: a Structured Yield OS for Sui**, submitted to the
DeepBook Predict track of Sui Overflow 2026. Read this file fully before any
task. Every decision defers to this file.

## The product in three layers (this is the ONLY top-level story)

- **INPUT LAYER** — assets users actually hold: native SUI, LSDs
  (vSUI/afSUI/haSUI), ordinary USDC, BTC (xBTC/sBTC)
- **ENGINE LAYER** — one concept: a dUSDC-denominated allocation engine that
  routes capital across DeepBook Predict (PLP via `predict::supply`, binaries
  and range strips via `predict::mint`), `deepbook_margin` (leverage against
  SUI/LSD collateral), DeepBook Spot (asset conversion), and `iron_bank`
  (internal liquidity only) — and emits a human-legible explanation for every
  allocation decision it makes
- **OUTPUT LAYER** — **rfUSD**: a single transferable, composable,
  dUSDC-denominated yield share token; exits under the buffer cap are instant

One-liner (use verbatim in README/UI copy):
> "A dUSDC-native capital system that converts any Sui asset into structured
> volatility and staking yield across DeepBook Predict, Margin, and Iron Bank."

## Non-negotiable product rules

1. **Users deposit ordinary USDC, never dUSDC.** The deposit PTB swaps
   USDC → dUSDC internally (DeepBook Spot or canonical wrap — see OPEN
   QUESTIONS); withdrawals swap back. dUSDC never appears in the UI.
2. **Iron Bank is internal only** — a "liquidity abstraction module" with
   exactly two guarantees: (a) idle dUSDC is parked in iron_bank so it always
   earns, (b) withdrawals under the buffer cap are funded instantly via
   short-term draw, repaid automatically from the next settlement roll. It is
   never a deposit asset, never a narrative pillar, never gets a UI headline.
3. **Everything is normalized to dUSDC NAV.** One share token (rfUSD). No
   per-asset share classes. Yield-source isolation (staking yield only to
   collateral-leg depositors) is enforced in NAV computation via per-depositor
   `VaultPosition` records.
4. **Every allocator decision emits an `AllocationDecision` event** with
   numeric trigger (ATM IV vs thresholds), regime, reason_code, and
   before/after weights. The frontend `DecisionFeed` renders these as
   plain-language cards linking to the on-chain event. Never ship allocator
   intelligence without its matching transparency surface.
5. **Trustless safety valves:** `emergency_deleverage` callable by anyone
   when LTV is breached (aborts when healthy); withdrawals always open even
   when the vault is paused; hard caps in `risk_params` cannot be exceeded
   even by admin.

## Tiered scope (cut from the bottom, never the top)

| Tier | Scope | Status gate |
|---|---|---|
| **1 — must ship** | USDC deposit path + vSUI path (no leverage) + allocator (PLP + range sleeves) + AllocationDecision events + keeper roll + rfUSD + public risk dashboard + simulation harness | End-to-end on testnet from a fresh wallet |
| **2** | Leverage loop on LSD collateral + Iron Bank liquidity module (parking + instant exits) + native SUI staking path | Tier 1 still passes cold |
| **3 — only if 1–2 are demo-stable** | BTC path + afSUI/haSUI + LTV scenario simulator UI | Tiers 1–2 still pass cold |

If asked to build anything not in the current tier, refuse and cite this table.

**Logged exception:** the BTC path was pulled forward from Tier 3 via
**rfBTC** (`contracts/sources/rfbtc.move`) — a self-issued, capped-faucet
testnet coin standing in for DeepBook's `dbtc`, which isn't deployed on the
target testnet branch (`contracts/deps/dbtc` is a commented-out skeleton).
This was necessary because the BTC input path was otherwise fully blocked on
an external dependency with no ETA; rfBTC is interface-compatible with a 1:1
swap to canonical BTC once `dbtc` lands. Do not generalize this exception —
it does not authorize building other Tier 2/3 scope ahead of schedule.

## Repository layout

```
reflux/
├── CLAUDE.md
├── docs/                  # INTEGRATION_NOTES.md (resolved DR-1/DR-2, verbatim ABIs) + fixtures/
├── contracts/             # Sui Move package `reflux`
│   ├── Move.toml  Published.toml
│   ├── deps/               # local stubs for external coin packages (afsui, dbtc, dusdc, usdc, …)
│   ├── sources/            # see build order below
│   └── tests/
├── lib/                   # shared TypeScript SDK (used by app + keeper + sim)
│   ├── sui/  deepbook/  lsd/  lsp/  strategy/  risk/  constants.ts
├── app/                   # Next.js 14 App Router (TypeScript)
│   ├── app/                # pages + api routes
│   ├── components/
│   └── hooks/
├── keeper/                # standalone Node.js service
├── sim/                   # simulation harness → SIMULATION.md
└── tests/integration/     # end-to-end testnet flows
```

## Move build order (strict dependency chain)

1. `risk_params.move` 2. `keeper_auth.move` 3. `share_token.move` (rfUSD)
4. `lsd_adapter.move` 5. `staking_adapter.move` 6. `spot_router.move`
7. `ib_credit.move` 8. `leverage.move` 9. `allocator.move`
10. `predict_strategy.move` 11. `emergency.move` 12. `deposit_router.move`
13. `vault.move`

Plus, outside the strict chain: `rfbtc.move` (testnet BTC bridge coin, see
the logged Tier exception above) and `types.move` (coin witnesses for
assets not yet live on testnet: `VSUI`, `HASUI`, `BTC`).

## Engineering conventions

- **Move:** 2024 edition. All amounts `u64` in base units; rates/weights in
  bps (`u64`, 10000 = 100%); prices scaled 1e9 (`_e9` suffix), IV scaled 1e4
  (`_e4`). No magic numbers — constants in `risk_params.move`. Every abort
  uses a named error constant (`const EInsufficientCollateral: u64 = ...`).
  Checked math everywhere; overflow on multiply-before-divide handled via
  u128 intermediates. Capability pattern for admin/keeper auth. Events for
  every state transition. Each module ships with its test file in the same PR.
- **TypeScript:** strict mode, no `any`. All chain amounts `bigint`. Zod
  validation on every API route input and every indexer response. PTB
  builders are pure functions in `lib/sui/ptb.ts` — no side effects, fully
  unit-testable with mocked object IDs.
- **Testing gate:** `sui move test` must pass with zero failures before any
  TypeScript work in a phase; `npm test` must pass before any deployment.
- **Secrets:** only via env vars; `.env.example` kept current; keeper key
  never in the repo.
- **Naming:** product = Reflux; share token = rfUSD (`RFUSD` Move type,
  module `share_token`); Move package = `reflux`; npm scope dirs as above.

## External dependencies (exact pins)

- DeepBook Predict: repo `MystenLabs/deepbookv3`, **branch
  `predict-testnet-4-16`** (NOT main). Key modules: `predict.move`,
  `oracle.move`, `plp.move`. Entry points used: `predict::mint`,
  `predict::supply`, `predict::redeem_permissionless`, `predict::redeem_supply`.
- Predict indexer: `https://predict-server.testnet.mystenlabs.com`
  (`/oracles`, `/oracle/{id}/svi`, `/positions?manager={id}`)
- Local stack: `MystenLabs/deepbook-sandbox`
- dUSDC faucet (testnet): `https://tally.so/r/Xx102L`
- Pyth for SUI/USD and BTC/USD prices (LTV + FX tracking)
- LSPs: Volo (vSUI), Aftermath (afSUI), Haedal (haSUI)
- Sui TS SDK `@mysten/sui`; zkLogin for onboarding

## OPEN QUESTIONS — resolved (see `docs/INTEGRATION_NOTES.md` for full evidence)

1. **Canonical USDC ↔ dUSDC conversion on testnet — RESOLVED.** No spot pool
   or wrap module for this pair exists on `predict-testnet-4-16`. Reflux
   ships its own 1:1 admin-seeded treasury inside `spot_router.move` (plus
   SUI↔dUSDC and rfBTC↔dUSDC CPAMM pools) rather than depending on an
   external pool that doesn't exist. `deposit_usdc` and the withdraw path
   route through this internal router.
2. **Does `iron_bank` allow a contract caller? — RESOLVED (no package
   exists).** `grep -ri iron_bank` over `deepbookv3@predict-testnet-4-16`
   returns zero hits. `ib_credit.move` ships `ReserveSleeveSource` (a
   reserved-dUSDC sleeve, `reserve_weight_bps`) as the live default
   implementation of the `LiquiditySource` interface; `IronBankSource`
   stays behind the same interface for whenever that package is confirmed.
   The two user guarantees (idle funds earn; instant exits under the buffer
   cap) hold under either backing — the rest of the system does not care
   which is active.

## Definition of production-grade (applies to every phase)

- Zero `TODO` in shipped code paths; stubs only behind feature flags
- Every external call (indexer, RPC, Pyth) has timeout, retry with backoff,
  and a typed error path surfaced to the UI/logs
- Idempotent keeper: re-processing the same settlement event is a no-op
  (Redis dedup keys)
- Slippage protection (`min_out`) on every swap and every share mint/burn
- All deployed object IDs recorded in `lib/constants.ts` AND README
- README sections mirror the judging rubric: Real-World Application (50%),
  Product & UX (20%), Technical Implementation (20%), Presentation & Vision (10%)

## Do-Not list

- Do NOT add deposit support for dUSDC or USDsui
- Do NOT create multiple share classes
- Do NOT let Iron Bank exceed its two guarantees
- Do NOT hardcode allocation weights outside `AllocationPolicy`
- Do NOT use floating point anywhere in Move or in NAV math (bigint only)
- Do NOT build Tier 3 features while any Tier 1/2 gate is red
- Do NOT mention "vault" in user-facing copy — the product is a Yield OS
  (the word `vault` stays in code identifiers only)
