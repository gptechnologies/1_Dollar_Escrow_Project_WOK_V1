import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Confirm Escrow',
  description: 'Open this page to confirm participation in an escrow as the seller.',
  openGraph: {
    title: 'Confirm Escrow | Crow',
    description: 'Confirm participation in escrow as the seller.',
    url: '/tx/confirm',
    images: ['/og-image.svg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Confirm Escrow | Crow',
    description: 'Confirm participation in escrow as the seller.',
    images: ['/og-image.svg'],
  },
};

export default function ConfirmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
