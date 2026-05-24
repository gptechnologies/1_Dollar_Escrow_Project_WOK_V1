import { NextResponse } from 'next/server';
import { confirmPaymentAttempt } from '@/lib/base-price-tags/payment-status';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    return NextResponse.json(await confirmPaymentAttempt(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm payment';
    const status = message.includes('not found') ? 404 : 400;

    console.error('Payment status error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
