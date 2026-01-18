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
  if (targetAmount <= BigInt(0)) {
    return { valid: false, error: 'targetAmount must be positive' };
  }

  // deadline - must be a number (unix timestamp)
  if (typeof b.deadline !== 'number' || !Number.isInteger(b.deadline)) {
    return { valid: false, error: 'deadline must be an integer (unix timestamp)' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (b.deadline <= now) {
    return { valid: false, error: 'deadline must be in the future' };
  }
  if (b.deadline > now + MAX_DEADLINE_WINDOW_SECONDS) {
    return { valid: false, error: 'deadline cannot be more than 365 days in the future' };
  }

  // payout !== funder
  if (b.payout.toLowerCase() === b.funder.toLowerCase()) {
    return { valid: false, error: 'payout and funder cannot be the same address' };
  }

  // Optional arbitrators
  if (b.arbitrator1 !== undefined && !isValidAddress(b.arbitrator1)) {
    return { valid: false, error: 'Invalid arbitrator1 address' };
  }
  if (b.arbitrator2 !== undefined && !isValidAddress(b.arbitrator2)) {
    return { valid: false, error: 'Invalid arbitrator2 address' };
  }
  if (b.arbitrator2 && !b.arbitrator1) {
    return { valid: false, error: 'arbitrator1 is required when arbitrator2 is set' };
  }

  return {
    valid: true,
    data: {
      payout: b.payout as string,
      funder: b.funder as string,
      token: b.token as string,
      targetAmount: b.targetAmount as string,
      deadline: b.deadline as number,
      arbitrator1: b.arbitrator1 as string | undefined,
      arbitrator2: b.arbitrator2 as string | undefined,
    },
  };
}

interface ValidatedBody {
  payout: string;
  funder: string;
  token: string;
  targetAmount: string;
  deadline: number;
  arbitrator1?: string;
  arbitrator2?: string;
}

/**
 * POST /api/escrow/create
 * Proxy to oracle API with rate limiting, validation, and idempotency
 */
export async function POST(request: NextRequest) {
  const ORACLE_API_URL = process.env.ORACLE_API_URL;
  const ORACLE_API_KEY = process.env.ORACLE_API_KEY;

  // Validate server-side config
  if (!ORACLE_API_URL || !ORACLE_API_KEY) {
    console.error('Missing ORACLE_API_URL or ORACLE_API_KEY env vars');
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
    deadline: validatedBody.deadline,
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

  // Step 4: Forward to oracle API
  try {
    const oracleResponse = await fetch(`${ORACLE_API_URL}/escrow/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ORACLE_API_KEY}`,
      },
      body: JSON.stringify(validatedBody),
    });

    const data = await oracleResponse.json();

    // Store successful responses for idempotency (async - uses Redis when configured)
    if (oracleResponse.ok) {
      await storeIdempotencyResponse(idempotencyKey, data);
    }

    // Return with rate limit headers
    return NextResponse.json(data, { 
      status: oracleResponse.status,
      headers: {
        'X-RateLimit-Remaining': String(rateLimitResult.remaining),
        'X-RateLimit-Reset': String(rateLimitResult.resetTime),
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach oracle API' },
      { status: 502 }
    );
  }
}
