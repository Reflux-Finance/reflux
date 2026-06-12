import { describe, expect, it } from 'vitest';
import {
  OraclesResponseSchema,
  SviParamsSchema,
  PositionsResponseSchema,
  nearestActiveOracle,
} from './predict.js';

describe('OraclesResponseSchema', () => {
  it('parses a valid oracle list', () => {
    const raw = [
      { id: '0xabc', expiry_ts_ms: 1_700_000_000_000, is_settled: false },
      { id: '0xdef', name: 'SUI/USD', expiry_ts_ms: 1_710_000_000_000, is_settled: true },
    ];
    const oracles = OraclesResponseSchema.parse(raw);
    expect(oracles).toHaveLength(2);
    expect(oracles[0]?.id).toBe('0xabc');
    expect(oracles[1]?.is_settled).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(() => OraclesResponseSchema.parse([{ id: '0xabc' }])).toThrow();
  });
});

describe('SviParamsSchema', () => {
  it('parses valid SVI params', () => {
    const raw = {
      oracle_id: '0xabc',
      a: 0.04,
      b: 0.4,
      rho: -0.1,
      m: 0.0,
      sigma: 0.1,
      timestamp_ms: 1_700_000_000_000,
    };
    const params = SviParamsSchema.parse(raw);
    expect(params.a).toBe(0.04);
    expect(params.rho).toBe(-0.1);
  });
});

describe('PositionsResponseSchema', () => {
  it('parses a position list', () => {
    const raw = [
      {
        id: '0x111',
        manager: '0x222',
        oracle_id: '0xabc',
        position_type: 0,
        capital_dusdc: '10000000',
        is_settled: false,
      },
    ];
    const positions = PositionsResponseSchema.parse(raw);
    expect(positions[0]?.capital_dusdc).toBe('10000000');
  });
});

describe('nearestActiveOracle', () => {
  it('returns the oracle with the soonest expiry', () => {
    const oracles = [
      { id: 'c', expiry_ts_ms: 3000, is_settled: false },
      { id: 'a', expiry_ts_ms: 1000, is_settled: false },
      { id: 'b', expiry_ts_ms: 2000, is_settled: false },
    ];
    expect(nearestActiveOracle(oracles)?.id).toBe('a');
  });

  it('skips settled oracles', () => {
    const oracles = [
      { id: 'settled', expiry_ts_ms: 500, is_settled: true },
      { id: 'active', expiry_ts_ms: 1000, is_settled: false },
    ];
    expect(nearestActiveOracle(oracles)?.id).toBe('active');
  });

  it('returns undefined when all settled', () => {
    expect(nearestActiveOracle([{ id: 'x', expiry_ts_ms: 1000, is_settled: true }])).toBeUndefined();
  });
});
