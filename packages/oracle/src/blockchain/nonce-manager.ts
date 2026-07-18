/**
 * Nonce manager with retry and exponential backoff
 * Ensures transactions are sent with correct nonces and handles race conditions
 */

import { publicClient, getServerSigner } from "./client.js";

class NonceManager {
  private pendingNonce: number | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_MS = 2000; // cache nonce for 2s

  async getNonce(forceRefresh = false): Promise<number> {
    const now = Date.now();
    
    if (!forceRefresh && this.pendingNonce !== null && now - this.lastFetchTime < this.CACHE_MS) {
      return this.pendingNonce;
    }

    // Fetch from chain
    const { account } = getServerSigner();
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });

    this.pendingNonce = nonce;
    this.lastFetchTime = now;
    return nonce;
  }

  increment() {
    if (this.pendingNonce !== null) {
      this.pendingNonce++;
    }
  }

  reset() {
    this.pendingNonce = null;
  }
}

export const nonceManager = new NonceManager();

/**
 * Retry helper with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
  context = ""
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry if nonce is too low (already mined)
      if (error.message?.includes("nonce too low")) {
        console.log(`[${context}] Nonce too low, resetting nonce manager`);
        nonceManager.reset();
        throw error;
      }

      // Don't retry if gas estimation failed (likely revert)
      if (error.message?.includes("execution reverted")) {
        console.error(`[${context}] Transaction would revert:`, error.message);
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`[${context}] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`[${context}] Failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}
