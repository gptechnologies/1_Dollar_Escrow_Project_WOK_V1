'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, Loader2, Copy, ExternalLink, Check, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EscrowCard from './EscrowCard';
import { FACTORY_ADDRESS, getArbiscanAddressUrl } from '@/lib/chain';

// Utility to shorten Ethereum addresses
const shortenAddress = (address: string): string => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};

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
  
  // Factory address modal/bottom sheet state
  const [showFactoryModal, setShowFactoryModal] = useState(false);
  const [factoryCopied, setFactoryCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Copy factory address with toast feedback
  const copyFactoryAddress = async () => {
    try {
      await navigator.clipboard.writeText(FACTORY_ADDRESS);
      setFactoryCopied(true);
      setToastMessage('Copied factory address');
      setTimeout(() => {
        setFactoryCopied(false);
        setToastMessage('');
      }, 2000);
    } catch {
      // Clipboard access denied
    }
  };

  // Close modal on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFactoryModal(false);
    };
    if (showFactoryModal) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [showFactoryModal]);

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
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-5 relative">
      {/* Toast notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#0BB89A] text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg z-50"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">Escrow Lookup</h3>
        {/* Factory Address - shortened on mobile with expand option */}
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] md:text-xs text-white/40">Factory:</span>
          {/* Mobile: short address with expand button */}
          <button
            onClick={() => setShowFactoryModal(true)}
            className="md:hidden flex items-center gap-1 text-[10px] font-mono text-[#0BB89A]/70 hover:text-[#0BB89A] transition-colors"
          >
            {shortenAddress(FACTORY_ADDRESS)}
            <ChevronDown className="w-3 h-3" />
          </button>
          {/* Desktop: full address inline */}
          <span className="hidden md:inline font-mono text-xs text-[#0BB89A]/70 break-all">
            {FACTORY_ADDRESS}
          </span>
          {/* Desktop copy + link buttons */}
          <button
            onClick={copyFactoryAddress}
            className="hidden md:flex p-1 text-white/40 hover:text-white/70 transition-colors"
            title="Copy factory address"
          >
            {factoryCopied ? <Check className="w-3 h-3 text-[#0BB89A]" /> : <Copy className="w-3 h-3" />}
          </button>
          <a
            href={getArbiscanAddressUrl(FACTORY_ADDRESS)}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex p-1 text-white/40 hover:text-white/70 transition-colors"
            title="View on Arbiscan"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Search Form - Mobile: stacked layout, Desktop: inline */}
      <form onSubmit={handleSubmit}>
        {/* Mobile layout */}
        <div className="md:hidden space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter escrow address (0x...) or lookup code"
              className="w-full rounded-lg border border-white/20 bg-white/10 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/40 focus:border-[#0BB89A]/70 focus:outline-none focus:ring-2 focus:ring-[#0BB89A]/30"
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="w-full h-11 text-sm font-semibold text-white bg-[#0BB89A] rounded-lg hover:bg-[#0BB89A]/90 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Search
              </>
            )}
          </button>
        </div>

        {/* Desktop layout */}
        <div className="hidden md:block relative">
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

      {/* Factory Address Bottom Sheet (Mobile only) */}
      <AnimatePresence>
        {showFactoryModal && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFactoryModal(false)}
              className="md:hidden fixed inset-0 bg-black/60 z-40"
            />
            {/* Bottom Sheet */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="md:hidden fixed bottom-0 left-0 right-0 bg-[#1a1a1a] border-t border-white/10 rounded-t-2xl p-5 z-50"
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-semibold text-white">Factory Address</h4>
                <button
                  onClick={() => setShowFactoryModal(false)}
                  className="p-1 text-white/60 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Full address */}
              <div className="bg-white/5 rounded-lg p-3 mb-4">
                <code className="text-xs font-mono text-[#0BB89A] break-all leading-relaxed">
                  {FACTORY_ADDRESS}
                </code>
              </div>
              
              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    copyFactoryAddress();
                    setTimeout(() => setShowFactoryModal(false), 500);
                  }}
                  className="flex-1 h-11 flex items-center justify-center gap-2 text-sm font-medium text-white bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                >
                  {factoryCopied ? <Check className="w-4 h-4 text-[#0BB89A]" /> : <Copy className="w-4 h-4" />}
                  Copy
                </button>
                <a
                  href={getArbiscanAddressUrl(FACTORY_ADDRESS)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-11 flex items-center justify-center gap-2 text-sm font-medium text-white bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Arbiscan
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
