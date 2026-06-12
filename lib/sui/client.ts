import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import type { RefluxEnv } from '../constants.js';
import { env } from '../constants.js';

const NETWORK_URLS: Record<string, string> = {
  localnet: 'http://127.0.0.1:9000',
  devnet: getFullnodeUrl('devnet'),
  testnet: getFullnodeUrl('testnet'),
  mainnet: getFullnodeUrl('mainnet'),
};

export function createSuiClient(network: RefluxEnv['NEXT_PUBLIC_SUI_NETWORK'] = env.NEXT_PUBLIC_SUI_NETWORK): SuiClient {
  const url = NETWORK_URLS[network];
  if (!url) throw new Error(`Unknown network: ${network}`);
  return new SuiClient({ url });
}

/** Shared singleton for the configured network. */
export const suiClient: SuiClient = createSuiClient();

/** Retry an async call with exponential backoff. Throws the last error on exhaustion. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 200, timeoutMs = 10_000 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((res) => setTimeout(res, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}
