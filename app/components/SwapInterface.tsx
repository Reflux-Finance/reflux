'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClientQuery,
  useSuiClientContext,
} from '@mysten/dapp-kit';
import { useEnokiFlow } from '@mysten/enoki/react';
import { useAuth } from '../hooks/useAuth';

// ─── Token catalogue ─────────────────────────────────────────────────────────

const USDC_TYPE   = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const DUSDC_TYPE  = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const SUI_TYPE    = '0x2::sui::SUI';
const RFBTC_TYPE  = process.env.NEXT_PUBLIC_RFBTC_TYPE ?? '';

const PYTH_SUI  = process.env.NEXT_PUBLIC_PYTH_SUI_PRICE_ID  ?? '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744';
const PYTH_BTC  = process.env.NEXT_PUBLIC_PYTH_BTC_PRICE_ID  ?? 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

interface Token {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  color: string;
  available: boolean;
  unavailableReason?: string;
  moveType: string;
  priceRef: 'sui' | 'btc' | 'usd';
}

const TOKENS: Token[] = [
  // ── Available ──────────────────────────────────────────────────────────────
  { id: 'sui',   symbol: 'SUI',   name: 'Sui',           decimals: 9, color: '#4CA3FF', available: true,  moveType: SUI_TYPE,   priceRef: 'sui' },
  { id: 'usdc',  symbol: 'USDC',  name: 'USD Coin',      decimals: 6, color: '#2775CA', available: true,  moveType: USDC_TYPE,  priceRef: 'usd' },
  { id: 'dusdc', symbol: 'dUSDC', name: 'DeepBook USDC', decimals: 6, color: '#00D4C8', available: true,  moveType: DUSDC_TYPE, priceRef: 'usd' },
  { id: 'rfbtc', symbol: 'rfBTC', name: 'Reflux BTC',    decimals: 8, color: '#F7931A', available: true,  moveType: RFBTC_TYPE, priceRef: 'btc' },
  // ── Unavailable ────────────────────────────────────────────────────────────
  { id: 'dbtc',  symbol: 'dBTC',  name: 'DeepBook BTC',  decimals: 8, color: '#C97B2D', available: false, unavailableReason: 'dBTC not deployed',      moveType: '', priceRef: 'btc' },
  { id: 'xbtc',  symbol: 'xBTC',  name: 'Axelar BTC',    decimals: 8, color: '#E08040', available: false, unavailableReason: 'xBTC not on testnet',    moveType: '', priceRef: 'btc' },
  { id: 'sbtc',  symbol: 'sBTC',  name: 'Stacks BTC',    decimals: 8, color: '#FF5500', available: false, unavailableReason: 'sBTC not on testnet',    moveType: '', priceRef: 'btc' },
  { id: 'vsui',  symbol: 'vSUI',  name: 'Volo SUI',      decimals: 9, color: '#7B4FFF', available: false, unavailableReason: 'Volo not on testnet',    moveType: '', priceRef: 'sui' },
  { id: 'afsui', symbol: 'afSUI', name: 'Aftermath SUI', decimals: 9, color: '#FF4747', available: false, unavailableReason: 'Aftermath not on testnet', moveType: '', priceRef: 'sui' },
  { id: 'hasui',  symbol: 'haSUI',  name: 'Haedal SUI',           decimals: 9, color: '#FF9900', available: false, unavailableReason: 'Haedal not on testnet',   moveType: '',                                                                                                                                                       priceRef: 'sui' },
  // ── Scallop sCoins — mainnet only ─────────────────────────────────────────
  { id: 'ssui',   symbol: 'sSUI',   name: 'Scallop SUI',          decimals: 9, color: '#3A90EE', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0xaafc4f740de0dd0dde642a31148fb94517087052f19afb0f7bed1dc41a50c77b::scallop_sui::SCALLOP_SUI',                                                                    priceRef: 'sui' },
  { id: 'svsui',  symbol: 'svSUI',  name: 'Scallop vSUI',         decimals: 9, color: '#6B7FEE', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0xe1a1cc6bcf0001a015eab84bcc6713393ce20535f55b8b6f35c142e057a25fbe::scallop_v_sui::SCALLOP_V_SUI',                                                                   priceRef: 'sui' },
  { id: 'safsui', symbol: 'safSUI', name: 'Scallop afSUI',        decimals: 9, color: '#EE6B6B', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0x00671b1fa2a124f5be8bdae8b91ee711462c5d9e31bda232e70fd9607b523c88::scallop_af_sui::SCALLOP_AF_SUI',                                                                    priceRef: 'sui' },
  { id: 'shasui', symbol: 'shaSUI', name: 'Scallop haSUI',        decimals: 9, color: '#EEAA55', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0x9a2376943f7d22f88087c259c5889925f332ca4347e669dc37d54c2bf651af3c::scallop_ha_sui::SCALLOP_HA_SUI',                                                                    priceRef: 'sui' },
  { id: 'susdc',  symbol: 'sUSDC',  name: 'Scallop USDC',         decimals: 6, color: '#1A8FA0', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0x854950aa624b1df59fe64e630b2ba7c550642e9342267a33061d59fb31582da5::scallop_usdc::SCALLOP_USDC',                                                                       priceRef: 'usd' },
  { id: 'swusdc', symbol: 'sWUSDC', name: 'Scallop Wormhole USDC',decimals: 6, color: '#1A7898', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0xad4d71551d31092230db1fd482008ea42867dbf27b286e9c70a79d2a6191d58d::scallop_wormhole_usdc::SCALLOP_WORMHOLE_USDC',                                                        priceRef: 'usd' },
  { id: 'swusdt', symbol: 'sWUSDT', name: 'Scallop Wormhole USDT',decimals: 6, color: '#1AAA7E', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0xe6e5a012ec20a49a3d1d57bd2b67140b96cd4d3400b9d79e541f7bdbab661f95::scallop_wormhole_usdt::SCALLOP_WORMHOLE_USDT',                                                        priceRef: 'usd' },
  { id: 'sweth',  symbol: 'sWETH',  name: 'Scallop Wormhole ETH', decimals: 8, color: '#8855CC', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0x67540ceb850d418679e69f1fb6b2093d6df78a2a699ffc733f7646096d552e9b::scallop_wormhole_eth::SCALLOP_WORMHOLE_ETH',                                                           priceRef: 'usd' },
  { id: 'ssbeth', symbol: 'ssbETH', name: 'Scallop sb-ETH',       decimals: 8, color: '#9966DD', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0xb14f82d8506d139eacef109688d1b71e7236bcce9b2c0ad526abcd6aa5be7de0::scallop_sb_eth::SCALLOP_SB_ETH',                                                                      priceRef: 'usd' },
  { id: 'ssca',   symbol: 'sSCA',   name: 'Scallop SCA',          decimals: 6, color: '#FF7744', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0x5ca17430c1d046fae9edeaa8fd76c7b4193a00d764a0ecfa9418d733ad27bc1e::scallop_sca::SCALLOP_SCA',                                                                        priceRef: 'usd' },
  { id: 'scetus', symbol: 'sCETUS', name: 'Scallop CETUS',        decimals: 6, color: '#11AA88', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0xea346ce428f91ab007210443efcea5f5cdbbb3aae7e9affc0ca93f9203c31f0c::scallop_cetus::SCALLOP_CETUS',                                                                     priceRef: 'usd' },
  { id: 'sdeep',  symbol: 'sDEEP',  name: 'Scallop DEEP',         decimals: 6, color: '#5577CC', available: false, unavailableReason: 'Scallop not on testnet', moveType: '0xeb7a05a3224837c5e5503575aed0be73c091d1ce5e43aa3c3e716e0ae614608f::scallop_deep::SCALLOP_DEEP',                                                                       priceRef: 'usd' },
];

const DEFAULT_FROM = TOKENS.find(t => t.id === 'sui')!;
const DEFAULT_TO   = TOKENS.find(t => t.id === 'dusdc')!;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tokenToUsd(token: Token, amount: number, sui: number, btc: number): number {
  if (token.priceRef === 'sui') return amount * sui;
  if (token.priceRef === 'btc') return amount * btc;
  return amount;
}

function usdToToken(token: Token, usd: number, sui: number, btc: number): number {
  if (token.priceRef === 'sui') return sui > 0 ? usd / sui : 0;
  if (token.priceRef === 'btc') return btc > 0 ? usd / btc : 0;
  return usd;
}

function getRoute(from: string, to: string): string[] {
  const direct = new Set(['sui→dusdc','dusdc→sui','usdc→dusdc','dusdc→usdc','rfbtc→dusdc','dusdc→rfbtc']);
  if (direct.has(`${from}→${to}`)) return [from, to];
  if (from !== 'dusdc' && to !== 'dusdc') return [from, 'dusdc', to];
  return [from, to];
}

// ─── On-chain pool state ──────────────────────────────────────────────────────

interface PoolReserves { a: string; b: string }
interface PoolState {
  pools: { usdc_dusdc: PoolReserves; sui_dusdc: PoolReserves; rfbtc_dusdc: PoolReserves };
  funded: boolean;
}

const EMPTY_POOLS: PoolState = {
  pools: { usdc_dusdc: { a: '0', b: '0' }, sui_dusdc: { a: '0', b: '0' }, rfbtc_dusdc: { a: '0', b: '0' } },
  funded: false,
};

// CPAMM with 0.3% fee (matches on-chain FEE_BPS=30)
function cpammOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (reserveIn === 0n || reserveOut === 0n || amountIn === 0n) return 0n;
  const feeNum = 9_970n;
  const aw = amountIn * feeNum;
  return (aw * reserveOut) / (reserveIn * 10_000n + aw);
}

function quoteSwap(
  from: string, to: string,
  amountInFloat: number, fromDec: number, toDec: number,
  pools: PoolState,
): { out: number; impact: number } | null {
  if (!pools.funded || amountInFloat <= 0) return null;
  const amountIn = BigInt(Math.floor(amountInFloat * 10 ** fromDec));
  const p = pools.pools;
  const rSuiA = BigInt(p.sui_dusdc.a), rSuiB = BigInt(p.sui_dusdc.b);
  const rBtcA = BigInt(p.rfbtc_dusdc.a), rBtcB = BigInt(p.rfbtc_dusdc.b);

  let outRaw: bigint;
  let idealOut: bigint; // no-fee spot price output for impact calc

  const pair = `${from}→${to}`;
  if (pair === 'usdc→dusdc' || pair === 'dusdc→usdc') {
    outRaw = amountIn; // 1:1 treasury
    return { out: Number(outRaw) / 10 ** toDec, impact: 0 };
  } else if (pair === 'sui→dusdc') {
    outRaw = cpammOut(amountIn, rSuiA, rSuiB);
    idealOut = rSuiA > 0n ? (amountIn * rSuiB) / rSuiA : 0n;
  } else if (pair === 'dusdc→sui') {
    outRaw = cpammOut(amountIn, rSuiB, rSuiA);
    idealOut = rSuiB > 0n ? (amountIn * rSuiA) / rSuiB : 0n;
  } else if (pair === 'rfbtc→dusdc') {
    outRaw = cpammOut(amountIn, rBtcA, rBtcB);
    idealOut = rBtcA > 0n ? (amountIn * rBtcB) / rBtcA : 0n;
  } else if (pair === 'dusdc→rfbtc') {
    outRaw = cpammOut(amountIn, rBtcB, rBtcA);
    idealOut = rBtcB > 0n ? (amountIn * rBtcA) / rBtcB : 0n;
  } else if (from !== 'dusdc' && to !== 'dusdc') {
    // multi-hop: from → dUSDC → to (both legs CPAMM)
    const fromDec_ = fromDec; // already in base units
    const hop1 = from === 'sui'
      ? cpammOut(amountIn, rSuiA, rSuiB)
      : cpammOut(amountIn, rBtcA, rBtcB);
    const hop2 = to === 'sui'
      ? cpammOut(hop1, rSuiB, rSuiA)
      : cpammOut(hop1, rBtcB, rBtcA);
    void fromDec_;
    outRaw = hop2;
    idealOut = outRaw; // skip impact for multi-hop
  } else {
    return null;
  }

  const out = Number(outRaw) / 10 ** toDec;
  const impact = idealOut > 0n
    ? Math.max(0, 1 - Number(outRaw) / Number(idealOut))
    : 0;
  return { out, impact };
}

function formatBalance(raw: string, decimals: number): string {
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n < 0.001 ? '<0.001' : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmt(n: number, dp = 4): string {
  if (n === 0) return '0';
  if (n < 0.000001) return n.toExponential(2);
  if (n < 1) return n.toFixed(dp);
  if (n < 1000) return n.toFixed(Math.min(dp, 2));
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TokenIcon({ token, size = 28 }: { token: Token; size?: number }) {
  const initials = token.symbol.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: `${token.color}22`,
        border: `1.5px solid ${token.color}55`,
        color: token.color,
        fontSize: size * 0.36,
      }}
    >
      {initials}
    </div>
  );
}

function TokenButton({
  token,
  onClick,
}: {
  token: Token;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#1C2430] hover:bg-[#222D3C] border border-gray-700/60 hover:border-gray-600 transition-all duration-150 focus:outline-none"
    >
      <TokenIcon token={token} size={22} />
      <span className="text-sm font-semibold text-white whitespace-nowrap">{token.symbol}</span>
      <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function TokenPicker({
  selected,
  excluded,
  onSelect,
  onClose,
}: {
  selected: Token;
  excluded: Token;
  onSelect: (t: Token) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = TOKENS.filter(
    t => t.id !== excluded.id &&
    (t.symbol.toLowerCase().includes(query.toLowerCase()) ||
     t.name.toLowerCase().includes(query.toLowerCase())),
  );
  const available   = filtered.filter(t => t.available);
  const unavailable = filtered.filter(t => !t.available);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        className="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 rounded-2xl border border-gray-700/60 overflow-hidden"
        style={{ background: '#0D1117' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-800">
          <span className="text-sm font-semibold text-white">Select token</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-800">
          <input
            autoFocus
            placeholder="Search name or symbol…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-[#1C2430] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-teal-500/60 transition-colors"
          />
        </div>

        {/* Token list */}
        <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
          {/* Available */}
          {available.map(t => (
            <button
              key={t.id}
              onClick={() => { onSelect(t); onClose(); }}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors ${selected.id === t.id ? 'bg-teal-950/30' : ''}`}
            >
              <TokenIcon token={t} size={32} />
              <div className="text-left min-w-0">
                <div className="text-sm font-semibold text-white">{t.symbol}</div>
                <div className="text-xs text-gray-500 truncate">{t.name}</div>
              </div>
              {selected.id === t.id && (
                <svg className="w-4 h-4 text-teal-400 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                </svg>
              )}
            </button>
          ))}

          {/* Separator */}
          {unavailable.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-800/60 mt-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-600">
                Not available on testnet
              </span>
            </div>
          )}

          {/* Unavailable — blurred */}
          {unavailable.map(t => (
            <div
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 cursor-not-allowed select-none"
              style={{ filter: 'blur(0.6px)', opacity: 0.45 }}
            >
              <TokenIcon token={t} size={32} />
              <div className="text-left min-w-0">
                <div className="text-sm font-semibold text-gray-400">{t.symbol}</div>
                <div className="text-xs text-gray-600 truncate">{t.name}</div>
              </div>
              <span className="ml-auto flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-600 border border-gray-700/40">
                {t.unavailableReason}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Slippage settings panel ─────────────────────────────────────────────────

const SLIPPAGE_PRESETS = [
  { label: '0.1%', bps: 10 },
  { label: '0.5%', bps: 50 },
  { label: '1%',   bps: 100 },
];

function SlippagePanel({
  slippageBps,
  setSlippageBps,
  onClose,
}: {
  slippageBps: number;
  setSlippageBps: (v: number) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState('');
  const isPreset = SLIPPAGE_PRESETS.some(p => p.bps === slippageBps);

  return (
    <div
      className="absolute top-10 right-0 z-30 w-64 rounded-xl border border-gray-700/60 p-4 shadow-2xl"
      style={{ background: '#0D1117' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-300">Slippage tolerance</span>
        <button onClick={onClose} className="text-gray-600 hover:text-white text-xs transition-colors">✕</button>
      </div>
      <div className="flex gap-2 mb-3">
        {SLIPPAGE_PRESETS.map(p => (
          <button
            key={p.bps}
            onClick={() => { setSlippageBps(p.bps); setCustom(''); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
              slippageBps === p.bps && isPreset
                ? 'bg-teal-600/30 text-teal-300 border border-teal-500/60'
                : 'bg-gray-800 text-gray-400 border border-gray-700/60 hover:border-gray-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <input
          type="number"
          min="0.01"
          max="50"
          step="0.01"
          placeholder="Custom %"
          value={custom}
          onChange={e => {
            setCustom(e.target.value);
            const n = parseFloat(e.target.value);
            if (!isNaN(n) && n > 0) setSlippageBps(Math.round(n * 100));
          }}
          className="w-full bg-[#1C2430] border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-teal-500/60 pr-8 transition-colors"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-600">%</span>
      </div>
      <div className="mt-2 text-[10px] text-gray-600 font-mono">
        Current: {(slippageBps / 100).toFixed(2)}%
        {slippageBps > 100 && <span className="text-amber-500 ml-2">⚠ High slippage</span>}
      </div>
    </div>
  );
}

// ─── Main SwapInterface ───────────────────────────────────────────────────────

export function SwapInterface() {
  const auth    = useAuth();
  const account = useCurrentAccount();
  const flow    = useEnokiFlow();
  const { client: suiClient } = useSuiClientContext();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [fromToken, setFromToken]     = useState<Token>(DEFAULT_FROM);
  const [toToken,   setToToken]       = useState<Token>(DEFAULT_TO);
  const [fromAmount, setFromAmount]   = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [showSettings, setShowSettings] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker,   setShowToPicker]   = useState(false);
  const [prices, setPrices]     = useState({ sui: 0, btc: 0 });
  const [pools,  setPools]      = useState<PoolState>(EMPTY_POOLS);
  const [loadingFaucet, setLoadingFaucet] = useState(false);
  const [loadingSwap,   setLoadingSwap]   = useState(false);
  const [txDigest, setTxDigest] = useState('');
  const [error, setError]       = useState('');

  // Fetch Pyth prices every 15 s
  useEffect(() => {
    async function fetch_() {
      try {
        const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SUI}&ids[]=${PYTH_BTC}`;
        const res  = await fetch(url);
        const data = await res.json() as { parsed: Array<{ id: string; price: { price: string; expo: number } }> };
        for (const p of data.parsed ?? []) {
          const price = Number(p.price.price) * Math.pow(10, p.price.expo);
          if (p.id.startsWith(PYTH_SUI.slice(0,10))) setPrices(prev => ({ ...prev, sui: price }));
          if (p.id.startsWith(PYTH_BTC.slice(0,10))) setPrices(prev => ({ ...prev, btc: price }));
        }
      } catch { /* ignore — stale prices are fine */ }
    }
    void fetch_();
    const id = setInterval(fetch_, 15_000);
    return () => clearInterval(id);
  }, []);

  // Pool state — poll every 30 s
  useEffect(() => {
    async function fetchPools() {
      try {
        const res = await fetch('/api/spot/pools');
        const json = await res.json() as { ok: boolean; data?: PoolState };
        if (json.ok && json.data) setPools(json.data);
      } catch { /* stale data fine */ }
    }
    void fetchPools();
    const id = setInterval(fetchPools, 30_000);
    return () => clearInterval(id);
  }, []);

  // Balance queries
  const { data: fromCoinsData } = useSuiClientQuery(
    'getCoins',
    { owner: auth.address ?? '', coinType: fromToken.moveType },
    { enabled: Boolean(auth.address && fromToken.moveType) },
  );
  const { data: toCoinsData } = useSuiClientQuery(
    'getCoins',
    { owner: auth.address ?? '', coinType: toToken.moveType },
    { enabled: Boolean(auth.address && toToken.moveType) },
  );

  const fromBalance = useMemo(() => {
    const coins = fromCoinsData?.data;
    if (!coins?.length) return '0';
    return coins.reduce((sum, c) => sum + BigInt(c.balance), 0n).toString();
  }, [fromCoinsData]);

  const toBalance = useMemo(() => {
    const coins = toCoinsData?.data;
    if (!coins?.length) return '0';
    return coins.reduce((sum, c) => sum + BigInt(c.balance), 0n).toString();
  }, [toCoinsData]);

  // Best coin for the swap
  const bestFromCoin = useMemo(() => {
    const coins = fromCoinsData?.data;
    if (!coins?.length) return null;
    return coins.reduce((best, c) => BigInt(c.balance) > BigInt(best.balance) ? c : best);
  }, [fromCoinsData]);

  // Computed output — prefer on-chain CPAMM quote, fallback to Pyth oracle estimate
  const { toAmount, priceImpact } = useMemo(() => {
    const n = parseFloat(fromAmount);
    if (isNaN(n) || n <= 0) return { toAmount: '', priceImpact: 0 };

    // On-chain CPAMM quote (when pools are seeded)
    const quote = quoteSwap(fromToken.id, toToken.id, n, fromToken.decimals, toToken.decimals, pools);
    if (quote && quote.out > 0) return { toAmount: fmt(quote.out, 6), priceImpact: quote.impact };

    // Fallback: Pyth oracle estimate
    if (prices.sui === 0 && fromToken.priceRef === 'sui') return { toAmount: '', priceImpact: 0 };
    const usd = tokenToUsd(fromToken, n, prices.sui, prices.btc);
    const out  = usdToToken(toToken, usd, prices.sui, prices.btc);
    return { toAmount: out > 0 ? fmt(out, 6) : '', priceImpact: 0 };
  }, [fromAmount, fromToken, toToken, prices, pools]);

  // Minimum received after slippage
  const minReceived = useMemo(() => {
    const n = parseFloat(toAmount);
    if (isNaN(n) || n <= 0) return '';
    return fmt(n * (1 - slippageBps / 10_000), 6);
  }, [toAmount, slippageBps]);

  // USD value of from amount
  const fromUsd = useMemo(() => {
    const n = parseFloat(fromAmount);
    if (isNaN(n) || n <= 0) return '';
    const usd = tokenToUsd(fromToken, n, prices.sui, prices.btc);
    return `≈ $${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }, [fromAmount, fromToken, prices]);

  const route = useMemo(() => getRoute(fromToken.id, toToken.id), [fromToken.id, toToken.id]);

  function flip() {
    if (!toToken.available) return;
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setTxDigest('');
    setError('');
  }

  function setFromTokenSafe(t: Token) {
    if (t.id === toToken.id) setToToken(fromToken);
    setFromToken(t);
    setFromAmount('');
    setTxDigest('');
    setError('');
  }

  function setToTokenSafe(t: Token) {
    if (t.id === fromToken.id) setFromToken(toToken);
    setToToken(t);
    setTxDigest('');
    setError('');
  }

  const handleSetMax = useCallback(() => {
    const raw = fromBalance;
    const n = Number(BigInt(raw)) / 10 ** fromToken.decimals;
    setFromAmount(n > 0 ? fmt(n, 6) : '');
  }, [fromBalance, fromToken.decimals]);

  async function execTx(txBase64: string) {
    if (account) {
      const r = await signAndExecute({ transaction: txBase64 });
      return r.digest;
    }
    const keypair = await flow.getKeypair({ network: 'testnet' });
    const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
    const { bytes, signature } = await keypair.signTransaction(txBytes);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (suiClient as any).executeTransactionBlock({
      transactionBlock: bytes,
      signature,
      options: { showEffects: true },
    }) as { digest: string };
    return result.digest;
  }

  async function handleFaucet() {
    if (!auth.address) { setError('Connect wallet first'); return; }
    setLoadingFaucet(true);
    setError('');
    setTxDigest('');
    try {
      const res = await fetch('/api/rfbtc/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: auth.address }),
      });
      const json = await res.json() as { ok: boolean; data?: { txBase64: string }; error?: string };
      if (!json.ok || !json.data?.txBase64) { setError(json.error ?? 'Faucet error'); return; }
      const digest = await execTx(json.data.txBase64);
      setTxDigest(digest);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoadingFaucet(false);
    }
  }

  async function handleSwap() {
    if (!auth.address) { setError('Connect wallet first'); return; }
    const fromNum = parseFloat(fromAmount);
    if (isNaN(fromNum) || fromNum <= 0) { setError('Enter an amount'); return; }
    if (!bestFromCoin) { setError(`No ${fromToken.symbol} coins found in wallet`); return; }

    setLoadingSwap(true);
    setError('');
    setTxDigest('');

    try {
      const minOutFloat    = parseFloat(minReceived || '0');
      const minAmountOut   = BigInt(Math.floor(minOutFloat * 10 ** toToken.decimals));
      const fromAmountBase = BigInt(Math.floor(fromNum * 10 ** fromToken.decimals));

      const res = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAsset:      fromToken.id,
          toAsset:        toToken.id,
          fromCoinId:     bestFromCoin.coinObjectId,
          fromAmountBase: fromAmountBase.toString(),
          minAmountOut:   minAmountOut.toString(),
          sender:         auth.address,
        }),
      });

      const json = await res.json() as { ok: boolean; data?: { txBase64: string; status: string }; error?: string };
      if (!json.ok || !json.data?.txBase64) { setError(json.error ?? 'Swap build failed'); return; }

      const digest = await execTx(json.data.txBase64);
      setTxDigest(digest);
      setFromAmount('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoadingSwap(false);
    }
  }

  const canSwap = Boolean(
    auth.address &&
    fromToken.available &&
    toToken.available &&
    parseFloat(fromAmount) > 0 &&
    !loadingSwap,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (txDigest) {
    return (
      <div className="space-y-6">
        <div className="bg-teal-950/30 border border-teal-700/40 rounded-2xl p-6 text-center space-y-3">
          <div className="text-3xl text-teal-400">✓</div>
          <p className="text-white font-semibold">Transaction submitted</p>
          <a
            href={`https://suiexplorer.com/txblock/${txDigest}?network=testnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs font-mono text-teal-400 hover:text-teal-300 break-all transition-colors"
          >
            {txDigest} ↗
          </a>
          <button
            onClick={() => { setTxDigest(''); setError(''); }}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            New swap
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Pool status banner ─────────────────────────────────────────────── */}
      {pools.funded ? (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono"
          style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.2)', color: '#2DD4BF' }}
        >
          <span className="flex-shrink-0">●</span>
          <span>Live rates · on-chain CPAMM · 0.3% fee</span>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-mono"
          style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', color: '#D97706' }}
        >
          <span className="mt-px flex-shrink-0">⏳</span>
          <span>Pools pending initialization — rates are oracle estimates until pools are seeded by admin.</span>
        </div>
      )}

      {/* ── Main swap card ──────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-gray-800 overflow-visible"
        style={{ background: '#0D1117' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-800/50">
          <span className="text-sm font-semibold text-white">Swap</span>
          <div className="relative">
            <button
              onClick={() => setShowSettings(v => !v)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showSettings && (
              <SlippagePanel
                slippageBps={slippageBps}
                setSlippageBps={setSlippageBps}
                onClose={() => setShowSettings(false)}
              />
            )}
          </div>
        </div>

        {/* From */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-600 font-mono uppercase tracking-wider">From</span>
            {auth.address && (
              <button
                onClick={handleSetMax}
                className="text-[10px] font-mono text-gray-600 hover:text-teal-400 transition-colors"
              >
                Balance: {formatBalance(fromBalance, fromToken.decimals)} {fromToken.symbol}
              </button>
            )}
          </div>
          <div
            className="flex items-center gap-2 p-3 rounded-xl"
            style={{ background: '#161B22', border: '1px solid #30363D' }}
          >
            <TokenButton token={fromToken} onClick={() => setShowFromPicker(true)} />
            <div className="flex-1 text-right">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={fromAmount}
                onChange={e => { setFromAmount(e.target.value); setError(''); setTxDigest(''); }}
                className="w-full bg-transparent text-right text-lg font-semibold text-white placeholder-gray-700 focus:outline-none"
              />
              {fromUsd && (
                <div className="text-[11px] text-gray-600 font-mono">{fromUsd}</div>
              )}
            </div>
          </div>
        </div>

        {/* Flip button */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            onClick={flip}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 focus:outline-none"
            style={{
              background: '#1C2430',
              border: '2px solid #30363D',
              color: '#00D4C8',
            }}
            title="Flip tokens"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* To */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-600 font-mono uppercase tracking-wider">To</span>
            {auth.address && (
              <span className="text-[10px] font-mono text-gray-600">
                Balance: {formatBalance(toBalance, toToken.decimals)} {toToken.symbol}
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-2 p-3 rounded-xl"
            style={{ background: '#161B22', border: '1px solid #30363D' }}
          >
            <TokenButton token={toToken} onClick={() => setShowToPicker(true)} />
            <div className="flex-1 text-right">
              <div className={`text-lg font-semibold font-mono ${toAmount ? 'text-teal-300' : 'text-gray-700'}`}>
                {toAmount || '0'}
              </div>
              {toAmount && prices.sui > 0 && (
                <div className="text-[11px] text-gray-600 font-mono">
                  ≈ ${usdToToken(toToken, parseFloat(toAmount), 1, 1) > 0
                    ? tokenToUsd(toToken, parseFloat(toAmount), prices.sui, prices.btc)
                        .toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : '—'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Price info */}
        {toAmount && fromAmount && (
          <div className="mx-4 mb-4 p-3 rounded-xl bg-[#161B22] border border-gray-800 space-y-1.5 text-xs font-mono">
            <div className="flex justify-between text-gray-400">
              <span>Rate</span>
              <span className="text-gray-300">
                1 {fromToken.symbol} = {fmt(parseFloat(toAmount) / parseFloat(fromAmount), 4)} {toToken.symbol}
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Price impact</span>
              <span className={priceImpact > 0.02 ? 'text-amber-400' : priceImpact > 0.005 ? 'text-yellow-400' : 'text-teal-400'}>
                {pools.funded
                  ? priceImpact < 0.0001 ? '< 0.01%' : `${(priceImpact * 100).toFixed(2)}%`
                  : '~'}
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Min received ({(slippageBps / 100).toFixed(2)}%)</span>
              <span className="text-gray-300">{minReceived} {toToken.symbol}</span>
            </div>
            <div className="flex justify-between text-gray-400 pt-0.5 border-t border-gray-800">
              <span>Route</span>
              <span className="text-gray-300 flex items-center gap-1">
                {route.map((r, i) => (
                  <span key={r} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-600">→</span>}
                    <span className="uppercase">{r}</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-red-950/30 border border-red-700/40 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}

        {/* CTA */}
        <div className="px-4 pb-4 space-y-2">
          {!auth.address ? (
            <div
              className="w-full py-3 rounded-xl text-center text-sm font-semibold"
              style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)', color: '#F5A623' }}
            >
              Connect wallet to swap
            </div>
          ) : (
            <button
              onClick={() => void handleSwap()}
              disabled={!canSwap}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
              style={canSwap ? { background: 'linear-gradient(135deg,#00B09B,#00D4C8)', color: '#001A18' } : { background: '#1C2430', color: '#4B5563' }}
            >
              {loadingSwap ? 'Building…' : !fromAmount ? 'Enter an amount' : `Swap ${fromToken.symbol} → ${toToken.symbol}`}
            </button>
          )}

          {/* rfBTC faucet shortcut */}
          {(fromToken.id === 'rfbtc' || toToken.id === 'rfbtc') && auth.address && (
            <button
              onClick={() => void handleFaucet()}
              disabled={loadingFaucet}
              className="w-full py-2 rounded-xl text-xs font-mono font-medium transition-colors disabled:opacity-40"
              style={{
                background: 'rgba(247,147,26,0.08)',
                border: '1px solid rgba(247,147,26,0.25)',
                color: '#F7931A',
              }}
            >
              {loadingFaucet ? 'Minting…' : 'Get 1,000 rfBTC from faucet'}
            </button>
          )}
        </div>
      </div>

      {/* Token pickers */}
      {showFromPicker && (
        <TokenPicker
          selected={fromToken}
          excluded={toToken}
          onSelect={setFromTokenSafe}
          onClose={() => setShowFromPicker(false)}
        />
      )}
      {showToPicker && (
        <TokenPicker
          selected={toToken}
          excluded={fromToken}
          onSelect={setToTokenSafe}
          onClose={() => setShowToPicker(false)}
        />
      )}
    </div>
  );
}
