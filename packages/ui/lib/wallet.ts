/**
 * Wallet utilities for connecting and signing transactions
 * Handles wallet connection flow and mobile deep links
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { ARBITRUM_CHAIN_ID, EscrowABI, ERC20ABI, EscrowFactoryABI, FACTORY_ADDRESS } from './chain';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type WalletStep = 
  | 'idle'
  | 'connecting'
  | 'switching'
  | 'ready'
  | 'signing'
  | 'success'
  | 'error';

export type WalletState = {
  step: WalletStep;
  address: Address | null;
  chainId: number | null;
  txHash: string | null;
  error: string | null;
  hasInjectedWallet: boolean;
};

export type WalletActions = {
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  sendTransaction: (to: Address, data: Hex) => Promise<void>;
  reset: () => void;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Wallet Hook
// ═══════════════════════════════════════════════════════════════════════════════

export function useWalletConnection(): WalletState & WalletActions {
  const [step, setStep] = useState<WalletStep>('idle');
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasInjectedWallet, setHasInjectedWallet] = useState(false);

  // Check for injected wallet on mount
  useEffect(() => {
    setHasInjectedWallet(typeof window !== 'undefined' && !!window.ethereum);
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const accts = accounts as string[];
      if (accts.length === 0) {
        setAddress(null);
        setStep('idle');
      } else {
        setAddress(accts[0] as Address);
      }
    };

    const handleChainChanged = (chainIdHex: unknown) => {
      const newChainId = parseInt(chainIdHex as string, 16);
      setChainId(newChainId);
      if (newChainId !== ARBITRUM_CHAIN_ID && step === 'ready') {
        setStep('switching');
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [step]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('No wallet detected');
      setStep('error');
      return;
    }

    try {
      setStep('connecting');
      setError(null);

      // Request accounts
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      }) as string[];

      if (accounts.length === 0) {
        throw new Error('No accounts returned');
      }

      setAddress(accounts[0] as Address);

      // Get current chain
      const chainIdHex = await window.ethereum.request({
        method: 'eth_chainId',
      }) as string;
      const currentChainId = parseInt(chainIdHex, 16);
      setChainId(currentChainId);

      if (currentChainId === ARBITRUM_CHAIN_ID) {
        setStep('ready');
      } else {
        setStep('switching');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      setError(message);
      setStep('error');
    }
  }, []);

  const switchChain = useCallback(async () => {
    if (!window.ethereum) {
      setError('No wallet detected');
      setStep('error');
      return;
    }

    try {
      setStep('switching');
      setError(null);

      // Try to switch to Arbitrum
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${ARBITRUM_CHAIN_ID.toString(16)}` }],
        });
      } catch (switchError: unknown) {
        // If chain doesn't exist, add it
        const err = switchError as { code?: number };
        if (err.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${ARBITRUM_CHAIN_ID.toString(16)}`,
              chainName: 'Arbitrum One',
              nativeCurrency: {
                name: 'Ethereum',
                symbol: 'ETH',
                decimals: 18,
              },
              rpcUrls: ['https://arb1.arbitrum.io/rpc'],
              blockExplorerUrls: ['https://arbiscan.io'],
            }],
          });
        } else {
          throw switchError;
        }
      }

      setChainId(ARBITRUM_CHAIN_ID);
      setStep('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to switch chain';
      setError(message);
      setStep('error');
    }
  }, []);

  const sendTransaction = useCallback(async (to: Address, data: Hex) => {
    if (!window.ethereum || !address) {
      setError('Wallet not connected');
      setStep('error');
      return;
    }

    try {
      setStep('signing');
      setError(null);

      const txHashResult = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to,
          data,
          // Gas will be estimated by the wallet
        }],
      }) as string;

      setTxHash(txHashResult);
      setStep('success');
    } catch (err) {
      const message = parseTransactionError(err);
      setError(message);
      setStep('error');
    }
  }, [address]);

  const reset = useCallback(() => {
    setStep('idle');
    setTxHash(null);
    setError(null);
  }, []);

  return {
    step,
    address,
    chainId,
    txHash,
    error,
    hasInjectedWallet,
    connect,
    switchChain,
    sendTransaction,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transaction Encoding
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Encode confirm() transaction data
 */
