import type { Metadata } from 'next';
import MyTagsClient from '@/components/base-price-tags/MyTagsClient';
import { getBasePriceTagPublicConfig } from '@/lib/base-price-tags/config';

export const metadata: Metadata = {
  title: 'My Price Tags',
  description: 'View Base USDC price tags that pay to your connected wallet.',
};

export default function MyTagsPage() {
  return <MyTagsClient chain={getBasePriceTagPublicConfig()} />;
}

