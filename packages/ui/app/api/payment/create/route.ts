import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const INT_RE = /^\d+$/;

/**
 * POST /api/payment/create
 * Public proxy to oracle POST /payment/create.
 * Creates a payment link and returns the generated code.
 */
export async function POST(request: NextRequest) {
  const ORACLE_API_URL = process.env.ORACLE_API_URL;

  if (!ORACLE_API_URL) {
    console.error('Missing ORACLE_API_URL env var');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  const clientIP = getClientIP(request.headers);
  const rateLimitResult = await checkRateLimit(clientIP);

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
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }

  const { wallet, token, amount, description } = body as Record<string, unknown>;

  if (typeof wallet !== 'string' || !ETH_ADDRESS_RE.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }
  if (typeof token !== 'string' || !ETH_ADDRESS_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
  }
  if (typeof amount !== 'string' || !INT_RE.test(amount)) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return NextResponse.json({ error: 'Description must be a string' }, { status: 400 });
  }

  try {
    const oracleResponse = await fetch(`${ORACLE_API_URL}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, token, amount, description }),
    });

    const data = await oracleResponse.json();

    return NextResponse.json(data, {
      status: oracleResponse.status,
      headers: {
        'X-RateLimit-Remaining': String(rateLimitResult.remaining),
        'X-RateLimit-Reset': String(rateLimitResult.resetTime),
      },
    });
  } catch (error) {
    console.error('Payment create proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach oracle API' },
      { status: 502 }
    );
  }
}
