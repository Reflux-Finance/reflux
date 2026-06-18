/**
 * /deposit — Universal deposit flow.
 *
 * Supports all Reflux asset paths:
 *   Tier 1 — USDC (direct) · vSUI (no leverage)
 *   Tier 2 — Native SUI (staked via LSP) · vSUI with leverage
 *   Tier 3 — afSUI · haSUI · xBTC
 *
 * USDC is the only asset that appears in user-facing copy — all dUSDC
 * conversion happens internally inside the PTB.
 */

import { DepositForm } from '../../components/DepositForm';

export default function DepositPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-2">Deposit</h1>
      <p className="text-gray-500 text-sm mb-8">
        Deposit any Sui asset to receive <span className="text-teal-400 font-mono">rfUSD</span> —
        your yield-bearing share of the Reflux capital system. Exits under the
        buffer cap are instant.
      </p>
      <DepositForm />
    </div>
  );
}
