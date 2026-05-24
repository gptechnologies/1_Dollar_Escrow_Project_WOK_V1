import { NextRequest, NextResponse } from 'next/server';
import { confirmPaymentAttempt } from '@/lib/base-price-tags/payment-status';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const paymentId = String((body as Record<string, unknown>).paymentId ?? '');

    if (!paymentId) {
      return NextResponse.json({ error: 'Missing payment ID' }, { status: 400 });
    }

    return NextResponse.json(await confirmPaymentAttempt(paymentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm payment';
    const status = message.includes('not found') ? 404 : 400;

    console.error('Confirm Base payment error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
