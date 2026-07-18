'use client';

import { Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

type EscrowLookupBarProps = {
  query: string;
  setQuery: (value: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

export default function EscrowLookupBar({
  query,
  setQuery,
  loading,
  onSubmit,
  onKeyDown,
}: EscrowLookupBarProps) {
  return (
    <form onSubmit={onSubmit} className="rune-dash-head-search">
      <Search size={15} aria-hidden className="rune-dash-head-search-icon" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search escrow address"
        disabled={loading}
        className="rune-dash-head-search-input"
        aria-label="Search escrow address"
      />
      {loading && <Loader2 size={14} className="rune-dash-head-search-spinner animate-spin" aria-hidden />}
    </form>
  );
}
