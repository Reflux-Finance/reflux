import { describe, expect, it } from 'vitest';
import {
  buildDepositUsdcTx,
  buildWithdrawTx,
  buildDepositVsuiTx,
  buildEmergencyDeleverageTx,
  buildRollPositionsTx,
  type RefluxContracts,
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
      minSharesOut: 9_900_000n,
      sender: MOCK_SENDER,
    });
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('is pure: same inputs produce structurally identical transactions', () => {
    const params = {
      contracts: CONTRACTS,
      usdcCoinId: MOCK_ID,
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
      minDusdcOut: 9_900_000n,
      minUsdcOut: 0n,
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

describe('PTB snapshot tests', () => {
  it('deposit_usdc matches snapshot', () => {
    const tx = buildDepositUsdcTx({
      contracts: CONTRACTS,
      usdcCoinId: MOCK_ID,
      minSharesOut: 9_900_000n,
      sender: MOCK_SENDER,
    });
    const data = tx.getData();
    expect(data.commands).toHaveLength(1);
    const cmd = data.commands[0] as { MoveCall?: { package: string; module: string; function: string } };
    expect(cmd.MoveCall).toBeDefined();
    expect(cmd.MoveCall?.package).toBe(MOCK_ID);
    expect(cmd.MoveCall?.module).toBe('deposit_router');
    expect(cmd.MoveCall?.function).toBe('deposit_usdc');
  });
});
