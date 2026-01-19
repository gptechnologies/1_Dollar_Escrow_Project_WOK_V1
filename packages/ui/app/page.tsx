'use client';

import { useEffect, useState, useRef } from 'react';
import CreateEscrowCard from '@/components/CreateEscrowCard';
import SplineHero from '@/components/SplineHero';
import SessionTimer from '@/components/SessionTimer';
import SessionExpiredToast from '@/components/SessionExpiredToast';
import EscrowDashboard from '@/components/EscrowDashboard';
import InfoAccordion from '@/components/InfoAccordion';
import Image from 'next/image';
import { useSessionStore } from '@/store/useSessionStore';

export default function Home() {
  const { touchSession, sessionId } = useSessionStore();
  const [showExpiredToast, setShowExpiredToast] = useState(false);
  const previousSessionId = useRef(sessionId);

  useEffect(() => {
    // Detect when session ID changes (session reset)
    if (previousSessionId.current !== sessionId) {
      setShowExpiredToast(true);
      previousSessionId.current = sessionId;
    }
  }, [sessionId]);

  useEffect(() => {
    // Reset timer on user interaction
    const handleActivity = () => {
      touchSession();
    };

    // Listen for user activity
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keypress', handleActivity);
    window.addEventListener('click', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keypress', handleActivity);
      window.removeEventListener('click', handleActivity);
    };
  }, [touchSession]);

  return (
    <main className="min-h-screen relative">
      {/* Global Spline Background (fixed, covers entire page) */}
      <SplineHero />

      {/* All foreground content */}
      <div className="relative z-10">
        {/* Session Expired Toast */}
        <SessionExpiredToast 
          show={showExpiredToast} 
          onClose={() => setShowExpiredToast(false)} 
        />
        
        {/* ==================== SECTION 1: Hero ==================== */}
        <section className="relative">
          <div className="relative z-30">
            
            {/* Header */}
            <div className="max-w-7xl mx-auto px-4 pt-6">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Image 
                    src="/Crow Logo Isolated Black.png" 
                    alt="Crow Logo" 
                    width={64} 
                    height={64} 
                  />
                  <div className="relative">
                    <span className="text-2xl font-bold text-white">Crow</span>
                    <span className="absolute left-0 top-full text-xs text-white/60 whitespace-nowrap">The simplest P2P escrow service</span>
                  </div>
                </div>
                <p className="text-sm md:text-base font-medium text-white/80">
                  No sign up required. <span className="text-[#0BB89A]">*Supports USDC or USDT on the ARBITRUM network*</span>
                </p>
                <SessionTimer />
              </div>
            </div>

            {/* Main Content Area */}
            <div className="pt-4 md:pt-8 px-4 max-w-7xl mx-auto">
              <div className="flex flex-col lg:flex-row lg:justify-between lg:items-stretch gap-8">
                
                {/* LEFT: Existing Card (Margins preserved) */}
                <div className="flex-shrink-0">
                  <CreateEscrowCard />
                </div>

                {/* RIGHT: New Side Panel - top info box */}
                <div className="flex-1 max-w-2xl flex flex-col justify-between">
                  
                  {/* 1. Top Info Box - full width on mobile, right-aligned on desktop */}
                  <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-5 w-full lg:w-[320px] lg:ml-auto">
                    <h3 className="text-lg font-semibold text-white mb-2">How It Works</h3>
                    <ul className="space-y-2 text-sm text-white/70">
                      <li className="flex items-start gap-2">
                        <span className="text-[#0BB89A] font-bold">1.</span>
                        <span>FIRST, create an escrow with the instant escrow form. The buyer address is the wallet that will be funding the escrow. The seller address is the wallet that will be paid if successful. This will be given an escrow address and lookup code.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#0BB89A] font-bold">2.</span>
                        <span>NEXT, the seller confirms the escrow by sending $1 to the escrow address or with the Confirm button in the escrow dashboard.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#0BB89A] font-bold">3.</span>
                        <span>AFTER, the escrow is confirmed, fund the escrow before the deadline. Funds are released automatically released to the seller on the deadline.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#0BB89A] font-bold">4.</span>
                        <span>If arbitrators are filled out, they are the only option for resolution or funds will need to be requested from the treasury.</span>
                      </li>
                    </ul>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ==================== SECTION 1.5: Live Escrows ==================== */}
        <section className="px-4 pt-16 pb-12">
          <div className="max-w-6xl mx-auto">
            <EscrowDashboard />
          </div>
        </section>

        {/* ==================== SECTION 2: Information Accordion ==================== */}
        <section className="py-16 px-4">
          <div className="max-w-7xl mx-auto">
            <InfoAccordion
              items={[
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
                  id: 'how-it-works-detailed',
                  title: 'How It Works (Detailed)',
                  content: (
                    <>
                      <p className="mb-4">Expanding on the quick guide:</p>
                      <ol className="space-y-3 list-decimal list-inside">
                        <li>
                          <strong className="text-white">Create Escrow:</strong> The buyer or seller initiates by filling out the form with the amount, token, buyer address, seller address, and payout deadline.
                        </li>
                        <li>
                          <strong className="text-white">Seller Confirmation:</strong> The <em>seller</em> sends exactly $1 USDC to the generated escrow address. This confirms their participation and readiness.
                        </li>
                        <li>
                          <strong className="text-white">Buyer Funding:</strong> The <em>buyer</em> then sends the full escrow amount (e.g., $100 USDC) to the same escrow address.
                        </li>
                        <li>
                          <strong className="text-white">Automatic Release:</strong> Once the payout deadline is reached and both parties have funded (seller $1, buyer full amount), the full escrow amount is automatically sent to the seller's payout address.
                        </li>
                        <li>
                          <strong className="text-white">Dispute Resolution:</strong> <em>Important:</em> Our service does not arbitrate disputes. Users must rely on their own contracts, legal agreements, or law enforcement in case of issues.
                        </li>
                      </ol>
                    </>
                  ),
                },
                {
                  id: 'whitepaper',
                  title: 'Whitepaper: The $1 Escrow Project',
                  content: (
                    <>
                      <p className="mb-4">
                        Dive deeper into the technical architecture, smart contract logic, security principles, and future vision of Temp-Escrow. Our whitepaper outlines how we leverage the Arbitrum network for efficient and secure P2P transactions.
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
                          <h4 className="text-white font-semibold mb-2">Q: What network does Temp-Escrow use?</h4>
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
                          <h4 className="text-white font-semibold mb-2">Q: What happens if there's a dispute?</h4>
                          <p>A: Temp-Escrow does not arbitrate disputes. It's crucial to transact with trusted parties and have separate agreements in place.</p>
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
