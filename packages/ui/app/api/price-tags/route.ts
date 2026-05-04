import { NextRequest, NextResponse } from 'next/server';
import { displayAmountToRaw, normalizeDisplayAmount } from '@/lib/base-price-tags/amount';
import {
  createPriceTag,
  listPriceTagsByRecipient,
  listRecentPriceTags,
} from '@/lib/base-price-tags/repository';
import { normalizeAddress, normalizeDescription } from '@/lib/base-price-tags/validation';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function getOrigin(request: NextRequest): string {
  return new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request.headers);
  const rateLimitResult = await checkRateLimit(`base-price-tag:${clientIP}`);

  if (!rateLimitResult.success) {
    const retryAfter = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);

    return NextResponse.json(
      { error: 'Too many requests. Please try again later.', retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
        },
      },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const input = body as Record<string, unknown>;
    const amount = typeof input.amount === 'string' ? input.amount : '';
    const amountDisplay = normalizeDisplayAmount(amount);
    const amountRaw = displayAmountToRaw(amountDisplay);
    const recipientAddress = normalizeAddress(String(input.recipientAddress ?? input.wallet ?? ''));
    const description = normalizeDescription(input.description);

    const priceTag = await createPriceTag({
      amountRaw,
      amountDisplay,
      description,
      recipientAddress,
      origin: getOrigin(request),
    });

    return NextResponse.json(
      { priceTag },
      {
        status: 201,
        headers: {
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create price tag';
    const status = message.includes('DATABASE_URL') || message.includes('POSTGRES_URL') ? 500 : 400;

    console.error('Create Base price tag error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 100);
    const recipient = searchParams.get('recipient');
    const priceTags = recipient
      ? await listPriceTagsByRecipient({
          recipientAddress: normalizeAddress(recipient),
          limit,
          origin: getOrigin(request),
        })
      : await listRecentPriceTags(limit, getOrigin(request));

    return NextResponse.json({ priceTags });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list price tags';
    const status = message.includes('DATABASE_URL') || message.includes('POSTGRES_URL') ? 500 : 400;

    console.error('List Base price tags error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
