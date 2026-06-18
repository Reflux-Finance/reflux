'use client';

import { useEffect, useState } from 'react';
import { SwapInterface } from '../../components/SwapInterface';

interface PoolReserves { a: string; b: string }
interface PoolsData {
  usdc_dusdc: PoolReserves;
  sui_dusdc: PoolReserves;
  rfbtc_dusdc: PoolReserves;
}

const EMPTY_POOLS: PoolsData = {
  usdc_dusdc:  { a: '0', b: '0' },
  sui_dusdc:   { a: '0', b: '0' },
  rfbtc_dusdc: { a: '0', b: '0' },
};

function isLive(r: PoolReserves): boolean {
  return BigInt(r.a) > 0n && BigInt(r.b) > 0n;
}

export default function TradePage() {
  const [pools, setPools] = useState<PoolsData>(EMPTY_POOLS);

  useEffect(() => {
    async function fetchPools() {
      try {
        const res = await fetch('/api/spot/pools');
        const json = await res.json() as { ok: boolean; data?: { pools: PoolsData } };
        if (json.ok && json.data) setPools(json.data.pools);
      } catch { /* stale data fine */ }
    }
    void fetchPools();
    const id = setInterval(fetchPools, 30_000);
    return () => clearInterval(id);
  }, []);

  const suiLive   = isLive(pools.sui_dusdc);
  const usdcLive  = isLive(pools.usdc_dusdc);
  const rfbtcLive = isLive(pools.rfbtc_dusdc);

  const poolRows = [
    { pair: 'SUI / dUSDC',   status: suiLive ? 'live' : 'external_pending',                     note: 'DeepBook Spot — DR-1' },
    { pair: 'USDC / dUSDC',  status: usdcLive ? 'live' : 'external_pending',                     note: 'DeepBook Spot — DR-1' },
    { pair: 'rfBTC / dUSDC', status: rfbtcLive ? 'live' : 'external_pending',                     note: 'DeepBook Spot — DR-1' },
    { pair: 'SUI / USDC',    status: suiLive && usdcLive ? 'live' : 'external_pending',           note: '2-hop via dUSDC'       },
    { pair: 'SUI / rfBTC',   status: suiLive && rfbtcLive ? 'live' : 'external_pending',          note: '2-hop via dUSDC'       },
    { pair: 'USDC / rfBTC',  status: usdcLive && rfbtcLive ? 'live' : 'external_pending',         note: '2-hop via dUSDC'       },
  ];

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Trade</h1>
        <p className="text-sm text-gray-500 mt-1">
          Swap between supported assets. All routes settle in dUSDC.
        </p>
      </div>

      <SwapInterface />

      {/* Pool status table */}
      <div className="mt-8 bg-[#0D1117] border border-gray-800 rounded-2xl p-5">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4">
          Pool status
        </div>
        <div className="space-y-2 text-xs font-mono">
          {poolRows.map(({ pair, status, note }) => (
            <div key={pair} className="flex items-center justify-between py-1.5 border-b border-gray-800/60 last:border-0">
              <span className="text-gray-300">{pair}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">{note}</span>
                <span
                  className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider"
                  style={{
                    background: status === 'live' ? 'rgba(0,212,200,0.12)' : 'rgba(245,158,11,0.1)',
                    color:      status === 'live' ? '#00D4C8'              : '#D97706',
                    border:     `1px solid ${status === 'live' ? 'rgba(0,212,200,0.3)' : 'rgba(245,158,11,0.25)'}`,
                  }}
                >
                  {status === 'live' ? 'live' : 'pending'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10px] text-gray-700 leading-relaxed">
          Status reflects live on-chain reserves in SpotRouterConfig — a pair shows
          live once both sides of its pool are seeded.
          rfBTC faucet is live now — get test BTC directly from the swap interface above.
        </p>
      </div>
    </main>
  );
}
