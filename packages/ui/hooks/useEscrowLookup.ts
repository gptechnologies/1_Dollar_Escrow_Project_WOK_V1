'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  EscrowStatus,
  TOKEN_INFO,
  type EscrowActivity,
} from '@/lib/chain';

export type EscrowLookupData = {
  chainId: 42161 | 1;
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
  termsHash?: string;
  arbitrator1?: string;
  arbitrator2?: string;
  arbitrator3?: string;
  arbitrationMode?: number;
  pendingOutcome?: number;
  overrideWindowEnd?: number;
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
  isInOverrideWindow?: boolean;
  isTerminal?: boolean;
  isPartial?: boolean;
  activity?: EscrowActivity[];
};

const STATUS_NAMES: Record<number, string> = {
  [EscrowStatus.CREATED]: 'Created',
  [EscrowStatus.ACTIVE]: 'Active',
  [EscrowStatus.PENDING_MUTUAL_RESOLUTION]: 'PendingMutualResolution',
  [EscrowStatus.SETTLED]: 'Settled',
  [EscrowStatus.REFUNDED]: 'Refunded',
};

export function useEscrowLookup(initialQuery = '') {
  const [query, setQuery] = useState(initialQuery);
  const [escrow, setEscrow] = useState<EscrowLookupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isFetching = useRef(false);

  const lookupEscrow = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed || isFetching.current) return;

    isFetching.current = true;
    setLoading(true);
    setError('');
    setEscrow(null);

    try {
      const listResponse = await fetch(`/api/escrow/list?query=${encodeURIComponent(trimmed)}&limit=1`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!listResponse.ok) {
        throw new Error('Escrow lookup failed');
      }

      const listData = await listResponse.json();
      const match = Array.isArray(listData.escrows) ? listData.escrows[0] : null;
      if (!match?.code) {
        setError('No escrow was found for that lookup code or contract address');
        return;
      }

      const statusResponse = await fetch(`/api/escrow/status/${encodeURIComponent(match.code)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!statusResponse.ok) {
        throw new Error('Escrow status lookup failed');
      }

      const state = await statusResponse.json();
      const tokenInfo = state.token ? TOKEN_INFO[String(state.token).toLowerCase()] : undefined;
      setEscrow({
        chainId: Number(state.chainId ?? state.network) as 42161 | 1,
        chainName: state.chainName,
        escrow: state.escrow,
        code: state.code ?? match.code,
        status: Number(state.status),
        statusName: STATUS_NAMES[state.status] || 'Unknown',
        sellerWallet: state.sellerWallet,
        buyerRefundWallet: state.buyerRefundWallet,
        token: state.token,
        tokenSymbol: state.tokenSymbol ?? tokenInfo?.symbol,
        tokenDecimals: state.tokenDecimals ?? tokenInfo?.decimals,
        targetAmount: state.targetAmount?.toString() ?? null,
        balance: state.balance?.toString(),
        createdAt: state.createdAt,
        settlementDate: state.settlementDate,
        termsHash: state.termsHash,
        arbitrator1: state.arbitrator1,
        arbitrator2: state.arbitrator2,
        arbitrator3: state.arbitrator3,
        arbitrationMode: state.arbitrationMode,
        pendingOutcome: state.pendingOutcome,
        overrideWindowEnd: state.overrideWindowEnd,
        settleVotes: state.settleVotes,
        refundVotes: state.refundVotes,
        mutualSettleApprovedByBuyer: state.mutualSettleApprovedByBuyer,
        mutualSettleApprovedBySeller: state.mutualSettleApprovedBySeller,
        mutualRefundApprovedByBuyer: state.mutualRefundApprovedByBuyer,
        mutualRefundApprovedBySeller: state.mutualRefundApprovedBySeller,
        isFunded: state.isFunded,
        isActivatable: state.isActivatable,
        isSettleable: state.isSettleable,
        isVotable: state.isVotable,
        isFinalizable: state.isFinalizable,
        isRefundableUnderfunded: state.isRefundableUnderfunded,
        isInOverrideWindow: state.isInOverrideWindow,
        isTerminal: state.isTerminal,
        isPartial: state.isPartial,
        activity: state.activity,
      });
    } catch (err) {
      console.error('Escrow lookup failed:', err);
      setError('No escrow was found for that lookup code/address, or the indexer request failed');
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  }, []);

  useEffect(() => {
    if (!initialQuery.trim()) return;
    setQuery(initialQuery);
    lookupEscrow(initialQuery);
  }, [initialQuery, lookupEscrow]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookupEscrow(query);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookupEscrow(query);
    }
  };

  return {
    query,
    setQuery,
    escrow,
    loading,
    error,
    lookupEscrow,
    handleSubmit,
    handleKeyDown,
  };
}
