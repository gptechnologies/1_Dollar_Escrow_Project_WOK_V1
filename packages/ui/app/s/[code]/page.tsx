import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { buildTxHref, resolveAppBaseUrl, type ShareAction, type ShareRole, type WalletTarget } from '@/lib/share';
import { formatTokenAmount, formatTimestamp, shortenAddress } from '@/lib/chain';

type EscrowSummary = {
  escrow: string;
  code: string;
  payout: string;
  funder: string;
  tokenSymbol: string;
  tokenDecimals: number;
  targetAmount: string;
  deadline: number;
};

type SharePageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ action?: string; role?: string; wallet?: string }>;
};

function normalizeAction(action?: string): ShareAction {
  if (action === 'confirm' || action === 'fund' || action === 'finalize') {
    return action;
  }
  return 'confirm';
}

function normalizeRole(action: ShareAction, role?: string): ShareRole | undefined {
  if (role === 'buyer' || role === 'seller') {
    return role;
  }
  if (action === 'confirm') return 'seller';
  if (action === 'fund') return 'buyer';
  return undefined;
}

function normalizeWallet(wallet?: string): WalletTarget | undefined {
  if (wallet === 'metamask' || wallet === 'coinbase') return wallet;
  return undefined;
}

function buildMetaMaskDeepLink(url: string): string {
  const cleanUrl = url.replace(/^https?:\/\//, '');
  return `https://metamask.app.link/dapp/${cleanUrl}`;
}

function buildCoinbaseWalletDeepLink(url: string): string {
  return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`;
}

function getActionCopy(action: ShareAction) {
  if (action === 'confirm') {
    return {
      title: 'Confirm escrow',
      subtitle: 'Seller action',
      cta: 'Confirm as seller',
    };
  }
  if (action === 'fund') {
    return {
      title: 'Fund escrow',
      subtitle: 'Buyer action',
      cta: 'Fund escrow now',
    };
  }
  return {
    title: 'Finalize escrow',
    subtitle: 'Release payout on deadline',
    cta: 'Finalize escrow',
  };
}

async function fetchEscrowSummaryByCode(code: string): Promise<EscrowSummary | null> {
  const ORACLE_API_URL = process.env.ORACLE_API_URL;
  if (!ORACLE_API_URL) return null;

  try {
    const response = await fetch(`${ORACLE_API_URL}/escrow/status/${code}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.escrow || !data?.code) return null;
    return data as EscrowSummary;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: SharePageProps): Promise<Metadata> {
  const { code } = await params;
  const { action: actionParam } = await searchParams;
  const action = normalizeAction(actionParam);
  const copy = getActionCopy(action);
  const summary = await fetchEscrowSummaryByCode(code);

  const tokenLine = summary
    ? `${formatTokenAmount(BigInt(summary.targetAmount), summary.tokenDecimals)} ${summary.tokenSymbol}`
    : 'Escrow action';
  const description = summary
    ? `${copy.subtitle}. ${tokenLine} before ${formatTimestamp(summary.deadline)}.`
    : `${copy.subtitle}. Open Crow to review escrow details and continue.`;

  return {
    title: `${copy.title} | Crow`,
    description,
    openGraph: {
      title: `${copy.title} | Crow`,
      description,
      images: ['/og-image.svg'],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${copy.title} | Crow`,
      description,
      images: ['/og-image.svg'],
    },
  };
}

export default async function ShareLandingPage({ params, searchParams }: SharePageProps) {
  const { code } = await params;
  const { action: actionParam, role: roleParam, wallet: walletParam } = await searchParams;
  const action = normalizeAction(actionParam);
  const role = normalizeRole(action, roleParam);
  const walletTarget = normalizeWallet(walletParam);
  const copy = getActionCopy(action);
  const summary = await fetchEscrowSummaryByCode(code);

  const txPath = summary ? buildTxHref(action, summary.escrow, summary.code, role) : null;

  // Wallet-specific auto-redirect: build absolute tx URL then wrap in wallet deep link
  if (walletTarget && txPath) {
    const baseUrl = resolveAppBaseUrl();
    const fullTxUrl = `${baseUrl}${txPath}`;

    if (walletTarget === 'metamask') {
      redirect(buildMetaMaskDeepLink(fullTxUrl));
    }
    if (walletTarget === 'coinbase') {
      redirect(buildCoinbaseWalletDeepLink(fullTxUrl));
    }
  }

  // Default web flow — show summary with CTA link
  const href = txPath ?? '/';

  return (
    <main className="min-h-screen bg-[#0d0618] text-white px-4 py-16">
      <div className="max-w-xl mx-auto">
        <div className="surface-card p-6">
          <p className="text-xs uppercase tracking-wide text-white/50 mb-2">{copy.subtitle}</p>
          <h1 className="text-2xl font-semibold mb-3">{copy.title}</h1>

          {summary ? (
            <div className="space-y-2 text-sm text-white/75 mb-5">
              <p>
                Escrow amount:{' '}
                <span className="text-white font-medium">
                  {formatTokenAmount(BigInt(summary.targetAmount), summary.tokenDecimals)} {summary.tokenSymbol}
                </span>
              </p>
              <p>Deadline: <span className="text-white">{formatTimestamp(summary.deadline)}</span></p>
              <p>Buyer: <span className="font-mono text-xs text-white/80">{shortenAddress(summary.funder)}</span></p>
              <p>Seller: <span className="font-mono text-xs text-white/80">{shortenAddress(summary.payout)}</span></p>
              <p>Code: <span className="font-mono text-xs text-white/90">{summary.code}</span></p>
            </div>
          ) : (
            <p className="text-sm text-white/70 mb-5">
              We couldn&apos;t fetch escrow details from this code right now. You can still open Crow and verify before signing.
            </p>
          )}

          <Link
            href={href}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0BB89A] text-white font-semibold hover:bg-[#0BB89A]/90 active:scale-[0.99] transition-all"
          >
            {copy.cta}
            <ArrowRight className="w-4 h-4" />
          </Link>

          <div className="mt-4 flex items-start gap-2 text-xs text-white/50">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-[#0BB89A]" />
            Always verify the lookup code, buyer/seller wallets, and token amount before signing.
          </div>
        </div>
      </div>
    </main>
  );
}
