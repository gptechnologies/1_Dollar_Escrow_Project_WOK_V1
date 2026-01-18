/**
 * Escrow Review Card - Displays escrow details for transaction verification
 * Shows all relevant information before user signs a transaction
 */

'use client';

import { useState } from 'react';
import { Copy, ExternalLink, Check, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { 
  type EscrowState, 
  shortenAddress, 
  getArbiscanAddressUrl, 
  formatTokenAmount,
  formatTimestamp,
  getTimeRemaining,
} from '@/lib/chain';

type ActionType = 'confirm' | 'finalize' | 'sweep';

type EscrowReviewCardProps = {
  escrow: EscrowState;
  action: ActionType;
  connectedAddress?: string | null;
};

type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
};

// Action metadata
const ACTION_INFO: Record<ActionType, { 
  title: string; 
  functionName: string; 
  description: string;
}> = {
  confirm: {
    title: 'Confirm Escrow',
    functionName: 'confirm()',
    description: 'As the seller, you are confirming your participation in this escrow.',
  },
  finalize: {
    title: 'Finalize Escrow',
    functionName: 'finalizeAfterDeadline()',
    description: 'Release funds to the seller now that the deadline has passed.',
  },
  sweep: {
    title: 'Sweep Funds',
    functionName: 'sweepToTreasury()',
    description: 'Sweep remaining funds to treasury after escrow termination.',
  },
};

