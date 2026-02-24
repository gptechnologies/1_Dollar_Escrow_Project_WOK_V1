'use client';

import { useState, useCallback } from 'react';
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
  ClipboardPaste,
  Fingerprint,
  X,
} from 'lucide-react';
import { getArbiscanAddressUrl } from '@/lib/chain';
import { buildShareUrl, buildWalletShareUrls } from '@/lib/share';
import { SIMPLE_COPY } from '@/lib/copy';
import { getStageGuidance, normalizePhaseName, StagePill, StageProgress, type PhaseKey } from './escrowStage';
import ShareModal from './ShareModal';

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
// Wallet Matcher
// ═══════════════════════════════════════════════════════════════════════════════

type MatchResult = { role: string; address: string } | null;

function useWalletMatcher(addresses: { role: string; address: string }[]) {
  const [input, setInput] = useState('');

  const match: MatchResult = (() => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed || !/^0x[a-fA-F0-9]{40}$/.test(input.trim())) return null;
    for (const entry of addresses) {
      if (entry.address.toLowerCase() === trimmed) return entry;
    }
    return null;
  })();

  const hasInput = input.trim().length > 0;
  const noMatch = hasInput && /^0x[a-fA-F0-9]{40}$/.test(input.trim()) && !match;

  return { input, setInput, match, hasInput, noMatch };
}

type WalletMatchBarProps = {
  input: string;
  setInput: (v: string) => void;
  match: MatchResult;
  noMatch: boolean;
};

