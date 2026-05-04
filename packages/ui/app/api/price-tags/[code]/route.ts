import { NextRequest, NextResponse } from 'next/server';
import { getPriceTag } from '@/lib/base-price-tags/repository';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { code } = await context.params;

  try {
    const priceTag = await getPriceTag(code, new URL(request.url).origin);

    if (!priceTag) {
      return NextResponse.json({ error: 'Price tag not found' }, { status: 404 });
    }

    return NextResponse.json({ priceTag });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch price tag';
    const status = message.includes('DATABASE_URL') || message.includes('POSTGRES_URL') ? 500 : 400;

    console.error('Fetch Base price tag error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}

