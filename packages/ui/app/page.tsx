'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import CreateEscrowCard from '@/components/CreateEscrowCard';
import EscrowDashboard from '@/components/EscrowDashboard';
import AcceptPaymentCard from '@/components/AcceptPaymentCard';
import InfoAccordion from '@/components/InfoAccordion';
import { useSearchParams } from 'next/navigation';

const SplineHero = dynamic(() => import('@/components/SplineHero'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-[url('/clouds.png')] bg-cover bg-center bg-no-repeat z-0" />
  ),
});

type HomePrefill = {
  amount?: string;
  token?: string;
  funder?: string;
  payout?: string;
  deadlineDate?: string;
  deadlineTime?: string;
};

function HomeContent({
  prefillCreate,
  prefillLookup,
}: {
  prefillCreate: HomePrefill;
  prefillLookup: string;
}) {
  return (
    <main className="min-h-screen relative">
      {/* Global Spline Background (fixed, covers entire page) */}
      <SplineHero />

      {/* All foreground content */}
      <div className="relative z-10">
        {/* ==================== SECTION 1: Hero ==================== */}
        <section className="relative">
          <div className="relative z-30">
            
            {/* Header - Mobile: simplified 3-line hero, Desktop: original layout */}
            <div className="max-w-7xl mx-auto px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] md:pt-6">
              {/* Mobile Hero (< md) */}
              <div className="md:hidden flex flex-col items-center text-center gap-2 pb-4">
                <p className="text-xs text-white/60">No sign up required</p>
                <h1 className="text-3xl font-bold text-white">Crow</h1>
                <p className="text-sm text-white/70">
                  Instant escrow for <span className="text-[#0BB89A]">USDC/USDT</span> on Arbitrum
                </p>
              </div>

              {/* Desktop Hero (>= md) */}
              <div className="hidden md:flex justify-between items-center">
                <div className="relative">
                  <span className="text-2xl font-bold text-white">Crow</span>
                  <span className="absolute left-0 top-full text-xs text-white/60 whitespace-nowrap">The simplest P2P escrow service</span>
                </div>
                <p className="text-sm md:text-base font-medium text-white/80 text-center flex-1">
                  No sign up required. <span className="text-[#0BB89A]">*Supports USDC or USDT on the ARBITRUM network*</span>
                </p>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="pt-4 md:pt-8 px-4 max-w-7xl mx-auto">
              <div className="flex flex-col lg:flex-row lg:justify-between lg:items-stretch gap-8">
                
                {/* LEFT: Existing Card (Margins preserved) */}
                <div className="flex-shrink-0 mx-auto md:mx-0">
                  <CreateEscrowCard initialValues={prefillCreate} />
                </div>

                {/* RIGHT: How It Works + Accept Payment - hidden on mobile, shown on desktop */}
                <div className="hidden lg:flex flex-1 max-w-2xl flex-col gap-6">
                  
                  {/* Top Info Box - right-aligned on desktop */}
                  <div className="surface-card p-5 w-[320px] ml-auto">
                    <h3 className="text-lg font-semibold text-white mb-2">How it works</h3>
                    <ul className="space-y-2 text-sm text-white/70">
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
                    <p className="mt-3 text-sm text-white/70">Optional: Add an arbitrator for disputes.</p>
                  </div>

                  {/* Accept Payment Card - right-aligned below How it works */}
                  <div className="ml-auto">
                    <AcceptPaymentCard />
                  </div>

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
        <section className="lg:hidden px-4 pb-8 md:pb-12 flex justify-center">
          <AcceptPaymentCard />
        </section>

        {/* ==================== SECTION 3: Information Accordion ==================== */}
        <section className="py-8 md:py-16 px-4">
          <div className="max-w-7xl mx-auto">
            <InfoAccordion
              items={[
                {
                  id: 'how-it-works',
                  title: 'How it works',
                  mobileOnly: true,
                  content: (
                    <>
                      <ul className="space-y-3 text-sm text-white/70">
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
                      <p className="mt-3 text-sm text-white/70">Optional: Add an arbitrator for disputes.</p>
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
                  id: 'roadmap',
                  title: 'Roadmap',
                  content: (
                    <>
                      <p className="mb-2">We have two goals:</p>
                      <ol className="space-y-2 list-decimal list-inside mb-4">
                        <li>Our first goal is to find out what our users like, and expand on that.</li>
                        <li>Our last goal is to find out what our users do not like, and remove as much of that as possible.</li>
                      </ol>
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
