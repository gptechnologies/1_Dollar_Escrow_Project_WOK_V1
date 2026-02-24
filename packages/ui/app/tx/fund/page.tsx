/**
 * TX Fund Page - Buyer funds escrow by transferring token to escrow address
 * Requires: connected wallet must be the funder (buyer) address
 * Contract call: ERC20 transfer(escrow, targetAmount)
 */

'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { type Address } from 'viem';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import TxPageShell from '@/components/tx/TxPageShell';
import TxActionArea from '@/components/tx/TxActionArea';
import ShareModal from '@/components/ShareModal';
import { buildShareUrl, buildWalletShareUrls } from '@/lib/share';
import {
  readEscrowState,
  isValidAddress,
  formatTokenAmount,
  type EscrowState,
  shortenAddress,
} from '@/lib/chain';
import type { EligibilityResult } from '@/components/tx/EscrowReviewCard';
import { encodeFundEscrowTx } from '@/lib/wallet';

function FundPageContent() {
  const searchParams = useSearchParams();
  const escrowParam = searchParams.get('escrow');
  const codeParam = searchParams.get('code');

  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

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
        setError(err instanceof Error ? err.message : 'Failed to load escrow data from chain');
      } finally {
        setLoading(false);
      }
    }

    loadEscrow();
  }, [escrowParam]);

  const handleAddressChange = useCallback((address: string | null) => {
    setConnectedAddress(address);
  }, []);

  if (loading) {
    return (
      <TxPageShell title="Fund Escrow">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#0BB89A] animate-spin mb-4" />
          <p className="text-white/60">Loading escrow data from chain...</p>
        </div>
      </TxPageShell>
    );
  }

  if (error || !escrow) {
    return (
      <TxPageShell title="Fund Escrow">
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-6 h-6 text-red-400" />
            <h2 className="text-lg font-semibold text-white">Failed to Load Escrow</h2>
          </div>
          <p className="text-red-300/80 mb-4">{error || 'Unknown error occurred'}</p>
        </div>
      </TxPageShell>
    );
  }

  const amountToFund = escrow.targetAmount;
  const txData = encodeFundEscrowTx(escrow.escrow, amountToFund);
  const fundShareUrl = codeParam ? buildShareUrl(codeParam, { action: 'fund', role: 'buyer' }) : null;
  const fundWalletUrls = codeParam ? buildWalletShareUrls(codeParam, { action: 'fund', role: 'buyer' }) : null;

  const eligibility: EligibilityResult = (() => {
    const reasons: string[] = [];
    let eligible = true;

    if (!escrow.confirmed) {
      reasons.push('Escrow is not confirmed yet');
      eligible = false;
    } else {
      reasons.push('Escrow is confirmed');
    }

    if (escrow.isFunded) {
      reasons.push('Escrow is already funded');
      eligible = false;
    }

    if (escrow.resolved || escrow.expired) {
      reasons.push('Escrow is in a terminal state');
      eligible = false;
    }

    if (connectedAddress) {
      if (connectedAddress.toLowerCase() !== escrow.funder.toLowerCase()) {
        reasons.push('Only buyer (funder) should fund this escrow');
        eligible = false;
      } else {
        reasons.push('Connected as buyer (funder)');
      }
    } else {
      reasons.push('Connect wallet to verify buyer role');
      eligible = false;
    }

    return { eligible, reasons };
  })();

  return (
    <TxPageShell title="Fund Escrow">
      <div className="space-y-6">
        <div className="surface-card p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Before you sign</h3>
            </div>
            {fundShareUrl && (
              <ShareModal
                shareUrl={fundShareUrl}
                walletUrls={fundWalletUrls ?? undefined}
                title="Share funding link"
                description="Send this to the buyer so they can fund escrow."
                triggerLabel="Share"
              />
            )}
          </div>
          <ul className="space-y-2 text-sm text-white/70 mb-4">
            <li><span className="text-white font-medium">Who should sign:</span> the buyer wallet only.</li>
            <li><span className="text-white font-medium">What this does:</span> transfers funds into escrow.</li>
            <li><span className="text-white font-medium">What happens next:</span> escrow becomes funded, then can be finalized after deadline.</li>
          </ul>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-white/50 text-xs mb-1">{codeParam ? 'Lookup Code' : 'Escrow Address'}</p>
              <p className="font-mono text-white/85">{codeParam || shortenAddress(escrow.escrow)}</p>
            </div>
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-white/50 text-xs mb-1">You will send</p>
              <p className="text-[#0BB89A] font-semibold">
                {formatTokenAmount(amountToFund, escrow.tokenDecimals)} {escrow.tokenSymbol}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/55">
            You are signing an ERC-20 transfer from your wallet to this escrow contract.
          </p>
        </div>

        <div className="surface-card p-6">
          <h3 className="text-sm font-medium text-white/70 mb-3">After funding</h3>
          <ul className="space-y-2 text-sm text-white/60">
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">1.</span>
              <span>Funds are transferred on-chain to the escrow contract.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">2.</span>
              <span>Escrow status updates to funded.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0BB89A] font-bold">3.</span>
              <span>Anyone can finalize after deadline if conditions are met.</span>
            </li>
          </ul>
        </div>

        <TxActionArea
          escrowAddress={escrow.token}
          txData={txData}
          eligibility={eligibility}
          onAddressChange={handleAddressChange}
          actionLabel={`Send ${escrow.tokenSymbol} to escrow`}
        />

        <div className="surface-card p-6">
          <div className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 mt-0.5 text-[#0BB89A]" />
            <p className="text-xs text-white/60">
              Verify the lookup code and token amount match what you expect before signing.
            </p>
          </div>
        </div>
      </div>
    </TxPageShell>
  );
}

export default function FundPage() {
  return (
    <Suspense fallback={
      <TxPageShell title="Fund Escrow">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#0BB89A] animate-spin mb-4" />
          <p className="text-white/60">Loading...</p>
        </div>
      </TxPageShell>
    }>
      <FundPageContent />
    </Suspense>
  );
}
