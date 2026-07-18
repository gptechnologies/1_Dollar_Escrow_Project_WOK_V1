/**
 * Central registry mapping every escrow action to its label, contract function,
 * transaction encoding and eligibility check. Drives inline dashboard signing,
 * with /tx/action retained only as a fallback route.
 */

import { type Address, type Hex } from 'viem';
import {
  type EscrowState,
  EscrowOutcome,
  EscrowStatus,
  formatTokenAmount,
} from './chain';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
import {
  encodeSellerConfirmTx,
  encodeSettleTx,
  encodeRefundUnderfundedTx,
  encodeRecoverLatePaymentTokenTx,
  encodeApproveMutualSettleTx,
  encodeApproveMutualRefundTx,
  encodeFinalizeMutualResolutionTx,
  encodeArbSettleTx,
  encodeArbRefundTx,
  encodeArbVoteSettleTx,
  encodeArbVoteRefundTx,
  encodeSweepExcessTx,
  encodeFundEscrowTx,
} from './wallet';
import type { ShareAction } from './share';

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
};

export type ActionMeta = {
  action: ShareAction;
  title: string;
  shortLabel: string;
  description: string;
  functionName: string;
  /** Who should typically sign this action. */
  actor: 'buyer' | 'seller' | 'arbitrator' | 'anyone';
};

