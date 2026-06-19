'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClientContext,
  useSuiClientQuery,
} from '@mysten/dapp-kit';
import { useEnokiFlow } from '@mysten/enoki/react';
import { useAuth } from '../../hooks/useAuth';

const RFBTC_TYPE = process.env.NEXT_PUBLIC_RFBTC_TYPE ?? '';
const RFBTC_FAUCET_MAX = 100_000_000_000; // 1,000 rfBTC (8 decimals)

function formatRfbtc(raw: string | bigint): string {
  return (Number(raw) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function ConnectGate() {
  const router = useRouter();
  return (
    <div
      className="rounded-xl px-6 py-12 text-center space-y-4"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
    >
      <div className="text-3xl">🔗</div>
      <div>
        <div className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Sign in
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Sign in to mint testnet assets to your address.
        </p>
      </div>
      <button onClick={() => router.push('/login')} className="btn-teal px-6 py-2.5 text-sm">
        Sign in
      </button>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Supports Sui Wallet, Slush, Suiet — and Google via zkLogin (no seed phrase).
      </p>
    </div>
  );
}

function Card({
  title,
  badge,
  badgeTone,
  children,
}: {
  title: string;
  badge: string;
  badgeTone: 'live' | 'limited' | 'manual';
  children: React.ReactNode;
}) {
  const tones: Record<string, { bg: string; color: string; border: string }> = {
    live:    { bg: 'rgba(0,212,200,0.08)',   color: 'var(--teal-light)', border: 'var(--teal-border)' },
    limited: { bg: 'rgba(245,166,35,0.08)',  color: 'var(--amber)',      border: 'rgba(245,166,35,0.25)' },
    manual:  { bg: 'rgba(139,152,168,0.08)', color: 'var(--text-muted)', border: 'var(--border-default)' },
  };
  const tone = tones[badgeTone];
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}>
      <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded-full"
          style={{ background: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}
        >
          {badge}
        </span>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

function RfBtcFaucet({ address }: { address: string }) {
  const account = useCurrentAccount();
  const flow = useEnokiFlow();
  const { client: suiClient } = useSuiClientContext();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [txDigest, setTxDigest] = useState('');

  const { data: balanceData, refetch } = useSuiClientQuery(
    'getBalance',
    { owner: address, coinType: RFBTC_TYPE },
    { enabled: Boolean(address && RFBTC_TYPE) },
  );

  async function execTx(txBase64: string): Promise<string> {
    if (account) {
      const result = await signAndExecuteTransaction({ transaction: txBase64 });
      return result.digest;
    }
    const keypair = await flow.getKeypair({ network: 'testnet' });
    const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
    const { bytes, signature } = await keypair.signTransaction(txBytes);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (suiClient as any).executeTransactionBlock({
      transactionBlock: bytes,
      signature,
      options: { showEffects: true },
    }) as { digest: string };
    return result.digest;
  }

  async function handleMint() {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) { setError('Enter an amount greater than 0'); return; }
    const baseUnits = Math.floor(amountNum * 1e8);
    if (baseUnits > RFBTC_FAUCET_MAX) {
      setError(`Max ${(RFBTC_FAUCET_MAX / 1e8).toLocaleString()} rfBTC per mint — call again for more.`);
      return;
    }

    setLoading(true);
    setError('');
    setTxDigest('');
    try {
      const res = await fetch('/api/rfbtc/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: address, amount: baseUnits.toString() }),
      });
      const json = await res.json() as { ok: boolean; data?: { txBase64: string }; error?: string };
      if (!json.ok || !json.data?.txBase64) { setError(json.error ?? 'Mint failed'); return; }
      const digest = await execTx(json.data.txBase64);
      setTxDigest(digest);
      void refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Reflux&apos;s own testnet BTC — fully self-issued, no external dependency.
        Mint any amount up to {(RFBTC_FAUCET_MAX / 1e8).toLocaleString()} rfBTC per call.
      </p>

      {balanceData && (
        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          Current balance: {formatRfbtc(balanceData.totalBalance)} rfBTC
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount of rfBTC"
          className="flex-1 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
        />
        <button
          onClick={() => void handleMint()}
          disabled={loading}
          className="btn-teal px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {loading ? 'Minting…' : 'Mint rfBTC'}
        </button>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

      {txDigest && (
        <a
          href={`https://suiexplorer.com/txblock/${txDigest}?network=testnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs flex items-center gap-1"
          style={{ color: 'var(--teal)' }}
        >
          ✓ Minted — view on Explorer ↗
        </a>
      )}
    </div>
  );
}

export default function FaucetPage() {
  const { address, isConnected } = useAuth();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>rfBTC Faucet</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Reflux&apos;s own testnet BTC — fully self-issued, no external dependency.
        </p>
      </div>

      {!isConnected || !address ? (
        <ConnectGate />
      ) : (
        <Card title="rfBTC" badge="self-issued · any amount" badgeTone="live">
          <RfBtcFaucet address={address} />
          <div
            className="px-3 py-2.5 rounded-lg text-xs leading-relaxed"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            On mainnet, rfBTC is redeemable 1:1 with real BTC — this faucet (free, uncapped minting)
            only exists on testnet so the deposit flow can be tested without a live BTC bridge.
          </div>
        </Card>
      )}
    </div>
  );
}
