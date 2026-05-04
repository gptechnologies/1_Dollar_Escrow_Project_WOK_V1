import { NextRequest, NextResponse } from 'next/server';
import { createPendingPayment, listPaymentsByRecipient } from '@/lib/base-price-tags/repository';
import { assertTxHash, normalizeAddress } from '@/lib/base-price-tags/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const input = body as Record<string, unknown>;
    const priceTagCode = String(input.priceTagCode ?? '');
    const txHash = assertTxHash(input.txHash);

    if (!priceTagCode) {
      return NextResponse.json({ error: 'Missing price tag code' }, { status: 400 });
    }

    const payment = await createPendingPayment({ priceTagCode, txHash });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create payment';
    const status = message.includes('not found') ? 404 : 400;

    console.error('Create Base payment error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 100);
    const recipient = searchParams.get('recipient');

    if (!recipient) {
      return NextResponse.json({ error: 'Missing recipient address' }, { status: 400 });
    }

    const payments = await listPaymentsByRecipient({
      recipientAddress: normalizeAddress(recipient),
      limit,
    });

    return NextResponse.json({ payments });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list payments';

    console.error('List Base payments error:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
