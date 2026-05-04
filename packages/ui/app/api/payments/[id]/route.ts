import { NextResponse } from 'next/server';
import { getPayment } from '@/lib/base-price-tags/repository';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const payment = await getPayment(id);

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    return NextResponse.json({ payment });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch payment';

    console.error('Fetch Base payment error:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

