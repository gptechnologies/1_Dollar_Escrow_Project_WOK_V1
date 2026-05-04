import { NextRequest, NextResponse } from 'next/server';
import { getPayment, updatePaymentStatus } from '@/lib/base-price-tags/repository';
import { verifyPayment } from '@/lib/base-price-tags/verify';

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

    const payment = await getPayment(paymentId);

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if (payment.status === 'confirmed') {
      return NextResponse.json({ payment });
    }

    const verification = await verifyPayment(payment);

    if (verification.status === 'pending') {
      return NextResponse.json({ payment, verification });
    }

    const updated = await updatePaymentStatus({
      id: payment.id,
      status: verification.status,
      payerAddress: verification.status === 'confirmed' ? verification.payerAddress : null,
      failureReason: verification.status === 'failed' ? verification.reason : null,
    });

    return NextResponse.json({ payment: updated, verification });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm payment';

    console.error('Confirm Base payment error:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

