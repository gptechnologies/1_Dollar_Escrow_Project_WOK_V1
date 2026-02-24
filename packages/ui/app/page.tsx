'use client';

import { Suspense, useState, useEffect } from 'react';
import Image from 'next/image';
import CreateEscrowCard from '@/components/CreateEscrowCard';
import EscrowDashboard from '@/components/EscrowDashboard';
import AcceptPaymentCard from '@/components/AcceptPaymentCard';
import InfoAccordion from '@/components/InfoAccordion';
import { ChevronDown } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

type HomePrefill = {
  amount?: string;
  token?: string;
  funder?: string;
  payout?: string;
  deadlineDate?: string;
  deadlineTime?: string;
};

const TAGLINES = ['No Bank', 'No Middleman', 'Instant Settlement', 'All you need is a wallet'];

function CenterHero() {
  const [visible, setVisible] = useState<number[]>([]);

  useEffect(() => {
    const timers = TAGLINES.map((_, i) =>
      setTimeout(() => setVisible((prev) => [...prev, i]), 600 + i * 500)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-8 min-w-0">
      <Image src="/Crow Logo Isolated Black.png" alt="Crow" width={80} height={80} />
      <h1 className="text-4xl font-bold text-white mt-3">Crow</h1>
      <p className="text-sm text-white/60 mt-1">Instant P2P payments</p>
      <div className="mt-6 space-y-2">
        {TAGLINES.map((line, i) => (
          <p
            key={line}
            className="text-lg font-medium text-[#0BB89A] transition-all duration-700"
            style={{
              opacity: visible.includes(i) ? 1 : 0,
              transform: visible.includes(i) ? 'translateY(0)' : 'translateY(8px)',
            }}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function HomeContent({
  prefillCreate,
  prefillLookup,
}: {
  prefillCreate: HomePrefill;
  prefillLookup: string;
}) {
  return (
    <main className="min-h-screen relative">
      {/* Clouds background (matches TxPageShell) */}
      <div className="fixed inset-0 -z-10 bg-[url('/clouds.png')] bg-cover bg-center bg-no-repeat" />

      {/* All foreground content */}
      <div className="relative z-10">
        {/* ==================== SECTION 1: Hero ==================== */}
        <section className="relative">
          <div className="relative z-30">

            {/* Mobile Hero (< lg) */}
            <div className="lg:hidden">
              <div className="flex flex-col items-center text-center gap-2 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 px-4">
                <p className="text-xs text-white/60">No sign up required</p>
                <div className="flex items-center gap-2">
                  <Image src="/Crow Logo Isolated Black.png" alt="Crow" width={40} height={40} />
                  <h1 className="text-3xl font-bold text-white">Crow</h1>
                </div>
                <p className="text-sm text-white/70">Instant P2P payments</p>
              </div>
              <div className="pt-2 px-4 max-w-7xl mx-auto">
                <div className="flex-shrink-0 mx-auto">
                  <CreateEscrowCard initialValues={prefillCreate} />
                </div>
              </div>
            </div>

            {/* Desktop Layout (>= lg): 3-column */}
            <div className="hidden lg:block pt-6 px-4 max-w-7xl mx-auto">
              <p className="text-sm font-medium text-white/80 text-center mb-6">
                No sign up required. <span className="text-[#0BB89A]">Supports USDC or USDT on the ARBITRUM network</span>
              </p>
              <div className="flex items-start justify-between gap-6">

                {/* LEFT: Create Escrow */}
                <div className="flex-shrink-0">
                  <CreateEscrowCard initialValues={prefillCreate} />
                </div>

                {/* CENTER: Brand Hero */}
                <CenterHero />

                {/* RIGHT: Accept Payment */}
                <div className="flex-shrink-0 flex flex-col items-center gap-3">
                  <AcceptPaymentCard />
                  <a
                    href="#how-it-works"
                    className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
                  >
                    How it works
                    <ChevronDown className="w-4 h-4 animate-bounce" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ==================== SECTION 2: Escrow Lookup ==================== */}
        <section className="px-4 pt-8 md:pt-16 pb-8 md:pb-12">
          <div className="max-w-6xl mx-auto">
            <EscrowDashboard initialQuery={prefillLookup} />
          </div>
        </section>

        {/* ==================== SECTION 2.5: Accept Payment (mobile only) ==================== */}
        <section className="lg:hidden px-4 pb-8 md:pb-12 flex flex-col items-center gap-3">
          <AcceptPaymentCard />
          <a
            href="#how-it-works"
            className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            How it works
            <ChevronDown className="w-4 h-4 animate-bounce" />
          </a>
        </section>

        {/* ==================== SECTION 3: Information Accordion ==================== */}
        <section id="how-it-works" className="py-8 md:py-16 px-4 scroll-mt-8">
          <div className="max-w-7xl mx-auto">
            <InfoAccordion
              items={[
                {
                  id: 'how-it-works',
                  title: 'How it works',
                  content: (
                    <>
                      <h4 className="text-white font-semibold mb-2">Escrow</h4>
                      <ul className="space-y-3 text-sm text-white/70 mb-5">
                        <li className="flex items-start gap-2">
                          <span className="text-[#0BB89A] font-bold">1.</span>
                          <span><strong className="text-white">Create escrow</strong><br />Enter buyer + seller wallets and set a deadline. We generate an escrow address + code.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-[#0BB89A] font-bold">2.</span>
                          <span><strong className="text-white">Confirm (seller)</strong><br />Seller confirms the deal (one click or a $1 confirmation).</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-[#0BB89A] font-bold">3.</span>
                          <span><strong className="text-white">Fund (buyer)</strong><br />Buyer deposits funds before the deadline. On the deadline, funds release automatically.</span>
                        </li>
                      </ul>
                      <p className="text-sm text-white/70 mb-5">Optional: Add an arbitrator for disputes.</p>

                      <h4 className="text-white font-semibold mb-2">Accept Stablecoins</h4>
                      <ul className="space-y-3 text-sm text-white/70">
                        <li className="flex items-start gap-2">
                          <span className="text-[#0BB89A] font-bold">1.</span>
                          <span><strong className="text-white">Create a payment link</strong><br />Enter your wallet address, a price, and an optional description. We generate a QR code and a shareable link.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-[#0BB89A] font-bold">2.</span>
                          <span><strong className="text-white">Share the QR code</strong><br />Use it as a price tag, embed it on your site, or send the link directly. It works like a digital invoice.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-[#0BB89A] font-bold">3.</span>
                          <span><strong className="text-white">Get paid instantly</strong><br />When someone scans the QR with their wallet, the transfer is prefilled with the exact amount. Funds go directly to your wallet -- no middleman, no delays.</span>
                        </li>
                      </ul>
                    </>
                  ),
                },
                {
                  id: 'who-would-use',
                  title: 'Who Would Use This',
                  content: (
                    <>
                      <p className="mb-4">
                        This service is for any person, buyer or seller who needs an escrow service without the complexities of traditional escrow, where both parties agree to use USDC or USDT. If you are looking to make a purchase that requires a down payment, upfront payment, or a deposit, this service is for you.
                      </p>
                      <p className="mb-2">Examples:</p>
                      <ul className="space-y-2 list-disc list-inside">
                        <li>Property Sales: Homes, Vehicles, Land, IP. This service acts just like a pure escrow in a traditional transaction.</li>
                        <li>Direct Person to Person purchasing: No more arguing over whether to pay before the seller ships or vice-versa. This service allows you to prove intent to pay, without sending the money upfront.</li>
                        <li>Put your money on the table: A friendly $10 bet, becomes a $20 escrow where both parties fund half, and an arbitrator (or two) decides the winner.</li>
                      </ul>
                    </>
                  ),
                },
                {
                  id: 'whitepaper',
                  title: 'Whitepaper: The $1 Escrow Project',
                  content: (
                    <>
                      <p className="mb-4">
                        Dive deeper into the technical architecture, smart contract logic, security principles, and future vision of Crow. Our whitepaper outlines how we leverage the Arbitrum network for efficient and secure P2P transactions.
                      </p>
                      <p>
                        <a
                          href="/whitepaper.pdf"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0BB89A] hover:text-[#0BB89A]/80 underline transition-colors"
                        >
                          Download Whitepaper (PDF)
                        </a>
                      </p>
                    </>
                  ),
                },
                {
                  id: 'agents-md',
                  title: 'Agents.MD',
                  content: (
                    <>
                      <p className="mb-4">
                        A programmatic reference for AI agents and developers to interact with the Crow escrow contracts on Arbitrum without the web UI.
                      </p>

                      <h4 className="text-white font-semibold mb-2">Addresses (Arbitrum One, Chain ID 42161)</h4>
                      <ul className="space-y-1 text-sm font-mono mb-4">
                        <li><span className="text-white/50">Factory:</span> <span className="text-white/80">0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9</span></li>
                        <li><span className="text-white/50">USDC:</span> <span className="text-white/80">0xaf88d065e77c8cC2239327C5EDb3A432268e5831</span></li>
                        <li><span className="text-white/50">USDT:</span> <span className="text-white/80">0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9</span></li>
                      </ul>

                      <h4 className="text-white font-semibold mb-2">What You Can Do</h4>
                      <ul className="space-y-1 text-sm list-disc list-inside mb-4">
                        <li><strong className="text-white">Create escrow</strong> &mdash; call <code className="text-[#0BB89A]">createEscrowSimple()</code> on the factory (permissionless)</li>
                        <li><strong className="text-white">Confirm</strong> &mdash; seller calls <code className="text-[#0BB89A]">confirm()</code> within 24h</li>
                        <li><strong className="text-white">Fund</strong> &mdash; buyer sends ERC-20 <code className="text-[#0BB89A]">transfer()</code> to the escrow address</li>
                        <li><strong className="text-white">Finalize</strong> &mdash; anyone calls <code className="text-[#0BB89A]">finalizeAfterDeadline()</code> after the deadline</li>
                        <li><strong className="text-white">Arbitrate</strong> &mdash; arbitrators call <code className="text-[#0BB89A]">arbitratorRelease()</code> or <code className="text-[#0BB89A]">arbitratorRefund()</code></li>
                        <li><strong className="text-white">Mutual actions</strong> &mdash; both parties can agree to early release, refund, deadline extension, or arbitrator swap</li>
                        <li><strong className="text-white">Accept payments</strong> &mdash; create QR-based payment links via the <code className="text-[#0BB89A]">POST /payment/create</code> API</li>
                      </ul>

                      <p className="mb-2">Full reference with ABIs, code examples, lifecycle diagrams, and API endpoints:</p>
                      <p>
                        <a
                          href="https://github.com/gptechnologies/1_Dollar_Escrow_Project_WOK_V1/blob/v2/AGENTS.md"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0BB89A] hover:text-[#0BB89A]/80 underline transition-colors"
                        >
                          View AGENTS.md on GitHub
                        </a>
                      </p>
                    </>
                  ),
                },
                {
                  id: 'faqs',
                  title: 'FAQs',
                  content: (
                    <>
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-white font-semibold mb-2">Q: What network does Crow use?</h4>
                          <p>A: We currently operate exclusively on the Arbitrum network for USDC transactions.</p>
                        </div>
                        <div>
                          <h4 className="text-white font-semibold mb-2">Q: Is there a fee?</h4>
                          <p>A: Yes, a $1 USDC fee is paid by the seller to confirm the escrow. This fee is non-refundable.</p>
                        </div>
                        <div>
                          <h4 className="text-white font-semibold mb-2">Q: Can I use other tokens?</h4>
                          <p>A: Currently, only USDC is supported. We plan to add more tokens in the future.</p>
                        </div>
                        <div>
                          <h4 className="text-white font-semibold mb-2">Q: What happens if there&apos;s a dispute?</h4>
                          <p>A: Crow does not arbitrate disputes. It&apos;s crucial to transact with trusted parties and have separate agreements in place.</p>
                        </div>
                      </div>
                    </>
                  ),
                },
              ]}
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center py-8 text-gray-400 text-sm">
          <p>Powered by Arbitrum</p>
        </footer>
      </div>
    </main>
  );
}

function HomeWithSearchParams() {
  const searchParams = useSearchParams();
  const prefillCreate: HomePrefill = {
    amount: searchParams.get('amount') ?? undefined,
    token: searchParams.get('token') ?? undefined,
    funder: searchParams.get('funder') ?? undefined,
    payout: searchParams.get('payout') ?? undefined,
    deadlineDate: searchParams.get('deadlineDate') ?? undefined,
    deadlineTime: searchParams.get('deadlineTime') ?? undefined,
  };
  const prefillLookup = searchParams.get('code') ?? searchParams.get('escrow') ?? '';

  return <HomeContent prefillCreate={prefillCreate} prefillLookup={prefillLookup} />;
}

export default function Home() {
  return (
    <Suspense fallback={<HomeContent prefillCreate={{}} prefillLookup="" />}>
      <HomeWithSearchParams />
    </Suspense>
  );
}
