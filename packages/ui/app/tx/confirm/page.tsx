/**
 * TX Confirm Page - Seller confirms their participation in the escrow
 * Requires: connected wallet must be the payout (seller) address
 * Contract function: confirm()
 */

'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { type Address } from 'viem';
import ShareModal from '@/components/ShareModal';
import TxPageShell from '@/components/tx/TxPageShell';
import EscrowReviewCard, { checkEligibility, type ActionType } from '@/components/tx/EscrowReviewCard';
import TxActionArea from '@/components/tx/TxActionArea';
import { readEscrowState, isValidAddress, type EscrowState } from '@/lib/chain';
import { encodeConfirmTx } from '@/lib/wallet';
import { buildShareUrl } from '@/lib/share';
import { AlertCircle, Loader2 } from 'lucide-react';

function ConfirmPageContent() {
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
      <TxPageShell title="Confirm Escrow">
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
      <TxPageShell title="Confirm Escrow">
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
  const action: ActionType = 'confirm';
  const eligibility = checkEligibility(escrow, action, connectedAddress);
  const txData = encodeConfirmTx();
  const confirmShareUrl = codeParam
    ? buildShareUrl(codeParam, { action: 'confirm', role: 'seller' })
    : null;

  return (
    <TxPageShell title="Confirm Escrow">
      <div className="space-y-6">
        <div className="surface-card p-6">
          <div className="flex items-center justify-between gap-4 mb-2">
            <h3 className="text-lg font-semibold text-white">Before you sign</h3>
            {confirmShareUrl && (
              <ShareModal
                shareUrl={confirmShareUrl}
                title="Share confirm link"
                description="Send this to the seller so they can confirm escrow."
                triggerLabel="Share"
              />
            )}
          </div>
          <ul className="space-y-2 text-sm text-white/70">
            <li><span className="text-white font-medium">Who should sign:</span> the seller wallet only.</li>
            <li><span className="text-white font-medium">What this does:</span> marks escrow as confirmed.</li>
            <li><span className="text-white font-medium">What happens next:</span> buyer can fund this escrow.</li>
          </ul>
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
          actionLabel="Confirm escrow"
        />

        {/* Additional Info */}
        <div className="surface-card p-6">
          <h3 className="text-sm font-medium text-white/70 mb-3">After confirmation</h3>
          <ul className="space-y-2 text-sm text-white/60">
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">1.</span>
              <span>Your confirmation is recorded on-chain</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">2.</span>
              <span>The buyer (funder) can now deposit funds</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">3.</span>
              <span>Once funded and deadline passes, you&apos;ll receive the funds</span>
            </li>
          </ul>
        </div>
      </div>
    </TxPageShell>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={
      <TxPageShell title="Confirm Escrow">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#0BB89A] animate-spin mb-4" />
          <p className="text-white/60">Loading...</p>
        </div>
      </TxPageShell>
    }>
      <ConfirmPageContent />
    </Suspense>
  );
}
