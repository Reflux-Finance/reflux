import { z } from 'zod';
import { withRetry } from '../sui/client.js';
import { env } from '../constants.js';

// ─── Internal Oracle type (normalized, used everywhere in the codebase) ───────

export const OracleSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  expiry_ts_ms: z.number(),
  is_settled: z.boolean(),
  settlement_price_e9: z.number().optional(),
});
export type Oracle = z.infer<typeof OracleSchema>;

// ─── Wire schema — matches actual predict-server.testnet.mystenlabs.com/oracles ─

const RawOracleSchema = z.union([
  // Normalized form (used in unit tests)
  OracleSchema,
  // Real predict-server wire form (as of 2026-06)
  z.object({
    oracle_id: z.string(),
    expiry: z.number(),
    status: z.string(),
    settlement_price: z.number().nullable().optional(),
    underlying_asset: z.string().optional(),
  }).transform((raw): Oracle => ({
    id: raw.oracle_id,
    expiry_ts_ms: raw.expiry,
    is_settled: raw.status === 'settled',
    settlement_price_e9: raw.settlement_price ?? undefined,
  })),
]);

export const OraclesResponseSchema = z.array(RawOracleSchema);

// ─── SVI params ───────────────────────────────────────────────────────────────

/**
 * Internal SVI params — all fields are plain floats.
 * This is what `computeAtmIvE4` consumes.
 */
export const SviParamsSchema = z.object({
  oracle_id: z.string(),
  a: z.number(),
  b: z.number(),
  rho: z.number(),
  m: z.number(),
  sigma: z.number(),
  timestamp_ms: z.number(),
});
export type SviParams = z.infer<typeof SviParamsSchema>;

/**
 * Wire schema for `/oracles/{id}/svi/latest`.
 *
 * On-chain all SVI magnitudes are `u64` scaled by `FLOAT_SCALING = 1e9`.
 * Signed params (`rho`, `m`) are split into magnitude + `*_negative: bool`
 * (because Move's `i64::I64` is emitted as two fields by the indexer).
 *
 * Transform: divide magnitudes by 1e9; flip sign if `*_negative` is true.
 */
const WireSviSchema = z.union([
  // Normalised form — accepted in tests and any future flattened response
  SviParamsSchema,
  // Real indexer wire form
  z.object({
    oracle_id: z.string(),
    a: z.number(),
    b: z.number(),
    rho: z.number(),
    rho_negative: z.boolean().optional(),
    m: z.number(),
    m_negative: z.boolean().optional(),
    sigma: z.number(),
    onchain_timestamp: z.number(),
  }).transform((w): SviParams => {
    const SCALE = 1e9;
    const sign = (v: number, neg?: boolean) => neg ? -v : v;
    return {
      oracle_id: w.oracle_id,
      a: w.a / SCALE,
      b: w.b / SCALE,
      rho: sign(w.rho / SCALE, w.rho_negative),
      m: sign(w.m / SCALE, w.m_negative),
      sigma: w.sigma / SCALE,
      timestamp_ms: w.onchain_timestamp,
    };
  }),
]);

// ─── Oracle price ─────────────────────────────────────────────────────────────

/**
 * Wire schema for `/oracles/{id}/prices/latest`.
 * `spot` and `forward` are already scaled 1e9 (FLOAT_SCALING).
 */
export const OraclePriceSchema = z.object({
  oracle_id: z.string(),
  spot: z.number(),
  forward: z.number(),
  onchain_timestamp: z.number(),
});
export type OraclePrice = z.infer<typeof OraclePriceSchema>;

// ─── Manager positions ────────────────────────────────────────────────────────

const MintedPositionSchema = z.object({
  oracle_id: z.string().optional(),
  manager_id: z.string().optional(),
  quantity: z.number().optional(),
  cost: z.number().optional(),
}).passthrough();

export const ManagerPositionsSchema = z.object({
  minted: z.array(MintedPositionSchema),
  redeemed: z.array(MintedPositionSchema),
});
export type ManagerPositions = z.infer<typeof ManagerPositionsSchema>;

/** Legacy flat array form — kept for backwards-compat with tests. */
const FlatPositionSchema = z.object({
  id: z.string(),
  manager: z.string(),
  oracle_id: z.string(),
  position_type: z.number(),
  capital_dusdc: z.string(),
  is_settled: z.boolean(),
});
export type PredictPosition = z.infer<typeof FlatPositionSchema>;

