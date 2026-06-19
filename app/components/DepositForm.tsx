'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClientQuery, useSuiClientContext } from '@mysten/dapp-kit';
import { useEnokiFlow } from '@mysten/enoki/react';
import { DUSDC_FAUCET_URL } from '@reflux/lib';
import { useAuth } from '../hooks/useAuth';

// ─── rfBTC move type (set in .env after republishing contracts with rfbtc.move) ─
const RFBTC_MOVE_TYPE = process.env.NEXT_PUBLIC_RFBTC_TYPE ?? '';

// ─── Asset catalogue ───────────────────────────────────────────────────────────

type AssetId =
  | 'usdc' | 'dusdc' | 'sui' | 'vsui' | 'afsui' | 'hasui' | 'rfbtc'
  | 'dbtc' | 'xbtc' | 'sbtc'
  | 'ssui' | 'svsui' | 'safsui' | 'shasui' | 'susdc' | 'swusdc' | 'swusdt'
  | 'sweth' | 'ssbeth' | 'ssca' | 'scetus' | 'sdeep';
type LspChoice = 0 | 1 | 2; // 0=Volo/vSUI, 1=Aftermath/afSUI, 2=Haedal/haSUI
type Step = 'asset' | 'configure' | 'confirm' | 'submitted';

interface AssetMeta {
  id: AssetId;
  label: string;
  sublabel: string;
  description: string;
  tier: 1 | 2 | 3;
  riskTag: string;
  riskColor: string;
  /** Base staking APY % (0 for non-staking assets). */
  stakingApy: number;
  hasLeverage: boolean;
  /** Whether this asset needs an LSP sub-picker (native SUI). */
  needsLsp: boolean;
  /** Whether this is a generic LSD (not the dedicated vsui path). */
  isGenericLsd: boolean;
  /** Move type string — used when routing to deposit_lsd<L>. */
  moveType: string;
  /** Warning shown on the confirm step. */
  confirmWarning?: string;
  /** Protocol not deployed on the current testnet — card is shown but disabled. */
  testnetUnavailable?: boolean;
  /** Specific reason shown instead of the generic "Not available on testnet" label. */
  unavailableReason?: string;
}

