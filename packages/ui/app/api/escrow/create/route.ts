import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  getClientIP,
  checkIdempotency,
  storeIdempotencyResponse,
  generateIdempotencyKey,
} from '@/lib/rate-limit';

// Max deadline window: 365 days in seconds
const MAX_DEADLINE_WINDOW_SECONDS = 365 * 24 * 60 * 60;
const MIN_TARGET_AMOUNT = BigInt(1_000_000); // $1 in 6 decimals

/**
 * Validate Ethereum address format
 */
function isValidAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate request body schema and business rules
 */
function validateRequestBody(body: unknown): { valid: true; data: ValidatedBody } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const b = body as Record<string, unknown>;

  // Required fields
  if (!isValidAddress(b.payout)) {
    return { valid: false, error: 'Invalid or missing payout address' };
  }
  if (!isValidAddress(b.funder)) {
    return { valid: false, error: 'Invalid or missing funder address' };
  }
  if (!isValidAddress(b.token)) {
    return { valid: false, error: 'Invalid or missing token address' };
  }

  // targetAmount - must be a positive number string
  if (typeof b.targetAmount !== 'string' || !/^\d+$/.test(b.targetAmount)) {
    return { valid: false, error: 'targetAmount must be a numeric string' };
  }
  const targetAmount = BigInt(b.targetAmount);
  if (targetAmount < MIN_TARGET_AMOUNT) {
    return { valid: false, error: 'Minimum escrow amount is $1' };
  }

  // Single settlement date (unix timestamp)
  if (typeof b.settlementDate !== 'number' || !Number.isInteger(b.settlementDate)) {
    return { valid: false, error: 'settlementDate must be an integer (unix timestamp)' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (b.settlementDate <= now) {
    return { valid: false, error: 'settlementDate must be in the future' };
  }
  if (b.settlementDate > now + MAX_DEADLINE_WINDOW_SECONDS) {
    return { valid: false, error: 'settlementDate cannot be more than 365 days in the future' };
  }

  // payout !== funder
  if (b.payout.toLowerCase() === b.funder.toLowerCase()) {
    return { valid: false, error: 'payout and funder cannot be the same address' };
  }

  // Optional terms hash
  if (b.termsHash !== undefined && (typeof b.termsHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(b.termsHash))) {
    return { valid: false, error: 'Invalid termsHash format' };
  }
  if (b.termsText !== undefined && typeof b.termsText !== 'string') {
    return { valid: false, error: 'termsText must be a string' };
  }

  // Optional arbitrators (0/1/3 enforced by the backend + contract)
  const arbs = [b.arbitrator1, b.arbitrator2, b.arbitrator3];
  for (const arb of arbs) {
    if (arb !== undefined && !isValidAddress(arb)) {
      return { valid: false, error: 'Invalid arbitrator address' };
    }
  }
  const hasArb2 = !!b.arbitrator2;
  const hasArb3 = !!b.arbitrator3;
  if ((hasArb2 || hasArb3) && !(b.arbitrator1 && b.arbitrator2 && b.arbitrator3)) {
    return { valid: false, error: 'Must have 0, 1, or 3 arbitrators (all three required if more than one)' };
  }

  return {
    valid: true,
    data: {
      payout: b.payout as string,
      funder: b.funder as string,
      token: b.token as string,
      targetAmount: b.targetAmount as string,
      settlementDate: b.settlementDate as number,
      termsHash: b.termsHash as string | undefined,
      termsText: b.termsText as string | undefined,
      arbitrator1: b.arbitrator1 as string | undefined,
      arbitrator2: b.arbitrator2 as string | undefined,
      arbitrator3: b.arbitrator3 as string | undefined,
    },
  };
}

interface ValidatedBody {
  payout: string;
  funder: string;
  token: string;
  targetAmount: string;
  settlementDate: number;
  termsHash?: string;
  termsText?: string;
  arbitrator1?: string;
  arbitrator2?: string;
  arbitrator3?: string;
}

/**
 * POST /api/escrow/create
 * Optional proxy to indexer API server-signed creation.
 * Main product flow is wallet-direct creation plus /api/escrow/register.
 */
export async function POST(request: NextRequest) {
  const INDEXER_API_URL = process.env.INDEXER_API_URL || process.env.ORACLE_API_URL;
  const INDEXER_API_KEY = process.env.INDEXER_API_KEY || process.env.ORACLE_API_KEY;

  // Validate server-side config
  if (!INDEXER_API_URL || !INDEXER_API_KEY) {
    console.error('Missing INDEXER_API_URL/INDEXER_API_KEY or ORACLE_API_URL/ORACLE_API_KEY env vars');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  // Step 1: Rate limiting (async - uses Redis when configured)
  const clientIP = getClientIP(request.headers);
  const rateLimitResult = await checkRateLimit(clientIP);

  if (!rateLimitResult.success) {
    const retryAfter = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
    return NextResponse.json(
      { 
        error: 'Too many requests. Please try again later.',
        retryAfter,
      },
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

  // Step 2: Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON in request body' },
      { status: 400 }
    );
  }

  const validation = validateRequestBody(body);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400 }
    );
  }

  const validatedBody = validation.data;

  // Step 3: Idempotency check (async - uses Redis when configured)
  const idempotencyKey = generateIdempotencyKey({
    payout: validatedBody.payout,
    funder: validatedBody.funder,
    deadline: validatedBody.settlementDate,
  });

  const idempotencyCheck = await checkIdempotency(idempotencyKey);
  if (idempotencyCheck.isDuplicate) {
    return NextResponse.json(
      { 
        error: 'Duplicate request detected. This escrow may already be created.',
        cached: true,
        ...(idempotencyCheck.cachedResponse as object),
      },
      { status: 409 }
    );
  }

  // Step 4: Forward to indexer API
  try {
    const indexerResponse = await fetch(`${INDEXER_API_URL}/escrow/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INDEXER_API_KEY}`,
      },
      body: JSON.stringify(validatedBody),
    });

    const data = await indexerResponse.json();

    // Store successful responses for idempotency (async - uses Redis when configured)
    if (indexerResponse.ok) {
      await storeIdempotencyResponse(idempotencyKey, data);
    }

    // Return with rate limit headers
    return NextResponse.json(data, { 
      status: indexerResponse.status,
      headers: {
        'X-RateLimit-Remaining': String(rateLimitResult.remaining),
        'X-RateLimit-Reset': String(rateLimitResult.resetTime),
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach indexer API' },
      { status: 502 }
    );
  }
}
