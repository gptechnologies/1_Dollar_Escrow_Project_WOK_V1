'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Lock,
  Loader2,
  RotateCcw,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Address, Hex } from 'viem';
import { getArbiscanAddressUrl, getArbiscanTxUrl, getChainConfig, type SupportedChainId } from '@/lib/chain';
import { EscrowOutcome, type EscrowActivity, type EscrowState } from '@/lib/chain';
import { ACTION_META, buildActionTx, checkEligibility, getDashboardActions, resolveDashboardAction, type DashboardAction } from '@/lib/escrowActions';
import { buildDashboardActionHref, isShareAction, type ShareAction } from '@/lib/share';
import { buildMetaMaskDeepLink, useWalletConnection } from '@/lib/wallet';
import FieldHelpPopover from './FieldHelpPopover';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type EscrowCardProps = {
  chainId: SupportedChainId;
  chainName?: string;
  escrow: string;
  code?: string;
  status: number;
  statusName?: string;
  sellerWallet: string;
  buyerRefundWallet: string;
  token?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  targetAmount: string | null;
  balance?: string;
  createdAt?: number | null;
  settlementDate?: number | null;
  arbitrator1?: string;
  arbitrator2?: string;
  arbitrator3?: string;
  arbitrationMode?: number; // 0, 1, or 3
  pendingOutcome?: number; // 0 None, 1 Settle, 2 Refund
  settleVotes?: number;
  refundVotes?: number;
  mutualSettleApprovedByBuyer?: boolean;
  mutualSettleApprovedBySeller?: boolean;
  mutualRefundApprovedByBuyer?: boolean;
  mutualRefundApprovedBySeller?: boolean;
  isFunded?: boolean;
  isActivatable?: boolean;
  isSettleable?: boolean;
  isVotable?: boolean;
  isFinalizable?: boolean;
  isRefundableUnderfunded?: boolean;
  isTerminal?: boolean;
  isPartial?: boolean;
  activity?: EscrowActivity[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const MICRO_UNITS = BigInt(1_000_000);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const TOKEN_SYMBOLS: Record<string, string> = {
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
};

const INTENT_ICONS: Record<DashboardAction['intent'], LucideIcon> = {
  fund: CircleDollarSign,
  confirm: ShieldCheck,
  release: Send,
  refund: RotateCcw,
};

const DASHBOARD_HELP = {
  escrowProgress:
    'This shows where the escrow is in the process. Created means it exists. Funded means the buyer has sent the payment. Confirmed means the seller has acknowledged it. Resolved means the money has been released or refunded.',
  actions:
    'Use these buttons to take the next allowed step. The right person, such as the buyer, seller, or arbitrator, can confirm, release, or refund when that action is available.',
  recentActions:
    'This is the activity history for the escrow. It shows actions requested or completed by any party, such as a seller confirming or an arbitrator voting to release or refund.',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

const formatAmount = (value: string | null): string => {
  if (!value) return '—';
  try {
    const amount = BigInt(value);
    const whole = amount / MICRO_UNITS;
    const fraction = amount % MICRO_UNITS;
    const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (fraction === BigInt(0)) return `${wholeStr}.00`;
    const fractionStr = fraction.toString().padStart(6, '0').replace(/0+$/, '').slice(0, 2).padEnd(2, '0');
    return `${wholeStr}.${fractionStr}`;
  } catch {
    return value;
  }
};

const formatDeadline = (value: number | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatActivityTime = (value: number | null | undefined): string => {
  if (!value) return '--:--';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getTokenSymbol = (tokenAddress: string): string =>
  TOKEN_SYMBOLS[tokenAddress.toLowerCase()] || 'USDC';

const isAssignedAddress = (value?: string): value is string =>
  !!value && value !== ZERO_ADDRESS;

const asAddress = (value?: string): Address =>
  (value && isAssignedAddress(value) ? value : ZERO_ADDRESS) as Address;

const asBigInt = (value?: string | null): bigint => {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
};

function buildDashboardEscrowState(props: EscrowCardProps): EscrowState {
  const balance = asBigInt(props.balance);
  return {
    chainId: props.chainId,
    escrow: props.escrow as Address,
    sellerWallet: props.sellerWallet as Address,
    buyerRefundWallet: props.buyerRefundWallet as Address,
    token: asAddress(props.token),
    treasury: ZERO_ADDRESS as Address,
    arbitrator1: asAddress(props.arbitrator1),
    arbitrator2: asAddress(props.arbitrator2),
    arbitrator3: asAddress(props.arbitrator3),
    arbitrationMode: props.arbitrationMode ?? 0,
    targetAmount: asBigInt(props.targetAmount),
    balance,
    settlementDate: props.settlementDate ?? 0,
    createdAt: props.createdAt ?? 0,
    overrideWindowEnd: 0,
    termsHash: '0x',
    status: props.status,
    pendingOutcome: (props.pendingOutcome ?? EscrowOutcome.NONE) as EscrowOutcome,
    settleVotes: props.settleVotes ?? 0,
    refundVotes: props.refundVotes ?? 0,
    isFunded: !!props.isFunded,
    mutualSettleApprovedByBuyer: !!props.mutualSettleApprovedByBuyer,
    mutualSettleApprovedBySeller: !!props.mutualSettleApprovedBySeller,
    mutualRefundApprovedByBuyer: !!props.mutualRefundApprovedByBuyer,
    mutualRefundApprovedBySeller: !!props.mutualRefundApprovedBySeller,
    isTerminal: !!props.isTerminal,
    isActivatable: !!props.isActivatable,
    isRefundableUnderfunded: !!props.isRefundableUnderfunded,
    isSettleable: !!props.isSettleable,
    isVotable: !!props.isVotable,
    isInOverrideWindow: false,
    isFinalizable: !!props.isFinalizable,
    tokenSymbol: props.tokenSymbol ?? (props.token ? getTokenSymbol(props.token) : 'USDC'),
    tokenDecimals: props.tokenDecimals ?? 6,
    escrowTokenBalance: balance,
  };
}

function currentActionUrl(action: ShareAction, escrow: string, code?: string, role?: DashboardAction['role']): string {
  const href = buildDashboardActionHref(action, escrow, code ?? '', role);
  if (typeof window === 'undefined') return href;
  return `${window.location.origin}${href}`;
}

function roleForAction(action: ShareAction): DashboardAction['role'] | undefined {
  if (action === 'fund') return 'buyer';
  if (action === 'sellerConfirm') return 'seller';
  if (action === 'arbSettle' || action === 'arbRefund') return 'arbitrator';
  return undefined;
}

function tileMatchesAction(tile: DashboardAction, action: ShareAction): boolean {
  if (tile.action === action) return true;
  if (tile.intent === 'release') {
    return action === 'settle' || action === 'mutualSettle' || action === 'arbSettle' || action === 'finalize';
  }
  if (tile.intent === 'refund') {
    return action === 'refundUnderfunded' || action === 'mutualRefund' || action === 'arbRefund' || action === 'finalize';
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════════════════════

function DashAddressRow({
  label,
  value,
  copyLabel,
  emptyText = 'Not assigned',
}: {
  label: string;
  value?: string;
  copyLabel: string;
  emptyText?: string;
}) {
  const assigned = isAssignedAddress(value);
  return (
    <span className="rune-dash-address-row rune-surface-inset">
      <b>{label}</b>
      {assigned ? (
        <CopyableField value={value} label={copyLabel} />
      ) : (
        <span className="rune-dash-address-empty">{emptyText}</span>
      )}
    </span>
  );
}

function CopyableField({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      className={`rune-dash-copyable${copied ? ' is-copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied' : value}
      aria-label={label}
    >
      <code>{copied ? 'Copied' : value}</code>
      <span className="sr-only" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
    </button>
  );
}

function ActionTile({
  tile,
  onSelect,
}: {
  tile: DashboardAction;
  onSelect: (tile: DashboardAction) => void;
}) {
  const Icon = tile.enabled ? INTENT_ICONS[tile.intent] : Lock;

  if (!tile.enabled) {
    return (
      <span
        className="rune-dash-action-tile is-disabled"
        role="link"
        aria-disabled="true"
        title={tile.reason}
      >
        <span className="rune-dash-action-icon" aria-hidden><Icon size={22} /></span>
        <span className="rune-dash-action-label">{tile.label}</span>
        <span className="sr-only">{tile.reason}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(tile)}
      className="rune-dash-action-tile"
      title={tile.label}
    >
      <span className="rune-dash-action-icon" aria-hidden><Icon size={22} /></span>
      <span className="rune-dash-action-label">{tile.label}</span>
    </button>
  );
}

function DashboardHeading({
  as = 'h4',
  label,
  help,
}: {
  as?: 'h3' | 'h4';
  label: string;
  help: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      <FieldHelpPopover label={label} description={help} />
    </>
  );

  return as === 'h3' ? (
    <h3 className="rune-dash-heading">{content}</h3>
  ) : (
    <h4 className="rune-dash-heading">{content}</h4>
  );
}

function InlineActionPanel({
  tile,
  escrowState,
  code,
  onClose,
}: {
  tile: DashboardAction;
  escrowState: EscrowState;
  code?: string;
  onClose: () => void;
}) {
  const chainConfig = getChainConfig(escrowState.chainId);
  const wallet = useWalletConnection(escrowState.chainId);
  const resolvedAction = resolveDashboardAction(escrowState, tile, wallet.address);
  const meta = ACTION_META[resolvedAction];
  const eligibility = checkEligibility(escrowState, resolvedAction, wallet.address);
  const tx = buildActionTx(resolvedAction, escrowState);
  const isOnTargetChain = wallet.chainId === escrowState.chainId;
  const canSend = wallet.step === 'ready' && isOnTargetChain && eligibility.eligible;
  const actionUrl = currentActionUrl(resolvedAction, escrowState.escrow, code, roleForAction(resolvedAction));
  const metaMaskUrl = buildMetaMaskDeepLink(actionUrl);

  const execute = async () => {
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    if (!isOnTargetChain) {
      await wallet.switchChain();
      return;
    }
    if (eligibility.eligible) {
      await wallet.sendTransaction(tx.to, tx.data as Hex);
    }
  };

  if (!wallet.hasInjectedWallet) {
    return (
      <section className="rune-dash-inline-action rune-dash-panel" aria-live="polite">
        <div className="rune-dash-inline-head">
          <div>
            <small>{meta.functionName}</small>
            <h4>{meta.title}</h4>
          </div>
          <button type="button" onClick={onClose} aria-label="Close action">Close</button>
        </div>
        <p>{meta.description}</p>
        <a className="rune-dash-inline-primary" href={metaMaskUrl}>
          <Wallet size={16} />
          Open in MetaMask
          <ExternalLink size={14} />
        </a>
      </section>
    );
  }

  return (
    <section className="rune-dash-inline-action rune-dash-panel" aria-live="polite">
      <div className="rune-dash-inline-head">
        <div>
          <small>{meta.functionName}</small>
          <h4>{meta.title}</h4>
        </div>
        <button type="button" onClick={onClose} aria-label="Close action">Close</button>
      </div>

      <p>{meta.description}</p>

      {wallet.address && (
        <div className="rune-dash-inline-wallet rune-surface-inset">
          <span>Wallet</span>
          <code>{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</code>
          <b>{isOnTargetChain ? chainConfig.shortName : 'Wrong network'}</b>
        </div>
      )}

      {wallet.step === 'success' && wallet.txHash ? (
        <div className="rune-dash-inline-result success">
          <CheckCircle size={17} />
          <span>Transaction submitted</span>
          <a href={getArbiscanTxUrl(wallet.txHash, escrowState.chainId)} target="_blank" rel="noopener noreferrer">
            View <ExternalLink size={12} />
          </a>
        </div>
      ) : wallet.step === 'error' ? (
        <div className="rune-dash-inline-result error">
          <AlertCircle size={17} />
          <span>{wallet.error}</span>
          <button type="button" onClick={wallet.reset}>Reset</button>
        </div>
      ) : (
        <>
          <ul className="rune-dash-inline-checks">
            {eligibility.reasons.map((reason) => (
              <li key={reason} className={eligibility.eligible ? 'ok' : ''}>{reason}</li>
            ))}
          </ul>
          <button
            type="button"
            className="rune-dash-inline-primary"
            onClick={execute}
            disabled={wallet.step === 'connecting' || wallet.step === 'switching' || wallet.step === 'signing' || (!!wallet.address && isOnTargetChain && !eligibility.eligible)}
          >
            {wallet.step === 'connecting' || wallet.step === 'switching' || wallet.step === 'signing' ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
            {!wallet.address
              ? 'Connect MetaMask'
              : !isOnTargetChain
                ? `Switch to ${chainConfig.shortName}`
                : canSend
                  ? meta.title
                  : 'Action unavailable'}
          </button>
        </>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function EscrowCard(props: EscrowCardProps) {
  const [selectedAction, setSelectedAction] = useState<DashboardAction | null>(null);
  const [hydratedUrlAction, setHydratedUrlAction] = useState(false);
  const {
    escrow,
    code,
    status,
    sellerWallet,
    buyerRefundWallet,
    token,
    tokenSymbol,
    targetAmount,
    balance,
    createdAt,
    settlementDate,
    arbitrator1,
    arbitrator2,
    arbitrator3,
    arbitrationMode,
    isFunded,
    isPartial,
    activity,
  } = props;

  const displayTokenSymbol = tokenSymbol || (token ? getTokenSymbol(token) : 'USDC');

  const settled = status === 3;
  const refunded = status === 4;
  const resolved = settled || refunded;
  const funded = !!isFunded;

  const arb1Valid = isAssignedAddress(arbitrator1);
  const arbCount = arbitrationMode ?? (arb1Valid ? 1 : 0);

  const addressRows = [
    { label: 'Escrow', value: escrow, copyLabel: 'Copy escrow address' },
    { label: 'Buyer', value: buyerRefundWallet, copyLabel: 'Copy buyer address' },
    { label: 'Seller', value: sellerWallet, copyLabel: 'Copy seller address' },
    { label: 'Arbitrator 1', value: arbitrator1, copyLabel: 'Copy arbitrator 1 address' },
    { label: 'Arbitrator 2', value: arbitrator2, copyLabel: 'Copy arbitrator 2 address' },
    { label: 'Arbitrator 3', value: arbitrator3, copyLabel: 'Copy arbitrator 3 address' },
  ] as const;

  // ── Progress: Created -> Funded -> Confirmed (optional) -> Resolved.
  // Seller confirmation is optional, so a funded escrow can resolve without it.
  type StepState = 'done' | 'active' | '';
  const confirmed = status === 1 || status === 2;
  const steps: { name: string; state: StepState }[] = [
    { name: 'Created', state: 'done' },
    { name: 'Funded', state: funded || confirmed || resolved ? 'done' : 'active' },
    { name: 'Confirmed', state: confirmed || resolved ? 'done' : funded ? 'active' : '' },
    { name: 'Resolved', state: resolved ? 'done' : status === 2 ? 'active' : '' },
  ];

  const actionTiles = getDashboardActions({
    status,
    arbitrationMode: arbCount,
    pendingOutcome: props.pendingOutcome,
    balance,
    isFunded: props.isFunded,
    isTerminal: props.isTerminal,
    isActivatable: props.isActivatable,
    isSettleable: props.isSettleable,
    isVotable: props.isVotable,
    isFinalizable: props.isFinalizable,
    isRefundableUnderfunded: props.isRefundableUnderfunded,
  });

  const escrowState = buildDashboardEscrowState(props);

  useEffect(() => {
    if (hydratedUrlAction || selectedAction || typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const actionParam = params.get('action') ?? undefined;
    const escrowParam = params.get('escrow');
    if (!isShareAction(actionParam)) return;
    if (escrowParam && escrowParam.toLowerCase() !== escrow.toLowerCase()) return;

    const matchingTile = actionTiles.find((tile) => tile.enabled && tileMatchesAction(tile, actionParam));
    if (matchingTile) {
      setSelectedAction(matchingTile);
      setHydratedUrlAction(true);
    }
  }, [actionTiles, escrow, hydratedUrlAction, selectedAction]);

  const recentActions = activity && activity.length > 0
    ? activity
    : [{
        id: 'created-fallback',
        timestamp: createdAt ?? null,
        role: 'Contract',
        tone: 'contract',
        text: 'Executed Function: Created',
      } satisfies EscrowActivity];

  return (
    <div className="rune-dash">
      {/* Header */}
      <div className="rune-dash-header">
        <div className="rune-dash-head-main">
          <div className="rune-dash-head-body">
            <div className="rune-dash-amount">
              <small className="rune-dash-amount-label">Escrow Amount</small>
              <strong>{formatAmount(targetAmount)}</strong>
              <span className="rune-dash-token-chip">
                <CircleDollarSign size={14} />
                {displayTokenSymbol}
              </span>
            </div>
            {balance && (
              <div className="rune-dash-balance">
                Balance <strong>{formatAmount(balance)}</strong> {displayTokenSymbol}
              </div>
            )}
            <div className="rune-dash-deadlines">
              <div className="rune-dash-deadline-item">
                <Clock3 size={14} aria-hidden />
                <div>
                  <small>Settlement Date</small>
                  <time>{formatDeadline(settlementDate)}</time>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="rune-dash-head-side">
          <div className="rune-dash-addresses">
            {addressRows.map((row) => (
              <DashAddressRow
                key={row.label}
                label={row.label}
                value={row.value}
                copyLabel={row.copyLabel}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Progress */}
      <section className="rune-dash-progress">
        <DashboardHeading label="Escrow Progress" help={DASHBOARD_HELP.escrowProgress} />
        <div className="rune-dash-steps">
          {steps.map((step) => (
            <div className={`rune-dash-step ${step.state}`} key={step.name}>
              <b>{step.state === 'done' ? <Check size={13} /> : <i />}</b>
              <span>{step.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Actions + recent on-chain actions */}
      <div className="rune-dash-grid">
        <section className="rune-dash-panel rune-dash-actions-panel">
          <DashboardHeading label="Actions" help={DASHBOARD_HELP.actions} />
          <div className="rune-dash-action-grid">
            {actionTiles.map((tile) => (
              <ActionTile key={tile.intent} tile={tile} onSelect={setSelectedAction} />
            ))}
          </div>
        </section>

        <section className="rune-dash-panel rune-dash-log">
          <DashboardHeading label="Recent Actions" help={DASHBOARD_HELP.recentActions} />
          <div className="rune-dash-log-list">
            {recentActions.map((row) => (
              <div className="rune-dash-log-row" key={row.id}>
                <span className="rune-dash-log-time">[{formatActivityTime(row.timestamp)}]</span>
                <span className={`rune-dash-log-role ${row.tone}`}>{row.role}:</span>
                <span className="rune-dash-log-text">{row.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {selectedAction && (
        <InlineActionPanel
          tile={selectedAction}
          escrowState={escrowState}
          code={code}
          onClose={() => setSelectedAction(null)}
        />
      )}

      {isPartial && (
        <p className="rune-dash-partial">
          Current contract state is live. Recent action history may be limited by the RPC log range.
        </p>
      )}

      <div className="rune-dash-footer">
        <a href={getArbiscanAddressUrl(escrow, props.chainId)} target="_blank" rel="noopener noreferrer">
          View on {props.chainId === 1 ? 'Etherscan' : 'Arbiscan'} <ExternalLink size={13} />
        </a>
        <span>{props.chainName ?? getChainConfig(props.chainId).name}</span>
        <span>{refunded ? 'Refunded to buyer' : settled ? 'Settled to seller' : funded ? 'Funded on-chain' : 'Awaiting funding'}</span>
        {arbCount > 0 && <span className="rune-dash-arbnote">{arbCount === 3 ? '3 arbitrators (2 of 3)' : '1 arbitrator'}</span>}
      </div>
    </div>
  );
}