const ASSETS: AssetMeta[] = [
  {
    id: 'usdc',
    label: 'USDC',
    sublabel: 'Circle',
    description: 'Deposit from anywhere. Exchange, bridge, or wallet — plain USDC works.',
    tier: 1,
    riskTag: 'Low',
    riskColor: 'text-green-400',
    stakingApy: 0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '',
  },
  {
    id: 'dusdc',
    label: 'dUSDC',
    sublabel: 'DeepBook V3',
    description: 'Deposit dUSDC directly — no swap needed. Get dUSDC via the DeepBook testnet faucet.',
    tier: 1,
    riskTag: 'Low',
    riskColor: 'text-green-400',
    stakingApy: 0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  },
  {
    id: 'sui',
    label: 'SUI',
    sublabel: 'Native',
    description: 'SUI is swapped to dUSDC via DeepBook Spot in a single transaction — no staking required.',
    tier: 1,
    riskTag: 'Low',
    riskColor: 'text-green-400',
    stakingApy: 0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0x2::sui::SUI',
  },
  {
    id: 'vsui',
    label: 'vSUI',
    sublabel: 'Volo LSD',
    description: 'Keep your Volo staking rewards while your capital earns structured yield.',
    tier: 1,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 4.5,
    hasLeverage: true,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    testnetUnavailable: true,
    unavailableReason: 'Volo not on testnet',
  },
  {
    id: 'afsui',
    label: 'afSUI',
    sublabel: 'Aftermath LSD',
    description: 'Aftermath liquid staking with leverage loops for amplified returns.',
    tier: 3,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 4.8,
    hasLeverage: true,
    needsLsp: false,
    isGenericLsd: true,
    moveType:
      '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
    testnetUnavailable: true,
    unavailableReason: 'Aftermath not on testnet',
  },
  {
    id: 'hasui',
    label: 'haSUI',
    sublabel: 'Haedal LSD',
    description: 'Haedal liquid staking with leverage loops for amplified returns.',
    tier: 3,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 4.7,
    hasLeverage: true,
    needsLsp: false,
    isGenericLsd: true,
    moveType:
      '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    testnetUnavailable: true,
    unavailableReason: 'Haedal not on testnet',
  },
  {
    id: 'rfbtc',
    label: 'rfBTC',
    sublabel: 'Reflux BTC · testnet',
    description: 'Reflux-native testnet BTC. Get rfBTC from the faucet page. Swapped to dUSDC internally.',
    tier: 1,
    riskTag: 'High',
    riskColor: 'text-red-400',
    stakingApy: 0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: RFBTC_MOVE_TYPE,
    confirmWarning:
      'Your rfUSD shares are denominated in dUSDC. On exit, proceeds are converted back to rfBTC at the prevailing Pyth BTC/USD price. You bear BTC/USD price risk throughout.',
  },
  {
    id: 'dbtc',
    label: 'dBTC',
    sublabel: 'DeepBook BTC',
    description: 'DeepBook synthetic BTC. Will be enabled once MystenLabs deploys dbtc on testnet.',
    tier: 3,
    riskTag: 'High',
    riskColor: 'text-red-400',
    stakingApy: 0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '',
    testnetUnavailable: true,
    unavailableReason: 'dBTC not deployed',
  },
  {
    id: 'xbtc',
    label: 'xBTC',
    sublabel: 'Axelar / LayerZero',
    description: 'Axelar-bridged BTC on Sui. Not available on testnet.',
    tier: 3,
    riskTag: 'High',
    riskColor: 'text-red-400',
    stakingApy: 0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '',
    testnetUnavailable: true,
    unavailableReason: 'xBTC not on testnet',
  },
  {
    id: 'sbtc',
    label: 'sBTC',
    sublabel: 'Stacks bridge',
    description: 'Stacks-bridged BTC on Sui. Not available on testnet.',
    tier: 3,
    riskTag: 'High',
    riskColor: 'text-red-400',
    stakingApy: 0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '',
    testnetUnavailable: true,
    unavailableReason: 'sBTC not on testnet',
  },
  // ─── Scallop sCoins (mainnet only) ────────────────────────────────────────
  {
    id: 'ssui',
    label: 'sSUI',
    sublabel: 'Scallop · SUI lending',
    description: 'Scallop lending yield on SUI deposits. Earn SUI supply APY compounded with structured predict yield.',
    tier: 2,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 4.5,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xaafc4f740de0dd0dde642a31148fb94517087052f19afb0f7bed1dc41a50c77b::scallop_sui::SCALLOP_SUI',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'svsui',
    label: 'svSUI',
    sublabel: 'Scallop · vSUI lending',
    description: 'Scallop lending yield on Volo vSUI — staking + lending + predict yield stacked.',
    tier: 2,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 5.5,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xe1a1cc6bcf0001a015eab84bcc6713393ce20535f55b8b6f35c142e057a25fbe::scallop_v_sui::SCALLOP_V_SUI',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'safsui',
    label: 'safSUI',
    sublabel: 'Scallop · afSUI lending',
    description: 'Scallop lending yield on Aftermath afSUI — staking + lending + predict yield stacked.',
    tier: 2,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 5.5,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0x00671b1fa2a124f5be8bdae8b91ee711462c5d9e31bda232e70fd9607b523c88::scallop_af_sui::SCALLOP_AF_SUI',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'shasui',
    label: 'shaSUI',
    sublabel: 'Scallop · haSUI lending',
    description: 'Scallop lending yield on Haedal haSUI — staking + lending + predict yield stacked.',
    tier: 2,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 5.5,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0x9a2376943f7d22f88087c259c5889925f332ca4347e669dc37d54c2bf651af3c::scallop_ha_sui::SCALLOP_HA_SUI',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'susdc',
    label: 'sUSDC',
    sublabel: 'Scallop · USDC lending',
    description: 'Scallop USDC supply yield compounded with predict premia. Stablecoin base.',
    tier: 2,
    riskTag: 'Low',
    riskColor: 'text-green-400',
    stakingApy: 5.2,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0x854950aa624b1df59fe64e630b2ba7c550642e9342267a33061d59fb31582da5::scallop_usdc::SCALLOP_USDC',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'swusdc',
    label: 'sWUSDC',
    sublabel: 'Scallop · Wormhole USDC',
    description: 'Scallop Wormhole-bridged USDC supply yield + predict premia.',
    tier: 2,
    riskTag: 'Low',
    riskColor: 'text-green-400',
    stakingApy: 5.0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xad4d71551d31092230db1fd482008ea42867dbf27b286e9c70a79d2a6191d58d::scallop_wormhole_usdc::SCALLOP_WORMHOLE_USDC',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'swusdt',
    label: 'sWUSDT',
    sublabel: 'Scallop · Wormhole USDT',
    description: 'Scallop Wormhole-bridged USDT supply yield + predict premia.',
    tier: 2,
    riskTag: 'Low',
    riskColor: 'text-green-400',
    stakingApy: 4.8,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xe6e5a012ec20a49a3d1d57bd2b67140b96cd4d3400b9d79e541f7bdbab661f95::scallop_wormhole_usdt::SCALLOP_WORMHOLE_USDT',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'sweth',
    label: 'sWETH',
    sublabel: 'Scallop · Wormhole ETH',
    description: 'Scallop Wormhole ETH supply yield. ETH price exposure denominated in dUSDC NAV.',
    tier: 3,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 2.5,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0x67540ceb850d418679e69f1fb6b2093d6df78a2a699ffc733f7646096d552e9b::scallop_wormhole_eth::SCALLOP_WORMHOLE_ETH',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'ssbeth',
    label: 'ssbETH',
    sublabel: 'Scallop · sb-ETH lending',
    description: 'Scallop sb-ETH supply yield. ETH price exposure denominated in dUSDC NAV.',
    tier: 3,
    riskTag: 'Medium',
    riskColor: 'text-amber-400',
    stakingApy: 2.2,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xb14f82d8506d139eacef109688d1b71e7236bcce9b2c0ad526abcd6aa5be7de0::scallop_sb_eth::SCALLOP_SB_ETH',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'ssca',
    label: 'sSCA',
    sublabel: 'Scallop · SCA lending',
    description: 'Scallop governance token supply yield. High reward, high volatility.',
    tier: 3,
    riskTag: 'High',
    riskColor: 'text-red-400',
    stakingApy: 8.0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0x5ca17430c1d046fae9edeaa8fd76c7b4193a00d764a0ecfa9418d733ad27bc1e::scallop_sca::SCALLOP_SCA',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'scetus',
    label: 'sCETUS',
    sublabel: 'Scallop · CETUS lending',
    description: 'Scallop CETUS supply yield. DeFi token exposure + predict premia.',
    tier: 3,
    riskTag: 'High',
    riskColor: 'text-red-400',
    stakingApy: 6.5,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xea346ce428f91ab007210443efcea5f5cdbbb3aae7e9affc0ca93f9203c31f0c::scallop_cetus::SCALLOP_CETUS',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
  {
    id: 'sdeep',
    label: 'sDEEP',
    sublabel: 'Scallop · DEEP lending',
    description: 'Scallop DeepBook DEEP supply yield. Native protocol exposure + predict premia.',
    tier: 3,
    riskTag: 'High',
    riskColor: 'text-red-400',
    stakingApy: 7.0,
    hasLeverage: false,
    needsLsp: false,
    isGenericLsd: false,
    moveType: '0xeb7a05a3224837c5e5503575aed0be73c091d1ce5e43aa3c3e716e0ae614608f::scallop_deep::SCALLOP_DEEP',
    testnetUnavailable: true,
    unavailableReason: 'Scallop not on testnet',
  },
];

const LSP_OPTIONS: { label: string; sublabel: string; lspChoice: LspChoice }[] = [
  { label: 'Volo', sublabel: '→ vSUI · ~4.5% APY', lspChoice: 0 },
  { label: 'Aftermath', sublabel: '→ afSUI · ~4.8% APY', lspChoice: 1 },
  { label: 'Haedal', sublabel: '→ haSUI · ~4.7% APY', lspChoice: 2 },
];

// ─── APY math (presentation only — all floating-point, no chain math) ─────────

const BASE_PLP_APY = 3.5;
const BASE_PREMIA_APY = 5.0;
const INTEREST_RATE = 2.5;

function computeApy(
  stakingApy: number,
  leverageBps: number,
): { staking: number; premia: number; plp: number; interest: number; net: number } {
  const lvr = leverageBps / 10_000;
  const staking = stakingApy;
  const premia = (1 + lvr) * BASE_PREMIA_APY;
  const plp = (1 + lvr) * BASE_PLP_APY;
  const interest = lvr * INTEREST_RATE;
  const net = staking + premia + plp - interest;
  return { staking, premia, plp, interest, net };
}

// ─── Balance helpers ────────────────────────────────────────────────────────

/** Base-unit decimals for assets the deposit form lets a user fund directly. */
function assetDecimals(id: AssetId): number {
  switch (id) {
    case 'sui':   return 9;
    case 'rfbtc': return 8;
    default:      return 6; // usdc, dusdc
  }
}

/** Where to point a user who doesn't have enough of an asset to deposit. */
function fundingHint(id: AssetId): string {
  switch (id) {
    case 'rfbtc': return 'Mint more on the faucet page — any amount, instantly.';
    case 'sui':   return "Get testnet SUI from Sui's official faucet (e.g. the Sui Wallet extension, or `sui client faucet`).";
    case 'dusdc': return `dUSDC has no self-serve faucet — request it manually at ${DUSDC_FAUCET_URL}.`;
    case 'usdc':  return 'Testnet USDC is scarce and has no public faucet. Try rfBTC instead — it mints freely on the faucet page.';
    default:      return 'Check the rfBTC faucet page, or request other testnet assets from their official sources.';
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const colors: Record<number, string> = {
    1: 'bg-teal-900/60 text-teal-300 border-teal-700/50',
    2: 'bg-blue-900/60 text-blue-300 border-blue-700/50',
    3: 'bg-purple-900/60 text-purple-300 border-purple-700/50',
  };
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${colors[tier]}`}>
      Tier {tier}
    </span>
  );
}

function ApyBar({
  staking,
  premia,
  plp,
  interest,
  net,
  showStaking,
}: ReturnType<typeof computeApy> & { showStaking: boolean }) {
  const total = staking + premia + plp;
  const pct = (v: number) => `${((v / (total || 1)) * 100).toFixed(0)}%`;

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded overflow-hidden gap-px">
        {showStaking && staking > 0 && (
          <div
            className="bg-teal-500 transition-all duration-300"
            style={{ width: pct(staking) }}
          />
        )}
        <div
          className="bg-amber-500 transition-all duration-300"
          style={{ width: pct(premia) }}
        />
        <div
          className="bg-blue-500 transition-all duration-300"
          style={{ width: pct(plp) }}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
        <div className="flex justify-between">
          <span className={showStaking && staking > 0 ? 'text-teal-400' : 'text-gray-600'}>
            Staking
          </span>
          <span className={showStaking && staking > 0 ? 'text-teal-300' : 'text-gray-600'}>
            {showStaking && staking > 0 ? `+${staking.toFixed(1)}%` : 'N/A'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-amber-400">Premia</span>
          <span className="text-amber-300">+{premia.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blue-400">PLP</span>
          <span className="text-blue-300">+{plp.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-red-400">Interest</span>
          <span className="text-red-300">{interest > 0 ? `-${interest.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="col-span-2 border-t border-gray-700 pt-1 flex justify-between font-semibold">
          <span className="text-gray-300">Net est. APY</span>
          <span className="text-white">{net.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Asset cards ───────────────────────────────────────────────────────

function AssetStep({
  onSelect,
}: {
  onSelect: (id: AssetId) => void;
}) {
  const available   = ASSETS.filter((a) => !a.testnetUnavailable);
  const unavailable = ASSETS.filter((a) => a.testnetUnavailable);

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4 font-mono uppercase tracking-wider">
        Select deposit asset
      </p>

      {/* Available assets */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {available.map((a) => {
          const apy = computeApy(a.stakingApy, 0);
          return (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              className="group text-left p-4 rounded-xl border border-gray-800 hover:border-teal-600/60 bg-[#0D1117] hover:bg-[#0f1923] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold text-white group-hover:text-teal-300 transition-colors">
                    {a.label}
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono">{a.sublabel}</div>
                </div>
                <TierBadge tier={a.tier} />
              </div>
              <div className="text-xs text-gray-400 mb-3 leading-relaxed line-clamp-2">
                {a.description}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">est. APY</div>
                  <div className="text-sm font-mono font-semibold text-teal-400">
                    {apy.net.toFixed(1)}%
                  </div>
                </div>
                <span className={`text-[10px] font-mono ${a.riskColor}`}>{a.riskTag} risk</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Unavailable — mainnet only */}
      {unavailable.length > 0 && (
        <>
          <div className="flex items-center gap-2 my-5">
            <div className="h-px flex-1 bg-gray-800/80" />
            <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest px-1">
              Mainnet only
            </span>
            <div className="h-px flex-1 bg-gray-800/80" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {unavailable.map((a) => (
              <div
                key={a.id}
                className="text-left p-3 rounded-xl border border-gray-800/50 bg-[#0A0D12] opacity-55 cursor-not-allowed select-none"
                title={a.unavailableReason ?? 'Not available on testnet'}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div>
                    <div className="text-sm font-semibold text-gray-600">{a.label}</div>
                    <div className="text-[10px] text-gray-700 font-mono">{a.sublabel}</div>
                  </div>
                  <TierBadge tier={a.tier} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-gray-600 bg-gray-800/60 border border-gray-700/50 px-1.5 py-0.5 rounded truncate max-w-[70%]">
                    {a.unavailableReason ?? 'Not available on testnet'}
                  </span>
                  <span className={`text-[10px] font-mono opacity-40 ${a.riskColor} flex-shrink-0`}>{a.riskTag}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 2: Configure ────────────────────────────────────────────────────────

function ConfigureStep({
  asset,
  amount,
  setAmount,
  leverageBps,
  setLeverageBps,
  lspChoice,
  setLspChoice,
  walletBalanceRaw,
  insufficientBalance,
  onBack,
  onNext,
}: {
  asset: AssetMeta;
  amount: string;
  setAmount: (v: string) => void;
  leverageBps: number;
  setLeverageBps: (v: number) => void;
  lspChoice: LspChoice;
  setLspChoice: (v: LspChoice) => void;
  walletBalanceRaw: bigint | null;
  insufficientBalance: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const amountNum = parseFloat(amount);
  const isValid = !isNaN(amountNum) && amountNum > 0;
  const apy = useMemo(
    () => computeApy(asset.stakingApy, leverageBps),
    [asset.stakingApy, leverageBps],
  );
  const leveragePct = (leverageBps / 100).toFixed(0);
  const decimals = assetDecimals(asset.id);
  const balanceDisplay = walletBalanceRaw === null
    ? null
    : (Number(walletBalanceRaw) / 10 ** decimals);

  return (
    <div className="space-y-5">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-white text-xs font-mono transition-colors"
        >
          ← Back
        </button>
        <span className="text-white font-semibold">{asset.label}</span>
        <TierBadge tier={asset.tier} />
      </div>

      {/* LSP picker (native SUI only) */}
      {asset.needsLsp && (
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider block mb-2">
            Staking provider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {LSP_OPTIONS.map((opt) => (
              <button
                key={opt.lspChoice}
                onClick={() => setLspChoice(opt.lspChoice)}
                className={`p-2 rounded-lg border text-left transition-all ${
                  lspChoice === opt.lspChoice
                    ? 'border-teal-500 bg-teal-950/40 text-teal-300'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="text-xs font-semibold">{opt.label}</div>
                <div className="text-[10px] font-mono text-gray-500">{opt.sublabel}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Amount input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label
            className="text-xs text-gray-500 uppercase tracking-wider"
            htmlFor="dep-amount"
          >
            Amount ({asset.label})
          </label>
          {balanceDisplay !== null && (
            <span className="text-[10px] font-mono text-gray-500">
              Balance: {balanceDisplay.toLocaleString('en-US', { maximumFractionDigits: 4 })} {asset.label}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            id="dep-amount"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-[#1C2430] border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-teal-500/60 transition-colors"
          />
          <button
            onClick={() => {
              if (balanceDisplay !== null) setAmount(String(balanceDisplay));
            }}
            disabled={balanceDisplay === null}
            className="px-3 py-2 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors disabled:opacity-40"
          >
            MAX
          </button>
        </div>
        {isValid && !insufficientBalance && (
          <div className="mt-1.5 text-xs text-gray-500 font-mono">
            ≈ {(amountNum * 0.999).toFixed(4)} rfUSD (est., 0.1% slippage guard)
          </div>
        )}
        {insufficientBalance && (
          <div className="mt-2 px-3 py-2.5 rounded-lg text-xs bg-red-950/30 border border-red-800/40 text-red-300 leading-relaxed">
            <div className="font-semibold mb-0.5">Not enough {asset.label} in your wallet.</div>
            <div>{fundingHint(asset.id)}</div>
          </div>
        )}
      </div>

      {/* Leverage slider (LSD + SUI only) */}
      {asset.hasLeverage && (
        <div>
          <div className="flex justify-between mb-2">
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              Leverage
            </label>
            <span className="text-xs font-mono text-amber-400">
              {leveragePct}% LTV
              {leverageBps === 0 && (
                <span className="text-gray-600"> · no leverage</span>
              )}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={6500}
            step={100}
            value={leverageBps}
            onChange={(e) => setLeverageBps(Number(e.target.value))}
            className="w-full accent-teal-500"
          />
          <div className="flex justify-between text-[10px] text-gray-600 font-mono mt-1">
            <span>0%</span>
            <span className="text-amber-600">65% max</span>
          </div>
        </div>
      )}

      {/* rfBTC / BTC price-risk warning */}
      {asset.id === 'rfbtc' && asset.confirmWarning && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-xs text-red-300 leading-relaxed">
          {asset.confirmWarning}
        </div>
      )}

      {/* rfBTC faucet shortcut */}
      {asset.id === 'rfbtc' && (
        <Link
          href="/faucet"
          className="flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-mono transition-colors"
          style={{ background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.25)', color: '#F7931A' }}
        >
          <span>Need rfBTC? Mint any amount from the faucet</span>
          <span>→</span>
        </Link>
      )}

      {/* APY breakdown */}
      <div className="bg-[#0D1117] border border-gray-800 rounded-xl p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">
          Yield decomposition (est.)
        </div>
        <ApyBar {...apy} showStaking={asset.stakingApy > 0} />
      </div>

      <button
        onClick={onNext}
        disabled={!isValid || insufficientBalance}
        className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg font-semibold transition-colors text-sm"
      >
        Preview deposit
      </button>
    </div>
  );
}

// ─── Step 3: Confirm ──────────────────────────────────────────────────────────

function ptbSteps(asset: AssetMeta, leverageBps: number): string[] {
  const steps: string[] = [];
  if (asset.id === 'dusdc') {
    steps.push('Deposit dUSDC directly into the pool (no swap needed)');
    steps.push('Allocate dUSDC across PLP supply + range strips');
    steps.push('Mint rfUSD shares proportional to dUSDC NAV contribution');
  } else if (asset.id === 'usdc') {
    steps.push('Swap USDC → dUSDC via DeepBook Spot (slippage protected)');
    steps.push('Allocate dUSDC across PLP supply + range strips');
    steps.push('Mint rfUSD shares proportional to dUSDC NAV contribution');
  } else if (asset.id === 'sui') {
    steps.push('Swap SUI → dUSDC via DeepBook Spot pool (slippage protected)');
    steps.push('Allocate dUSDC across PLP supply + range strips');
    steps.push('Mint rfUSD shares proportional to dUSDC NAV contribution');
  } else if (asset.id === 'vsui' || asset.isGenericLsd) {
    steps.push(`Record ${asset.label} as margin collateral in VaultPosition`);
    if (leverageBps > 0) {
      steps.push(
        `Borrow ${(leverageBps / 100).toFixed(0)}% LTV dUSDC against collateral via deepbook_margin`,
      );
    }
    steps.push('Deploy dUSDC into PLP supply + range strips via DeepBook Predict');
    steps.push('Mint rfUSD shares proportional to dUSDC NAV contribution');
  } else if (asset.id === 'rfbtc') {
    steps.push('Swap rfBTC → dUSDC via DeepBook Spot (Pyth BTC/USD price, slippage protected)');
    steps.push('Record rfBTC entry price in VaultPosition for FX-denominated exit tracking');
    steps.push('Allocate dUSDC across PLP supply + range strips');
    steps.push('Mint rfUSD shares proportional to dUSDC NAV contribution');
  }
  return steps;
}

function ConfirmStep({
  asset,
  amount,
  leverageBps,
  onBack,
  onSubmit,
  error,
  loading,
}: {
  asset: AssetMeta;
  amount: string;
  leverageBps: number;
  onBack: () => void;
  onSubmit: () => void;
  error: string;
  loading: boolean;
}) {
  const amountNum = parseFloat(amount);
  const minOut = (amountNum * 0.995).toFixed(4);
  const steps = ptbSteps(asset, leverageBps);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-white text-xs font-mono transition-colors"
        >
          ← Back
        </button>
        <span className="text-white font-semibold">Confirm deposit</span>
      </div>

      {/* Summary table */}
      <div className="bg-[#0D1117] border border-gray-800 rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">You deposit</span>
          <span className="text-white font-mono">
            {amount} {asset.label}
          </span>
        </div>
        {leverageBps > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-400">Leverage</span>
            <span className="text-amber-400 font-mono">
              {(leverageBps / 100).toFixed(0)}% LTV
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-gray-800 pt-2">
          <span className="text-gray-400">Min rfUSD received</span>
          <span className="text-teal-300 font-mono">{minOut} rfUSD</span>
        </div>
      </div>

      {/* PTB steps */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
          What this transaction does
        </div>
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-xs text-gray-400">
              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-800 text-gray-500 flex items-center justify-center text-[9px] font-mono">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {asset.confirmWarning && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 text-xs text-red-300 leading-relaxed">
          {asset.confirmWarning}
        </div>
      )}

      {error && (
        <div className="bg-red-950/30 border border-red-700/40 rounded-lg p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg font-semibold transition-colors text-sm"
      >
        {loading ? 'Building transaction…' : 'Sign & submit'}
      </button>

      <p className="text-[10px] text-gray-600 text-center">
        USDC is automatically swapped to dUSDC on-chain. You never hold dUSDC directly.
      </p>
    </div>
  );
}

// ─── Step 4: Submitted ────────────────────────────────────────────────────────

function SubmittedStep({
  txDigest,
  onReset,
}: {
  txDigest: string;
  onReset: () => void;
}) {
  return (
    <div className="text-center py-6 space-y-4">
      <div className="text-4xl">✓</div>
      <h2 className="text-white font-semibold">Deposit submitted</h2>
      <p className="text-gray-400 text-sm">
        Your rfUSD shares will appear in your wallet once the transaction confirms.
      </p>
      {txDigest && (
        <a
          href={`https://suiexplorer.com/txblock/${txDigest}?network=testnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono break-all px-2 text-teal-500 hover:text-teal-400 transition-colors"
        >
          {txDigest} ↗
        </a>
      )}
      <button
        onClick={onReset}
        className="text-sm text-teal-400 hover:text-teal-300 transition-colors"
      >
        Make another deposit
      </button>
    </div>
  );
}

// ─── Root form ────────────────────────────────────────────────────────────────

export function DepositForm() {
  const account = useCurrentAccount();
  const auth = useAuth();
  const flow = useEnokiFlow();
  const { client: suiClient } = useSuiClientContext();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [step, setStep] = useState<Step>('asset');
  const [selectedId, setSelectedId] = useState<AssetId | null>(null);
  const [amount, setAmount] = useState('');
  const [leverageBps, setLeverageBps] = useState(0);
  const [lspChoice, setLspChoice] = useState<LspChoice>(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [txDigest, setTxDigest] = useState('');

  const asset = ASSETS.find((a) => a.id === selectedId) ?? null;

  // Coin type for the selected asset (used to look up the user's coin).
  const selectedCoinType = useMemo(() => {
    if (!asset) return null;
    switch (asset.id) {
      case 'usdc':  return '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
      case 'dusdc': return asset.moveType;
      case 'sui':   return '0x2::sui::SUI';
      case 'rfbtc': return asset.moveType || null;
      case 'vsui':
      case 'afsui':
      case 'hasui':
      case 'dbtc':
      case 'xbtc':
      case 'sbtc':  return asset.moveType || null;
      default:      return null;
    }
  }, [asset]);

  // Query the user's coins for the selected asset.
  const { data: coinsData } = useSuiClientQuery(
    'getCoins',
    { owner: auth.address ?? '', coinType: selectedCoinType ?? '' },
    { enabled: Boolean(auth.address && selectedCoinType) },
  );

  // Pick the coin with the largest balance (simplest strategy — no merging needed).
  const bestCoin = useMemo(() => {
    const coins = coinsData?.data;
    if (!coins || coins.length === 0) return null;
    return coins.reduce((best, c) =>
      BigInt(c.balance) > BigInt(best.balance) ? c : best,
    );
  }, [coinsData]);

  // Total wallet balance across all coin objects of the selected type — used
  // to validate the requested amount before building a transaction that
  // would otherwise fail with a raw insufficient-balance abort.
  const walletBalanceRaw = useMemo(() => {
    const coins = coinsData?.data;
    if (!coins || coins.length === 0) return 0n;
    return coins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  }, [coinsData]);
  const decimals = asset ? assetDecimals(asset.id) : 6;
  const amountBaseUnits = (() => {
    const n = parseFloat(amount);
    return isNaN(n) || n <= 0 ? 0n : BigInt(Math.floor(n * 10 ** decimals));
  })();
  const insufficientBalance = Boolean(
    auth.address && asset && amountBaseUnits > 0n && amountBaseUnits > walletBalanceRaw,
  );

  function reset() {
    setStep('asset');
    setSelectedId(null);
    setAmount('');
    setLeverageBps(0);
    setLspChoice(0);
    setError('');
    setTxDigest('');
  }

  function handleAssetSelect(id: AssetId) {
    const meta = ASSETS.find((a) => a.id === id);
    if (!meta || meta.testnetUnavailable) return;
    setSelectedId(id);
    setLeverageBps(0);
    setLspChoice(0);
    setAmount('');
    setError('');
    setStep('configure');
  }

  async function handleSubmit() {
    if (!asset) return;
    if (!auth.address) {
      setError('Sign in to deposit.');
      return;
    }
    if (insufficientBalance) {
      setError(
        `Not enough ${asset.label} in your wallet for this amount. ${fundingHint(asset.id)}`,
      );
      return;
    }
    setError('');
    setLoading(true);

    try {
      const amountNum = parseFloat(amount);
      const minSharesOut = Math.floor(amountNum * 0.995 * 1_000_000).toString();
      const sender = auth.address;
      const coinId = bestCoin?.coinObjectId ?? '0x' + '0'.repeat(64);

      let body: Record<string, unknown>;
      switch (asset.id) {
        case 'dusdc':
          body = { asset: 'dusdc', dusdcCoinId: coinId, minSharesOut, sender };
          break;
        case 'usdc': {
          // USDC has 6 decimals: 1 USDC = 1_000_000 base units
          const usdcAmountBase = Math.floor(amountNum * 1_000_000).toString();
          body = { asset: 'usdc', usdcCoinId: coinId, usdcAmountBase, minSharesOut, sender };
          break;
        }
        case 'sui': {
          // SUI has 9 decimals: 1 SUI = 1_000_000_000 MIST
          const suiAmountBase = Math.floor(amountNum * 1_000_000_000).toString();
          body = { asset: 'sui', suiCoinId: coinId, suiAmountBase, minSharesOut, sender };
          break;
        }
        case 'vsui':
          body = {
            asset: 'vsui',
            vsuiCoinId: coinId,
            leverageBps: leverageBps.toString(),
            priceE9: '1000000000',
            minSharesOut,
            sender,
          };
          break;
        case 'afsui':
        case 'hasui':
          body = {
            asset: 'lsd',
            lsdCoinId: coinId,
            lsdType: asset.moveType,
            leverageBps: leverageBps.toString(),
            priceE9: '1000000000',
            minSharesOut,
            sender,
          };
          break;
        case 'rfbtc':
          body = { asset: 'rfbtc', rfbtcCoinId: coinId, minSharesOut, sender };
          break;
        default:
          throw new Error('Unknown asset');
      }

      const res = await fetch('/api/vault/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as {
        ok: boolean;
        data?: { txBase64: string };
        error?: string;
      };

      if (!json.ok || !json.data?.txBase64) {
        setError(json.error ?? 'Deposit failed');
        return;
      }

      let digest: string;
      if (account) {
        // Wallet extension — dapp-kit handles signing.
        const result = await signAndExecuteTransaction({ transaction: json.data.txBase64 });
        digest = result.digest;
      } else {
        // zkLogin via Enoki — sign with the ephemeral keypair + ZK proof.
        const keypair = await flow.getKeypair({ network: 'testnet' });
        const txBytes = Uint8Array.from(atob(json.data.txBase64), (c) => c.charCodeAt(0));
        const { bytes, signature } = await keypair.signTransaction(txBytes);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (suiClient as any).executeTransactionBlock({
          transactionBlock: bytes,
          signature,
          options: { showEffects: true },
        }) as { digest: string };
        digest = result.digest;
      }
      setTxDigest(digest);
      setStep('submitted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#0D1117] border border-gray-800 rounded-2xl p-6">
      {/* Wallet status bar */}
      {!auth.address && (
        <div
          className="mb-4 px-3 py-2.5 rounded-lg flex items-center gap-2 text-xs"
          style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)', color: '#F5A623' }}
        >
          <span>⚠</span>
          <span>Sign in to deposit — wallet or Google (zkLogin). Your position is tracked on-chain.</span>
        </div>
      )}

      {step === 'asset' && <AssetStep onSelect={handleAssetSelect} />}

      {step === 'configure' && asset && (
        <ConfigureStep
          asset={asset}
          amount={amount}
          setAmount={setAmount}
          leverageBps={leverageBps}
          setLeverageBps={setLeverageBps}
          lspChoice={lspChoice}
          setLspChoice={setLspChoice}
          walletBalanceRaw={auth.address ? walletBalanceRaw : null}
          insufficientBalance={insufficientBalance}
          onBack={() => setStep('asset')}
          onNext={() => { setError(''); setStep('confirm'); }}
        />
      )}

      {step === 'confirm' && asset && (
        <ConfirmStep
          asset={asset}
          amount={amount}
          leverageBps={leverageBps}
          onBack={() => setStep('configure')}
          onSubmit={() => void handleSubmit()}
          error={error}
          loading={loading}
        />
      )}

      {step === 'submitted' && (
        <SubmittedStep txDigest={txDigest} onReset={reset} />
      )}
    </div>
  );
}
