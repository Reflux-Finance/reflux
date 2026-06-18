'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  useEnokiFlow,
  useZkLogin as useEnokiZkLoginState,
} from '@mysten/enoki/react';

export type ZkLoginPhase = 'idle' | 'redirecting' | 'ready' | 'error';

export interface ZkLoginState {
  phase: ZkLoginPhase;
  address: string | null;
  error: string | null;
  /** True when both NEXT_PUBLIC_ENOKI_API_KEY and NEXT_PUBLIC_GOOGLE_CLIENT_ID are set. */
  isConfigured: boolean;
  startOAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useZkLogin(): ZkLoginState {
  const flow = useEnokiFlow();
  const enokiState = useEnokiZkLoginState();
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Defer reading the Enoki atom until after hydration.
  // useStore() reads nanostores synchronously — on the server the atom is empty,
  // but on the client it may hold a stored session, causing a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const address = mounted ? (enokiState.address ?? null) : null;

  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_ENOKI_API_KEY &&
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  );

  const startOAuth = useCallback(async () => {
    if (!isConfigured) {
      setError(
        'Enoki API key or Google Client ID is not configured. ' +
          'Set NEXT_PUBLIC_ENOKI_API_KEY and NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env.',
      );
      return;
    }
    setError(null);
    setRedirecting(true);
    try {
      const authUrl = await flow.createAuthorizationURL({
        provider: 'google',
        clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        redirectUrl: `${window.location.origin}/login`,
        network: 'testnet',
      });
      window.location.href = authUrl;
    } catch (e) {
      setRedirecting(false);
      setError(e instanceof Error ? e.message : 'Failed to start Google sign-in');
    }
  }, [flow, isConfigured]);

  const logout = useCallback(async () => {
    setError(null);
    await flow.logout();
  }, [flow]);

  const phase: ZkLoginPhase = address
    ? 'ready'
    : redirecting
      ? 'redirecting'
      : error
        ? 'error'
        : 'idle';

  return { phase, address, error, isConfigured, startOAuth, logout };
}
