import { z } from 'zod';

/**
 * Typed environment constants for Reflux.
 *
 * Every chain object ID flows through here — nothing else in the codebase
 * reads `process.env` directly. Deployment-dependent IDs are optional at
 * parse time; call {@link requireDeployed} before building PTBs or serving
 * routes that need them, and it will throw listing every missing ID at once.
 */

const SUI_OBJECT_ID = /^0x[0-9a-fA-F]{1,64}$/;
const MOVE_TYPE = /^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/;

const objectId = z.string().regex(SUI_OBJECT_ID, 'expected a 0x… Sui object ID');
const moveType = z.string().regex(MOVE_TYPE, 'expected a fully-qualified Move type (0xPKG::module::Type)');

export const EnvSchema = z.object({
  NEXT_PUBLIC_SUI_NETWORK: z.enum(['localnet', 'devnet', 'testnet', 'mainnet']).default('testnet'),

  // Reflux deployment (filled in after `sui client publish`)
  NEXT_PUBLIC_PACKAGE_ID: objectId.optional(),
  NEXT_PUBLIC_VAULT_ID: objectId.optional(),
  NEXT_PUBLIC_RFUSD_TYPE: moveType.optional(),
  NEXT_PUBLIC_DEPOSIT_ROUTER_ID: objectId.optional(),
  NEXT_PUBLIC_ALLOCATOR_ID: objectId.optional(),
  NEXT_PUBLIC_IB_CREDIT_STATE_ID: objectId.optional(),

  // External protocol deployments
  NEXT_PUBLIC_PREDICT_PACKAGE_ID: objectId.optional(),
  // Predict shared object ID — defaults to the known testnet value
  NEXT_PUBLIC_PREDICT_OBJECT_ID: objectId.optional().default(
    '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  ),
  // dUSDC type — defaults to the known testnet value
  NEXT_PUBLIC_DUSDC_TYPE: z.string().optional().default(
    '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  ),
  NEXT_PUBLIC_MARGIN_PACKAGE_ID: objectId.optional(),
  NEXT_PUBLIC_PREDICT_SERVER: z
    .string()
    .url()
    .default('https://predict-server.testnet.mystenlabs.com'),
  NEXT_PUBLIC_USDC_DUSDC_POOL: objectId.optional(),
  // SpotRouterConfig shared object — set after `sui client publish`
  NEXT_PUBLIC_SPOT_ROUTER_CONFIG_ID: objectId.optional(),
  // Keeper's PredictManager object ID (created once via buildPredictCreateManagerTx)
  KEEPER_PREDICT_MANAGER_ID: objectId.optional(),

  // LSDs / LSPs
  NEXT_PUBLIC_VSUI_TYPE: moveType.optional(),
  NEXT_PUBLIC_VOLO_STAKING_POOL: objectId.optional(),
  NEXT_PUBLIC_AFTERMATH_STAKING_POOL: objectId.optional(),
  NEXT_PUBLIC_HAEDAL_STAKING_POOL: objectId.optional(),

  // rfBTC — Reflux Finance testnet BTC (our own coin, enables BTC deposit path on testnet).
  // Fill in after `sui client publish` adds rfbtc.move to the package.
  NEXT_PUBLIC_RFBTC_TYPE: z.string().optional(),
  NEXT_PUBLIC_RFBTC_TREASURY_ID: objectId.optional(),

  // BTC wrapped assets (Tier 3) — fill in after confirming live testnet deployments.
  // xBTC: confirm source (Axelar/LayerZero bridge on Sui testnet).
  // sBTC: Stacks-bridged BTC — confirm if testnet deployment exists.
  // dBTC: DeepBook's dBTC once deps/dbtc placeholder address is replaced.
  NEXT_PUBLIC_XBTC_TYPE: z.string().optional(),
  NEXT_PUBLIC_SBTC_TYPE: z.string().optional(),
  NEXT_PUBLIC_DBTC_TYPE: z.string().optional(),
  // Pyth price info object ID for BTC/USD on the target network (not the feed ID).
  NEXT_PUBLIC_PYTH_BTC_PRICE_INFO_OBJECT_ID: objectId.optional(),

  // Pyth price feed IDs (32-byte hex feed IDs, not object IDs)
  NEXT_PUBLIC_PYTH_SUI_PRICE_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_PYTH_BTC_PRICE_ID: z.string().min(1).optional(),

  // Keeper-only secrets (never NEXT_PUBLIC, never in the repo)
  KEEPER_PRIVATE_KEY: z.string().min(1).optional(),
  UPSTASH_REDIS_URL: z.string().url().optional(),
  UPSTASH_REDIS_TOKEN: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
});

export type RefluxEnv = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const lines = issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

export function readEnv(source: Record<string, string | undefined> = process.env): RefluxEnv {
  // Treat empty strings the same as absent — `VAR=` in .env should not fail validators.
  const cleaned: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(source).map(([k, v]) => [k, v === '' ? undefined : v]),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) throw new EnvValidationError(result.error.issues);
  return result.data;
}

export const env: RefluxEnv = readEnv();

/** Every env key that only exists after contracts are deployed. */
export const DEPLOYED_ID_KEYS = [
  'NEXT_PUBLIC_PACKAGE_ID',
  'NEXT_PUBLIC_VAULT_ID',
  'NEXT_PUBLIC_RFUSD_TYPE',
  'NEXT_PUBLIC_DEPOSIT_ROUTER_ID',
  'NEXT_PUBLIC_ALLOCATOR_ID',
  'NEXT_PUBLIC_IB_CREDIT_STATE_ID',
] as const;

export type DeployedIdKey = (typeof DEPLOYED_ID_KEYS)[number];

export type DeployedConstants = RefluxEnv & { [K in DeployedIdKey]: NonNullable<RefluxEnv[K]> };

export class MissingDeploymentError extends Error {
  readonly missing: DeployedIdKey[];
  constructor(missing: DeployedIdKey[]) {
    super(
      `Reflux contracts not (fully) configured — missing env IDs: ${missing.join(', ')}. ` +
        'Run `sui client publish` in contracts/ and record the IDs in .env (see README).',
    );
    this.name = 'MissingDeploymentError';
    this.missing = missing;
  }
}

/**
 * Asserts that every deployment-dependent ID is present, throwing a single
 * error that lists ALL missing keys (not just the first).
 */
export function requireDeployed(e: RefluxEnv = env): DeployedConstants {
  const missing = DEPLOYED_ID_KEYS.filter((k) => e[k] === undefined);
  if (missing.length > 0) throw new MissingDeploymentError(missing);
  return e as DeployedConstants;
}

// ---------------------------------------------------------------------------
// Fixed-point scales (mirror contracts/sources/risk_params.move — never drift)
// ---------------------------------------------------------------------------

/** Basis points denominator: 10_000 bps == 100%. */
export const BPS_DENOMINATOR = 10_000n;
/** Price scale: prices carry the `_e9` suffix and are scaled by 1e9. */
export const PRICE_SCALE_E9 = 1_000_000_000n;
/** Implied-vol scale: IV carries the `_e4` suffix and is scaled by 1e4. */
export const IV_SCALE_E4 = 10_000n;

/** dUSDC testnet faucet (manual, for development only). */
export const DUSDC_FAUCET_URL = 'https://tally.so/r/Xx102L';

// ---------------------------------------------------------------------------
// Reflux testnet deployment (v5 upgrade 2026-06-18, adds
// deposit_router::withdraw_partial and fixes deposit_usdc to record
// OUTPUT_USDC instead of OUTPUT_ORIGINAL)
// Original publish tx: HwPwNn2j7X9Ui4p2CTynYVWfMBSVF7yQVQKFBf9MVkNK
// Upgrade tx: see contracts/Published.toml
// Coin types AND event types remain tied to the ORIGINAL package (v1) as per
// Sui Move upgrade rules — only call sites should use REFLUX_PACKAGE_ID.
// ---------------------------------------------------------------------------

/** Reflux Move package ID on testnet (v5 upgrade — use for all function calls). */
export const REFLUX_PACKAGE_ID =
  '0x1a2b48289a2f018c2cdb18f330e36a3c1c150abbfca3cae5864931a3bac26967';

/** Original (v1) package ID — coin types are permanently scoped to this address. */
const REFLUX_ORIGINAL_PACKAGE_ID =
  '0xee23c4aecc3ab750c2c62ca5861b4fc517f577b0f219d80fa25a42d838a09bea';

/** rfUSD (SHARE_TOKEN) Move type — tied to original package. */
export const RFUSD_TYPE = `${REFLUX_ORIGINAL_PACKAGE_ID}::share_token::SHARE_TOKEN`;

/** rfBTC Move type (Reflux testnet BTC — mintable via faucet) — tied to original package. */
export const RFBTC_TYPE = `${REFLUX_ORIGINAL_PACKAGE_ID}::rfbtc::RFBTC`;

/**
 * VaultPosition.preferred_output values — mirrors deposit_router.move's
 * OUTPUT_ORIGINAL / OUTPUT_USDC / OUTPUT_SUI constants.
 */
export const PREFERRED_OUTPUT_ORIGINAL = 0; // raw dUSDC, no conversion on withdraw
export const PREFERRED_OUTPUT_USDC = 1;     // withdraw swaps dUSDC -> USDC
export const PREFERRED_OUTPUT_SUI = 2;      // reserved (Tier 2)

/** Shared objects created by the Reflux deployment. */
export const REFLUX_OBJECTS = {
  vaultState:          '0xbfc2a572cfa870e5ac3892890bddd49a9a0fc8ba72835164fde9b7f7fb186075',
  depositPool:         '0x436a992dd8be862499912829a71e1c4d5bdebf4c5033889e134635c884da9b2f',
  allocationPolicy:    '0x749fe68f56a41d7464e060b9d2d2480d3b633d7cb4fcaf9a6355e1e72f6f0658',
  shareRegistry:       '0x7cda763279b02b18db08605f0b50bd782e9ab312daa04b8fffbd2a3318498471',
  riskParams:          '0xde981936cb371787462fe5b1ad011d080155d9efb17e67e7dd4a17953d372fb3',
  spotRouterConfig:    '0x8265f2bd6599c789fcac1ceefbd8564364bebde1b960d0e639c000323edecf56',
  lsdRateRegistry:     '0xd4fd7811833b5e9aaf4445fc201602a47c4ef364ce7ae393c2e5de20f9085e39',
  ibCreditState:       '0x65967b330149e5b8bce367130b25694fd57bf8e78c7a98e3b7f3a1c18d6f7261',
  rfBtcTreasury:       '0x7aea4304538af559babade03e014b172d760fde1eaa6e44a7c122aac7cb5da44',
  coinMetadataRfusd:   '0x209774a71f7027bd6eeaf524a701ca057a84abf5db938b95b15377fb1eb5a7de',
  coinMetadataRfbtc:   '0xad9fa32d50932d4b2ce504b3c599c9861b06c4fcfb8ca066631f10d8cc271b04',
  upgradeCap:          '0xefe08867b3959a13152cb85445d9d410ea01bc2072a76781081f181a23e52738',
  // Replaces the old `adminCap` (a freely-transferable AdminCap object) now
  // that admin/keeper auth is OpenZeppelin `access_control` — see
  // reflux::access and the "OpenZeppelin Move Libraries" section of the
  // README. This is the shared `AccessControl<ACCESS>` registry; admin/keeper
  // PTBs mint a short-lived `Auth<AdminRole>` / `Auth<KeeperRole>` from it via
  // an extra moveCall in the same transaction rather than referencing a
  // persistent capability object ID.
  // TODO: update after redeploying the new package — not yet published.
  accessControl:       '0x0',
} as const;

// ---------------------------------------------------------------------------
// Known testnet DeepBook Predict deployments (verified 2026-06, branch predict-testnet-4-16)
// These are IMMUTABLE once the package is published — safe to hardcode.
// ---------------------------------------------------------------------------

/** DeepBook Predict package ID on testnet. */
export const PREDICT_PACKAGE_ID =
  '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';

/** DeepBook Predict shared object ID on testnet. */
export const PREDICT_OBJECT_ID =
  '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';

/**
 * dUSDC Move type on testnet.
 * This is the quote asset for all DeepBook Predict markets.
 * dUSDC is a test coin (no canonical USDC wrap module exists in this branch).
 * Obtain via faucet: DUSDC_FAUCET_URL.
 */
export const DUSDC_TYPE =
  '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

/** PLP (Predict Liquidity Provider) coin type — the share token for PLP deposits. */
export const PLP_TYPE = `${PREDICT_PACKAGE_ID}::plp::PLP`;

/** Default PredictContracts for testnet (use in PTB builders). */
export const TESTNET_PREDICT_CONTRACTS = {
  predictPackageId: PREDICT_PACKAGE_ID,
  predictObjectId: PREDICT_OBJECT_ID,
  dusdcType: DUSDC_TYPE,
  plpType: PLP_TYPE,
} as const;
