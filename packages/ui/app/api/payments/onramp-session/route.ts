import { NextRequest, NextResponse } from 'next/server';
import { createPaymentId } from '@/lib/base-price-tags/code';
import {
  createCoinbaseOnrampSession,
  createPartnerUserRef,
} from '@/lib/base-price-tags/coinbase-onramp';
import { getPriceTag, createPendingOnrampPayment, updateOnrampSession } from '@/lib/base-price-tags/repository';
import { getClientIP } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const code = String((body as Record<string, unknown>).code ?? '');

    if (!code) {
      return NextResponse.json({ error: 'Missing price tag code' }, { status: 400 });
    }

    const priceTag = await getPriceTag(code, new URL(request.url).origin);

    if (!priceTag) {
      return NextResponse.json({ error: 'Price tag not found' }, { status: 404 });
    }

    if (!priceTag.isActive) {
      return NextResponse.json({ error: 'This price tag is inactive' }, { status: 400 });
    }

    const paymentId = createPaymentId();
    const partnerUserRef = createPartnerUserRef(priceTag.code, paymentId);
    const payment = await createPendingOnrampPayment({
      id: paymentId,
      priceTagCode: priceTag.code,
      partnerUserRef,
    });

    const session = await createCoinbaseOnrampSession({
      priceTag,
      paymentId: payment.id,
      partnerUserRef,
      clientIp: getClientIP(request.headers),
      requestOrigin: new URL(request.url).origin,
    });

    const updated = await updateOnrampSession({
      id: payment.id,
      onrampUrl: session.onrampUrl,
      providerStatus: 'session_created',
      providerResponse: session.response,
    });

    return NextResponse.json(
      {
        paymentAttemptId: updated.id,
        onrampUrl: session.onrampUrl,
        payment: updated,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Coinbase Onramp session';
    const status = message.includes('not found') ? 404 : message.includes('required') ? 500 : 400;

    console.error('Create Coinbase Onramp session error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
