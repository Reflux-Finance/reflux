'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthCallback } from '@mysten/enoki/react';
import { useAuth } from '../../hooks/useAuth';

const SUPPORTED_ASSETS = ['USDC', 'vSUI', 'afSUI', 'haSUI', 'SUI', 'xBTC'];

const WHAT_YOU_GET = [
  {
    icon: '⚡',
    title: 'Instant exits',
    body: 'Withdraw under the buffer cap without waiting for positions to settle.',
  },
  {
    icon: '📊',
    title: 'Live APY',
    body: 'Track your yield decomposition: staking + premia + PLP, updated every roll.',
  },
  {
    icon: '🔍',
    title: 'On-chain proof',
    body: 'Every allocation decision links directly to the on-chain event — nothing is hidden.',
  },
];

const WALLET_OPTIONS = [
  { name: 'Sui Wallet', icon: '🌊', id: 'Sui Wallet' },
  { name: 'Slush',      icon: '❄',  id: 'Slush'      },
  { name: 'Suiet',      icon: '🟣', id: 'Suiet'      },
];

export default function LoginPage() {
  const { isConnected, wallets, connect, zkLogin } = useAuth();
  const router = useRouter();

  // Handle Google OAuth callback — Enoki reads the URL hash, exchanges the JWT
  // for a ZK proof via its managed prover, and stores the session.
  const { handled } = useAuthCallback();

  // Redirect to dashboard once wallet or zkLogin session is active.
  useEffect(() => {
    if (handled || isConnected) {
      router.replace('/dashboard');
    }
  }, [handled, isConnected, router]);

  const { phase, error: zkError, isConfigured, startOAuth } = zkLogin;
  const zkPending = phase === 'redirecting';

  return (
    <div className="max-w-lg mx-auto pt-8 pb-16">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
          Login to Reflux
        </h1>
        <p className="text-sm leading-relaxed max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
          Deposit any Sui asset. Receive{' '}
          <span style={{ color: 'var(--teal)' }} className="font-mono font-semibold">
            rfUSD
          </span>{' '}
          — a single composable yield share backed by DeepBook Predict, Margin, and Iron Bank.
        </p>
      </div>

      {/* Supported assets */}
      <div className="flex flex-wrap gap-2 justify-center mb-8">
        {SUPPORTED_ASSETS.map((a) => (
          <span
            key={a}
            className="text-xs font-mono px-2.5 py-1 rounded-full"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            {a}
          </span>
        ))}
      </div>

      {/* Connect card */}
      <div
        className="rounded-2xl overflow-hidden mb-6"
        style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
      >
        {/* zkLogin via Enoki */}
        <div className="p-6 space-y-3">
          <p
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Recommended · no browser extension needed
          </p>

          <button
            onClick={() => void startOAuth()}
            disabled={zkPending || !isConfigured}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl font-semibold text-sm transition-all disabled:opacity-60"
            style={{
              background: 'white',
              color: '#1a1a1a',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              cursor: zkPending || !isConfigured ? 'not-allowed' : 'pointer',
            }}
          >
            {/* Google logo */}
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>

            {zkPending ? 'Redirecting to Google…' : 'Continue with Google (zkLogin)'}

            {!isConfigured && !zkPending && (
              <span
                className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: 'rgba(0,0,0,0.08)', color: '#666' }}
              >
                setup required
              </span>
            )}
          </button>

          {zkError && (
            <p className="text-xs text-center" style={{ color: 'var(--red)' }}>
              {zkError}
            </p>
          )}

          <p className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
            Powered by Enoki · zkLogin creates a self-custodied Sui address — no seed phrase.
          </p>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 px-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
          <span className="py-4 text-xs" style={{ color: 'var(--text-muted)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
        </div>

        {/* Sui wallet extensions */}
        <div className="px-6 pb-6 space-y-2">
          <p
            className="text-xs font-medium uppercase tracking-wider mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            Browser extension
          </p>
          {WALLET_OPTIONS.map((opt) => {
            const detected = wallets.find((w) => w.name === opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => connect(opt.id)}
                disabled={!detected}
                className="wallet-btn w-full flex items-center gap-3 py-3 px-4 rounded-xl text-sm font-medium disabled:opacity-40"
                title={detected ? undefined : `${opt.name} not detected — install the extension`}
              >
                <span
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                  style={{ background: 'var(--bg-panel)' }}
                >
                  {opt.icon}
                </span>
                <span>{opt.name}</span>
                {!detected ? (
                  <span
                    className="ml-auto text-[10px] font-mono"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    not installed
                  </span>
                ) : (
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
                    →
                  </span>
                )}
              </button>
            );
          })}

          {wallets.length === 0 && (
            <p className="text-[10px] text-center pt-2" style={{ color: 'var(--text-muted)' }}>
              No Sui wallet extension detected in this browser.
            </p>
          )}
        </div>
      </div>

      {/* What you get */}
      <div className="space-y-3 mb-8">
        {WHAT_YOU_GET.map(({ icon, title, body }) => (
          <div
            key={title}
            className="flex gap-3 p-4 rounded-xl"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span className="text-xl flex-shrink-0">{icon}</span>
            <div>
              <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                {title}
              </div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {body}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Risk dashboard CTA */}
      <div className="text-center">
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          Explore the protocol before signing up
        </p>
        <Link href="/risk" className="btn-ghost text-xs px-5 py-2.5">
          View risk dashboard — no wallet needed
        </Link>
      </div>
    </div>
  );
}
