import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Finalize Escrow',
  description: 'Open this page to release escrow funds after the deadline.',
  openGraph: {
    title: 'Finalize Escrow | Crow',
    description: 'Release escrow funds after the deadline.',
    url: '/tx/finalize',
    images: ['/og-image.svg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Finalize Escrow | Crow',
    description: 'Release escrow funds after the deadline.',
    images: ['/og-image.svg'],
  },
};

export default function FinalizeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
