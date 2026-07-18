'use client';

import { CheckCircle2, CircleDollarSign, Handshake, RotateCcw, UserCheck } from 'lucide-react';
import type { ComponentType } from 'react';

// Stage keys mirror the EscrowV2 Status enum
export type StageKey =
  | 'Created'
  | 'Active'
  | 'PendingResolution'
  | 'Settled'
  | 'Refunded';

export type StageGuidance = {
  headline: string;
  nextActionLabel: string;
  nextActor: 'buyer' | 'seller' | 'arbitrator' | 'anyone' | 'none';
  instruction: string;
  afterAction: string;
};

type StageGuidanceContext = {
  buyerAddress?: string;
  sellerAddress?: string;
};

type StageMeta = {
  label: string;
  badgeClass: string;
  icon: ComponentType<{ className?: string }>;
};

// Main happy-path progression for the stepper
export const STAGE_FLOW: StageKey[] = ['Created', 'Active', 'Settled'];

const STAGE_META: Record<StageKey, StageMeta> = {
  Created: {
    label: 'Awaiting funding',
    badgeClass: 'bg-yellow-500/20 text-yellow-300',
    icon: UserCheck,
  },
  Active: {
    label: 'Active (in escrow)',
    badgeClass: 'bg-emerald-500/20 text-emerald-300',
    icon: CircleDollarSign,
  },
  PendingResolution: {
    label: 'Pending mutual resolution',
    badgeClass: 'bg-blue-500/20 text-blue-300',
    icon: Handshake,
  },
  Settled: {
    label: 'Settled to seller',
    badgeClass: 'bg-white/10 text-white/70',
    icon: CheckCircle2,
  },
  Refunded: {
    label: 'Refunded to buyer',
    badgeClass: 'bg-white/10 text-white/70',
    icon: RotateCcw,
  },
};

const STATUS_TO_STAGE: StageKey[] = [
  'Created',           // 0
  'Active',            // 1
  'PendingResolution', // 2
  'Settled',           // 3
  'Refunded',          // 4
];

export function stageFromStatus(status: number): StageKey {
  return STATUS_TO_STAGE[status] ?? 'Created';
}

export function stageFromStatusName(statusName: string): StageKey {
  switch (statusName) {
    case 'Created':
      return 'Created';
    case 'Active':
      return 'Active';
    case 'PendingMutualResolution':
    case 'PendingResolution':
      return 'PendingResolution';
    case 'Settled':
    case 'Released':
      return 'Settled';
    case 'Refunded':
      return 'Refunded';
    default:
      return 'Created';
  }
}

export function getStageMeta(stage: StageKey): StageMeta {
  return STAGE_META[stage];
}

export function isTerminalStage(stage: StageKey): boolean {
  return stage === 'Settled' || stage === 'Refunded';
}

function shortAddress(address?: string): string {
  if (!address) return 'unknown wallet';
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getStageGuidance(stage: StageKey, context: StageGuidanceContext = {}): StageGuidance {
  switch (stage) {
    case 'Created':
      return {
        headline: 'This escrow is waiting to be funded. Seller confirmation is optional.',
        nextActionLabel: 'Fund escrow',
        nextActor: 'buyer',
        instruction: `Buyer ${shortAddress(context.buyerAddress)} funds the escrow; seller ${shortAddress(context.sellerAddress)} may optionally confirm once funded.`,
        afterAction: 'Once fully funded it can resolve after the settlement date, even without seller confirmation.',
      };
    case 'Active':
      return {
        headline: 'This escrow is active and holding funds.',
        nextActionLabel: 'Resolve escrow',
        nextActor: 'anyone',
        instruction: 'Release after the settlement date, mutually agree, or let arbitrators decide.',
        afterAction: 'Funds are released to the seller or refunded to the buyer on resolution.',
      };
    case 'PendingResolution':
      return {
        headline: 'Both parties agreed on an outcome — arbitrators can still override.',
        nextActionLabel: 'Finalize after window',
        nextActor: 'anyone',
        instruction: 'During the 30-day window an arbitrator may override; otherwise anyone can finalize.',
        afterAction: 'After the override window the agreed outcome executes.',
      };
    case 'Settled':
      return {
        headline: 'This escrow is complete — funds were released to the seller.',
        nextActionLabel: 'No action needed',
        nextActor: 'none',
        instruction: 'Funds have already been released.',
        afterAction: 'No further action is required.',
      };
    case 'Refunded':
      return {
        headline: 'This escrow was refunded to the buyer.',
        nextActionLabel: 'No action needed',
        nextActor: 'none',
        instruction: 'Funds were returned to the buyer.',
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

export function StagePill({ stage }: { stage: StageKey }) {
  const meta = getStageMeta(stage);
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

export function StageProgress({ stage }: { stage: StageKey }) {
  const activeIndex = STAGE_FLOW.indexOf(stage);
  const offPath = activeIndex === -1;

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {STAGE_FLOW.map((step, idx) => {
        const meta = getStageMeta(step);
        const Icon = meta.icon;
        const isCurrent = step === stage;
        const isComplete = !offPath && activeIndex > idx;

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
      {offPath && (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${getStageMeta(stage).badgeClass}`}>
          {(() => {
            const Icon = getStageMeta(stage).icon;
            return <Icon className="w-3.5 h-3.5" />;
          })()}
          {getStageMeta(stage).label}
        </span>
      )}
    </div>
  );
}
