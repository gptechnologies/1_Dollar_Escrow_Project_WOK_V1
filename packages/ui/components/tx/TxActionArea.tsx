/**
 * TX Action Area - Handles wallet connection flow and transaction execution
 * Provides both injected wallet support and mobile deep links
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { 
  Wallet, 
  ArrowRight, 
  Loader2, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { type Address, type Hex } from 'viem';
import { 
  useWalletConnection, 
  buildMetaMaskDeepLink, 
  buildCoinbaseWalletDeepLink,
  getCurrentUrl,
} from '@/lib/wallet';
import { ARBITRUM_CHAIN_ID, getArbiscanTxUrl } from '@/lib/chain';
import { SIMPLE_COPY } from '@/lib/copy';
import type { EligibilityResult } from '@/lib/escrowActions';

type TxActionAreaProps = {
  escrowAddress: Address;
  txData: Hex;
  eligibility: EligibilityResult;
  onAddressChange?: (address: string | null) => void;
  actionLabel?: string;
};

export default function TxActionArea({ 
  escrowAddress, 
  txData, 
  eligibility,
  onAddressChange,
  actionLabel = 'Sign transaction',
}: TxActionAreaProps) {
  const wallet = useWalletConnection();

  // Notify parent of address changes
  useEffect(() => {
    onAddressChange?.(wallet.address);
  }, [wallet.address, onAddressChange]);

  // Render based on wallet availability
  if (!wallet.hasInjectedWallet) {
    return <MobileDeepLinks />;
  }

  return (
    <WalletFlow 
      wallet={wallet} 
      escrowAddress={escrowAddress}
      txData={txData}
      eligibility={eligibility}
      actionLabel={actionLabel}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Wallet Flow (Desktop / In-wallet Browser)
// ═══════════════════════════════════════════════════════════════════════════════

type WalletFlowProps = {
  wallet: ReturnType<typeof useWalletConnection>;
  escrowAddress: Address;
  txData: Hex;
  eligibility: EligibilityResult;
  actionLabel: string;
};

function WalletFlow({ wallet, escrowAddress, txData, eligibility, actionLabel }: WalletFlowProps) {
  const { 
    step, 
    address, 
    chainId, 
    txHash, 
    error, 
    connect, 
    switchChain, 
    sendTransaction,
    reset,
  } = wallet;

  // Success state
  if (step === 'success' && txHash) {
    return (
      <div className="surface-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-[#0BB89A]/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-[#0BB89A]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Transaction Submitted</h3>
            <p className="text-sm text-white/60">Your transaction is being processed</p>
          </div>
        </div>
        
        <div className="bg-black/30 rounded-lg p-4 mb-4">
          <div className="text-xs text-white/50 mb-1">Transaction Hash</div>
          <a 
            href={getArbiscanTxUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-mono text-sm text-[#0BB89A] hover:underline break-all"
          >
            {txHash}
            <ExternalLink className="w-4 h-4 flex-shrink-0" />
          </a>
        </div>

        <div className="flex gap-3">
          <Link 
            href="/"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 active:scale-[0.99] transition-all"
          >
            Back to Dashboard
          </Link>
          <a
            href={getArbiscanTxUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0BB89A] text-white font-medium hover:bg-[#0BB89A]/90 active:scale-[0.99] transition-all"
          >
            View on Arbiscan
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  // Error state
  if (step === 'error') {
    return (
      <div className="surface-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Transaction Failed</h3>
            <p className="text-sm text-red-300/80">{error}</p>
          </div>
        </div>

        <button
          onClick={reset}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 active:scale-[0.99] transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    );
  }

  // Determine current step and button state
  const isOnArbitrum = chainId === ARBITRUM_CHAIN_ID;
  const canExecute = eligibility.eligible && step === 'ready' && isOnArbitrum;

  return (
    <div className="surface-card p-6">
      {/* Step Indicators */}
      <div className="flex items-center gap-2 mb-6">
        <StepIndicator 
          number={1} 
          label="Connect" 
          active={step === 'idle' || step === 'connecting'}
          completed={!!address}
        />
        <div className="flex-1 h-px bg-white/20" />
        <StepIndicator 
          number={2} 
          label="Network" 
          active={step === 'switching'}
          completed={isOnArbitrum && !!address}
        />
        <div className="flex-1 h-px bg-white/20" />
        <StepIndicator 
          number={3} 
          label="Sign" 
          active={step === 'ready' || step === 'signing'}
          completed={step === 'success'}
        />
      </div>

      {/* Connected Address */}
      {address && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 mb-4">
          <div className="text-xs text-white/50">Connected Wallet</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/80">
              {`${address.slice(0, 6)}...${address.slice(-4)}`}
            </span>
            <div className={`w-2 h-2 rounded-full ${isOnArbitrum ? 'bg-[#0BB89A]' : 'bg-yellow-400'}`} />
          </div>
        </div>
      )}

      {/* Action Button */}
      {step === 'idle' && (
        <button
          onClick={connect}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-[#0BB89A] text-white font-semibold hover:bg-[#0BB89A]/90 active:scale-[0.99] transition-all"
        >
          <Wallet className="w-5 h-5" />
          Connect Wallet
        </button>
      )}

      {step === 'connecting' && (
        <button
          disabled
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-white/10 text-white/60 font-semibold cursor-not-allowed"
        >
          <Loader2 className="w-5 h-5 animate-spin" />
          Connecting...
        </button>
      )}

      {(step === 'switching' || (address && !isOnArbitrum)) && (
        <button
          onClick={() => switchChain()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-yellow-500 text-black font-semibold hover:bg-yellow-400 active:scale-[0.99] transition-all"
        >
          <ArrowRight className="w-5 h-5" />
          Switch to Arbitrum
        </button>
      )}

      {step === 'ready' && isOnArbitrum && (
        <button
          onClick={() => sendTransaction(escrowAddress, txData)}
          disabled={!eligibility.eligible}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-4 rounded-xl font-semibold transition-colors ${
            canExecute
              ? 'bg-[#0BB89A] text-white hover:bg-[#0BB89A]/90 active:scale-[0.99] transition-all'
              : 'bg-white/10 text-white/40 cursor-not-allowed'
          }`}
        >
          {actionLabel}
          <ArrowRight className="w-5 h-5" />
        </button>
      )}

      {step === 'signing' && (
        <button
          disabled
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-white/10 text-white/60 font-semibold cursor-not-allowed"
        >
          <Loader2 className="w-5 h-5 animate-spin" />
          Waiting for signature...
        </button>
      )}

      {/* Eligibility warning */}
      {!eligibility.eligible && step === 'ready' && (
        <p className="mt-3 text-sm text-center text-red-300/80">
          {SIMPLE_COPY.cannotExecute}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Deep Links
// ═══════════════════════════════════════════════════════════════════════════════

function MobileDeepLinks() {
  const currentUrl = typeof window !== 'undefined' ? getCurrentUrl() : '';

  return (
    <div className="surface-card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-white/70" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Open in Wallet</h3>
          <p className="text-sm text-white/60">{SIMPLE_COPY.mobileWalletHint}</p>
        </div>
      </div>

      <div className="space-y-3">
        <a
          href={buildMetaMaskDeepLink(currentUrl)}
          className="w-full inline-flex items-center justify-center gap-3 px-4 py-4 rounded-xl bg-[#F6851B]/10 border border-[#F6851B]/30 text-white font-semibold hover:bg-[#F6851B]/20 active:scale-[0.99] transition-all"
        >
          <MetaMaskIcon />
          Open in MetaMask
          <ExternalLink className="w-4 h-4 ml-auto opacity-50" />
        </a>

        <a
          href={buildCoinbaseWalletDeepLink(currentUrl)}
          className="w-full inline-flex items-center justify-center gap-3 px-4 py-4 rounded-xl bg-[#0052FF]/10 border border-[#0052FF]/30 text-white font-semibold hover:bg-[#0052FF]/20 active:scale-[0.99] transition-all"
        >
          <CoinbaseWalletIcon />
          Open in Coinbase Wallet
          <ExternalLink className="w-4 h-4 ml-auto opacity-50" />
        </a>
      </div>

      <p className="mt-4 text-xs text-center text-white/40">
        Click a button above to open this page in your wallet&apos;s browser
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Components
// ═══════════════════════════════════════════════════════════════════════════════

type StepIndicatorProps = {
  number: number;
  label: string;
  active: boolean;
  completed: boolean;
};

function StepIndicator({ number, label, active, completed }: StepIndicatorProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
        completed 
          ? 'bg-[#0BB89A] text-white' 
          : active 
            ? 'bg-white/20 text-white' 
            : 'bg-white/5 text-white/40'
      }`}>
        {completed ? <CheckCircle2 className="w-4 h-4" /> : number}
      </div>
      <span className={`text-xs ${active || completed ? 'text-white/80' : 'text-white/40'}`}>
        {label}
      </span>
    </div>
  );
}

// Wallet Icons
function MetaMaskIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M21.65 2L13.35 8.29L14.88 4.61L21.65 2Z" fill="#E17726"/>
      <path d="M2.35 2L10.57 8.35L9.12 4.61L2.35 2Z" fill="#E27625"/>
      <path d="M18.68 16.71L16.56 20.06L21.19 21.36L22.55 16.79L18.68 16.71Z" fill="#E27625"/>
      <path d="M1.46 16.79L2.81 21.36L7.44 20.06L5.32 16.71L1.46 16.79Z" fill="#E27625"/>
      <path d="M7.2 10.54L5.84 12.61L10.44 12.84L10.27 7.87L7.2 10.54Z" fill="#E27625"/>
      <path d="M16.8 10.54L13.68 7.81L13.56 12.84L18.16 12.61L16.8 10.54Z" fill="#E27625"/>
      <path d="M7.44 20.06L10.16 18.73L7.83 16.82L7.44 20.06Z" fill="#E27625"/>
      <path d="M13.84 18.73L16.56 20.06L16.17 16.82L13.84 18.73Z" fill="#E27625"/>
    </svg>
  );
}

function CoinbaseWalletIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="#0052FF"/>
      <path d="M12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4ZM14.5 14.5H9.5V9.5H14.5V14.5Z" fill="white"/>
    </svg>
  );
}
