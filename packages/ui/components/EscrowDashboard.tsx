'use client';

import { useState, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import EscrowCard from './EscrowCard';
import { FACTORY_ADDRESS } from '@/lib/chain';

// Full escrow data from status endpoint (or partial from list)
type EscrowData = {
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
  arbitratorCount?: number;
  // Flag to indicate partial data (from list fallback)
  isPartial?: boolean;
};

export default function EscrowDashboard() {
  const [query, setQuery] = useState('');
  const [escrow, setEscrow] = useState<EscrowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isFetching = useRef(false);

  const lookupEscrow = async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed || isFetching.current) return;

    isFetching.current = true;
    setLoading(true);
    setError('');
    setEscrow(null);

    try {
      // Step 1: Search for escrow by address or code via list endpoint
      const listResponse = await fetch(
        `/api/escrow/list?query=${encodeURIComponent(trimmed)}&limit=1`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const listData = await listResponse.json();

      if (!listResponse.ok) {
        throw new Error(listData?.error || 'Search failed');
      }

      const escrows = listData.escrows || [];
      if (escrows.length === 0) {
        throw new Error('No escrow found for that address or code');
      }

      const listEscrow = escrows[0];

      // Step 2: Try to get full status using the code
      try {
        const statusResponse = await fetch(`/api/escrow/status/${listEscrow.code}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setEscrow(statusData);
          return;
        }
      } catch {
        // Status call failed, fall through to use list data
      }

      // Fallback: Use basic data from list endpoint
      // (older contracts or chain read failures)
      setEscrow({
        escrow: listEscrow.escrow,
        code: listEscrow.code,
        phase: listEscrow.phase,
        phaseName: listEscrow.phaseName,
        deadline: listEscrow.deadline,
        targetAmount: listEscrow.targetAmount,
        payout: listEscrow.payout,
        funder: listEscrow.funder,
        isPartial: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  };

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

  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-5">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">Escrow Lookup</h3>
        <p className="text-xs text-white/60">
          Current Factory Address:{' '}
          <span className="font-mono text-[#0BB89A] break-all">{FACTORY_ADDRESS}</span>
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter escrow address (0x...) or lookup code"
            className="w-full rounded-lg border border-white/20 bg-white/10 py-2.5 pl-9 pr-24 text-sm text-white placeholder:text-white/40 focus:border-[#0BB89A]/70 focus:outline-none focus:ring-2 focus:ring-[#0BB89A]/30"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 text-xs font-semibold text-white bg-[#0BB89A] rounded-md hover:bg-[#0BB89A]/90 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              'Search'
            )}
          </button>
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* Escrow Card */}
      {escrow && (
        <div className="mt-4">
          <EscrowCard
            escrow={escrow.escrow}
            code={escrow.code}
            phase={escrow.phase}
            phaseName={escrow.phaseName}
            deadline={escrow.deadline}
            confirmDeadline={escrow.confirmDeadline}
            targetAmount={escrow.targetAmount}
            token={escrow.token}
            payout={escrow.payout}
            funder={escrow.funder}
            arbitrator1={escrow.arbitrator1}
            arbitrator2={escrow.arbitrator2}
            arbitratorCount={escrow.arbitratorCount}
            isPartial={escrow.isPartial}
          />
        </div>
      )}

      {/* Empty State */}
      {!escrow && !loading && !error && (
        <div className="mt-6 text-center">
          <p className="text-sm text-white/40">
            Enter an escrow address or lookup code to view details
          </p>
        </div>
      )}
    </div>
  );
}
