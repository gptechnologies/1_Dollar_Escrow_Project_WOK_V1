import type { Metadata } from 'next';
import { shortenAddress } from '@/lib/chain';
import PaymentPageClient from './client';

type PaymentLink = {
  code: string;
  wallet: string;
  token: string;
  amount: string;
  description: string | null;
  createdAt: string;
};

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 },
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { symbol: 'USDT', decimals: 6 },
};

type PageProps = {
  params: Promise<{ code: string }>;
};

async function fetchPaymentLink(code: string): Promise<PaymentLink | null> {
  const oracleUrl = process.env.ORACLE_API_URL;
  if (!oracleUrl) return null;

  try {
    const res = await fetch(`${oracleUrl}/payment/${code}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const link = await fetchPaymentLink(code);

  if (!link) {
    return { title: 'Payment Not Found | Crow' };
  }

  const tokenInfo = KNOWN_TOKENS[link.token.toLowerCase()] || { symbol: 'TOKEN', decimals: 6 };
  const displayAmount = (Number(link.amount) / 10 ** tokenInfo.decimals).toFixed(2);
  const desc = link.description
    ? `${link.description} — $${displayAmount} ${tokenInfo.symbol}`
    : `Pay $${displayAmount} ${tokenInfo.symbol} on Arbitrum`;

  return {
    title: `Pay ${displayAmount} ${tokenInfo.symbol} | Crow`,
    description: desc,
  };
}

export default async function PaymentPage({ params }: PageProps) {
  const { code } = await params;
  const link = await fetchPaymentLink(code);

  if (!link) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="surface-card p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-white mb-2">Payment Not Found</h1>
          <p className="text-white/60 text-sm">
            The payment link <code className="font-mono text-white/80">{code}</code> does not exist
            or has been removed.
          </p>
        </div>
      </main>
    );
  }

  const tokenInfo = KNOWN_TOKENS[link.token.toLowerCase()] || { symbol: 'TOKEN', decimals: 6 };
  const displayAmount = (Number(link.amount) / 10 ** tokenInfo.decimals).toFixed(2);

  return (
    <PaymentPageClient
      link={link}
      tokenSymbol={tokenInfo.symbol}
      displayAmount={displayAmount}
    />
  );
}