export const ACTION_META: Record<ShareAction, ActionMeta> = {
  fund: {
    action: 'fund',
    title: 'Fund Escrow',
    shortLabel: 'Fund',
    description: 'Transfer the target amount into the escrow contract.',
    functionName: 'transfer(escrow, targetAmount)',
    actor: 'buyer',
  },
  sellerConfirm: {
    action: 'sellerConfirm',
    title: 'Confirm Escrow',
    shortLabel: 'Confirm',
    description: 'As the seller, activate this escrow now that it is fully funded.',
    functionName: 'sellerConfirm()',
    actor: 'seller',
  },
  settle: {
    action: 'settle',
    title: 'Release Escrow',
    shortLabel: 'Release',
    description: 'Release funds to the seller after the settlement date.',
    functionName: 'settle()',
    actor: 'anyone',
  },
  mutualSettle: {
    action: 'mutualSettle',
    title: 'Approve Release to Seller',
    shortLabel: 'Mutual release',
    description: 'Approve releasing the funds to the seller. Both parties must approve.',
    functionName: 'approveMutualSettle()',
    actor: 'buyer',
  },
  mutualRefund: {
    action: 'mutualRefund',
    title: 'Approve Refund to Buyer',
    shortLabel: 'Mutual refund',
    description: 'Approve refunding the funds to the buyer. Both parties must approve.',
    functionName: 'approveMutualRefund()',
    actor: 'seller',
  },
  arbSettle: {
    action: 'arbSettle',
    title: 'Arbitrator: Release to Seller',
    shortLabel: 'Vote release',
    description: 'As an arbitrator, vote to release the funds to the seller.',
    functionName: 'arbSettle()',
    actor: 'arbitrator',
  },
  arbRefund: {
    action: 'arbRefund',
    title: 'Arbitrator: Refund to Buyer',
    shortLabel: 'Vote refund',
    description: 'As an arbitrator, vote to refund the funds to the buyer.',
    functionName: 'arbRefund()',
    actor: 'arbitrator',
  },
  finalize: {
    action: 'finalize',
    title: 'Finalize Mutual Resolution',
    shortLabel: 'Finalize',
    description: 'Execute the agreed outcome after the arbitrator override window.',
    functionName: 'finalizeMutualResolution()',
    actor: 'anyone',
  },
  refundUnderfunded: {
    action: 'refundUnderfunded',
    title: 'Refund (Underfunded)',
    shortLabel: 'Refund',
    description: 'Return the balance to the buyer for an escrow that was never fully funded by the settlement date.',
    functionName: 'refundUnderfunded()',
    actor: 'anyone',
  },
  recover: {
    action: 'recover',
    title: 'Recover Late Payment',
    shortLabel: 'Recover',
    description: 'Return payment tokens sent after the escrow was resolved back to the buyer.',
    functionName: 'recoverLatePaymentToken()',
    actor: 'anyone',
  },
  sweepExcess: {
    action: 'sweepExcess',
    title: 'Sweep Excess Funds',
    shortLabel: 'Sweep excess',
    description: 'Send excess or late funds to the treasury.',
    functionName: 'sweepExcess()',
    actor: 'anyone',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard Actions panel model
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal status snapshot used by the dashboard Actions panel (indexer/API shape). */
export type DashboardEscrowSnapshot = {
  status: number;
  arbitrationMode?: number;
  pendingOutcome?: number;
  balance?: string | null;
  isFunded?: boolean;
  isTerminal?: boolean;
  isActivatable?: boolean;
  isSettleable?: boolean;
  isVotable?: boolean;
  isFinalizable?: boolean;
  isRefundableUnderfunded?: boolean;
};

export type DashboardIntent = 'fund' | 'confirm' | 'release' | 'refund';

export type DashboardAction = {
  intent: DashboardIntent;
  action: ShareAction;
  label: string;
  role?: 'buyer' | 'seller' | 'arbitrator';
  enabled: boolean;
  /** Short explanation of why the action is unavailable (tooltip / aria). */
  reason: string;
};

/**
 * Derive the action tiles shown beside Recent Actions. State-level eligibility
 * only — wallet/role checks happen in the inline dashboard signer before signing.
 */
export function getDashboardActions(s: DashboardEscrowSnapshot): DashboardAction[] {
  const terminal = !!s.isTerminal || s.status === EscrowStatus.SETTLED || s.status === EscrowStatus.REFUNDED;
  const open = s.status === EscrowStatus.CREATED || s.status === EscrowStatus.ACTIVE;
  const arbitrated = (s.arbitrationMode ?? 0) > 0;
  const pendingOutcome = s.pendingOutcome ?? EscrowOutcome.NONE;
  const canFund = s.status === EscrowStatus.CREATED && !s.isFunded && !terminal;
  const canConfirm = !!s.isActivatable;
  const canRelease =
    !!s.isSettleable ||
    !!s.isVotable ||
    (open && !!s.isFunded) ||
    (!!s.isFinalizable && pendingOutcome === EscrowOutcome.SETTLE);
  const canRefund =
    !!s.isRefundableUnderfunded ||
    !!s.isVotable ||
    open ||
    (!!s.isFinalizable && pendingOutcome === EscrowOutcome.REFUND);

  const releaseAction: ShareAction = s.isFinalizable && pendingOutcome === EscrowOutcome.SETTLE
    ? 'finalize'
    : s.isVotable
      ? 'arbSettle'
      : s.isSettleable
        ? 'settle'
        : 'mutualSettle';

  const refundAction: ShareAction = s.isFinalizable && pendingOutcome === EscrowOutcome.REFUND
    ? 'finalize'
    : s.isRefundableUnderfunded
      ? 'refundUnderfunded'
      : s.isVotable
        ? 'arbRefund'
        : 'mutualRefund';

  return [
    {
      intent: 'fund',
      action: 'fund',
      label: 'Fund',
      role: 'buyer',
      enabled: canFund,
      reason: terminal
        ? 'Escrow is already resolved'
        : s.isFunded
          ? 'Escrow is fully funded'
          : 'Escrow is no longer awaiting funding',
    },
    {
      intent: 'confirm',
      action: 'sellerConfirm',
      label: 'Confirm',
      role: 'seller',
      enabled: canConfirm,
      reason: s.status !== EscrowStatus.CREATED
        ? 'Escrow is no longer awaiting seller confirmation'
        : 'Waiting for full funding before the seller can confirm',
    },
    {
      intent: 'release',
      action: releaseAction,
      label: 'Release',
      role: arbitrated && s.isVotable ? 'arbitrator' : undefined,
      enabled: canRelease,
      reason: terminal
        ? 'Escrow is already resolved'
        : !s.isFunded
          ? 'Release requires the escrow to be fully funded'
          : 'Release is not callable yet',
    },
    {
      intent: 'refund',
      action: refundAction,
      label: 'Refund',
      role: arbitrated && s.isVotable ? 'arbitrator' : undefined,
      enabled: canRefund,
      reason: terminal
        ? 'Escrow is already resolved'
        : 'Refund is not callable yet',
    },
  ];
}

/**
 * Resolve a dashboard intent into the concrete EscrowV2 function for the
 * connected signer. The dashboard exposes four user intents, while the contract
 * keeps distinct public, mutual-party and arbitrator functions.
 */
export function resolveDashboardAction(
  escrow: EscrowState,
  tile: DashboardAction,
  connectedAddress?: string | null,
): ShareAction {
  if (tile.intent === 'fund' || tile.intent === 'confirm') {
    return tile.action;
  }

  const party = isParty(escrow, connectedAddress);
  const arbitrator = isArbitrator(escrow, connectedAddress);
  const open = escrow.status === EscrowStatus.CREATED || escrow.status === EscrowStatus.ACTIVE;

  if (tile.intent === 'release') {
    if (escrow.isFinalizable && escrow.pendingOutcome === EscrowOutcome.SETTLE) return 'finalize';
    if (arbitrator && escrow.isVotable) return 'arbSettle';
    if (escrow.isSettleable) return 'settle';
    if (party && open && escrow.isFunded) return 'mutualSettle';
    if (escrow.isVotable) return 'arbSettle';
    if (open && escrow.isFunded) return 'mutualSettle';
    return tile.action;
  }

  if (escrow.isFinalizable && escrow.pendingOutcome === EscrowOutcome.REFUND) return 'finalize';
  if (arbitrator && escrow.isVotable) return 'arbRefund';
  if (escrow.isRefundableUnderfunded) return 'refundUnderfunded';
  if (party && open) return 'mutualRefund';
  if (escrow.isVotable) return 'arbRefund';
  if (open) return 'mutualRefund';
  return tile.action;
}

/**
 * Address (to) and calldata for a given action. Most actions target the escrow
 * contract; funding targets the token contract (ERC-20 transfer).
 */
export function buildActionTx(action: ShareAction, escrow: EscrowState): { to: Address; data: Hex } {
  switch (action) {
    case 'fund':
      return { to: escrow.token, data: encodeFundEscrowTx(escrow.escrow, escrow.targetAmount) };
    case 'sellerConfirm':
      return { to: escrow.escrow, data: encodeSellerConfirmTx() };
    case 'settle':
      return { to: escrow.escrow, data: encodeSettleTx() };
    case 'refundUnderfunded':
      return { to: escrow.escrow, data: encodeRefundUnderfundedTx() };
    case 'recover':
      return { to: escrow.escrow, data: encodeRecoverLatePaymentTokenTx() };
    case 'mutualSettle':
      return { to: escrow.escrow, data: encodeApproveMutualSettleTx() };
    case 'mutualRefund':
      return { to: escrow.escrow, data: encodeApproveMutualRefundTx() };
    case 'finalize':
      return { to: escrow.escrow, data: encodeFinalizeMutualResolutionTx() };
    case 'sweepExcess':
      return { to: escrow.escrow, data: encodeSweepExcessTx() };
    case 'arbSettle':
      return {
        to: escrow.escrow,
        data: escrow.arbitrationMode === 1 ? encodeArbSettleTx() : encodeArbVoteSettleTx(),
      };
    case 'arbRefund':
      return {
        to: escrow.escrow,
        data: escrow.arbitrationMode === 1 ? encodeArbRefundTx() : encodeArbVoteRefundTx(),
      };
  }
}

function isParty(escrow: EscrowState, address?: string | null): 'buyer' | 'seller' | null {
  if (!address) return null;
  const a = address.toLowerCase();
  if (a === escrow.buyerRefundWallet.toLowerCase()) return 'buyer';
  if (a === escrow.sellerWallet.toLowerCase()) return 'seller';
  return null;
}

function isArbitrator(escrow: EscrowState, address?: string | null): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  return [escrow.arbitrator1, escrow.arbitrator2, escrow.arbitrator3]
    .filter((x) => x && x.toLowerCase() !== ZERO_ADDRESS)
    .some((x) => x.toLowerCase() === a);
}

/**
 * Per-action eligibility derived from on-chain view helpers + connected wallet.
 */
export function checkEligibility(
  escrow: EscrowState,
  action: ShareAction,
  connectedAddress?: string | null,
): EligibilityResult {
  const reasons: string[] = [];
  let eligible = true;

  switch (action) {
    case 'fund': {
      if (escrow.isTerminal) {
        reasons.push('Escrow is already resolved');
        eligible = false;
      } else if (escrow.status !== EscrowStatus.CREATED) {
        reasons.push('Escrow is no longer awaiting funding');
        eligible = false;
      } else if (escrow.isFunded) {
        reasons.push('Escrow is already fully funded');
        eligible = false;
      } else {
        reasons.push(`Send ${formatTokenAmount(escrow.targetAmount, escrow.tokenDecimals)} ${escrow.tokenSymbol} to the escrow`);
      }
      if (connectedAddress) {
        if (connectedAddress.toLowerCase() !== escrow.buyerRefundWallet.toLowerCase()) {
          reasons.push('Only the buyer wallet should fund this escrow');
          eligible = false;
        } else {
          reasons.push('Connected as buyer');
        }
      } else {
        reasons.push('Connect wallet to verify the buyer role');
        eligible = false;
      }
      break;
    }

    case 'sellerConfirm': {
      if (escrow.isActivatable) {
        reasons.push('Escrow is funded and ready to confirm');
      } else {
        eligible = false;
        if (escrow.status !== EscrowStatus.CREATED) reasons.push('Escrow is no longer awaiting confirmation');
        else reasons.push('Escrow is not fully funded yet');
      }
      if (connectedAddress) {
        if (connectedAddress.toLowerCase() !== escrow.sellerWallet.toLowerCase()) {
          reasons.push('Only the seller can confirm');
          eligible = false;
        } else {
          reasons.push('Connected as seller');
        }
      } else {
        reasons.push('Connect wallet to verify the seller role');
        eligible = false;
      }
      break;
    }

    case 'settle':
      if (escrow.isSettleable) reasons.push('Settlement date reached — anyone can release the funds');
      else {
        eligible = false;
        reasons.push('Escrow is not releasable yet (must be funded, no arbitrators, past the settlement date)');
      }
      break;

    case 'refundUnderfunded':
      if (escrow.isRefundableUnderfunded) reasons.push('Escrow was never fully funded by the settlement date — refundable');
      else {
        eligible = false;
        reasons.push('Refund requires an unconfirmed, underfunded escrow past the settlement date');
      }
      break;

    case 'recover':
      if (!escrow.isTerminal) {
        eligible = false;
        reasons.push('Recovery is only available after the escrow is resolved');
      } else if (escrow.balance === BigInt(0)) {
        eligible = false;
        reasons.push('No leftover payment tokens to recover');
      } else {
        reasons.push('Leftover payment tokens can be returned to the buyer');
      }
      break;

    case 'mutualSettle':
    case 'mutualRefund': {
      const party = isParty(escrow, connectedAddress);
      if (escrow.status !== EscrowStatus.CREATED && escrow.status !== EscrowStatus.ACTIVE) {
        reasons.push('Mutual resolution is only available before the escrow is resolved');
        eligible = false;
      }
      if (action === 'mutualSettle' && !escrow.isFunded) {
        reasons.push('Release requires the escrow to be fully funded');
        eligible = false;
      }
      if (!connectedAddress) {
        reasons.push('Connect wallet to verify you are a party');
        eligible = false;
      } else if (!party) {
        reasons.push('Only the buyer or seller can approve a mutual resolution');
        eligible = false;
      } else {
        const approved =
          action === 'mutualSettle'
            ? party === 'buyer'
              ? escrow.mutualSettleApprovedByBuyer
              : escrow.mutualSettleApprovedBySeller
            : party === 'buyer'
              ? escrow.mutualRefundApprovedByBuyer
              : escrow.mutualRefundApprovedBySeller;
        if (approved) {
          reasons.push('You have already approved this — waiting on the other party');
          eligible = false;
        } else {
          reasons.push(`Connected as ${party}`);
        }
      }
      break;
    }

    case 'arbSettle':
    case 'arbRefund': {
      if (escrow.isVotable) reasons.push('Voting is open');
      else {
        reasons.push('Voting is not currently open for this escrow');
        eligible = false;
      }
      if (!connectedAddress) {
        reasons.push('Connect wallet to verify the arbitrator role');
        eligible = false;
      } else if (!isArbitrator(escrow, connectedAddress)) {
        reasons.push('Only an arbitrator can vote');
        eligible = false;
      } else {
        reasons.push('Connected as arbitrator');
      }
      break;
    }

    case 'finalize':
      if (escrow.isFinalizable) reasons.push('Override window passed — anyone can finalize the agreed outcome');
      else {
        eligible = false;
        if (escrow.status !== EscrowStatus.PENDING_MUTUAL_RESOLUTION) reasons.push('No pending mutual resolution');
        else reasons.push('The arbitrator override window is still open');
      }
      break;

    case 'sweepExcess': {
      const hasExcess = escrow.balance > escrow.targetAmount;
      if (escrow.isTerminal) {
        reasons.push('Escrow is resolved — use recover to return leftover payment tokens to the buyer');
        eligible = false;
      } else if (hasExcess) {
        reasons.push('Excess funds above the target can be swept to treasury');
      } else {
        reasons.push('No excess funds to sweep');
        eligible = false;
      }
      break;
    }
  }

  return { eligible, reasons };
}
