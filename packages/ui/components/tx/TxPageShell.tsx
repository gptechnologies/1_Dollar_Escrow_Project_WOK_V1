/**
 * TX Page Shell - Shared layout wrapper for transaction pages
 * Provides consistent header, background, and footer across /tx/* routes
 */

'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ReactNode } from 'react';

type TxPageShellProps = {
  children: ReactNode;
  title?: string;
};

const SplineHero = dynamic(() => import('@/components/SplineHero'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 -z-10 bg-[#1a0a2e]" />,
});

export default function TxPageShell({ children, title }: TxPageShellProps) {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <SplineHero />
      <div className="fixed inset-0 -z-10 bg-black/35" />

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="w-full px-4 py-6">
          <div className="max-w-4xl mx-auto">
            <Link href="/" className="inline-flex items-center gap-2 group">
              <div className="relative">
                <span className="text-2xl font-bold text-white">Crow</span>
                <span className="absolute left-0 top-full text-xs text-white/60 whitespace-nowrap">
                  The simplest P2P escrow service
                </span>
              </div>
            </Link>
          </div>
        </header>

        {/* Page Title */}
        {title && (
          <div className="px-4 pt-4">
            <div className="max-w-4xl mx-auto">
              <h1 className="text-xl md:text-2xl font-semibold text-white/90">
                {title}
              </h1>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 px-4 py-8">
          <div className="max-w-4xl mx-auto">
            {children}
          </div>
        </div>

        {/* Footer Warning */}
        <footer className="w-full px-4 py-6 mt-auto">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-start gap-2 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
              <svg 
                className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                />
              </svg>
              <p className="text-sm text-yellow-200/80">
                <strong className="text-yellow-300">Security Notice:</strong> Verify the escrow address and parties before signing. 
                Never sign transactions blindly. Only interact with escrows you created or were invited to.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
