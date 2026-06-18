'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClientQuery,
} from '@mysten/dapp-kit';
import { useEnokiFlow } from '@mysten/enoki/react';
import { useSuiClientContext } from '@mysten/dapp-kit';
import { useAuth } from '../hooks/useAuth';
import { PREFERRED_OUTPUT_USDC } from '@reflux/lib';

// rfUSD coin type — tied to original (v1) package ID.
const RFUSD_TYPE =
  process.env.NEXT_PUBLIC_RFUSD_TYPE ??
  `${process.env.NEXT_PUBLIC_PACKAGE_ID ?? ''}::share_token::SHARE_TOKEN`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserPosition {
  rfusdBalance: string;
  rfusdRaw: string;
  usdValue: string;
  navPerShare: string;
  navPerShareE9: string;
  positions: VaultPositionData[];
}

interface VaultPositionData {
  objectId: string;
  sharesMinted: string;
  depositTsMs: string;
  hasCollateral: boolean;
  hasDebt: boolean;
  preferredOutput: number;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatRfusd(raw: string): string {
  const n = Number(raw) / 1e6;  // rfUSD has 6 decimals
  if (n === 0) return '0.000';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toFixed(3);
}

function formatDusdc(raw: string | bigint): string {
  const n = Number(raw) / 1_000_000;
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function formatDate(tsMs: string): string {
  if (!tsMs || tsMs === '0') return '—';
  return new Date(Number(tsMs)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function assetLabel(preferred: number): string {
  return ['USDC', 'SUI', 'LSD', 'BTC'][preferred] ?? 'USDC';
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div
      className="rounded-xl p-6 animate-pulse space-y-4"
      style={{
        background: 'linear-gradient(135deg, var(--bg-panel) 0%, rgba(0,212,200,0.04) 100%)',
        border: '1px solid var(--teal-border)',
      }}
    >
      <div className="h-3 w-1/3 rounded" style={{ background: 'var(--bg-elevated)' }} />
      <div className="h-10 w-1/2 rounded" style={{ background: 'var(--bg-elevated)' }} />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 rounded" style={{ background: 'var(--bg-elevated)' }} />
        ))}
      </div>
    </div>
  );
}

// ─── Connect gate ─────────────────────────────────────────────────────────────

function ConnectGate() {
  const router = useRouter();
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, var(--bg-panel) 0%, rgba(0,212,200,0.04) 100%)',
        border: '1px solid var(--teal-border)',
      }}
    >
      <div className="px-6 py-12 text-center space-y-4">
        <div className="text-3xl">🔗</div>
        <div>
          <div className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Connect your wallet
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Connect to see your live rfUSD position, real APY, and instant-exit capacity.
          </p>
        </div>
        <button
          onClick={() => router.push('/login')}
          className="btn-teal px-6 py-2.5 text-sm"
        >
          Connect wallet
        </button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Supports Sui Wallet, Slush, Suiet — and Google via zkLogin (no seed phrase).
        </p>
      </div>
    </div>
  );
}

// ─── Withdraw button — full sign + submit flow ─────────────────────────────────

type WithdrawState = 'idle' | 'confirming' | 'building' | 'signing' | 'done' | 'error';

interface WithdrawButtonProps {
  address: string;
  positionId: string;
  sharesMinted: string;
  navPerShareE9: string;
  rfusdCoinId: string | null;
  preferredOutput: number;
  onSuccess: () => void;
}

