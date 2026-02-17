'use client';

import { CheckCircle2, CircleDollarSign, UserCheck, Wallet, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';

export type PhaseKey =
  | 'AwaitingConfirmation'
  | 'ConfirmedAwaitingFunding'
  | 'Funded'
  | 'Resolved'
  | 'Expired';

export type EscrowFlags = {
  confirmed: boolean;
  isFunded: boolean;
  resolved: boolean;
  expired: boolean;
};

export type StageGuidance = {
  headline: string;
  nextActionLabel: string;
  nextActor: 'buyer' | 'seller' | 'anyone' | 'none';
  instruction: string;
  afterAction: string;
};

type StageGuidanceContext = {
  buyerAddress?: string;
  sellerAddress?: string;
};

type PhaseMeta = {
  label: string;
  badgeClass: string;
  icon: ComponentType<{ className?: string }>;
};

export const PHASE_FLOW: PhaseKey[] = [
  'AwaitingConfirmation',
  'ConfirmedAwaitingFunding',
  'Funded',
  'Resolved',
];

const PHASE_META: Record<PhaseKey, PhaseMeta> = {
  AwaitingConfirmation: {
    label: 'Awaiting seller confirmation',
    badgeClass: 'bg-yellow-500/20 text-yellow-300',
    icon: UserCheck,
  },
  ConfirmedAwaitingFunding: {
    label: 'Awaiting buyer funding',
    badgeClass: 'bg-blue-500/20 text-blue-300',
    icon: Wallet,
  },
  Funded: {
    label: 'Funded, waiting for deadline',
    badgeClass: 'bg-emerald-500/20 text-emerald-300',
    icon: CircleDollarSign,
  },
  Resolved: {
    label: 'Escrow completed',
    badgeClass: 'bg-white/10 text-white/70',
    icon: CheckCircle2,
  },
  Expired: {
    label: 'Escrow expired',
    badgeClass: 'bg-red-500/20 text-red-300',
    icon: XCircle,
  },
};

export function normalizePhaseName(phaseName: string): PhaseKey {
  if (phaseName in PHASE_META) {
    return phaseName as PhaseKey;
  }
  return 'AwaitingConfirmation';
}

export function derivePhaseFromFlags(flags: EscrowFlags): PhaseKey {
  if (flags.resolved) return 'Resolved';
  if (flags.expired) return 'Expired';
  if (flags.isFunded) return 'Funded';
  if (flags.confirmed) return 'ConfirmedAwaitingFunding';
  return 'AwaitingConfirmation';
}

export function getPhaseMeta(phase: PhaseKey): PhaseMeta {
  return PHASE_META[phase];
}

function shortAddress(address?: string): string {
  if (!address) return 'unknown wallet';
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getStageGuidance(phase: PhaseKey, context: StageGuidanceContext = {}): StageGuidance {
  // Copy guardrail: keep this phrasing simple, direct, and actor-oriented.
  // Prefer "who acts now + what happens next" over technical details.
  switch (phase) {
    case 'AwaitingConfirmation':
      return {
        headline: 'This escrow is waiting for seller confirmation.',
        nextActionLabel: 'Confirm escrow',
        nextActor: 'seller',
        instruction: `Share the confirm link with seller ${shortAddress(context.sellerAddress)}.`,
        afterAction: 'After seller confirms, buyer can fund the escrow.',
      };
    case 'ConfirmedAwaitingFunding':
      return {
        headline: 'This escrow is confirmed and ready for funding.',
        nextActionLabel: 'Fund escrow',
        nextActor: 'buyer',
        instruction: `Waiting for buyer ${shortAddress(context.buyerAddress)} to fund escrow.`,
        afterAction: 'After funding, funds are locked until finalize conditions are met.',
      };
    case 'Funded':
      return {
        headline: 'This escrow is funded.',
        nextActionLabel: 'Finalize escrow',
        nextActor: 'anyone',
        instruction: 'Wait for the deadline, then finalize to release funds to the seller.',
        afterAction: 'After finalize, escrow moves to complete.',
      };
    case 'Resolved':
      return {
        headline: 'This escrow is complete.',
        nextActionLabel: 'No action needed',
        nextActor: 'none',
        instruction: 'Funds have already been released.',
        afterAction: 'No further action is required.',
      };
    case 'Expired':
      return {
        headline: 'This escrow has expired.',
        nextActionLabel: 'No action available',
        nextActor: 'none',
        instruction: 'This escrow can no longer continue in the normal flow.',
        afterAction: 'No further action is required.',
      };
    default:
      return {
        headline: 'Escrow status unavailable.',
        nextActionLabel: 'Check escrow details',
        nextActor: 'none',
        instruction: 'Review escrow details before acting.',
        afterAction: 'Try again after refreshing the page.',
      };
  }
}

export function StagePill({ phase }: { phase: PhaseKey }) {
  const meta = getPhaseMeta(phase);
  const Icon = meta.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${meta.badgeClass}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {meta.label}
    </span>
  );
}

export function StageProgress({ phase }: { phase: PhaseKey }) {
  const activeIndex = PHASE_FLOW.indexOf(phase);

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {PHASE_FLOW.map((step, idx) => {
        const meta = getPhaseMeta(step);
        const Icon = meta.icon;
        const isCurrent = step === phase;
        const isComplete = activeIndex > idx && phase !== 'Expired';

        return (
          <span
            key={step}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
              isCurrent
                ? 'bg-white/20 text-white'
                : isComplete
                  ? 'bg-[#0BB89A]/20 text-[#0BB89A]'
                  : 'bg-white/5 text-white/45'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {meta.label}
          </span>
        );
      })}
      {phase === 'Expired' && (
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] bg-red-500/20 text-red-300">
          <XCircle className="w-3.5 h-3.5" />
          Escrow expired
        </span>
      )}
    </div>
  );
}
