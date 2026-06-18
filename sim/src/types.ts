/** Core types shared across the simulation harness. */

export interface HistoricalExpiry {
  oracleId: string;
  openTimestampMs: number;
  expiryTimestampMs: number;
  /** ATM IV at open (annualised, e4-scaled bigint). */
  atmIvE4: bigint;
  /** Settlement price in dUSDC, e9-scaled. */
  settlementPriceE9: bigint;
  /** Realised volatility over the window (annualised, e4-scaled). */
  realisedVolE4: bigint;
}

export interface SimulationStep {
  rollId: number;
  timestampMs: number;
  navDusdc: bigint;
  totalSupply: bigint;
  navPerShareE9: bigint;
  atmIvE4: bigint;
  regime: 'low' | 'neutral' | 'high';
  plpPnlDusdc: bigint;
  rangePnlDusdc: bigint;
  ibIdlePnlDusdc: bigint;
  totalPnlDusdc: bigint;
}

export interface ScenarioResult {
  scenarioName: string;
  steps: SimulationStep[];
  finalNavDusdc: bigint;
  totalPnlDusdc: bigint;
  sharpeRatioE4: bigint;
  maxDrawdownBps: bigint;
  nRolls: number;
}

export interface SimulationReport {
  generatedAt: string;
  nExpiriesReplayed: number;
  scenarios: ScenarioResult[];
}
