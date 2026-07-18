/**
 * Escrow Review Card - Displays escrow details for transaction verification
 * Shows all relevant information before user signs a transaction
 */

'use client';

import { useState } from 'react';
import { Copy, ExternalLink, Check, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  type EscrowState,
  EscrowOutcome,
  shortenAddress,
  getArbiscanAddressUrl,
  formatTokenAmount,
  formatTimestamp,
  getTimeRemaining,
} from '@/lib/chain';
import { ACTION_META, checkEligibility, type EligibilityResult } from '@/lib/escrowActions';
import type { ShareAction } from '@/lib/share';
import { getStageGuidance, stageFromStatus, StagePill, StageProgress } from '@/components/escrowStage';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type EscrowReviewCardProps = {
  escrow: EscrowState;
  action: ShareAction;
  connectedAddress?: string | null;
  code?: string | null;
};

export default function EscrowReviewCard({
  escrow,
  action,
  connectedAddress,
  code,
}: EscrowReviewCardProps) {
  const actionInfo = ACTION_META[action];
  const eligibility = checkEligibility(escrow, action, connectedAddress);
  const stage = stageFromStatus(escrow.status);
  const stageGuidance = getStageGuidance(stage, {
    buyerAddress: escrow.buyerRefundWallet,
    sellerAddress: escrow.sellerWallet,
  });

  const arbs = [escrow.arbitrator1, escrow.arbitrator2, escrow.arbitrator3].filter(
    (a) => a && a.toLowerCase() !== ZERO_ADDRESS,
  );

  return (
    <div className="surface-card overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white">{actionInfo.title}</h2>
        <p className="text-sm text-white/60 mt-1">{actionInfo.description}</p>
      </div>

      {/* Escrow Details */}
      <div className="p-6 space-y-5">
        {code && <DetailRow label="Lookup Code" value={code} showCopy />}

        <DetailRow
          label="Escrow Address"
          value={escrow.escrow}
          isAddress
          showCopy
          showExternalLink
        />

        {/* Token & Amount */}
        <div className="grid grid-cols-2 gap-4">
          <DetailRow label="Token" value={escrow.tokenSymbol} />
          <DetailRow
            label="Target Amount"
            value={`${formatTokenAmount(escrow.targetAmount, escrow.tokenDecimals)} ${escrow.tokenSymbol}`}
          />
        </div>

        {/* Current Balance */}
        <DetailRow
          label="Current Balance"
          value={`${formatTokenAmount(escrow.balance, escrow.tokenDecimals)} ${escrow.tokenSymbol}`}
          highlight={escrow.isFunded}
        />

        {/* Settlement date */}
        <DetailRow
          label="Settlement Date"
          value={formatTimestamp(escrow.settlementDate)}
          subValue={getTimeRemaining(escrow.settlementDate)}
        />

        {/* Override window (only when pending) */}
        {escrow.overrideWindowEnd > 0 && (
          <DetailRow
            label="Arbitrator Override Window Ends"
            value={formatTimestamp(escrow.overrideWindowEnd)}
            subValue={getTimeRemaining(escrow.overrideWindowEnd)}
          />
        )}

        {/* Parties */}
        <div className="pt-2 border-t border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-3">Parties</h3>
          <div className="space-y-3">
            <DetailRow
              label="Buyer (refund wallet)"
              value={escrow.buyerRefundWallet}
              isAddress
              showCopy
              showExternalLink
              highlight={connectedAddress?.toLowerCase() === escrow.buyerRefundWallet.toLowerCase()}
            />
            <DetailRow
              label="Seller (payout wallet)"
              value={escrow.sellerWallet}
              isAddress
              showCopy
              showExternalLink
              highlight={connectedAddress?.toLowerCase() === escrow.sellerWallet.toLowerCase()}
            />
          </div>
        </div>

        {/* Arbitrators */}
        {arbs.length > 0 && (
          <div className="pt-2 border-t border-white/10">
            <h3 className="text-sm font-medium text-white/70 mb-3">
              Arbitrators ({escrow.arbitrationMode})
            </h3>
            <div className="space-y-3">
              {arbs.map((arb, i) => (
                <DetailRow
                  key={arb}
                  label={`Arbitrator #${i + 1}${i === 2 ? ' (tiebreaker)' : ''}`}
                  value={arb}
                  isAddress
                  showCopy
                  showExternalLink
                  highlight={connectedAddress?.toLowerCase() === arb.toLowerCase()}
                />
              ))}
            </div>
          </div>
        )}

        {/* Stage */}
        <div className="pt-2 border-t border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-2">Current Stage</h3>
          <div className="flex flex-wrap items-center gap-2">
            <StagePill stage={stage} />
            {escrow.pendingOutcome !== EscrowOutcome.NONE && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-blue-500/15 text-blue-300">
                Pending: {escrow.pendingOutcome === EscrowOutcome.SETTLE ? 'release to seller' : 'refund to buyer'}
              </span>
            )}
          </div>
          <StageProgress stage={stage} />
          <div className="mt-3 rounded-lg bg-white/10 border border-white/15 p-3">
            <p className="text-sm text-white/90">{stageGuidance.headline}</p>
            <p className="text-xs text-white/70 mt-1">
              <span className="font-semibold text-white/90">Next:</span> {stageGuidance.instruction}
            </p>
          </div>
        </div>

        {/* Contract Function */}
        <div className="pt-2 border-t border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-2">Contract Function</h3>
          <code className="block px-3 py-2 rounded-lg bg-black/30 text-sm text-[#0BB89A] font-mono">
            {actionInfo.functionName}
          </code>
        </div>

        {/* Eligibility */}
        <div className="pt-2 border-t border-white/10">
          <EligibilityPanel eligibility={eligibility} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Components
// ═══════════════════════════════════════════════════════════════════════════════

type DetailRowProps = {
  label: string;
  value: string;
  subValue?: string;
  isAddress?: boolean;
  showCopy?: boolean;
  showExternalLink?: boolean;
  highlight?: boolean;
};

function DetailRow({
  label,
  value,
  subValue,
  isAddress,
  showCopy,
  showExternalLink,
  highlight,
}: DetailRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-[#0BB89A]/10 border border-[#0BB89A]/30' : 'surface-subtle'}`}>
      <div className="text-xs text-white/50 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className={`font-mono text-sm ${isAddress ? 'text-white/80' : 'text-white'}`}>
          {isAddress ? shortenAddress(value) : value}
        </span>
        {showCopy && (
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[#0BB89A]" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
            )}
          </button>
        )}
        {showExternalLink && isAddress && (
          <a
            href={getArbiscanAddressUrl(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="View on Arbiscan"
          >
            <ExternalLink className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
          </a>
        )}
      </div>
      {subValue && (
        <div className="flex items-center gap-1 mt-1 text-xs text-white/40">
          <Clock className="w-3 h-3" />
          {subValue}
        </div>
      )}
    </div>
  );
}

type EligibilityPanelProps = {
  eligibility: EligibilityResult;
};

function EligibilityPanel({ eligibility }: EligibilityPanelProps) {
  const { eligible, reasons } = eligibility;

  return (
    <div className={`rounded-lg p-4 ${
      eligible
        ? 'bg-[#0BB89A]/10 border border-[#0BB89A]/30'
        : 'bg-red-500/10 border border-red-500/30'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        {eligible ? (
          <>
            <CheckCircle2 className="w-5 h-5 text-[#0BB89A]" />
            <span className="font-medium text-[#0BB89A]">Ready to Execute</span>
          </>
        ) : (
          <>
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="font-medium text-red-400">Not Ready</span>
          </>
        )}
      </div>
      {reasons.length > 0 && (
        <ul className="space-y-1 mt-2">
          {reasons.map((reason, i) => (
            <li key={i} className={`text-sm ${eligible ? 'text-[#0BB89A]/80' : 'text-red-300/80'}`}>
              • {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
