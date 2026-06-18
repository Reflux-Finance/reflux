'use client';

import {
  useCurrentAccount,
  useConnectWallet,
  useDisconnectWallet,
  useWallets,
} from '@mysten/dapp-kit';
import { useZkLogin } from './useZkLogin';

export interface AuthState {
  /** Sui address of the connected account (wallet extension or zkLogin). */
  address: string | null;
  isConnected: boolean;
  /** 'wallet' | 'zklogin' | null */
  authMethod: 'wallet' | 'zklogin' | null;
  /** Available wallet extensions detected in the browser. */
  wallets: ReturnType<typeof useWallets>;
  /** Connect a specific wallet extension by its name. */
  connect: (walletName: string) => void;
  /** Disconnect the current session (works for both wallet and zkLogin). */
  disconnect: () => void;
  /** zkLogin-specific state (for login page UI). */
  zkLogin: ReturnType<typeof useZkLogin>;
}

export function useAuth(): AuthState {
  const account = useCurrentAccount();
  const { mutate: connectWallet } = useConnectWallet();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const wallets = useWallets();
  const zkLogin = useZkLogin();

  // Extension wallet takes priority; fall back to zkLogin session.
  const address = account?.address ?? zkLogin.address ?? null;
  const authMethod = account ? 'wallet' : zkLogin.address ? 'zklogin' : null;

  function connect(name: string) {
    const wallet = wallets.find((w) => w.name === name);
    if (wallet) connectWallet({ wallet });
  }

  function disconnect() {
    if (account) {
      disconnectWallet();
    } else {
      void zkLogin.logout();
    }
  }

  return {
    address,
    isConnected: Boolean(address),
    authMethod,
    wallets,
    connect,
    disconnect,
    zkLogin,
  };
}
