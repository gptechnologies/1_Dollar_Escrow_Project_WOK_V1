import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fund Escrow',
  description: 'Open this page to fund escrow by sending USDC/USDT into the escrow address.',
  openGraph: {
    title: 'Fund Escrow | Crow',
    description: 'Fund escrow by sending USDC/USDT to the escrow address.',
    url: '/tx/fund',
    images: ['/og-image.svg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Fund Escrow | Crow',
    description: 'Fund escrow by sending USDC/USDT to the escrow address.',
    images: ['/og-image.svg'],
  },
};

export default function FundLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
