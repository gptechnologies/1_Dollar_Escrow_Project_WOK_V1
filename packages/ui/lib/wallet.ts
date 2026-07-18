/**
 * Wallet utilities for connecting and signing transactions
 * Handles wallet connection flow and mobile deep links
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import {
  ARBITRUM_CHAIN_ID,
  EscrowABI,
  ERC20ABI,
  EscrowFactoryABI,
  getChainConfig,
  type SupportedChainId,
} from './chain';

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
  switchChain: (chainId?: SupportedChainId) => Promise<void>;
  sendTransaction: (to: Address, data: Hex) => Promise<void>;
  reset: () => void;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Wallet Hook
// ═══════════════════════════════════════════════════════════════════════════════

export function useWalletConnection(targetChainId: SupportedChainId = ARBITRUM_CHAIN_ID): WalletState & WalletActions {
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
      if (newChainId !== targetChainId && step === 'ready') {
        setStep('switching');
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [step, targetChainId]);

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

      if (currentChainId === targetChainId) {
        setStep('ready');
      } else {
        setStep('switching');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      setError(message);
      setStep('error');
    }
  }, [targetChainId]);

  const switchChain = useCallback(async (requestedChainId?: SupportedChainId) => {
    if (!window.ethereum) {
      setError('No wallet detected');
      setStep('error');
      return;
    }

    try {
      setStep('switching');
      setError(null);

      const nextChainId = requestedChainId ?? targetChainId;
      const config = getChainConfig(nextChainId);

      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${nextChainId.toString(16)}` }],
        });
      } catch (switchError: unknown) {
        // If chain doesn't exist, add it
        const err = switchError as { code?: number };
        if (err.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${nextChainId.toString(16)}`,
              chainName: config.name,
              nativeCurrency: {
                name: 'Ethereum',
                symbol: 'ETH',
                decimals: 18,
              },
              rpcUrls: [config.rpcUrl],
              blockExplorerUrls: [config.explorerBaseUrl],
            }],
          });
        } else {
          throw switchError;
        }
      }

      setChainId(nextChainId);
      setStep('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to switch chain';
      setError(message);
      setStep('error');
    }
  }, [targetChainId]);

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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

/** Encode sellerConfirm() — seller activates a fully-funded escrow. */
export function encodeSellerConfirmTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'sellerConfirm' });
}

/** Encode settle() — 0-arb settle to seller after settlement deadline. */
export function encodeSettleTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'settle' });
}

/** Encode refundUnderfunded() — refund an underfunded escrow after the settlement date. */
export function encodeRefundUnderfundedTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'refundUnderfunded' });
}

/** Encode recoverLatePaymentToken() — return accepted-token funds sent after terminal resolution to the buyer. */
export function encodeRecoverLatePaymentTokenTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'recoverLatePaymentToken' });
}

/** Encode approveMutualSettle() — party approves paying the seller. */
export function encodeApproveMutualSettleTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'approveMutualSettle' });
}

/** Encode approveMutualRefund() — party approves refunding the buyer. */
export function encodeApproveMutualRefundTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'approveMutualRefund' });
}

/** Encode finalizeMutualResolution() — execute a pending resolution after the override window. */
export function encodeFinalizeMutualResolutionTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'finalizeMutualResolution' });
}

/** Encode arbSettle() — arbitrator votes to settle (1-arb naming). */
export function encodeArbSettleTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'arbSettle' });
}

/** Encode arbRefund() — arbitrator votes to refund (1-arb naming). */
export function encodeArbRefundTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'arbRefund' });
}

/** Encode arbVoteSettle() — arbitrator votes to settle (3-arb naming). */
export function encodeArbVoteSettleTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'arbVoteSettle' });
}

/** Encode arbVoteRefund() — arbitrator votes to refund (3-arb naming). */
export function encodeArbVoteRefundTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'arbVoteRefund' });
}

/** Encode sweepExcess() — sweep excess/late funds to treasury. */
export function encodeSweepExcessTx(): Hex {
  return encodeFunctionData({ abi: EscrowABI, functionName: 'sweepExcess' });
}

/** Encode ERC20 transfer(to, amount) for funding an escrow. */
export function encodeFundEscrowTx(escrowAddress: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20ABI,
    functionName: 'transfer',
    args: [escrowAddress, amount],
  });
}

/**
 * Encode EscrowFactoryV2.createEscrowSimple(...) for wallet signing.
 */
export function encodeCreateEscrowTx(params: {
  payout: Address;            // seller wallet
  funder: Address;            // buyer / refund wallet
  token: Address;
  targetAmount: bigint;
  settlementDate: number;
  termsHash?: Hex;
  arbitrator1?: Address;
  arbitrator2?: Address;
  arbitrator3?: Address;
}): Hex {
  return encodeFunctionData({
    abi: EscrowFactoryABI,
    functionName: 'createEscrowSimple',
    args: [
      params.payout,
      params.funder,
      params.token,
      params.targetAmount,
      BigInt(params.settlementDate),
      params.termsHash || ZERO_HASH,
      params.arbitrator1 || ZERO_ADDRESS,
      params.arbitrator2 || ZERO_ADDRESS,
      params.arbitrator3 || ZERO_ADDRESS,
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
  
  // Common EscrowV2 revert reasons
  if (message.includes('not seller')) return 'Only the seller can confirm this escrow';
  if (message.includes('not a party')) return 'Only the buyer or seller can do this';
  if (message.includes('not arbitrator')) return 'Only an arbitrator can do this';
  if (message.includes('not in created state')) return 'Escrow is no longer in the created state';
  if (message.includes('not funded')) return 'Escrow is not fully funded';
  if (message.includes('settlement date not reached')) return 'The settlement date has not been reached yet';
  if (message.includes('not resolvable')) return 'Escrow can no longer be resolved this way';
  if (message.includes('has arbitrators')) return 'Escrow has arbitrators — resolve via arbitration or mutual agreement';
  if (message.includes('already approved')) return 'You have already approved this action';
  if (message.includes('already voted')) return 'This arbitrator has already voted';
  if (message.includes('not votable')) return 'Voting is not currently open for this escrow';
  if (message.includes('no pending resolution')) return 'There is no pending mutual resolution';
  if (message.includes('override window open')) return 'The arbitrator override window is still open';
  if (message.includes('no excess')) return 'There are no excess funds to sweep';
  if (message.includes('not terminal')) return 'Escrow has not been resolved yet';
  if (message.includes('no payment token balance')) return 'There are no funds to recover';
  if (message.includes('use sweepExcess')) return 'Use sweep excess for the escrow token';
  if (message.includes('Escrow: funded')) return 'Escrow is fully funded — it cannot be refunded as underfunded';
  
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
