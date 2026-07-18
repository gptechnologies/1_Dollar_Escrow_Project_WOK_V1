import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Escrow Action',
  description: 'Review and sign an escrow transaction on Arbitrum.',
  openGraph: {
    title: 'Escrow Action | Crow',
    description: 'Review and sign an escrow transaction on Arbitrum.',
    url: '/tx/action',
    images: ['/og-image.svg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Escrow Action | Crow',
    description: 'Review and sign an escrow transaction on Arbitrum.',
    images: ['/og-image.svg'],
  },
};

export default function ActionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
