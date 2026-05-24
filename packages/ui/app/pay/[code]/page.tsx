import type { Metadata } from 'next';
import BasePayPaymentClient from '@/components/base-price-tags/BasePayPaymentClient';
import { getPriceTag } from '@/lib/base-price-tags/repository';

type PageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ onramp?: string; attempt?: string }>;
};

async function getTagForPage(code: string) {
  return getPriceTag(code);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const priceTag = await getTagForPage(code).catch(() => null);

  if (!priceTag) {
    return {
      title: 'Price Tag Not Found | Crow',
    };
  }

  return {
    title: `Pay ${priceTag.amountDisplay} USDC | Crow`,
    description: `${priceTag.description} - ${priceTag.amountDisplay} USDC on ${priceTag.chainName}`,
  };
}

export default async function BasePriceTagPaymentPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const query = await searchParams;
  const priceTag = await getTagForPage(code).catch(() => null);

  if (!priceTag) {
    return (
      <main className="min-h-screen relative flex items-center justify-center px-4">
        <div className="fixed inset-0 -z-10 bg-[url('/clouds.png')] bg-cover bg-center bg-no-repeat" />
        <div className="surface-card p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-white mb-2">Price Tag Not Found</h1>
          <p className="text-white/60 text-sm">
            The Base USDC price tag <code className="font-mono text-white/80">{code}</code> does
            not exist or is unavailable.
          </p>
        </div>
      </main>
    );
  }

  return (
    <BasePayPaymentClient
      priceTag={priceTag}
      initialOnrampAttemptId={query.onramp === 'return' ? query.attempt : undefined}
    />
  );
}
