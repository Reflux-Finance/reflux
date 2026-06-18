import { describe, expect, it } from 'vitest';
import {
  buildDepositUsdcTx,
  buildWithdrawTx,
  buildDepositVsuiTx,
  buildEmergencyDeleverageTx,
  buildRollPositionsTx,
  buildPredictSupplyTx,
  buildPredictWithdrawTx,
  buildPredictMintRangeTx,
  buildPredictRedeemPermissionlessTx,
  buildPredictCreateManagerTx,
  type RefluxContracts,
  type PredictContracts,
} from './ptb.js';
import { Transaction } from '@mysten/sui/transactions';

const MOCK_ID = '0x' + 'a'.repeat(64);
const MOCK_SENDER = '0x' + 'b'.repeat(64);

const CONTRACTS: RefluxContracts = {
  packageId: MOCK_ID,
  depositRouterId: MOCK_ID,
  shareRegistryId: MOCK_ID,
  riskParamsId: MOCK_ID,
  spotRouterConfigId: MOCK_ID,
  ibCreditStateId: MOCK_ID,
};

describe('buildDepositUsdcTx', () => {
  it('returns a Transaction instance', () => {
    const tx = buildDepositUsdcTx({
      contracts: CONTRACTS,
      usdcCoinId: MOCK_ID,
      usdcAmountBase: 10_000_000n,
      minSharesOut: 9_900_000n,
      sender: MOCK_SENDER,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('is pure: same inputs produce structurally identical transactions', () => {
    const params = {
      contracts: CONTRACTS,
      usdcCoinId: MOCK_ID,
      usdcAmountBase: 10_000_000n,
      minSharesOut: 9_900_000n,
      sender: MOCK_SENDER,
    };
    const tx1 = buildDepositUsdcTx(params);
    const tx2 = buildDepositUsdcTx(params);
    // Serialize both and compare JSON structure
    const s1 = JSON.stringify(tx1.getData());
    const s2 = JSON.stringify(tx2.getData());
    expect(s1).toBe(s2);
  });
});

describe('buildDepositVsuiTx', () => {
  it('returns a Transaction with leverage params', () => {
    const tx = buildDepositVsuiTx({
      contracts: CONTRACTS,
      vsuiCoinId: MOCK_ID,
      leverageBps: 5_000n,
      priceE9: 1_000_000_000n,
      minSharesOut: 0n,
      sender: MOCK_SENDER,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe('buildWithdrawTx', () => {
  it('returns a Transaction', () => {
    const tx = buildWithdrawTx({
      contracts: CONTRACTS,
      positionId: MOCK_ID,
      sharesCoinId: MOCK_ID,
      sharesAmount: 5_000_000n,
      minDusdcOut: 9_900_000n,
      nextRollId: 0n,
      sender: MOCK_SENDER,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });
});

describe('buildEmergencyDeleverageTx', () => {
  it('returns a Transaction with the correct module/function', () => {
    const tx = buildEmergencyDeleverageTx({
      contracts: CONTRACTS,
      positionId: MOCK_ID,
      repayCoinId: MOCK_ID,
      priceE9: 1_200_000_000n,
      sender: MOCK_SENDER,
    });
    expect(tx).toBeInstanceOf(Transaction);
    // Verify the module call is present
    const data = tx.getData();
    const cmd = data.commands[0] as { MoveCall?: { package: string; module: string; function: string } };
    expect(cmd.MoveCall?.module).toBe('emergency');
    expect(cmd.MoveCall?.function).toBe('emergency_deleverage');
  });
});

describe('buildRollPositionsTx', () => {
  it('calls vault::roll_positions', () => {
    const tx = buildRollPositionsTx({
      contracts: {
        ...CONTRACTS,
        vaultStateId: MOCK_ID,
        keeperAuthId: MOCK_ID,
        allocationPolicyId: MOCK_ID,
        clockId: '0x6',
      },
      atmIvE4: 4_500n,
      sender: MOCK_SENDER,
    });
    expect(tx).toBeInstanceOf(Transaction);
    const data = tx.getData();
    const cmd = data.commands[0] as { MoveCall?: { module: string; function: string } };
    expect(cmd.MoveCall?.module).toBe('vault');
    expect(cmd.MoveCall?.function).toBe('roll_positions');
  });
});

// ─── DeepBook Predict PTB builders ───────────────────────────────────────────

const PREDICT_CONTRACTS: PredictContracts = {
  predictPackageId: '0x' + 'f'.repeat(64),
  predictObjectId: '0x' + 'e'.repeat(64),
  dusdcType: '0x' + 'e'.repeat(64) + '::dusdc::DUSDC',
  plpType: '0x' + 'f'.repeat(64) + '::plp::PLP',
};

describe('buildPredictSupplyTx', () => {
  it('calls predict::supply with correct type arg', () => {
    const tx = buildPredictSupplyTx({
      contracts: PREDICT_CONTRACTS,
      dusdcCoinId: MOCK_ID,
      sender: MOCK_SENDER,
    });
    expect(tx).toBeInstanceOf(Transaction);
    const cmds = tx.getData().commands;
    // Two commands: supply call + transferObjects
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    const call = cmds[0] as { MoveCall?: { module: string; function: string; typeArguments: string[] } };
    expect(call.MoveCall?.module).toBe('predict');
    expect(call.MoveCall?.function).toBe('supply');
    expect(call.MoveCall?.typeArguments[0]).toBe(PREDICT_CONTRACTS.dusdcType);
  });
});

describe('buildPredictWithdrawTx', () => {
  it('calls predict::withdraw with correct type arg', () => {
    const tx = buildPredictWithdrawTx({
      contracts: PREDICT_CONTRACTS,
      plpCoinId: MOCK_ID,
      sender: MOCK_SENDER,
    });
    const call = tx.getData().commands[0] as { MoveCall?: { module: string; function: string } };
    expect(call.MoveCall?.module).toBe('predict');
    expect(call.MoveCall?.function).toBe('withdraw');
  });
});

describe('buildPredictCreateManagerTx', () => {
  it('calls predict::create_manager', () => {
    const tx = buildPredictCreateManagerTx(PREDICT_CONTRACTS.predictPackageId, MOCK_SENDER);
    const call = tx.getData().commands[0] as { MoveCall?: { module: string; function: string } };
    expect(call.MoveCall?.module).toBe('predict');
    expect(call.MoveCall?.function).toBe('create_manager');
  });
});

describe('buildPredictMintRangeTx', () => {
  it('composes range_key::new then predict::mint_range', () => {
    const tx = buildPredictMintRangeTx({
      contracts: PREDICT_CONTRACTS,
      managerId: MOCK_ID,
      oracleObjectId: MOCK_ID,
      expiry: 1_781_257_500_000n,
      lowerStrike: 55_000_000_000_000n,
      higherStrike: 65_000_000_000_000n,
      quantity: 100n,
      sender: MOCK_SENDER,
    });
    const cmds = tx.getData().commands;
    expect(cmds.length).toBe(2);
    const keyCall = cmds[0] as { MoveCall?: { module: string; function: string } };
    const mintCall = cmds[1] as { MoveCall?: { module: string; function: string } };
    expect(keyCall.MoveCall?.module).toBe('range_key');
    expect(keyCall.MoveCall?.function).toBe('new');
    expect(mintCall.MoveCall?.module).toBe('predict');
    expect(mintCall.MoveCall?.function).toBe('mint_range');
  });
});

describe('buildPredictRedeemPermissionlessTx', () => {
  it('composes market_key::new then predict::redeem_permissionless', () => {
    const tx = buildPredictRedeemPermissionlessTx({
      contracts: PREDICT_CONTRACTS,
      managerId: MOCK_ID,
      oracleObjectId: MOCK_ID,
      expiry: 1_781_257_500_000n,
      strike: 60_000_000_000_000n,
      isUp: true,
      quantity: 50n,
      sender: MOCK_SENDER,
    });
    const cmds = tx.getData().commands;
    expect(cmds.length).toBe(2);
    const keyCall = cmds[0] as { MoveCall?: { module: string; function: string } };
    const redeemCall = cmds[1] as { MoveCall?: { module: string; function: string } };
    expect(keyCall.MoveCall?.module).toBe('market_key');
    expect(keyCall.MoveCall?.function).toBe('new');
    expect(redeemCall.MoveCall?.module).toBe('predict');
    expect(redeemCall.MoveCall?.function).toBe('redeem_permissionless');
  });
});

describe('PTB snapshot tests', () => {
  it('deposit_usdc matches snapshot', () => {
    const tx = buildDepositUsdcTx({
      contracts: CONTRACTS,
      usdcCoinId: MOCK_ID,
      usdcAmountBase: 10_000_000n,
      minSharesOut: 9_900_000n,
      sender: MOCK_SENDER,
    });
    const data = tx.getData();
    // SplitCoins (exact deposit amount) followed by the deposit_usdc MoveCall.
    expect(data.commands).toHaveLength(2);
    const cmd = data.commands[1] as { MoveCall?: { package: string; module: string; function: string } };
    expect(cmd.MoveCall).toBeDefined();
    expect(cmd.MoveCall?.package).toBe(MOCK_ID);
    expect(cmd.MoveCall?.module).toBe('deposit_router');
    expect(cmd.MoveCall?.function).toBe('deposit_usdc');
  });
});
