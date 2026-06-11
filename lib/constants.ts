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
  NEXT_PUBLIC_MARGIN_PACKAGE_ID: objectId.optional(),
  NEXT_PUBLIC_PREDICT_SERVER: z
    .string()
    .url()
    .default('https://predict-server.testnet.mystenlabs.com'),
  NEXT_PUBLIC_USDC_DUSDC_POOL: objectId.optional(),

  // LSDs / LSPs
  NEXT_PUBLIC_VSUI_TYPE: moveType.optional(),
  NEXT_PUBLIC_VOLO_STAKING_POOL: objectId.optional(),
  NEXT_PUBLIC_AFTERMATH_STAKING_POOL: objectId.optional(),
  NEXT_PUBLIC_HAEDAL_STAKING_POOL: objectId.optional(),

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
  const result = EnvSchema.safeParse(source);
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
