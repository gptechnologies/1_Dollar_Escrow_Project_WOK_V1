'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, LockKeyhole, ShieldCheck } from 'lucide-react';
import CreateEscrowCard from '@/components/CreateEscrowCard';
import EscrowDashboard from '@/components/EscrowDashboard';
import EscrowLookupBar from '@/components/EscrowLookupBar';
import FieldHelpPopover from '@/components/FieldHelpPopover';
import PhaseCarousel from '@/components/home/PhaseCarousel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useEscrowLookup } from '@/hooks/useEscrowLookup';
import { ARBITRUM_CHAIN_ID, CHAIN_CONFIGS, type SupportedChainId } from '@/lib/chain';

const LIVE_DASHBOARD_HELP =
  'Use this dashboard to watch the escrow, check the details, and complete the whole process. Funding, confirmation, release, refunds, and dispute actions can all be handled here.';

function AppHeader() {
  return <header className="rune-site-header" id="top">
    <Link href="/" className="rune-brand rune-header-chip rune-docs-action">
      <Image src="/Crow Logo Isoloated White.png" alt="" width={40} height={40} priority />
      <span>Crow</span>
    </Link>
    <a href="#guide" className="rune-docs-action rune-header-nav-action">How it works</a>
    <div className="rune-header-actions">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="rune-docs-action">Whitepaper</button>
        </PopoverTrigger>
        <PopoverContent className="rune-whitepaper-popover" align="end" sideOffset={10}>
          <h3>The $1 Escrow Project</h3>
          <p>
            Using blockchain and smart contract technology we can perform a traditional escrow
            service without a centralized 3rd party to hold funds, at a fraction of the cost.
          </p>
          <p>
            Crow is a non-custodial, P2P escrow protocol built on Arbitrum and Ethereum. Every escrow is its
            own immutable smart contract with all logic and rules for the escrow defined at
            creation. No outside party, not even Crow, can confirm, modify, refund, or freeze an
            escrow once it is deployed on chain.
          </p>
          <p>
            Crow never holds or touches your funds. Funds are sent directly to the escrow
            contract, and every action is a separate transaction signed by an authorized wallet.
            {' '}<strong>Crow never requests token spending approvals or ongoing wallet permissions.</strong>
          </p>
          <p>Every escrow has only two possible outcomes:</p>
          <ul>
            <li>The seller is paid.</li>
            <li>The buyer is refunded.</li>
          </ul>
          <p>The outcome is determined entirely by the arbitration method chosen at creation.</p>
          <ul>
            <li>
              <strong>No Arbitrators:</strong> After the settlement deadline, anyone can settle
              the escrow and funds are released to the seller. This is essentially a wire
              transfer with a delay.
            </li>
            <li>
              <strong>One Arbitrator:</strong> The designated arbitrator votes to release or
              refund the escrow. This is a pure escrow.
            </li>
            <li>
              <strong>Three Arbitrators:</strong> A 2 out of 3 vote is required by any of the
              arbitrators before funds are released or refunded. This is a more complex, pure
              escrow.
            </li>
          </ul>
          <p>
            Crow charges a <strong>1% settlement fee, capped at $1 USDC</strong>, paid only on
            successful escrows. The fee is taken automatically from the seller upon release.
            Refunds are free.
          </p>
          <p>Every escrow, balance, vote, and transaction is publicly verifiable on-chain.</p>
        </PopoverContent>
      </Popover>
    </div>
  </header>;
}

export default function EscrowLanding() {
  const lookup = useEscrowLookup();
  const [selectedChainId, setSelectedChainId] = useState<SupportedChainId>(ARBITRUM_CHAIN_ID);
  const { setQuery, lookupEscrow } = lookup;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialLookup = params.get('q') || params.get('code') || params.get('escrow');
    if (!initialLookup) return;
    setQuery(initialLookup);
    lookupEscrow(initialLookup);
  }, [setQuery, lookupEscrow]);

  return <main className="rune-app-shell">
    <AppHeader />

    <section className="rune-hero rune-escrow-duo" aria-labelledby="rune-heading">
      <div className="rune-title-stack">
        <h1 id="rune-heading">Decentralized P2P escrow</h1>
        <p className="rune-hero-tagline" aria-label="Non Custodial. Trustless. No Wallet Approvals. No Sign Up">
          <span>Non Custodial. Trustless. No Wallet Approvals. No Sign Up</span>
        </p>
      </div>

      <section className="rune-create-panel" id="create" aria-label="Create new escrow">
        <div className="rune-panel-head">
          <h2>Create new escrow</h2>
          <label className="rune-chain-select">
            <LockKeyhole size={14} aria-hidden />
            <span className="sr-only">Escrow network</span>
            <span className="rune-chain-select-value" aria-hidden>
              {CHAIN_CONFIGS[selectedChainId].name}
            </span>
            <select
              value={selectedChainId}
              onChange={(event) => setSelectedChainId(Number(event.target.value) as SupportedChainId)}
              aria-label="Escrow network"
            >
              {[CHAIN_CONFIGS[ARBITRUM_CHAIN_ID], CHAIN_CONFIGS[1]].map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>{chain.name}</option>
              ))}
            </select>
            <ChevronDown size={13} aria-hidden />
          </label>
        </div>
        <CreateEscrowCard className="w-full" chainId={selectedChainId} />
        <p className="rune-funds-note"><ShieldCheck size={15} /> Funds are never held by Crow. Escrows run on smart contracts.</p>
      </section>

      <div id="dashboard" className="rune-dashboard-panel" aria-label="Live escrow dashboard">
        <div className="rune-panel-head rune-dashboard-head">
          <div>
            <h2 className="rune-dashboard-title-with-help">
              <i /> Live dashboard
              <FieldHelpPopover label="Live dashboard" description={LIVE_DASHBOARD_HELP} />
            </h2>
            <p>Updates in real time</p>
          </div>
          <EscrowLookupBar
            query={lookup.query}
            setQuery={lookup.setQuery}
            loading={lookup.loading}
            onSubmit={lookup.handleSubmit}
            onKeyDown={lookup.handleKeyDown}
          />
        </div>
        <EscrowDashboard
          className="w-full"
          showPreview
          hideInlineSearch
          query={lookup.query}
          setQuery={lookup.setQuery}
          loading={lookup.loading}
          error={lookup.error}
          escrow={lookup.escrow}
          onSubmit={lookup.handleSubmit}
          onKeyDown={lookup.handleKeyDown}
        />
      </div>
    </section>

    <section id="guide" className="rune-main-section rune-phase-section" aria-labelledby="phase-heading">
      <div className="rune-phase-section-head">
        <h2 id="phase-heading">How every escrow resolves</h2>
        <p>Four lifecycle phases, one settlement date, and explicit wallet permissions.</p>
      </div>
      <PhaseCarousel />
    </section>
    <footer id="compare" className="rune-footer"><span>© 2026 Crow. All rights reserved.</span><span id="pricing">Peer-to-peer escrow on Arbitrum and Ethereum</span><a href="#top">Return to top</a></footer>
  </main>;
}
