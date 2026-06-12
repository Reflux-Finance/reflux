import { describe, expect, it } from 'vitest';
import { lsdToSuiAmount, suiToLsdAmount, getLsdAdapter } from './staking.js';
import { PRICE_SCALE_E9 } from '../constants.js';

describe('lsdToSuiAmount', () => {
  it('1:1 at par rate (1e9)', () => {
    expect(lsdToSuiAmount(1_000_000_000n, PRICE_SCALE_E9)).toBe(1_000_000_000n);
  });

  it('scales correctly at 1.05 rate (vSUI has grown 5%)', () => {
    // rate = 1.05e9; 1 vSUI = 1.05 SUI
    const rate = 1_050_000_000n;
    const suiOut = lsdToSuiAmount(1_000_000_000n, rate);
    expect(suiOut).toBe(1_050_000_000n);
  });
});

describe('suiToLsdAmount', () => {
  it('converts SUI back to vSUI at par', () => {
    expect(suiToLsdAmount(1_000_000_000n, PRICE_SCALE_E9)).toBe(1_000_000_000n);
  });

  it('returns fewer LSD tokens when rate > 1', () => {
    // 1 SUI → 0.952 vSUI at rate 1.05
    const rate = 1_050_000_000n;
    const lsd = suiToLsdAmount(1_000_000_000n, rate);
    expect(lsd).toBeLessThan(1_000_000_000n);
  });

  it('returns 0 for zero rate', () => {
    expect(suiToLsdAmount(1_000_000_000n, 0n)).toBe(0n);
  });
});

describe('getLsdAdapter', () => {
  it('returns an adapter for vsui', () => {
    const adapter = getLsdAdapter('vsui');
    expect(adapter).toBeDefined();
    expect(typeof adapter.getExchangeRateE9).toBe('function');
    expect(typeof adapter.buildStakeTx).toBe('function');
    expect(typeof adapter.buildUnstakeTx).toBe('function');
  });

  it('returns adapters for all three variants', () => {
    for (const variant of ['vsui', 'afsui', 'hasui'] as const) {
      expect(() => getLsdAdapter(variant)).not.toThrow();
    }
  });

  it('throws for unknown variant', () => {
    // @ts-expect-error testing invalid input
    expect(() => getLsdAdapter('xsui')).toThrow();
  });
});
