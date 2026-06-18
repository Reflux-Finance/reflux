/**
 * /dashboard — Personal rfUSD position and protocol snapshot.
 *
 * PositionCard is a client component that gates on wallet connection and
 * fetches real on-chain data.  VaultStats and DecisionFeed are independent
 * client components that read public protocol state.
 */

import { PositionCard } from '../../components/PositionCard';
import { VaultStats } from '../../components/VaultStats';
import { DecisionFeed } from '../../components/DecisionFeed';
import { ApyBreakdown } from '../../components/ApyBreakdown';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Your rfUSD position · live allocation decisions · yield breakdown
          </p>
        </div>
        <Link href="/risk" className="btn-ghost text-xs px-4 py-2 flex-shrink-0">
          Risk dashboard →
        </Link>
      </div>

      {/* Position card — wallet-gated, fetches live on-chain data */}
      <PositionCard />

      {/* Protocol stats + Decision feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VaultStats />
        <DecisionFeed limit={5} />
      </div>

      {/* APY breakdown — live from DeepBook SVI */}
      <ApyBreakdown />
    </div>
  );
}
