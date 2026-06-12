import { z } from 'zod';
import { withRetry } from '../sui/client.js';
import { env } from '../constants.js';

// ─── Indexer response schemas ────────────────────────────────────────────────

export const OracleSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  expiry_ts_ms: z.number(),
  is_settled: z.boolean(),
  settlement_price_e9: z.number().optional(),
});
export type Oracle = z.infer<typeof OracleSchema>;

export const OraclesResponseSchema = z.array(OracleSchema);

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

export const PositionSchema = z.object({
  id: z.string(),
  manager: z.string(),
  oracle_id: z.string(),
  position_type: z.number(),
  capital_dusdc: z.string(),
  is_settled: z.boolean(),
});
export type PredictPosition = z.infer<typeof PositionSchema>;

export const PositionsResponseSchema = z.array(PositionSchema);

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

export async function fetchSviParams(
  oracleId: string,
  baseUrl: string = env.NEXT_PUBLIC_PREDICT_SERVER,
): Promise<SviParams> {
  const data = await withRetry(() => fetchJson(`${baseUrl}/oracle/${oracleId}/svi`));
  return SviParamsSchema.parse(data);
}

export async function listPositions(
  managerId: string,
  baseUrl: string = env.NEXT_PUBLIC_PREDICT_SERVER,
): Promise<PredictPosition[]> {
  const data = await withRetry(() =>
    fetchJson(`${baseUrl}/positions?manager=${encodeURIComponent(managerId)}`),
  );
  return PositionsResponseSchema.parse(data);
}

/** Returns the nearest active (non-settled) oracle by expiry. */
export function nearestActiveOracle(oracles: Oracle[]): Oracle | undefined {
  return oracles
    .filter((o) => !o.is_settled)
    .sort((a, b) => a.expiry_ts_ms - b.expiry_ts_ms)[0];
}
