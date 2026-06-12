import type { SuiClient } from '@mysten/sui/client';
import { z } from 'zod';
import { withRetry } from './client.js';

// ─── Zod schemas for on-chain Move object fields ────────────────────────────

const bigintFromString = z
  .string()
  .transform((s) => BigInt(s));

const u64Field = bigintFromString.or(z.bigint());

export const VaultStateSchema = z.object({
  roll_count: u64Field,
  last_nav_dusdc: u64Field,
  last_roll_ts: u64Field,
});
export type VaultState = z.infer<typeof VaultStateSchema>;

export const ShareRegistrySchema = z.object({
  total_supply: u64Field,
  nav_per_share_e9: u64Field,
});
export type ShareRegistry = z.infer<typeof ShareRegistrySchema>;

export const AllocationPolicySchema = z.object({
  base_plp_bps: u64Field,
  base_range_bps: u64Field,
  base_margin_loop_bps: u64Field,
  base_ib_idle_bps: u64Field,
  iv_low_threshold: u64Field,
  iv_high_threshold: u64Field,
  regime_shift_bps: u64Field,
  roll_counter: u64Field,
});
export type OnChainAllocationPolicy = z.infer<typeof AllocationPolicySchema>;

export const IBCreditStateSchema = z.object({
  buffer_drawn: u64Field,
  venue_tag: z.number().or(z.string().transform(Number)),
});
export type IBCreditState = z.infer<typeof IBCreditStateSchema>;

export const VaultPositionSchema = z.object({
  owner: z.string(),
  shares_minted: u64Field,
  deposit_ts_ms: u64Field,
  preferred_output: z.number().or(z.string().transform(Number)),
});
export type VaultPositionData = z.infer<typeof VaultPositionSchema>;

// ─── Generic typed object fetch ──────────────────────────────────────────────

export class ReadError extends Error {
  constructor(
    public readonly objectId: string,
    cause: unknown,
  ) {
    super(`Failed to read object ${objectId}: ${String(cause)}`);
    this.name = 'ReadError';
  }
}

async function fetchFields(client: SuiClient, objectId: string): Promise<Record<string, unknown>> {
  const result = await withRetry(() =>
    client.getObject({ id: objectId, options: { showContent: true } }),
  );
  const content = result.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new ReadError(objectId, `No Move content (got ${content?.dataType ?? 'undefined'})`);
  }
  return content.fields as Record<string, unknown>;
}

export async function readVaultState(client: SuiClient, id: string): Promise<VaultState> {
  try {
    return VaultStateSchema.parse(await fetchFields(client, id));
  } catch (e) {
    throw new ReadError(id, e);
  }
}

export async function readShareRegistry(client: SuiClient, id: string): Promise<ShareRegistry> {
  try {
    return ShareRegistrySchema.parse(await fetchFields(client, id));
  } catch (e) {
    throw new ReadError(id, e);
  }
}

export async function readAllocationPolicy(client: SuiClient, id: string): Promise<OnChainAllocationPolicy> {
  try {
    return AllocationPolicySchema.parse(await fetchFields(client, id));
  } catch (e) {
    throw new ReadError(id, e);
  }
}

export async function readIBCreditState(client: SuiClient, id: string): Promise<IBCreditState> {
  try {
    return IBCreditStateSchema.parse(await fetchFields(client, id));
  } catch (e) {
    throw new ReadError(id, e);
  }
}

export async function readVaultPosition(client: SuiClient, id: string): Promise<VaultPositionData> {
  try {
    return VaultPositionSchema.parse(await fetchFields(client, id));
  } catch (e) {
    throw new ReadError(id, e);
  }
}

/** Coin balance of a SUI coin object. */
export async function readCoinBalance(client: SuiClient, coinObjectId: string): Promise<bigint> {
  const result = await withRetry(() =>
    client.getObject({ id: coinObjectId, options: { showContent: true } }),
  );
  const content = result.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new ReadError(coinObjectId, 'Not a Move object');
  }
  const fields = content.fields as Record<string, unknown>;
  const balance = fields['balance'];
  return BigInt(String(balance));
}
