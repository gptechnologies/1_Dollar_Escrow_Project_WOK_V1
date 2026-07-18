'use client';

import EscrowCard from './EscrowCard';
import type { EscrowLookupData } from '@/hooks/useEscrowLookup';

const PREVIEW_ESCROW: EscrowLookupData = {
  chainId: 42161,
  chainName: 'Arbitrum One',
  escrow: '0x7f8a4b943a0d12fd7a51f9ddae0832c90b7a8104',
  status: 1,
  statusName: 'Active',
  sellerWallet: '0x91d2aA04478d8AaA4F908808827Dee22C2e9B7e9',
  buyerRefundWallet: '0x8F3ca17c5C22d8d6F79c5Eb0dFF23839b0EaA4b2',
  token: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  tokenSymbol: 'USDC',
  tokenDecimals: 6,
  targetAmount: '2500000000',
  balance: '2500000000',
  createdAt: 1767052740,
  settlementDate: 1769817540,
  arbitrator1: '0x5a7eD9d233dCB97e975b8b3993af8Ee6F44ac1D4',
  arbitrator2: '0x0000000000000000000000000000000000000000',
  arbitrator3: '0x0000000000000000000000000000000000000000',
  arbitrationMode: 1,
  pendingOutcome: 0,
  settleVotes: 0,
  refundVotes: 0,
  isFunded: true,
  isActivatable: false,
  isSettleable: false,
  isVotable: true,
  isFinalizable: false,
  isRefundableUnderfunded: false,
  isTerminal: false,
  activity: [
    { id: 'preview-confirm', timestamp: 1767055940, role: 'Seller', tone: 'seller', text: 'Called Function: Confirm' },
    { id: 'preview-funded', timestamp: 1767055560, role: 'Contract', tone: 'contract', text: 'Executed Function: Set Funded' },
    { id: 'preview-fund', timestamp: 1767055560, role: 'Buyer', tone: 'buyer', text: 'Called Function: Fund Escrow' },
    { id: 'preview-created', timestamp: 1767052740, role: 'Contract', tone: 'contract', text: 'Executed Function: Created' },
  ],
};

type EscrowDashboardProps = {
  className?: string;
  showPreview?: boolean;
  hideInlineSearch?: boolean;
  query: string;
  setQuery: (value: string) => void;
  loading: boolean;
  error: string;
  escrow: EscrowLookupData | null;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

export default function EscrowDashboard({
  className = '',
  showPreview = false,
  hideInlineSearch = false,
  query,
  setQuery,
  loading,
  error,
  escrow,
  onSubmit,
  onKeyDown,
}: EscrowDashboardProps) {
  const cardData = escrow ?? (showPreview && !query.trim() ? PREVIEW_ESCROW : null);

  return (
    <div className={`rune-dashboard-card ${className}`}>
      {!hideInlineSearch && (
        <form onSubmit={onSubmit} className="rune-dash-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Look up by code or escrow address"
            disabled={loading}
          />
        </form>
      )}

      {error && <div className="rune-dash-error">{error}</div>}

      {cardData && (
        <EscrowCard
          chainId={cardData.chainId}
          chainName={cardData.chainName}
          escrow={cardData.escrow}
          code={cardData.code}
          status={cardData.status}
          statusName={cardData.statusName}
          sellerWallet={cardData.sellerWallet}
          buyerRefundWallet={cardData.buyerRefundWallet}
          token={cardData.token}
          tokenSymbol={cardData.tokenSymbol}
          tokenDecimals={cardData.tokenDecimals}
          targetAmount={cardData.targetAmount}
          balance={cardData.balance}
          createdAt={cardData.createdAt}
          settlementDate={cardData.settlementDate}
          arbitrator1={cardData.arbitrator1}
          arbitrator2={cardData.arbitrator2}
          arbitrator3={cardData.arbitrator3}
          arbitrationMode={cardData.arbitrationMode}
          pendingOutcome={cardData.pendingOutcome}
          settleVotes={cardData.settleVotes}
          refundVotes={cardData.refundVotes}
          mutualSettleApprovedByBuyer={cardData.mutualSettleApprovedByBuyer}
          mutualSettleApprovedBySeller={cardData.mutualSettleApprovedBySeller}
          mutualRefundApprovedByBuyer={cardData.mutualRefundApprovedByBuyer}
          mutualRefundApprovedBySeller={cardData.mutualRefundApprovedBySeller}
          isFunded={cardData.isFunded}
          isActivatable={cardData.isActivatable}
          isSettleable={cardData.isSettleable}
          isVotable={cardData.isVotable}
          isFinalizable={cardData.isFinalizable}
          isRefundableUnderfunded={cardData.isRefundableUnderfunded}
          isTerminal={cardData.isTerminal}
          isPartial={cardData.isPartial}
          activity={cardData.activity}
        />
      )}

      {!cardData && !loading && !error && (
        <div className="rune-dash-empty">Enter a lookup code or escrow address to view escrow details</div>
      )}
    </div>
  );
}