function WalletMatchBar({ input, setInput, match, noMatch }: WalletMatchBarProps) {
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text.trim());
    } catch { /* clipboard unavailable */ }
  }, [setInput]);

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 text-[11px] text-white/50 mb-1.5">
        <Fingerprint className="w-3 h-3" />
        Verify your wallet
      </div>
      <div className="relative flex items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste your address to verify role"
          className={`w-full pl-3 pr-20 py-2 rounded-lg font-mono text-xs transition-all surface-input focus:outline-none focus:ring-2 text-white placeholder:text-white/35 ${
            match
              ? 'border-[#0BB89A]/60 focus:ring-[#0BB89A]/40 bg-[#0BB89A]/10'
              : noMatch
                ? 'border-red-400/50 focus:ring-red-400/30 bg-red-500/5'
                : 'focus:ring-[#0BB89A]/30'
          }`}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {input && (
            <button
              type="button"
              onClick={() => setInput('')}
              className="p-1 text-white/40 hover:text-white/70 transition-colors"
              title="Clear"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handlePaste}
            className="p-1 text-white/40 hover:text-white/70 transition-colors"
            title="Paste from clipboard"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Match result */}
      {match && (
        <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg bg-[#0BB89A]/15 border border-[#0BB89A]/30">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#0BB89A] shrink-0" />
          <span className="text-xs text-[#0BB89A] font-medium">
            Match — You are the <span className="font-bold">{match.role}</span>
          </span>
        </div>
      )}
      {noMatch && (
        <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25">
          <X className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-xs text-red-300">
            No match — This address is not a party in this escrow
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Party Row (with match highlight)
// ═══════════════════════════════════════════════════════════════════════════════

type PartyRowProps = {
  role: string;
  address: string;
  isMatch: boolean;
};

function PartyRow({ role, address, isMatch }: PartyRowProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-lg px-2.5 py-2 -mx-2.5 transition-colors ${
        isMatch ? 'bg-[#0BB89A]/10 ring-1 ring-[#0BB89A]/30' : ''
      }`}
    >
      <div className={`flex items-center gap-1.5 text-[11px] w-16 shrink-0 ${
        isMatch ? 'text-[#0BB89A]' : 'text-white/50'
      }`}>
        <User className="w-3 h-3" />
        {role}
        {isMatch && <Check className="w-3 h-3 text-[#0BB89A]" />}
      </div>
      <div className="flex items-center gap-1 min-w-0">
        <code className={`font-mono text-xs break-all sm:truncate ${
          isMatch ? 'text-[#0BB89A]' : 'text-white/80'
        }`}>
          <span className="sm:hidden">{shortenAddress(address)}</span>
          <span className="hidden sm:inline">{address}</span>
        </code>
        <CopyButton value={address} />
        <a
          href={getArbiscanAddressUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center shrink-0"
          title="View on Arbiscan"
        >
          <ExternalLink className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
        </a>
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
  const phaseKey = normalizePhaseName(phaseLabel);
  const tokenSymbol = token ? getTokenSymbol(token) : 'USDC';

  const hasArbitrators = (arbitratorCount ?? 0) > 0;
  const arb1Valid = arbitrator1 && arbitrator1 !== ZERO_ADDRESS;
  const arb2Valid = arbitrator2 && arbitrator2 !== ZERO_ADDRESS;
  const arb3Valid = arbitrator3 && arbitrator3 !== ZERO_ADDRESS;

  // Build the matchable addresses list
  const matchAddresses = [
    { role: 'Buyer', address: funder },
    { role: 'Seller', address: payout },
    ...(arb1Valid ? [{ role: 'Arbitrator #1', address: arbitrator1 }] : []),
    ...(arb2Valid ? [{ role: 'Arbitrator #2', address: arbitrator2 }] : []),
    ...(arb3Valid ? [{ role: 'Arbitrator #3', address: arbitrator3 }] : []),
  ];

  const matcher = useWalletMatcher(matchAddresses);
  const inputLower = matcher.input.trim().toLowerCase();
  const confirmShareUrl = buildShareUrl(code, { action: 'confirm', role: 'seller' });
  const confirmWalletUrls = buildWalletShareUrls(code, { action: 'confirm', role: 'seller' });
  const fundShareUrl = buildShareUrl(code, { action: 'fund', role: 'buyer' });
  const fundWalletUrls = buildWalletShareUrls(code, { action: 'fund', role: 'buyer' });
  const finalizeShareUrl = buildShareUrl(code, { action: 'finalize' });
  const finalizeWalletUrls = buildWalletShareUrls(code, { action: 'finalize' });
  const stageGuidance = getStageGuidance(phaseKey, {
    buyerAddress: funder,
    sellerAddress: payout,
  });

  return (
    <div className="surface-card overflow-hidden">
      {/* Header: Lookup Code + Phase */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-white/50 mb-1">Lookup Code</div>
            <div className="flex items-center gap-1 flex-wrap">
              <code className="font-mono text-sm text-white/90">
                {code}
              </code>
              <CopyButton value={code} />
            </div>
            <div className="flex items-center gap-1 mt-1.5">
              <code className="font-mono text-[11px] text-white/50 break-all">
                {shortenAddress(escrow)}
              </code>
              <a
                href={getArbiscanAddressUrl(escrow)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded hover:bg-white/10 transition-colors flex items-center justify-center shrink-0"
                title="View on Arbiscan"
              >
                <ExternalLink className="w-3 h-3 text-white/40 hover:text-white/70" />
              </a>
            </div>
          </div>
          <StagePill phase={phaseKey} />
        </div>
        <StageProgress phase={phaseKey} />
        <div className="mt-3 rounded-lg bg-white/10 border border-white/15 p-3">
          <p className="text-sm text-white/90 font-medium">{stageGuidance.headline}</p>
          <p className="text-xs text-white/70 mt-1">
            <span className="text-white/90 font-semibold">{SIMPLE_COPY.nextPrefix}</span> {stageGuidance.instruction}
          </p>
          <p className="text-xs text-white/55 mt-1">{stageGuidance.afterAction}</p>
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

        {/* Wallet matcher input */}
        <WalletMatchBar
          input={matcher.input}
          setInput={matcher.setInput}
          match={matcher.match}
          noMatch={matcher.noMatch}
        />

        <div className="space-y-1">
          <PartyRow role="Buyer" address={funder} isMatch={funder.toLowerCase() === inputLower} />
          <PartyRow role="Seller" address={payout} isMatch={payout.toLowerCase() === inputLower} />
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
          <div className="space-y-1">
            {arb1Valid && (
              <ArbRow num={1} address={arbitrator1} isMatch={arbitrator1.toLowerCase() === inputLower} />
            )}
            {arb2Valid && (
              <ArbRow num={2} address={arbitrator2} isMatch={arbitrator2.toLowerCase() === inputLower} />
            )}
            {arb3Valid && (
              <ArbRow num={3} address={arbitrator3} isMatch={arbitrator3.toLowerCase() === inputLower} suffix="(tiebreaker)" />
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
        <PhaseActionButton
          phaseKey={phaseKey}
          escrowAddress={escrow}
          code={code}
          confirmShareUrl={confirmShareUrl}
          confirmWalletUrls={confirmWalletUrls}
          fundShareUrl={fundShareUrl}
          fundWalletUrls={fundWalletUrls}
          finalizeShareUrl={finalizeShareUrl}
          finalizeWalletUrls={finalizeWalletUrls}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Arbitrator Row (with match highlight)
// ═══════════════════════════════════════════════════════════════════════════════

type ArbRowProps = {
  num: number;
  address: string;
  isMatch: boolean;
  suffix?: string;
};

function ArbRow({ num, address, isMatch, suffix }: ArbRowProps) {
  return (
    <div
      className={`flex items-center gap-1 min-w-0 rounded-lg px-2.5 py-1.5 -mx-2.5 transition-colors ${
        isMatch ? 'bg-[#0BB89A]/10 ring-1 ring-[#0BB89A]/30' : ''
      }`}
    >
      <span className={`text-[11px] w-4 shrink-0 ${isMatch ? 'text-[#0BB89A]' : 'text-white/50'}`}>
        {num}.
      </span>
      <code className={`font-mono text-xs break-all sm:truncate ${isMatch ? 'text-[#0BB89A]' : 'text-white/70'}`}>
        <span className="sm:hidden">{shortenAddress(address)}</span>
        <span className="hidden sm:inline">{address}</span>
      </code>
      <CopyButton value={address} />
      {isMatch && <Check className="w-3 h-3 text-[#0BB89A] shrink-0" />}
      {suffix && <span className="text-[10px] text-white/40 ml-1">{suffix}</span>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase Action Button
// ═══════════════════════════════════════════════════════════════════════════════

type PhaseActionButtonProps = {
  phaseKey: PhaseKey;
  escrowAddress: string;
  code: string;
  confirmShareUrl: string;
  confirmWalletUrls: Record<string, string>;
  fundShareUrl: string;
  fundWalletUrls: Record<string, string>;
  finalizeShareUrl: string;
  finalizeWalletUrls: Record<string, string>;
};

function PhaseActionButton({
  phaseKey,
  escrowAddress,
  code,
  confirmShareUrl,
  confirmWalletUrls,
  fundShareUrl,
  fundWalletUrls,
  finalizeShareUrl,
  finalizeWalletUrls,
}: PhaseActionButtonProps) {
  switch (phaseKey) {
    case 'AwaitingConfirmation':
      return (
        <div className="space-y-2">
          <Link
            href={`/tx/confirm?escrow=${escrowAddress}&code=${encodeURIComponent(code)}&role=seller`}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20 active:scale-[0.99] transition-all"
          >
            Confirm as Seller
            <ArrowRight className="w-4 h-4" />
          </Link>
          <ShareModal
            shareUrl={confirmShareUrl}
            walletUrls={confirmWalletUrls}
            title="Share confirm link"
            description="Send this to the seller so they can confirm the escrow."
            triggerLabel={SIMPLE_COPY.shareConfirm}
            triggerClassName="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
          />
        </div>
      );

    case 'Funded':
      return (
        <div className="space-y-2">
          <Link
            href={`/tx/finalize?escrow=${escrowAddress}&code=${encodeURIComponent(code)}`}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 active:scale-[0.99] transition-all"
          >
            Finalize Escrow
            <ArrowRight className="w-4 h-4" />
          </Link>
          <ShareModal
            shareUrl={finalizeShareUrl}
            walletUrls={finalizeWalletUrls}
            title="Share finalize link"
            description="Anyone can finalize when conditions are met."
            triggerLabel={SIMPLE_COPY.shareFinalize}
            triggerClassName="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
          />
        </div>
      );

    case 'ConfirmedAwaitingFunding':
      return (
        <div className="space-y-2">
          <Link
            href={`/tx/fund?escrow=${escrowAddress}&code=${encodeURIComponent(code)}&role=buyer`}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 active:scale-[0.99] transition-all"
          >
            Fund Escrow
            <ArrowRight className="w-4 h-4" />
          </Link>
          <ShareModal
            shareUrl={fundShareUrl}
            walletUrls={fundWalletUrls}
            title="Share funding link"
            description="Send this to the buyer so they can fund escrow."
            triggerLabel={SIMPLE_COPY.shareFunding}
            triggerClassName="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
          />
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
