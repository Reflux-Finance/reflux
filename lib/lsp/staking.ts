import type { SuiClient } from '@mysten/sui/client';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import type { RefluxEnv } from '../constants.js';
import { PRICE_SCALE_E9 } from '../constants.js';
import {
  getVoloExchangeRateE9,
  buildVoloStakeTx,
  buildVoloUnstakeTx,
} from '../lsd/volo.js';
import {
  getAftermathExchangeRateE9,
  buildAftermathStakeTx,
  buildAftermathUnstakeTx,
} from '../lsd/aftermath.js';
import {
  getHaedalExchangeRateE9,
  buildHaedalStakeTx,
  buildHaedalUnstakeTx,
} from '../lsd/haedal.js';

export type LsdVariant = 'vsui' | 'afsui' | 'hasui';

export interface LsdAdapter {
  getExchangeRateE9(client: SuiClient, env: RefluxEnv): Promise<bigint>;
  buildStakeTx(tx: Transaction, suiCoin: TransactionArgument, env: RefluxEnv): TransactionArgument;
  buildUnstakeTx(tx: Transaction, lsdCoin: TransactionArgument, env: RefluxEnv): TransactionArgument;
}

/** Convert LSD amount to SUI equivalent using exchange rate. */
export function lsdToSuiAmount(lsdAmount: bigint, exchangeRateE9: bigint): bigint {
  return (lsdAmount * exchangeRateE9) / PRICE_SCALE_E9;
}

/** Convert SUI amount to LSD equivalent using exchange rate. */
export function suiToLsdAmount(suiAmount: bigint, exchangeRateE9: bigint): bigint {
  if (exchangeRateE9 === 0n) return 0n;
  return (suiAmount * PRICE_SCALE_E9) / exchangeRateE9;
}

const voloAdapter: LsdAdapter = {
  async getExchangeRateE9(client, e) {
    if (!e.NEXT_PUBLIC_VOLO_STAKING_POOL) throw new Error('NEXT_PUBLIC_VOLO_STAKING_POOL not set');
    return getVoloExchangeRateE9(client, e.NEXT_PUBLIC_VOLO_STAKING_POOL);
  },
  buildStakeTx(tx, suiCoin, e) {
    if (!e.NEXT_PUBLIC_VOLO_STAKING_POOL) throw new Error('NEXT_PUBLIC_VOLO_STAKING_POOL not set');
    if (!e.NEXT_PUBLIC_PACKAGE_ID) throw new Error('NEXT_PUBLIC_PACKAGE_ID not set');
    return buildVoloStakeTx(tx, suiCoin, e.NEXT_PUBLIC_VOLO_STAKING_POOL, e.NEXT_PUBLIC_PACKAGE_ID);
  },
  buildUnstakeTx(tx, lsdCoin, e) {
    if (!e.NEXT_PUBLIC_VOLO_STAKING_POOL) throw new Error('NEXT_PUBLIC_VOLO_STAKING_POOL not set');
    if (!e.NEXT_PUBLIC_PACKAGE_ID) throw new Error('NEXT_PUBLIC_PACKAGE_ID not set');
    return buildVoloUnstakeTx(tx, lsdCoin, e.NEXT_PUBLIC_VOLO_STAKING_POOL, e.NEXT_PUBLIC_PACKAGE_ID);
  },
};

const aftermathAdapter: LsdAdapter = {
  async getExchangeRateE9(client, e) {
    if (!e.NEXT_PUBLIC_AFTERMATH_STAKING_POOL) throw new Error('NEXT_PUBLIC_AFTERMATH_STAKING_POOL not set');
    return getAftermathExchangeRateE9(client, e.NEXT_PUBLIC_AFTERMATH_STAKING_POOL);
  },
  buildStakeTx(tx, suiCoin, e) {
    if (!e.NEXT_PUBLIC_AFTERMATH_STAKING_POOL) throw new Error('NEXT_PUBLIC_AFTERMATH_STAKING_POOL not set');
    if (!e.NEXT_PUBLIC_PACKAGE_ID) throw new Error('NEXT_PUBLIC_PACKAGE_ID not set');
    return buildAftermathStakeTx(tx, suiCoin, e.NEXT_PUBLIC_AFTERMATH_STAKING_POOL, e.NEXT_PUBLIC_PACKAGE_ID);
  },
  buildUnstakeTx(tx, lsdCoin, e) {
    if (!e.NEXT_PUBLIC_AFTERMATH_STAKING_POOL) throw new Error('NEXT_PUBLIC_AFTERMATH_STAKING_POOL not set');
    if (!e.NEXT_PUBLIC_PACKAGE_ID) throw new Error('NEXT_PUBLIC_PACKAGE_ID not set');
    return buildAftermathUnstakeTx(tx, lsdCoin, e.NEXT_PUBLIC_AFTERMATH_STAKING_POOL, e.NEXT_PUBLIC_PACKAGE_ID);
  },
};

const haedalAdapter: LsdAdapter = {
  async getExchangeRateE9(client, e) {
    if (!e.NEXT_PUBLIC_HAEDAL_STAKING_POOL) throw new Error('NEXT_PUBLIC_HAEDAL_STAKING_POOL not set');
    return getHaedalExchangeRateE9(client, e.NEXT_PUBLIC_HAEDAL_STAKING_POOL);
  },
  buildStakeTx(tx, suiCoin, e) {
    if (!e.NEXT_PUBLIC_HAEDAL_STAKING_POOL) throw new Error('NEXT_PUBLIC_HAEDAL_STAKING_POOL not set');
    if (!e.NEXT_PUBLIC_PACKAGE_ID) throw new Error('NEXT_PUBLIC_PACKAGE_ID not set');
    return buildHaedalStakeTx(tx, suiCoin, e.NEXT_PUBLIC_HAEDAL_STAKING_POOL, e.NEXT_PUBLIC_PACKAGE_ID);
  },
  buildUnstakeTx(tx, lsdCoin, e) {
    if (!e.NEXT_PUBLIC_HAEDAL_STAKING_POOL) throw new Error('NEXT_PUBLIC_HAEDAL_STAKING_POOL not set');
    if (!e.NEXT_PUBLIC_PACKAGE_ID) throw new Error('NEXT_PUBLIC_PACKAGE_ID not set');
    return buildHaedalUnstakeTx(tx, lsdCoin, e.NEXT_PUBLIC_HAEDAL_STAKING_POOL, e.NEXT_PUBLIC_PACKAGE_ID);
  },
};

export const LSD_ADAPTERS: Record<LsdVariant, LsdAdapter> = {
  vsui: voloAdapter,
  afsui: aftermathAdapter,
  hasui: haedalAdapter,
};

export function getLsdAdapter(variant: LsdVariant): LsdAdapter {
  const adapter = LSD_ADAPTERS[variant];
  if (!adapter) throw new Error(`Unknown LSD variant: ${variant}`);
  return adapter;
}