export function encodeConfirmTx(): Hex {
  return encodeFunctionData({
    abi: EscrowABI,
    functionName: 'confirm',
  });
}

/**
 * Encode finalizeAfterDeadline() transaction data
 */
export function encodeFinalizeTx(): Hex {
  return encodeFunctionData({
    abi: EscrowABI,
    functionName: 'finalizeAfterDeadline',
  });
}

/**
 * Encode sweepToTreasury() transaction data
 */
export function encodeSweepTx(): Hex {
  return encodeFunctionData({
    abi: EscrowABI,
    functionName: 'sweepToTreasury',
  });
}

/**
 * Encode ERC20 transfer(to, amount) for funding escrow.
 */
export function encodeFundEscrowTx(escrowAddress: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20ABI,
    functionName: 'transfer',
    args: [escrowAddress, amount],
  });
}

/**
 * Encode EscrowFactory.createEscrowSimple(...) for wallet signing
 */
export function encodeCreateEscrowTx(params: {
  payout: Address;
  funder: Address;
  token: Address;
  targetAmount: bigint;
  deadline: number;
  arbitrator1?: Address;
  arbitrator2?: Address;
  arbitrator3?: Address;
}): Hex {
  const ZERO = '0x0000000000000000000000000000000000000000' as Address;
  return encodeFunctionData({
    abi: EscrowFactoryABI,
    functionName: 'createEscrowSimple',
    args: [
      params.payout,
      params.funder,
      params.token,
      params.targetAmount,
      BigInt(params.deadline),
      params.arbitrator1 || ZERO,
      params.arbitrator2 || ZERO,
      params.arbitrator3 || ZERO,
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Deep Link Builders
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build MetaMask deep link URL.
 * Uses the native metamask:// protocol which is more reliable than the
 * universal link (metamask.app.link) that can crash on some iOS versions.
 */
export function buildMetaMaskDeepLink(url: string): string {
  const cleanUrl = url.replace(/^https?:\/\//, '');
  return `metamask://dapp/${cleanUrl}`;
}

/**
 * Build Coinbase Wallet deep link URL.
 * Uses the native cbwallet:// protocol for reliability.
 */
export function buildCoinbaseWalletDeepLink(url: string): string {
  const cleanUrl = url.replace(/^https?:\/\//, '');
  return `cbwallet://dapp?url=${encodeURIComponent(`https://${cleanUrl}`)}`;
}

/**
 * Get the current page URL (for deep links).
 * Returns origin + pathname only (no query/hash) for clean deep links.
 */
export function getCurrentUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin + window.location.pathname;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Error Parsing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse transaction error into user-friendly message
 */
function parseTransactionError(err: unknown): string {
  if (!err) return 'Transaction failed';
  
  const error = err as { message?: string; code?: number; data?: { message?: string } };
  
  // User rejected
  if (error.code === 4001) {
    return 'Transaction rejected by user';
  }
  
  // Check for revert reason in error message
  const message = error.message || '';
  
  // Common Escrow revert reasons
  if (message.includes('not seller')) return 'Only the seller can confirm this escrow';
  if (message.includes('already confirmed')) return 'Escrow is already confirmed';
  if (message.includes('confirm window closed')) return 'Confirmation window has expired';
  if (message.includes('already terminal')) return 'Escrow has already been resolved or expired';
  if (message.includes('not confirmed')) return 'Escrow has not been confirmed yet';
  if (message.includes('not funded')) return 'Escrow is not fully funded';
  if (message.includes('deadline not reached')) return 'Deadline has not been reached yet';
  if (message.includes('has arbitrators')) return 'Escrow has arbitrators - use arbitration instead';
  if (message.includes('nothing to sweep')) return 'No funds to sweep';
  if (message.includes('not in terminal state')) return 'Escrow must be resolved or expired first';
  
  // Generic error with revert reason
  if (message.includes('execution reverted')) {
    const match = message.match(/execution reverted: (.+)/);
    if (match) return match[1];
  }
  
  // Fallback
  return message || 'Transaction failed';
}

// ═══════════════════════════════════════════════════════════════════════════════
// TypeScript Augmentation for window.ethereum
// ═══════════════════════════════════════════════════════════════════════════════

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
      isMetaMask?: boolean;
      isCoinbaseWallet?: boolean;
    };
  }
}