export default function EscrowReviewCard({ 
  escrow, 
  action, 
  connectedAddress 
}: EscrowReviewCardProps) {
  const actionInfo = ACTION_INFO[action];
  const eligibility = checkEligibility(escrow, action, connectedAddress);

  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white">{actionInfo.title}</h2>
        <p className="text-sm text-white/60 mt-1">{actionInfo.description}</p>
      </div>

      {/* Escrow Details */}
      <div className="p-6 space-y-5">
        {/* Escrow Address */}
        <DetailRow 
          label="Escrow Address"
          value={escrow.escrow}
          isAddress
          showCopy
          showExternalLink
        />

        {/* Token & Amount */}
        <div className="grid grid-cols-2 gap-4">
          <DetailRow 
            label="Token"
            value={escrow.tokenSymbol}
          />
          <DetailRow 
            label="Target Amount"
            value={`${formatTokenAmount(escrow.targetAmount, escrow.tokenDecimals)} ${escrow.tokenSymbol}`}
          />
        </div>

        {/* Current Balance */}
        <DetailRow 
          label="Current Balance"
          value={`${formatTokenAmount(escrow.escrowTokenBalance, escrow.tokenDecimals)} ${escrow.tokenSymbol}`}
          highlight={escrow.isFunded}
        />

        {/* Deadlines */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailRow 
            label="Deadline"
            value={formatTimestamp(escrow.deadline)}
            subValue={getTimeRemaining(escrow.deadline)}
          />
          <DetailRow 
            label="Confirm Deadline"
            value={formatTimestamp(escrow.confirmDeadline)}
            subValue={getTimeRemaining(escrow.confirmDeadline)}
          />
        </div>

        {/* Parties */}
        <div className="pt-2 border-t border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-3">Parties</h3>
          <div className="space-y-3">
            <DetailRow 
              label="Buyer (Funder)"
              value={escrow.funder}
              isAddress
              showCopy
              showExternalLink
              highlight={connectedAddress?.toLowerCase() === escrow.funder.toLowerCase()}
            />
            <DetailRow 
              label="Seller (Payout)"
              value={escrow.payout}
              isAddress
              showCopy
              showExternalLink
              highlight={connectedAddress?.toLowerCase() === escrow.payout.toLowerCase()}
            />
          </div>
        </div>

        {/* Status Flags */}
        <div className="pt-2 border-t border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-3">Current Status</h3>
          <div className="flex flex-wrap gap-2">
            <StatusBadge label="Confirmed" active={escrow.confirmed} />
            <StatusBadge label="Funded" active={escrow.isFunded} />
            <StatusBadge label="Resolved" active={escrow.resolved} variant="terminal" />
            <StatusBadge label="Expired" active={escrow.expired} variant="terminal" />
            {escrow.arbitratorCount > 0 && (
              <StatusBadge label={`${escrow.arbitratorCount} Arbitrator${escrow.arbitratorCount > 1 ? 's' : ''}`} active />
            )}
          </div>
        </div>

        {/* Contract Function */}
        <div className="pt-2 border-t border-white/10">
          <h3 className="text-sm font-medium text-white/70 mb-2">Contract Function</h3>
          <code className="block px-3 py-2 rounded-lg bg-black/30 text-sm text-[#0BB89A] font-mono">
            {actionInfo.functionName}
          </code>
        </div>

        {/* Eligibility Panel */}
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
    <div className={`rounded-lg p-3 ${highlight ? 'bg-[#0BB89A]/10 border border-[#0BB89A]/30' : 'bg-white/5'}`}>
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

type StatusBadgeProps = {
  label: string;
  active: boolean;
  variant?: 'default' | 'terminal';
};

function StatusBadge({ label, active, variant = 'default' }: StatusBadgeProps) {
  if (!active) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-white/5 text-white/40">
        {label}
      </span>
    );
  }

  const colorClass = variant === 'terminal' 
    ? 'bg-red-500/20 text-red-300' 
    : 'bg-[#0BB89A]/20 text-[#0BB89A]';

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
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

// ═══════════════════════════════════════════════════════════════════════════════
// Eligibility Logic
// ═══════════════════════════════════════════════════════════════════════════════

function checkEligibility(
  escrow: EscrowState, 
  action: ActionType,
  connectedAddress?: string | null
): EligibilityResult {
  const reasons: string[] = [];
  let eligible = true;

  const now = Math.floor(Date.now() / 1000);

  // Common terminal state check
  if (escrow.resolved || escrow.expired) {
    if (action !== 'sweep') {
      reasons.push('Escrow has already been resolved or expired');
      return { eligible: false, reasons };
    }
  }

  switch (action) {
    case 'confirm':
      // Must not be confirmed
      if (escrow.confirmed) {
        reasons.push('Escrow is already confirmed');
        eligible = false;
      }
      
      // Must be within confirm window
      if (now > escrow.confirmDeadline) {
        reasons.push('Confirmation window has expired');
        eligible = false;
      }
      
      // Must be seller
      if (connectedAddress) {
        if (connectedAddress.toLowerCase() !== escrow.payout.toLowerCase()) {
          reasons.push('Only the seller can confirm');
          eligible = false;
        } else {
          reasons.push('Connected as seller (payout address)');
        }
      } else {
        reasons.push('Connect wallet to verify you are the seller');
        eligible = false;
      }
      
      if (eligible) {
        reasons.push('All conditions met');
      }
      break;

    case 'finalize':
      // Check isPayable (derived: confirmed, funded, past deadline, no arbitrators, not terminal)
      if (escrow.isPayable) {
        reasons.push('Escrow is payable - all conditions met');
      } else {
        eligible = false;
        
        if (!escrow.confirmed) {
          reasons.push('Escrow has not been confirmed');
        }
        if (!escrow.isFunded) {
          reasons.push('Escrow is not fully funded');
        }
        if (now < escrow.deadline) {
          reasons.push('Deadline has not been reached');
        }
        if (escrow.arbitratorCount > 0) {
          reasons.push('Escrow has arbitrators - use arbitration flow');
        }
      }
      break;

    case 'sweep':
      // Must be terminal
      if (!escrow.isTerminal) {
        reasons.push('Escrow must be resolved or expired first');
        eligible = false;
      }
      
      // Must have balance
      if (escrow.escrowTokenBalance === BigInt(0)) {
        reasons.push('No funds to sweep');
        eligible = false;
      }
      
      if (eligible) {
        reasons.push(`${formatTokenAmount(escrow.escrowTokenBalance, escrow.tokenDecimals)} ${escrow.tokenSymbol} available to sweep`);
      }
      break;
  }

  return { eligible, reasons };
}

// Export eligibility check for use in action area
export { checkEligibility };
export type { EligibilityResult, ActionType };
