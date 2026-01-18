/**
 * Redis client for serverless environments (Vercel, etc.)
 * Uses Upstash Redis which is HTTP-based and works without connection pooling
 */

import { Redis } from '@upstash/redis';

// Singleton Redis client
let redisClient: Redis | null = null;

/**
 * Get the Redis client instance
 * Returns null if Redis is not configured (falls back to in-memory)
 */
export function getRedis(): Redis | null {
  if (redisClient) {
    return redisClient;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      '⚠️ Redis not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing). ' +
      'Rate limiting will fall back to in-memory (not recommended for production).'
    );
    return null;
  }

  try {
    redisClient = new Redis({
      url,
      token,
    });
    return redisClient;
  } catch (error) {
    console.error('❌ Failed to initialize Redis client:', error);
    return null;
  }
}

/**
 * Check if Redis is available
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
