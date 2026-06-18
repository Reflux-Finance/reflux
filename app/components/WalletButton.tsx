'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSuiClientQuery } from '@mysten/dapp-kit';
import { useAuth } from '../hooks/useAuth';
import { RFUSD_TYPE, DUSDC_TYPE } from '@reflux/lib';

// ─── Known coin types displayed in the balance panel ─────────────────────────

const SUI_TYPE  = '0x2::sui::SUI';
const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

interface CoinMeta { symbol: string; decimals: number; color: string }

const COIN_META: Record<string, CoinMeta> = {
  [SUI_TYPE]:    { symbol: 'SUI',   decimals: 9, color: '#6CBBFF' },
  [USDC_TYPE]:   { symbol: 'USDC',  decimals: 6, color: '#2775CA' },
  [RFUSD_TYPE]:  { symbol: 'rfUSD', decimals: 9, color: '#00D4C8' },
  [DUSDC_TYPE]:  { symbol: 'dUSDC', decimals: 6, color: '#A78BFA' },
  // vSUI / Volo cert
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT':
    { symbol: 'vSUI', decimals: 9, color: '#34D399' },
};

function fmt(raw: string, decimals: number): string {
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n >= 1_000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
       : n >= 0.001  ? n.toFixed(3).replace(/\.?0+$/, '')
       : n > 0       ? '<0.001'
       : '0';
}

function truncate(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// ─── Balance panel (inside dropdown) ─────────────────────────────────────────

const ALWAYS_SHOWN = [SUI_TYPE, USDC_TYPE];

function BalanceList({ address }: { address: string }) {
  const { data, isLoading } = useSuiClientQuery(
    'getAllBalances',
    { owner: address },
    { staleTime: 15_000 },
  );

  const allKnown = (data ?? []).filter((b) => COIN_META[b.coinType]);
  const balanceMap = new Map(allKnown.map((b) => [b.coinType, b.totalBalance]));

  // SUI + USDC always shown even at zero; other assets only when non-zero
  const alwaysRows = ALWAYS_SHOWN.map((type) => ({
    coinType: type,
    totalBalance: balanceMap.get(type) ?? '0',
  }));
  const extraRows = allKnown.filter(
    (b) => !ALWAYS_SHOWN.includes(b.coinType) && BigInt(b.totalBalance) > 0n,
  );
  const rows = [...alwaysRows, ...extraRows];

  if (isLoading) {
    return (
      <div className="py-3 flex items-center justify-center">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Loading balances…</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map((b) => {
        const meta = COIN_META[b.coinType];
        if (!meta) return null;
        return (
          <div key={b.coinType} className="flex items-center justify-between py-1.5 px-3 rounded-lg"
            style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-xs font-medium" style={{ color: meta.color }}>{meta.symbol}</span>
            <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
              {fmt(b.totalBalance, meta.decimals)}
            </span>
          </div>
        );
      })}
      {rows.length === 0 && (
        <p className="text-[11px] text-center py-2" style={{ color: 'var(--text-muted)' }}>
          No balances found on testnet
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);

  const { address, isConnected, authMethod, disconnect } = useAuth();
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  // Static "Connect" during SSR / hydration pass to avoid mismatch
  if (!mounted) {
    return (
      <button className="btn-teal text-xs px-4 py-2 rounded-lg font-semibold">
        Connect
      </button>
    );
  }

  if (!isConnected || !address) {
    return (
      <button
        onClick={() => router.push('/login')}
        className="btn-teal text-xs px-4 py-2 rounded-lg font-semibold"
      >
        Connect
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      {/* Address chip — click to open dropdown */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium transition-all"
        style={{
          background: open ? 'rgba(0,212,200,0.14)' : 'rgba(0,212,200,0.08)',
          border: '1px solid rgba(0,212,200,0.2)',
          color: '#33DDD8',
        }}
        aria-label="Wallet menu"
      >
        <span className="status-dot status-dot-green" />
        {truncate(address)}
        {authMethod === 'zklogin' && (
          <span
            className="ml-0.5 text-[9px] px-1 py-0.5 rounded"
            style={{ background: 'rgba(0,212,200,0.15)', color: 'var(--teal-light)' }}
          >
            zkLogin
          </span>
        )}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-64 rounded-xl overflow-hidden shadow-2xl z-50"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          {/* Address row */}
          <div className="px-3 pt-3 pb-2">
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Connected address
            </p>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
                {address}
              </span>
              <button
                onClick={() => void copyAddress()}
                className="flex-shrink-0 text-[10px] px-2 py-1 rounded-md transition-colors font-medium"
                style={{
                  background: copied ? 'rgba(0,212,200,0.15)' : 'var(--bg-elevated)',
                  color: copied ? '#00D4C8' : 'var(--text-muted)',
                  border: '1px solid var(--border-subtle)',
                }}
                title="Copy address"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} className="mx-3" />

          {/* Balances */}
          <div className="px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              On-chain balances
            </p>
            <BalanceList address={address} />
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

          {/* Disconnect */}
          <button
            onClick={() => { disconnect(); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-xs font-medium transition-colors hover:bg-red-900/20"
            style={{ color: 'var(--text-muted)' }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
