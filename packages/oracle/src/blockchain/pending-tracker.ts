/**
 * Pending Transaction Tracker
 * 
 * Tracks pending transactions in Redis to enable:
 * - Speed-up logic for stuck transactions
 * - Recovery after oracle restarts
 * - Backlog monitoring
 */

import { redisConnection } from "../watcher/queue.js";
import { ENV } from "../config/env.js";

// ============================================================================
// Types
// ============================================================================

export interface PendingTx {
  txHash: string;
  gasPrice: string; // Store as string for bigint compatibility
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  submittedAt: number; // Unix timestamp ms
  method: string;
  nonce: number;
  attempt: number; // Speed-up attempt number
}

// ============================================================================
// Redis Key Management
// ============================================================================

const PENDING_KEY = `pending:oracle:${ENV.CHAIN_ID}`;
const NONCE_KEY = `nonce:oracle:${ENV.CHAIN_ID}`;

// ============================================================================
// Pending TX Operations
// ============================================================================

/**
 * Track a pending transaction
 */
export async function trackPending(
  nonce: number,
  tx: Omit<PendingTx, "nonce">
): Promise<void> {
  const data: PendingTx = { ...tx, nonce };
  await redisConnection.hset(
    PENDING_KEY,
    nonce.toString(),
    JSON.stringify(data)
  );
  console.log(`📝 Tracked pending TX: nonce=${nonce}, txHash=${tx.txHash}`);
}

/**
 * Remove a pending transaction (after confirmation or replacement)
 */
export async function removePending(nonce: number): Promise<void> {
  await redisConnection.hdel(PENDING_KEY, nonce.toString());
  console.log(`🗑️ Removed pending TX: nonce=${nonce}`);
}

/**
 * Get a specific pending transaction
 */
export async function getPending(nonce: number): Promise<PendingTx | null> {
  const data = await redisConnection.hget(PENDING_KEY, nonce.toString());
  if (!data) return null;
  return JSON.parse(data) as PendingTx;
}

/**
 * Get all pending transactions
 */
export async function getAllPending(): Promise<PendingTx[]> {
  const data = await redisConnection.hgetall(PENDING_KEY);
  if (!data) return [];

  return Object.values(data).map((v) => JSON.parse(v) as PendingTx);
}

/**
 * Get pending transactions older than a threshold
 */
export async function getStuckTxs(olderThanMs: number): Promise<PendingTx[]> {
  const all = await getAllPending();
  const cutoff = Date.now() - olderThanMs;
  return all.filter((tx) => tx.submittedAt < cutoff);
}

/**
 * Get the number of pending transactions
 */
export async function getBacklogSize(): Promise<number> {
  const count = await redisConnection.hlen(PENDING_KEY);
  return count;
}

/**
 * Update a pending transaction (e.g., after speed-up)
 */
export async function updatePending(
  nonce: number,
  updates: Partial<Omit<PendingTx, "nonce">>
): Promise<void> {
  const existing = await getPending(nonce);
  if (!existing) {
    console.warn(`⚠️ Cannot update pending TX: nonce=${nonce} not found`);
    return;
  }

  const updated: PendingTx = { ...existing, ...updates };
  await redisConnection.hset(
    PENDING_KEY,
    nonce.toString(),
    JSON.stringify(updated)
  );
  console.log(`📝 Updated pending TX: nonce=${nonce}`);
}

// ============================================================================
// Nonce Management (Persisted)
// ============================================================================

/**
 * Get the last known nonce from Redis
 * Returns null if not set (will need to fetch from chain)
 */
export async function getStoredNonce(): Promise<number | null> {
  const nonce = await redisConnection.get(NONCE_KEY);
  return nonce ? parseInt(nonce, 10) : null;
}

/**
 * Update the stored nonce
 */
export async function setStoredNonce(nonce: number): Promise<void> {
  await redisConnection.set(NONCE_KEY, nonce.toString());
}

/**
 * Increment and return the next nonce
 */
export async function incrementNonce(): Promise<number> {
  const newNonce = await redisConnection.incr(NONCE_KEY);
  return newNonce;
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Get diagnostic info about pending transactions
 */
export async function getDiagnostics(): Promise<{
  backlogSize: number;
  oldestPendingAge: number | null;
  pendingNonces: number[];
  stuckCount: number;
}> {
  const all = await getAllPending();
  const now = Date.now();

  const ages = all.map((tx) => now - tx.submittedAt);
  const oldestAge = ages.length > 0 ? Math.max(...ages) : null;
  const stuckCount = all.filter((tx) => now - tx.submittedAt > 120_000).length; // > 2 min

  return {
    backlogSize: all.length,
    oldestPendingAge: oldestAge,
    pendingNonces: all.map((tx) => tx.nonce).sort((a, b) => a - b),
    stuckCount,
  };
}

/**
 * Clear all pending transactions (use with caution - for recovery only)
 */
export async function clearAllPending(): Promise<void> {
  await redisConnection.del(PENDING_KEY);
  console.log(`🗑️ Cleared all pending transactions`);
}






