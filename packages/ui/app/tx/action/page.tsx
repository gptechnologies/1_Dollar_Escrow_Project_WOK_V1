/**
 * Generic escrow transaction page.
 * Handles every escrow action (fund, sellerConfirm, settle, mutual settle/refund,
 * arbitrator votes, finalize, refunds, sweep) via ?action=<ShareAction>.
 */

'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { type Address } from 'viem';
import { AlertCircle, Loader2 } from 'lucide-react';
import ShareModal from '@/components/ShareModal';
import TxPageShell from '@/components/tx/TxPageShell';
import EscrowReviewCard from '@/components/tx/EscrowReviewCard';
import TxActionArea from '@/components/tx/TxActionArea';
import { readEscrowState, isValidAddress, type EscrowState } from '@/lib/chain';
import { ACTION_META, buildActionTx, checkEligibility } from '@/lib/escrowActions';
import { buildShareUrl, buildWalletShareUrls, isShareAction, type ShareAction, type ShareRole } from '@/lib/share';

function ActionPageContent() {
  const searchParams = useSearchParams();
  const escrowParam = searchParams.get('escrow');
  const codeParam = searchParams.get('code');
  const actionParam = searchParams.get('action') ?? undefined;
  const roleParam = searchParams.get('role') ?? undefined;

  const action: ShareAction = isShareAction(actionParam) ? actionParam : 'sellerConfirm';
  const meta = ACTION_META[action];
  const role: ShareRole | undefined =
    roleParam === 'buyer' || roleParam === 'seller' || roleParam === 'arbitrator' ? roleParam : undefined;

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
      <TxPageShell title={meta.title}>
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#0BB89A] animate-spin mb-4" />
          <p className="text-white/60">Loading escrow data from chain...</p>
        </div>
      </TxPageShell>
    );
  }

  if (error || !escrow) {
    return (
      <TxPageShell title={meta.title}>
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-6 h-6 text-red-400" />
            <h2 className="text-lg font-semibold text-white">Failed to Load Escrow</h2>
          </div>
          <p className="text-red-300/80 mb-4">{error || 'Unknown error occurred'}</p>
          <div className="text-sm text-white/50">
            <p>Make sure:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>The lookup code or escrow address is correct</li>
              <li>The escrow exists on Arbitrum One</li>
              <li>You have a stable internet connection</li>
            </ul>
          </div>
        </div>
      </TxPageShell>
    );
  }

  const eligibility = checkEligibility(escrow, action, connectedAddress);
  const { to, data } = buildActionTx(action, escrow);

  const shareUrl = codeParam ? buildShareUrl(codeParam, { action, role }) : null;
  const walletUrls = codeParam ? buildWalletShareUrls(codeParam, { action, role }) : null;

  return (
    <TxPageShell title={meta.title}>
      <div className="space-y-6">
        <div className="surface-card p-6">
          <div className="flex items-center justify-between gap-4 mb-2">
            <h3 className="text-lg font-semibold text-white">Before you sign</h3>
            {shareUrl && (
              <ShareModal
                shareUrl={shareUrl}
                walletUrls={walletUrls ?? undefined}
                title={`Share ${meta.shortLabel.toLowerCase()} link`}
                description={meta.description}
                triggerLabel="Share"
              />
            )}
          </div>
          <ul className="space-y-2 text-sm text-white/70">
            <li><span className="text-white font-medium">Who should sign:</span> {actorLabel(meta.actor)}.</li>
            <li><span className="text-white font-medium">What this does:</span> {meta.description}</li>
          </ul>
        </div>

        <EscrowReviewCard
          escrow={escrow}
          action={action}
          connectedAddress={connectedAddress}
          code={codeParam}
        />

        <TxActionArea
          escrowAddress={to}
          txData={data}
          eligibility={eligibility}
          onAddressChange={handleAddressChange}
          actionLabel={meta.title}
        />
      </div>
    </TxPageShell>
  );
}

function actorLabel(actor: 'buyer' | 'seller' | 'arbitrator' | 'anyone'): string {
  switch (actor) {
    case 'buyer':
      return 'the buyer wallet';
    case 'seller':
      return 'the seller wallet';
    case 'arbitrator':
      return 'an arbitrator wallet';
    default:
      return 'anyone (permissionless)';
  }
}

export default function ActionPage() {
  return (
    <Suspense fallback={
      <TxPageShell title="Escrow Action">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#0BB89A] animate-spin mb-4" />
          <p className="text-white/60">Loading...</p>
        </div>
      </TxPageShell>
    }>
      <ActionPageContent />
    </Suspense>
  );
}
