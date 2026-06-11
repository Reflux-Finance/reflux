import { describe, expect, it } from 'vitest';
import {
  DEPLOYED_ID_KEYS,
  EnvValidationError,
  MissingDeploymentError,
  readEnv,
  requireDeployed,
} from './constants.js';

const FAKE_ID = '0x' + 'a'.repeat(64);
const FAKE_TYPE = `${FAKE_ID}::share_token::RFUSD`;

describe('readEnv', () => {
  it('applies defaults when env is empty', () => {
    const env = readEnv({});
    expect(env.NEXT_PUBLIC_SUI_NETWORK).toBe('testnet');
    expect(env.NEXT_PUBLIC_PREDICT_SERVER).toBe('https://predict-server.testnet.mystenlabs.com');
  });

  it('rejects malformed object IDs', () => {
    expect(() => readEnv({ NEXT_PUBLIC_PACKAGE_ID: 'not-an-id' })).toThrow(EnvValidationError);
  });

  it('rejects a bare address where a Move type is required', () => {
    expect(() => readEnv({ NEXT_PUBLIC_RFUSD_TYPE: FAKE_ID })).toThrow(EnvValidationError);
  });

  it('accepts a fully-qualified Move type', () => {
    const env = readEnv({ NEXT_PUBLIC_RFUSD_TYPE: FAKE_TYPE });
    expect(env.NEXT_PUBLIC_RFUSD_TYPE).toBe(FAKE_TYPE);
  });
});

describe('requireDeployed', () => {
  it('throws listing EVERY missing key, not just the first', () => {
    const env = readEnv({ NEXT_PUBLIC_PACKAGE_ID: FAKE_ID });
    try {
      requireDeployed(env);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as MissingDeploymentError;
      expect(err).toBeInstanceOf(MissingDeploymentError);
      expect(err.missing).toEqual(DEPLOYED_ID_KEYS.filter((k) => k !== 'NEXT_PUBLIC_PACKAGE_ID'));
      for (const key of err.missing) expect(err.message).toContain(key);
    }
  });

  it('returns narrowed constants when everything is configured', () => {
    const env = readEnv({
      NEXT_PUBLIC_PACKAGE_ID: FAKE_ID,
      NEXT_PUBLIC_VAULT_ID: FAKE_ID,
      NEXT_PUBLIC_RFUSD_TYPE: FAKE_TYPE,
      NEXT_PUBLIC_DEPOSIT_ROUTER_ID: FAKE_ID,
      NEXT_PUBLIC_ALLOCATOR_ID: FAKE_ID,
      NEXT_PUBLIC_IB_CREDIT_STATE_ID: FAKE_ID,
    });
    const deployed = requireDeployed(env);
    expect(deployed.NEXT_PUBLIC_VAULT_ID).toBe(FAKE_ID);
  });
});
