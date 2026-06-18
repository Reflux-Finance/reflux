# Reflux Simulation Report

**Generated:** 2026-06-12T07:55:52.576Z
**Expiries replayed:** 4107

## Scenarios

| Scenario | Rolls | Final NAV (dUSDC) | Total PnL (dUSDC) | Sharpe ×10⁴ | Max Drawdown (bps) |
|---|---|---|---|---|---|
| neutral_baseline | 50 | 181.56 | 81.56 | 58264 | 0 |
| persistent_low_iv | 50 | 114.72 | 14.72 | 252373 | 0 |
| persistent_high_iv | 50 | 1246.31 | 1146.31 | 14416 | 0 |
| iv_spike | 50 | 994.53 | 894.53 | 9890 | 0 |
| bear_market | 50 | 102.77 | 2.77 | 1460 | 695 |
| oscillating_iv | 50 | 354.16 | 254.16 | 9841 | 0 |

## Notes

- All amounts in dUSDC (USDC-equivalent), base-unit (1e6 = $1 at USDC peg).
- PnL model is a simplified volatility model; does not include fees, slippage, or gas.
- Sharpe is computed on per-roll PnL; annualisation omitted for readability.
- IB idle yield assumed 3% annualised (300 bps).
- `EXTERNAL-PENDING`: PLP and range strip PnL are approximations until on-chain oracle prices are available.

## Regime Distribution

**neutral_baseline:** low=0 neutral=50 high=0
**persistent_low_iv:** low=50 neutral=0 high=0
**persistent_high_iv:** low=0 neutral=0 high=50
**iv_spike:** low=0 neutral=25 high=25
**bear_market:** low=33 neutral=17 high=0
**oscillating_iv:** low=25 neutral=0 high=25
