'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Copy,
  Check,
  ExternalLink,
  Calendar,
  Coins,
  User,
  Tag,
  ArrowRight,
  CheckCircle2,
  Shield,
} from 'lucide-react';
import { getArbiscanAddressUrl } from '@/lib/chain';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type EscrowCardProps = {
  escrow: string;
  code: string;
  phase: number;
  phaseName: string;
  deadline: number | null;
  confirmDeadline?: number;
  targetAmount: string | null;
  token?: string;
  payout: string;
  funder: string;
  arbitrator1?: string;
  arbitrator2?: string;
  arbitrator3?: string;  // Deadlock arbitrator (3-arb setup only)
  arbitratorCount?: number;  // 0, 1, or 3 (never 2)
  deadlocked?: boolean;  // True if arb1 and arb2 voted differently
  isPartial?: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const MICRO_UNITS = BigInt(1_000_000);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Known token addresses on Arbitrum
const TOKEN_SYMBOLS: Record<string, string> = {
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
};

export const PHASE_STYLES: Record<string, string> = {
  AwaitingConfirmation: 'bg-yellow-500/20 text-yellow-300',
  ConfirmedAwaitingFunding: 'bg-blue-500/20 text-blue-300',
  Funded: 'bg-emerald-500/20 text-emerald-300',
  Resolved: 'bg-white/10 text-white/60',
  Expired: 'bg-red-500/20 text-red-300',
  Unknown: 'bg-white/10 text-white/70',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

const formatAmount = (value: string | null): string => {
  if (!value) return '—';

  try {
    const amount = BigInt(value);
    const whole = amount / MICRO_UNITS;
    const fraction = amount % MICRO_UNITS;

    if (fraction === BigInt(0)) {
      return whole.toString();
    }

    const fractionStr = fraction
      .toString()
      .padStart(6, '0')
      .replace(/0+$/, '');

    return `${whole.toString()}.${fractionStr}`;
  } catch {
    return value;
  }
};

const formatDeadline = (value: number | null): string => {
  if (!value) return '—';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getTokenSymbol = (tokenAddress: string): string => {
  return TOKEN_SYMBOLS[tokenAddress.toLowerCase()] || 'TOKEN';
};

const shortenAddress = (address: string): string => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════════════════════

type CopyButtonProps = {
  value: string;
};

function CopyButton({ value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-[#0BB89A]" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
      )}
    </button>
  );
}

type DetailRowProps = {
  label: string;
  value: string;
  icon?: React.ReactNode;
  mono?: boolean;
  showCopy?: boolean;
  showLink?: boolean;
  fullWidth?: boolean;
};

function DetailRow({
  label,
  value,
  icon,
  mono,
  showCopy,
  showLink,
  fullWidth,
}: DetailRowProps) {
  return (
    <div className={`${fullWidth ? '' : ''}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-white/50 mb-1">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-1">
        <span
          className={`text-sm text-white/90 ${mono ? 'font-mono text-xs' : ''} ${
            fullWidth ? 'break-all' : ''
          }`}
          title={value}
        >
          {value}
        </span>
        {showCopy && <CopyButton value={value} />}
        {showLink && (
          <a
            href={getArbiscanAddressUrl(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
            title="View on Arbiscan"
          >
            <ExternalLink className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
          </a>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function EscrowCard({
  escrow,
  code,
  phase,
  phaseName,
  deadline,
  targetAmount,
  token,
  payout,
  funder,
  arbitrator1,
  arbitrator2,
  arbitrator3,
  arbitratorCount,
  deadlocked,
  isPartial,
}: EscrowCardProps) {
  const phaseLabel = phaseName || `Phase ${phase}`;
  const phaseClass = PHASE_STYLES[phaseLabel] || PHASE_STYLES.Unknown;
  const tokenSymbol = token ? getTokenSymbol(token) : 'USDC';

  const hasArbitrators = (arbitratorCount ?? 0) > 0;
  const arb1Valid = arbitrator1 && arbitrator1 !== ZERO_ADDRESS;
  const arb2Valid = arbitrator2 && arbitrator2 !== ZERO_ADDRESS;
  const arb3Valid = arbitrator3 && arbitrator3 !== ZERO_ADDRESS;

  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
      {/* Header: Escrow Address + Phase */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-white/50 mb-1">Escrow Address</div>
            <div className="flex items-center gap-1 flex-wrap">
              <code className="font-mono text-sm text-white/90 break-all">
                {escrow}
              </code>
              <CopyButton value={escrow} />
              <a
                href={getArbiscanAddressUrl(escrow)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center shrink-0"
                title="View on Arbiscan"
              >
                <ExternalLink className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
              </a>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap shrink-0 ${phaseClass}`}
          >
            {phaseLabel}
          </span>
        </div>
      </div>

      {/* Primary Details */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <DetailRow
            label="Lookup Code"
            value={code}
            icon={<Tag className="w-3 h-3" />}
            mono
            showCopy
          />
          <DetailRow
            label="Deadline"
            value={formatDeadline(deadline)}
            icon={<Calendar className="w-3 h-3" />}
          />
          <DetailRow
            label="Amount"
            value={`${formatAmount(targetAmount)} ${tokenSymbol}`}
            icon={<Coins className="w-3 h-3" />}
          />
        </div>
      </div>

      {/* Parties Section */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="text-[11px] text-white/40 uppercase tracking-wide mb-3">
          Parties
        </div>
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-1.5 text-[11px] text-white/50 w-16 shrink-0">
              <User className="w-3 h-3" />
              Buyer
            </div>
            <div className="flex items-center gap-1 min-w-0">
              <code className="font-mono text-xs text-white/80 break-all sm:truncate">
                <span className="sm:hidden">{shortenAddress(funder)}</span>
                <span className="hidden sm:inline">{funder}</span>
              </code>
              <CopyButton value={funder} />
              <a
                href={getArbiscanAddressUrl(funder)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center shrink-0"
                title="View on Arbiscan"
              >
                <ExternalLink className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-1.5 text-[11px] text-white/50 w-16 shrink-0">
              <User className="w-3 h-3" />
              Seller
            </div>
            <div className="flex items-center gap-1 min-w-0">
              <code className="font-mono text-xs text-white/80 break-all sm:truncate">
                <span className="sm:hidden">{shortenAddress(payout)}</span>
                <span className="hidden sm:inline">{payout}</span>
              </code>
              <CopyButton value={payout} />
              <a
                href={getArbiscanAddressUrl(payout)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center shrink-0"
                title="View on Arbiscan"
              >
                <ExternalLink className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Arbitrators Section (if any) */}
      {hasArbitrators && (
        <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-[11px] text-white/40 uppercase tracking-wide">
              <Shield className="w-3 h-3" />
              Arbitrators ({arbitratorCount})
            </div>
            {deadlocked && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-orange-500/20 text-orange-300">
                Deadlocked
              </span>
            )}
          </div>
          <div className="space-y-2">
            {arb1Valid && (
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] text-white/50 w-4 shrink-0">1.</span>
                <code className="font-mono text-xs text-white/70 break-all sm:truncate">
                  <span className="sm:hidden">{shortenAddress(arbitrator1)}</span>
                  <span className="hidden sm:inline">{arbitrator1}</span>
                </code>
                <CopyButton value={arbitrator1} />
              </div>
            )}
            {arb2Valid && (
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] text-white/50 w-4 shrink-0">2.</span>
                <code className="font-mono text-xs text-white/70 break-all sm:truncate">
                  <span className="sm:hidden">{shortenAddress(arbitrator2)}</span>
                  <span className="hidden sm:inline">{arbitrator2}</span>
                </code>
                <CopyButton value={arbitrator2} />
              </div>
            )}
            {arb3Valid && (
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] text-white/50 w-4 shrink-0">3.</span>
                <code className="font-mono text-xs text-white/70 break-all sm:truncate">
                  <span className="sm:hidden">{shortenAddress(arbitrator3)}</span>
                  <span className="hidden sm:inline">{arbitrator3}</span>
                </code>
                <CopyButton value={arbitrator3} />
                <span className="text-[10px] text-white/40 ml-1">(tiebreaker)</span>
              </div>
            )}
          </div>
          {arbitratorCount === 3 && (
            <p className="mt-2 text-[10px] text-white/50">
              Arb #1 and #2 must agree. If they disagree, #3 breaks the tie.
              Unresolved disputes are swept to treasury.
            </p>
          )}
        </div>
      )}

      {/* Partial Data Notice */}
      {isPartial && (
        <div className="px-4 py-2 border-b border-white/10 bg-yellow-500/5">
          <p className="text-[11px] text-yellow-300/70">
            Limited data available (older contract version)
          </p>
        </div>
      )}

      {/* Action Footer */}
      <div className="px-4 py-3">
        <PhaseActionButton phaseName={phaseLabel} escrowAddress={escrow} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase Action Button
// ═══════════════════════════════════════════════════════════════════════════════

type PhaseActionButtonProps = {
  phaseName: string;
  escrowAddress: string;
};

function PhaseActionButton({ phaseName, escrowAddress }: PhaseActionButtonProps) {
  switch (phaseName) {
    case 'AwaitingConfirmation':
      return (
        <Link
          href={`/tx/confirm?escrow=${escrowAddress}`}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20 transition-colors"
        >
          Confirm as Seller
          <ArrowRight className="w-4 h-4" />
        </Link>
      );

    case 'Funded':
      return (
        <Link
          href={`/tx/finalize?escrow=${escrowAddress}`}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-colors"
        >
          Finalize Escrow
          <ArrowRight className="w-4 h-4" />
        </Link>
      );

    case 'ConfirmedAwaitingFunding':
      return (
        <div className="w-full text-center py-2 text-sm text-blue-300/80">
          Awaiting buyer to fund escrow
        </div>
      );

    case 'Resolved':
      return (
        <div className="w-full inline-flex items-center justify-center gap-2 py-2 text-sm text-white/50">
          <CheckCircle2 className="w-4 h-4" />
          Escrow Complete
        </div>
      );

    case 'Expired':
      return (
        <div className="w-full text-center py-2 text-sm text-red-300/60">
          This escrow has expired
        </div>
      );

    default:
      return null;
  }
}
