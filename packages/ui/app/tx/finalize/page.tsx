/**
 * TX Finalize Page - Release funds to seller after deadline
 * Permissionless: anyone can call this when conditions are met
 * Contract function: finalizeAfterDeadline()
 */

'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { type Address } from 'viem';
import ShareModal from '@/components/ShareModal';
import TxPageShell from '@/components/tx/TxPageShell';
import EscrowReviewCard, { checkEligibility, type ActionType } from '@/components/tx/EscrowReviewCard';
import TxActionArea from '@/components/tx/TxActionArea';
import { readEscrowState, isValidAddress, formatTokenAmount, type EscrowState } from '@/lib/chain';
import { encodeFinalizeTx } from '@/lib/wallet';
import { buildShareUrl, buildWalletShareUrls } from '@/lib/share';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';

function FinalizePageContent() {
  const searchParams = useSearchParams();
  const escrowParam = searchParams.get('escrow');
  const codeParam = searchParams.get('code');

  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  // Load escrow state from chain
  useEffect(() => {
    async function loadEscrow() {
      if (!escrowParam) {
        setError('Missing escrow address in URL');
        setLoading(false);
        return;
      }

      if (!isValidAddress(escrowParam)) {
        setError('Invalid escrow address format');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const state = await readEscrowState(escrowParam as Address);
        setEscrow(state);
      } catch (err) {
        console.error('Failed to load escrow:', err);
        setError(
          err instanceof Error 
            ? err.message 
            : 'Failed to load escrow data from chain'
        );
      } finally {
        setLoading(false);
      }
    }

    loadEscrow();
  }, [escrowParam]);

  // Handle address changes from wallet connection
  const handleAddressChange = useCallback((address: string | null) => {
    setConnectedAddress(address);
  }, []);

  // Loading state
  if (loading) {
    return (
      <TxPageShell title="Finalize Escrow">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#0BB89A] animate-spin mb-4" />
          <p className="text-white/60">Loading escrow data from chain...</p>
        </div>
      </TxPageShell>
    );
  }

  // Error state
  if (error || !escrow) {
    return (
      <TxPageShell title="Finalize Escrow">
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-6 h-6 text-red-400" />
            <h2 className="text-lg font-semibold text-white">Failed to Load Escrow</h2>
          </div>
          <p className="text-red-300/80 mb-4">{error || 'Unknown error occurred'}</p>
          <div className="text-sm text-white/50">
            <p>Make sure:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>The escrow address is correct</li>
              <li>The escrow exists on Arbitrum One</li>
              <li>You have a stable internet connection</li>
            </ul>
          </div>
        </div>
      </TxPageShell>
    );
  }

  // Calculate eligibility
  const action: ActionType = 'finalize';
  const eligibility = checkEligibility(escrow, action, connectedAddress);
  const txData = encodeFinalizeTx();
  const finalizeShareUrl = codeParam ? buildShareUrl(codeParam, { action: 'finalize' }) : null;
  const finalizeWalletUrls = codeParam ? buildWalletShareUrls(codeParam, { action: 'finalize' }) : null;

  // Calculate payout amounts (fee is 1% capped at $1)
  const targetAmount = escrow.targetAmount;
  const ONE_DOLLAR = BigInt(1_000_000); // $1 in 6 decimals
  const FEE_THRESHOLD = BigInt(100_000_000); // $100 in 6 decimals
  const MIN_FEE = BigInt(10_000); // $0.01 in 6 decimals
  const fee = targetAmount > FEE_THRESHOLD 
    ? ONE_DOLLAR // $1 cap
    : targetAmount / BigInt(100); // 1%
  const actualFee = fee < MIN_FEE ? MIN_FEE : fee;
  const sellerReceives = targetAmount - actualFee;

  return (
    <TxPageShell title="Finalize Escrow">
      <div className="space-y-6">
        <div className="surface-card p-6">
          <div className="flex items-center justify-between gap-4 mb-2">
            <h3 className="text-lg font-semibold text-white">Before you sign</h3>
            {finalizeShareUrl && (
              <ShareModal
                shareUrl={finalizeShareUrl}
                walletUrls={finalizeWalletUrls ?? undefined}
                title="Share finalize link"
                description="Anyone can call finalize when escrow is payable."
                triggerLabel="Share"
              />
            )}
          </div>
          <ul className="space-y-2 text-sm text-white/70">
            <li><span className="text-white font-medium">Who can sign:</span> anyone when finalize conditions are met.</li>
            <li><span className="text-white font-medium">What this does:</span> releases escrow funds to the seller.</li>
            <li><span className="text-white font-medium">What happens next:</span> escrow is marked complete.</li>
          </ul>
        </div>

        {/* Payout Preview */}
        <div className="bg-[#0BB89A]/10 border border-[#0BB89A]/30 rounded-2xl p-6">
          <h3 className="text-sm font-medium text-[#0BB89A] mb-4">Payout Preview</h3>
          <div className="flex items-center justify-between gap-4">
            <div className="text-center">
              <div className="text-xs text-white/50 mb-1">Escrow Amount</div>
              <div className="text-xl font-bold text-white">
                {formatTokenAmount(escrow.targetAmount, escrow.tokenDecimals)} {escrow.tokenSymbol}
              </div>
            </div>
            <ArrowRight className="w-6 h-6 text-[#0BB89A]" />
            <div className="text-center">
              <div className="text-xs text-white/50 mb-1">Seller Receives</div>
              <div className="text-xl font-bold text-[#0BB89A]">
                {formatTokenAmount(sellerReceives, escrow.tokenDecimals)} {escrow.tokenSymbol}
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 text-center">
            <span className="text-xs text-white/40">
              Platform fee: {formatTokenAmount(actualFee, escrow.tokenDecimals)} {escrow.tokenSymbol}
              {escrow.bondPresent && ' (bond returned to seller separately)'}
            </span>
          </div>
        </div>

        {/* Review Card */}
        <EscrowReviewCard 
          escrow={escrow} 
          action={action}
          connectedAddress={connectedAddress}
        />

        {/* Action Area */}
        <TxActionArea 
          escrowAddress={escrow.escrow}
          txData={txData}
          eligibility={eligibility}
          onAddressChange={handleAddressChange}
          actionLabel="Finalize and release funds"
        />

        {/* Additional Info */}
        <div className="surface-card p-6">
          <h3 className="text-sm font-medium text-white/70 mb-3">After finalization</h3>
          <ul className="space-y-2 text-sm text-white/60">
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">1.</span>
              <span>The seller receives the escrow amount minus the platform fee</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">2.</span>
              <span>If the seller deposited a bond, it&apos;s returned to them</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">3.</span>
              <span>The escrow is marked as resolved and cannot be modified</span>
            </li>
          </ul>
          <div className="mt-4 p-3 rounded-lg bg-white/5">
            <p className="text-xs text-white/50">
              <strong className="text-white/70">Note:</strong> This function is permissionless - 
              anyone can call it when the conditions are met. This ensures the seller always gets 
              paid on time, even if the buyer is unavailable.
            </p>
          </div>
        </div>
      </div>
    </TxPageShell>
  );
}

export default function FinalizePage() {
  return (
    <Suspense fallback={
      <TxPageShell title="Finalize Escrow">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#0BB89A] animate-spin mb-4" />
          <p className="text-white/60">Loading...</p>
        </div>
      </TxPageShell>
    }>
      <FinalizePageContent />
    </Suspense>
  );
}