export const PositionSchema = FlatPositionSchema;
export const PositionsResponseSchema = z.array(FlatPositionSchema);

// ─── HTTP client ─────────────────────────────────────────────────────────────

export class IndexerError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    message: string,
  ) {
    super(`Indexer ${url} returned ${status}: ${message}`);
    this.name = 'IndexerError';
  }
}

async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const res = await Promise.race([
    fetch(url),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`Timeout after ${timeoutMs}ms fetching ${url}`)), timeoutMs),
    ),
  ]);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new IndexerError(url, res.status, body.slice(0, 200));
  }
  return res.json();
}

export async function listOracles(
  baseUrl: string = env.NEXT_PUBLIC_PREDICT_SERVER,
): Promise<Oracle[]> {
  const data = await withRetry(() => fetchJson(`${baseUrl}/oracles`));
  return OraclesResponseSchema.parse(data);
}

/**
 * Fetch SVI params for an oracle.
 * Endpoint: GET /oracles/{id}/svi/latest
 * Returns internal SviParams (floats, decoded from on-chain integer encoding).
 */
export async function fetchSviParams(
  oracleId: string,
  baseUrl: string = env.NEXT_PUBLIC_PREDICT_SERVER,
): Promise<SviParams> {
  const data = await withRetry(() =>
    fetchJson(`${baseUrl}/oracles/${oracleId}/svi/latest`),
  );
  return WireSviSchema.parse(data);
}

/**
 * Fetch the latest spot/forward price for an oracle.
 * Endpoint: GET /oracles/{id}/prices/latest
 * Prices are scaled 1e9 (FLOAT_SCALING).
 */
export async function fetchOraclePrice(
  oracleId: string,
  baseUrl: string = env.NEXT_PUBLIC_PREDICT_SERVER,
): Promise<OraclePrice> {
  const data = await withRetry(() =>
    fetchJson(`${baseUrl}/oracles/${oracleId}/prices/latest`),
  );
  return OraclePriceSchema.parse(data);
}

/**
 * Fetch active positions for a keeper's PredictManager.
 * Endpoint: GET /managers/{managerId}/positions
 * Returns { minted: [...], redeemed: [...] }.
 */
export async function listManagerPositions(
  managerId: string,
  baseUrl: string = env.NEXT_PUBLIC_PREDICT_SERVER,
): Promise<ManagerPositions> {
  const data = await withRetry(() =>
    fetchJson(`${baseUrl}/managers/${encodeURIComponent(managerId)}/positions`),
  );
  return ManagerPositionsSchema.parse(data);
}

/** @deprecated Use listManagerPositions. Left for backwards-compat with existing callers. */
export async function listPositions(
  managerId: string,
  baseUrl: string = env.NEXT_PUBLIC_PREDICT_SERVER,
): Promise<PredictPosition[]> {
  const positions = await listManagerPositions(managerId, baseUrl);
  // Return minted positions mapped to the legacy flat shape (best-effort)
  return positions.minted.map((p) => ({
    id: String(p['id'] ?? ''),
    manager: managerId,
    oracle_id: String(p['oracle_id'] ?? ''),
    position_type: Number(p['position_type'] ?? 0),
    capital_dusdc: String(p['capital_dusdc'] ?? '0'),
    is_settled: Boolean(p['is_settled'] ?? false),
  }));
}

/**
 * Returns the nearest active oracle by expiry, preferring future expiries.
 *
 * An oracle that has passed its expiry timestamp but is not yet settled
 * on-chain has TTE ≈ 0 — its SVI data is stale for pricing purposes.
 * We prefer a future-expiring oracle; if none exists we fall back to the
 * most-recently-expired unsettled oracle so the keeper can still roll.
 */
export function nearestActiveOracle(
  oracles: Oracle[],
  nowMs = Date.now(),
): Oracle | undefined {
  const unsettled = oracles.filter((o) => !o.is_settled);
  const future = unsettled.filter((o) => o.expiry_ts_ms > nowMs);
  const pool = future.length > 0 ? future : unsettled;
  return pool.sort((a, b) => a.expiry_ts_ms - b.expiry_ts_ms)[0];
}
