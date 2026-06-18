/**
 * POST /api/vault/deposit
 *
 * Builds an unsigned deposit PTB for any supported asset and returns it as
 * base64. The frontend signs and submits — the API never touches keys.
 *
 * All amounts are passed as decimal strings to survive JSON serialisation of
 * large u64s. They are transformed to BigInt by Zod before reaching the PTB
 * builders.
 *
 * Discriminant field `asset` selects which PTB builder to use:
 *   "dusdc" — deposit_router::deposit_dusdc             (Tier 1, works now — no swap)
 *   "usdc"  — deposit_router::deposit_usdc              (Tier 1, EXTERNAL-PENDING DR-1)
 *   "sui"   — deposit_router::deposit_sui               (Tier 1, EXTERNAL-PENDING DR-1)
 *   "vsui"  — deposit_router::deposit_vsui              (Tier 2, EXTERNAL-PENDING)
 *   "lsd"   — deposit_router::deposit_lsd<L>            (Tier 2/3, EXTERNAL-PENDING)
 *   "btc"   — deposit_router::deposit_btc<B>            (Tier 3, EXTERNAL-PENDING)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  buildDepositDusdcTx,
  buildDepositUsdcTx,
  buildDepositSuiDirectTx,
  buildDepositVsuiTx,
  buildDepositLsdTx,
  buildDepositBtcTx,
  buildDepositRfBtcTx,
  requireDeployed,
  REFLUX_OBJECTS,
} from '@reflux/lib';
import { suiClient, env } from '../../_lib/client';
import { ok, validationErr, serverErr } from '../../_lib/response';

export const dynamic = 'force-dynamic';

// ─── Per-asset schemas ────────────────────────────────────────────────────────

const bigintStr = z.string().regex(/^\d+$/).transform(BigInt);

const usdcBody = z.object({
  asset: z.literal('usdc'),
  usdcCoinId: z.string().min(1),
  /** Exact USDC to deposit in base units (6 decimals: 1 USDC = 1_000_000). */
  usdcAmountBase: bigintStr,
  minSharesOut: bigintStr,
  sender: z.string().min(1),
});

const vsuiBody = z.object({
  asset: z.literal('vsui'),
  vsuiCoinId: z.string().min(1),
  /** 0 = no leverage; max 6500 (65%). */
  leverageBps: bigintStr.optional().default('0'),
  /** Current vSUI/SUI price scaled e9. */
  priceE9: bigintStr.optional().default('1000000000'),
  minSharesOut: bigintStr,
  sender: z.string().min(1),
});

const lsdBody = z.object({
  asset: z.literal('lsd'),
  lsdCoinId: z.string().min(1),
  /** Fully-qualified Move type, e.g. "0x...::afsui::AFSUI". */
  lsdType: z.string().min(1),
  leverageBps: bigintStr.optional().default('0'),
  priceE9: bigintStr.optional().default('1000000000'),
  minSharesOut: bigintStr,
  sender: z.string().min(1),
});

const dusdcBody = z.object({
  asset: z.literal('dusdc'),
  dusdcCoinId: z.string().min(1),
  minSharesOut: bigintStr,
  sender: z.string().min(1),
});

const rfbtcBody = z.object({
  asset: z.literal('rfbtc'),
  rfbtcCoinId: z.string().min(1),
  minSharesOut: bigintStr,
  sender: z.string().min(1),
});

const suiBody = z.object({
  asset: z.literal('sui'),
  suiCoinId: z.string().min(1),
  /** Exact SUI deposit in MIST (1 SUI = 1_000_000_000). */
  suiAmountBase: bigintStr,
  minSharesOut: bigintStr,
  sender: z.string().min(1),
});

const btcBody = z.object({
  asset: z.literal('btc'),
  btcCoinId: z.string().min(1),
  /** Fully-qualified Move type, e.g. "0x...::xbtc::XBTC". */
  btcType: z.string().min(1),
  pythPriceInfoId: z.string().min(1),
  minDusdcOut: bigintStr.optional().default('0'),
  minSharesOut: bigintStr,
  sender: z.string().min(1),
});

const BodySchema = z.discriminatedUnion('asset', [
  dusdcBody,
  rfbtcBody,
  usdcBody,
  suiBody,
  vsuiBody,
  lsdBody,
  btcBody,
]);

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return validationErr(parsed.error);

  try {
    const deployed = requireDeployed(env);
    const contracts = {
      packageId: deployed.NEXT_PUBLIC_PACKAGE_ID,
      depositRouterId: deployed.NEXT_PUBLIC_DEPOSIT_ROUTER_ID,
      shareRegistryId: REFLUX_OBJECTS.shareRegistry,
      riskParamsId: REFLUX_OBJECTS.riskParams,
      spotRouterConfigId: REFLUX_OBJECTS.spotRouterConfig,
      ibCreditStateId: deployed.NEXT_PUBLIC_IB_CREDIT_STATE_ID,
    };

    const data = parsed.data;
    let tx;

    switch (data.asset) {
      case 'rfbtc':
        tx = buildDepositRfBtcTx({
          contracts,
          rfbtcCoinId: data.rfbtcCoinId,
          minSharesOut: data.minSharesOut,
          sender: data.sender,
        });
        break;

      case 'dusdc':
        tx = buildDepositDusdcTx({
          contracts,
          dusdcCoinId: data.dusdcCoinId,
          minSharesOut: data.minSharesOut,
          sender: data.sender,
        });
        break;

      case 'usdc':
        tx = buildDepositUsdcTx({
          contracts,
          usdcCoinId: data.usdcCoinId,
          usdcAmountBase: data.usdcAmountBase,
          minSharesOut: data.minSharesOut,
          sender: data.sender,
        });
        break;

      case 'sui':
        tx = buildDepositSuiDirectTx({
          contracts,
          suiCoinId: data.suiCoinId,
          suiAmountBase: data.suiAmountBase,
          minSharesOut: data.minSharesOut,
          sender: data.sender,
        });
        break;

      case 'vsui':
        tx = buildDepositVsuiTx({
          contracts,
          vsuiCoinId: data.vsuiCoinId,
          leverageBps: data.leverageBps,
          priceE9: data.priceE9,
          minSharesOut: data.minSharesOut,
          sender: data.sender,
        });
        break;

      case 'lsd':
        tx = buildDepositLsdTx({
          contracts,
          lsdCoinId: data.lsdCoinId,
          lsdType: data.lsdType,
          leverageBps: data.leverageBps,
          priceE9: data.priceE9,
          minSharesOut: data.minSharesOut,
          sender: data.sender,
        });
        break;

      case 'btc':
        tx = buildDepositBtcTx({
          contracts,
          btcCoinId: data.btcCoinId,
          btcType: data.btcType,
          pythPriceInfoId: data.pythPriceInfoId,
          minDusdcOut: data.minDusdcOut,
          minSharesOut: data.minSharesOut,
          sender: data.sender,
        });
        break;
    }

    const bytes = await tx.build({ client: suiClient });
    const txBase64 = Buffer.from(bytes).toString('base64');

    return ok({ txBase64, kind: `deposit_${data.asset}` });
  } catch (e) {
    return serverErr(e);
  }
}
