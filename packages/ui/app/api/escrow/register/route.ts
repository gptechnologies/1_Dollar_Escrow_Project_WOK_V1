import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

/**
 * POST /api/escrow/register
 * Public endpoint (no auth required) that proxies to indexer /escrow/register.
 * Accepts a txHash of a confirmed createEscrowSimple transaction and returns
 * the escrow address and lookup code assigned by the indexer.
 */
export async function POST(request: NextRequest) {
  const INDEXER_API_URL = process.env.INDEXER_API_URL || process.env.ORACLE_API_URL;

  if (!INDEXER_API_URL) {
    console.error('Missing INDEXER_API_URL or ORACLE_API_URL env var');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  // Rate limiting
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

  // Parse and validate
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }

  const { chainId, txHash, termsText } = body as Record<string, unknown>;
  if (chainId !== 1 && chainId !== 42161) {
    return NextResponse.json({ error: 'chainId must be 1 or 42161' }, { status: 400 });
  }
  if (typeof txHash !== 'string' || !TX_HASH_RE.test(txHash)) {
    return NextResponse.json({ error: 'Invalid txHash format' }, { status: 400 });
  }
  if (termsText !== undefined && typeof termsText !== 'string') {
    return NextResponse.json({ error: 'termsText must be a string' }, { status: 400 });
  }

  // Forward to indexer (no auth header - register is public)
  try {
    const indexerResponse = await fetch(`${INDEXER_API_URL}/escrow/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId, txHash, termsText }),
    });

    const data = await indexerResponse.json();

    return NextResponse.json(data, {
      status: indexerResponse.status,
      headers: {
        'X-RateLimit-Remaining': String(rateLimitResult.remaining),
        'X-RateLimit-Reset': String(rateLimitResult.resetTime),
      },
    });
  } catch (error) {
    console.error('Register proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach indexer API' },
      { status: 502 }
    );
  }
}