function WithdrawButton({
  address,
  positionId,
  sharesMinted,
  navPerShareE9,
  rfusdCoinId,
  preferredOutput,
  onSuccess,
}: WithdrawButtonProps) {
  const account = useCurrentAccount();
  const flow = useEnokiFlow();
  const { client: suiClient } = useSuiClientContext();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const payoutAsset = preferredOutput === PREFERRED_OUTPUT_USDC ? 'USDC' : 'dUSDC';
  const fullSharesMinted = BigInt(sharesMinted);
  // Default the amount input to the full position, in human rfUSD units (6 decimals).
  const [amountInput, setAmountInput] = useState(() => (Number(fullSharesMinted) / 1e6).toString());

  const [wState, setWState] = useState<WithdrawState>('idle');
  const [txDigest, setTxDigest] = useState('');
  const [error, setError] = useState('');

  const amountBaseUnits = (() => {
    const n = parseFloat(amountInput);
    if (isNaN(n) || n <= 0) return 0n;
    return BigInt(Math.round(n * 1e6));
  })();
  const amountValid = amountBaseUnits > 0n && amountBaseUnits <= fullSharesMinted;

  // Expected dUSDC output: shares × nav_per_share_e9 / 1e9 (in 6-decimal dUSDC base units)
  const expectedDusdc =
    (amountBaseUnits * BigInt(navPerShareE9)) / 1_000_000_000n;
  // Apply 0.5% slippage guard
  const minDusdcOut = (expectedDusdc * 995n) / 1000n;

  async function doWithdraw() {
    if (!rfusdCoinId) {
      setError('No rfUSD coin found in wallet. Refresh the page.');
      setWState('error');
      return;
    }
    if (!amountValid) {
      setError('Enter an amount between 0 and your shares minted.');
      setWState('error');
      return;
    }
    setWState('building');
    setError('');
    try {
      const res = await fetch('/api/vault/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          sharesCoinId: rfusdCoinId,
          sharesAmount: amountBaseUnits.toString(),
          minDusdcOut: minDusdcOut.toString(),
          sender: address,
        }),
      });

      const json = (await res.json()) as {
        ok: boolean;
        data?: { txBase64: string };
        error?: string;
      };

      if (!json.ok || !json.data?.txBase64) {
        setError(json.error ?? 'Failed to build withdraw transaction');
        setWState('error');
        return;
      }

      setWState('signing');
      let digest: string;

      if (account) {
        const result = await signAndExecuteTransaction({
          transaction: json.data.txBase64,
        });
        digest = result.digest;
      } else {
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
      setWState('done');
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
      setWState('error');
    }
  }

  if (wState === 'done') {
    return (
      <div className="flex flex-col gap-1">
        <div
          className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg font-semibold"
          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: 'var(--green)' }}
        >
          <span>✓ Withdrawn</span>
        </div>
        {txDigest && (
          <a
            href={`https://suiexplorer.com/txblock/${txDigest}?network=testnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono px-1"
            style={{ color: 'var(--teal)' }}
          >
            {txDigest.slice(0, 20)}… ↗
          </a>
        )}
      </div>
    );
  }

  if (wState === 'confirming') {
    const isFull = amountBaseUnits === fullSharesMinted;
    return (
      <div
        className="rounded-lg p-4 space-y-3"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', minWidth: '260px' }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          Confirm withdrawal
        </div>

        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Amount (rfUSD)</span>
            <button
              onClick={() => setAmountInput((Number(fullSharesMinted) / 1e6).toString())}
              className="text-[10px] font-mono"
              style={{ color: 'var(--teal)' }}
            >
              MAX ({formatRfusd(sharesMinted)})
            </button>
          </div>
          <input
            type="number"
            min="0"
            step="any"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Receive (est.)</span>
            <span style={{ color: 'var(--teal)' }}>{formatDusdc(expectedDusdc)} {payoutAsset}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Min out (0.5%)</span>
            <span style={{ color: 'var(--text-secondary)' }}>{formatDusdc(minDusdcOut)}</span>
          </div>
          <div
            className="text-[10px] pt-1"
            style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}
          >
            {isFull
              ? '⚡ Instant exit — funded from Iron Bank buffer. Closes this position.'
              : '⚡ Instant exit — funded from Iron Bank buffer. Position stays open for the remainder.'}
          </div>
        </div>

        {!amountValid && (
          <p className="text-[10px]" style={{ color: 'var(--red)' }}>
            Enter an amount between 0 and {formatRfusd(sharesMinted)} rfUSD.
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => void doWithdraw()}
            disabled={!amountValid}
            className="flex-1 py-2 text-xs rounded-lg font-semibold transition-all"
            style={{
              background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--green)',
              opacity: amountValid ? 1 : 0.5, cursor: amountValid ? 'pointer' : 'not-allowed',
            }}
          >
            Confirm
          </button>
          <button
            onClick={() => setWState('idle')}
            className="py-2 px-3 text-xs rounded-lg"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => {
          if (wState === 'error') { setError(''); setWState('idle'); return; }
          setWState('confirming');
        }}
        disabled={wState === 'building' || wState === 'signing'}
        className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg font-semibold transition-all"
        style={{
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.25)',
          color: 'var(--green)',
          opacity: wState === 'building' || wState === 'signing' ? 0.6 : 1,
          cursor: wState === 'building' || wState === 'signing' ? 'not-allowed' : 'pointer',
        }}
      >
        <span>
          {wState === 'building' ? 'Building tx…' :
           wState === 'signing'  ? 'Awaiting wallet…' :
           wState === 'error'    ? 'Retry' :
           payoutAsset === 'USDC' ? 'Withdraw USDC' : 'Withdraw'}
        </span>
        {wState === 'idle' && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)' }}
          >
            ⚡ Instant
          </span>
        )}
      </button>
      {wState === 'error' && error && (
        <p className="text-[10px] max-w-xs" style={{ color: 'var(--red)' }}>{error}</p>
      )}
    </div>
  );
}

// ─── Main PositionCard ────────────────────────────────────────────────────────

export function PositionCard() {
  const { address, isConnected } = useAuth();
  const [data, setData] = useState<UserPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch user's rfUSD coins so WithdrawButton has the actual coin objectId.
  const { data: rfusdCoinsData } = useSuiClientQuery(
    'getCoins',
    { owner: address ?? '', coinType: RFUSD_TYPE },
    { enabled: Boolean(address) },
  );

  // Find the coin with the largest balance to use for withdrawals.
  const bestRfusdCoin = rfusdCoinsData?.data?.length
    ? rfusdCoinsData.data.reduce((best, c) =>
        BigInt(c.balance) > BigInt(best.balance) ? c : best,
      )
    : null;

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/user/positions?address=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: UserPosition; error?: string }) => {
        if (j.ok && j.data) setData(j.data);
        else setError(j.error ?? 'Failed to load position');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [address, refreshKey]);

  if (!isConnected) return <ConnectGate />;
  if (loading) return <Skeleton />;

  const rfusdDisplay = data ? formatRfusd(data.rfusdRaw) : '0.000';
  const hasPosition = data && (Number(data.rfusdRaw) > 0 || data.positions.length > 0);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, var(--bg-panel) 0%, rgba(0,212,200,0.04) 100%)',
        border: '1px solid var(--teal-border)',
      }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid rgba(0,212,200,0.12)' }}
      >
        <div className="flex items-center gap-2">
          <span className="status-dot status-dot-green" />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            My Position
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="text-[11px] font-mono transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="Refresh"
          >
            ↻
          </button>
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(0,212,200,0.08)', color: 'var(--teal-light)', border: '1px solid var(--teal-border)' }}
          >
            Live
          </span>
        </div>
      </div>

      {error && (
        <div className="px-6 py-4">
          <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
        </div>
      )}

      {/* Balance hero */}
      <div className="px-6 pt-5 pb-4 flex flex-wrap gap-6 items-end">
        <div>
          <div className="metric-label mb-1.5">rfUSD Balance</div>
          <div className="text-4xl font-bold font-data" style={{ color: 'var(--text-primary)' }}>
            {rfusdDisplay}
            <span className="text-xl ml-1.5" style={{ color: 'var(--teal)' }}>rfUSD</span>
          </div>
          {data && (
            <div className="text-sm mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
              {data.usdValue} · NAV {data.navPerShare} dUSDC/rfUSD
            </div>
          )}
        </div>

        {!hasPosition && !error && (
          <div
            className="px-3 py-2 rounded-lg text-xs"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
          >
            No position yet — make your first deposit to start earning.
          </div>
        )}
      </div>

      {/* Per-position rows */}
      {data?.positions.map((pos, i) => (
        <div
          key={pos.objectId}
          className="px-6 py-4 space-y-3"
          style={{
            borderTop: '1px solid rgba(0,212,200,0.08)',
            background: i % 2 === 1 ? 'rgba(0,212,200,0.02)' : 'transparent',
          }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Deposited asset', value: assetLabel(pos.preferredOutput) },
              { label: 'Deposit date',    value: formatDate(pos.depositTsMs) },
              { label: 'Shares minted',   value: formatRfusd(pos.sharesMinted) + ' rfUSD' },
              { label: 'Leverage',         value: pos.hasDebt ? 'Active' : 'None' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="metric-label mb-1">{label}</div>
                <div className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Withdraw button per position */}
          <WithdrawButton
            address={address!}
            positionId={pos.objectId}
            sharesMinted={pos.sharesMinted}
            navPerShareE9={data.navPerShareE9 ?? '1000000000'}
            rfusdCoinId={bestRfusdCoin?.coinObjectId ?? null}
            preferredOutput={pos.preferredOutput}
            onSuccess={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      ))}

      {/* Address + explorer row */}
      <div
        className="px-6 py-3 flex items-center gap-2"
        style={{ borderTop: '1px solid rgba(0,212,200,0.08)' }}
      >
        <span className="text-[10px] font-mono truncate max-w-[220px]" style={{ color: 'var(--text-muted)' }}>
          {address}
        </span>
        <a
          href={`https://suiexplorer.com/address/${address}?network=testnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] ml-auto flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--teal)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          Explorer ↗
        </a>
      </div>

      {/* CTA row */}
      <div
        className="px-6 py-4 flex flex-wrap gap-3"
        style={{ borderTop: '1px solid rgba(0,212,200,0.08)' }}
      >
        <Link href="/deposit" className="btn-teal px-5 py-2.5 text-sm">
          + Deposit
        </Link>
        {!hasPosition && (
          <p className="text-xs self-center" style={{ color: 'var(--text-muted)' }}>
            Deposit to receive rfUSD and start earning structured yield.
          </p>
        )}
      </div>
    </div>
  );
}
