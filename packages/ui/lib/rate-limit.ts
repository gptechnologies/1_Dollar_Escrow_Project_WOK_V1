/**
 * Rate limiting and idempotency utilities
 * 
 * Uses Redis (Upstash) for distributed rate limiting across serverless instances.
 * Falls back to in-memory for local development if Redis is not configured.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { getRedis, isRedisConfigured } from './redis';

// ============================================================================
// Types
// ============================================================================

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

// ============================================================================
// Rate Limiting (Redis-backed with in-memory fallback)
// ============================================================================

// In-memory fallback for local development
interface InMemoryEntry {
  count: number;
  resetTime: number;
}
const inMemoryRateLimits = new Map<string, InMemoryEntry>();

// Upstash rate limiter (initialized lazily)
let upstashRateLimiter: Ratelimit | null = null;

function getUpstashRateLimiter(): Ratelimit | null {
  if (upstashRateLimiter) {
    return upstashRateLimiter;
  }

  const redis = getRedis();
  if (!redis) {
    return null;
  }

  // Sliding window: 3 requests per 60 seconds
  upstashRateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, '60 s'),
    analytics: true,
    prefix: 'ratelimit:escrow:create',
  });

  return upstashRateLimiter;
}

/**
 * Check rate limit for a given identifier (typically IP address)
 * Uses Redis if configured, otherwise falls back to in-memory
 */
export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  const rateLimiter = getUpstashRateLimiter();

  if (rateLimiter) {
    // Use Redis-backed rate limiter
    const result = await rateLimiter.limit(identifier);
    return {
      success: result.success,
      remaining: result.remaining,
      resetTime: result.reset,
    };
  }

  // Fallback to in-memory (for local dev or if Redis not configured)
  return checkRateLimitInMemory(identifier);
}

function checkRateLimitInMemory(identifier: string): RateLimitResult {
  const now = Date.now();
  const windowMs = 60_000; // 1 minute
  const maxRequests = 3;
  const key = `ratelimit:${identifier}`;
  
  // Cleanup old entries periodically
  if (Math.random() < 0.1) {
    for (const [k, entry] of inMemoryRateLimits.entries()) {
      if (entry.resetTime < now) {
        inMemoryRateLimits.delete(k);
      }
    }
  }

  const entry = inMemoryRateLimits.get(key);

  // No existing entry or window expired
  if (!entry || entry.resetTime < now) {
    const resetTime = now + windowMs;
    inMemoryRateLimits.set(key, { count: 1, resetTime });
    return {
      success: true,
      remaining: maxRequests - 1,
      resetTime,
    };
  }

  // Within window - check count
  if (entry.count >= maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  // Within window and under limit
  entry.count++;
  return {
    success: true,
    remaining: maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

// ============================================================================
// Idempotency (Redis-backed with in-memory fallback)
// ============================================================================

const IDEMPOTENCY_TTL_SECONDS = 300; // 5 minutes

// In-memory fallback
const inMemoryIdempotency = new Map<string, { timestamp: number; response: unknown }>();

/**
 * Check if a request is a duplicate based on its idempotency key
 * Returns the cached response if duplicate, null otherwise
 */
export async function checkIdempotency(key: string): Promise<{ isDuplicate: boolean; cachedResponse?: unknown }> {
  const redis = getRedis();

  if (redis) {
    // Use Redis
    const cached = await redis.get<string>(`idempotency:${key}`);
    if (cached) {
      try {
        const response = JSON.parse(cached);
        return { isDuplicate: true, cachedResponse: response };
      } catch {
        // Invalid JSON, treat as not cached
        return { isDuplicate: false };
      }
    }
    return { isDuplicate: false };
  }

  // Fallback to in-memory
  return checkIdempotencyInMemory(key);
}

function checkIdempotencyInMemory(key: string): { isDuplicate: boolean; cachedResponse?: unknown } {
  const now = Date.now();
  const ttlMs = IDEMPOTENCY_TTL_SECONDS * 1000;

  // Cleanup expired entries
  for (const [k, v] of inMemoryIdempotency.entries()) {
    if (now - v.timestamp > ttlMs) {
      inMemoryIdempotency.delete(k);
    }
  }

  const entry = inMemoryIdempotency.get(key);
  if (entry && now - entry.timestamp < ttlMs) {
    return { isDuplicate: true, cachedResponse: entry.response };
  }

  return { isDuplicate: false };
}

/**
 * Store a response for idempotency caching
 */
export async function storeIdempotencyResponse(key: string, response: unknown): Promise<void> {
  const redis = getRedis();

  if (redis) {
    // Use Redis with TTL
    await redis.set(`idempotency:${key}`, JSON.stringify(response), {
      ex: IDEMPOTENCY_TTL_SECONDS,
    });
    return;
  }

  // Fallback to in-memory
  inMemoryIdempotency.set(key, { timestamp: Date.now(), response });
}

/**
 * Generate an idempotency key from request parameters
 */
export function generateIdempotencyKey(params: {
  payout: string;
  funder: string;
  deadline: number;
}): string {
  // Simple hash using string concatenation
  return `${params.payout.toLowerCase()}-${params.funder.toLowerCase()}-${params.deadline}`;
}

// ============================================================================
// IP Detection
// ============================================================================

/**
 * Get client IP from request headers
 * Handles various proxy headers (Vercel, Cloudflare, etc.)
 */
export function getClientIP(headers: Headers): string {
  // Vercel / generic proxy
  const xForwardedFor = headers.get('x-forwarded-for');
  if (xForwardedFor) {
    // Take the first IP (client IP) from the chain
    return xForwardedFor.split(',')[0].trim();
  }

  // Cloudflare
  const cfConnectingIP = headers.get('cf-connecting-ip');
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  // Vercel specific
  const xRealIP = headers.get('x-real-ip');
  if (xRealIP) {
    return xRealIP;
  }

  // Fallback
  return 'unknown';
}

// ============================================================================
// Status check
// ============================================================================

/**
 * Check if Redis is being used for rate limiting
 */
export function isUsingRedis(): boolean {
  return isRedisConfigured() && getUpstashRateLimiter() !== null;
}
