/**
 * Transaction Queue for Oracle Wallet
 * 
 * Centralizes all blockchain transactions through a single BullMQ queue
 * to prevent nonce conflicts and enable speed-up logic for stuck transactions.
 */

import { Queue, Job, QueueEvents } from "bullmq";
import { redisConnection } from "../watcher/queue.js";
import { ENV } from "../config/env.js";

// ============================================================================
// Types
// ============================================================================

export type TxMethod = 
  | "createEscrow"
  | "confirmByOracle"
  | "finalizeAfterDeadline"
  | "expireIfNotConfirmed"
  | "expireIfNotFunded"
  | "sweepToTreasury"
  | "sweepToTreasuryAfterArbWindow";

export interface TxJobData {
  method: TxMethod;
  params: Record<string, unknown>;
  priority?: number; // Lower = higher priority
  createdAt: number;
}

export interface TxJobResult {
  txHash: string;
  blockNumber?: string;  // Stored as string to avoid BigInt JSON serialization issues
  gasUsed?: string;      // Stored as string to avoid BigInt JSON serialization issues
  success: boolean;
  error?: string;
}

// ============================================================================
// Queue Configuration
// ============================================================================

const QUEUE_NAME = `tx-sender-${ENV.CHAIN_ID}`;

// Singleton queue instance
let txQueue: Queue<TxJobData, TxJobResult> | null = null;

// Singleton QueueEvents instance (required for waitUntilFinished)
let queueEvents: QueueEvents | null = null;

/**
 * Get the TX sender queue (creates if not exists)
 */
export function getTxQueue(): Queue<TxJobData, TxJobResult> {
  if (txQueue) {
    return txQueue;
  }

  txQueue = new Queue<TxJobData, TxJobResult>(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000, // 5 seconds base delay
      },
      removeOnComplete: {
        count: 500, // Keep last 500 completed jobs for debugging
        age: 7 * 24 * 3600, // 7 days
      },
      removeOnFail: {
        age: 30 * 24 * 3600, // Keep failed jobs for 30 days
      },
    },
  });

  console.log(`📤 TX Queue initialized: ${QUEUE_NAME}`);
  return txQueue;
}

/**
 * Get the QueueEvents instance (required for waitUntilFinished)
 */
export function getQueueEvents(): QueueEvents {
  if (queueEvents) {
    return queueEvents;
  }

  queueEvents = new QueueEvents(QUEUE_NAME, {
    connection: redisConnection,
  });

  return queueEvents;
}

// ============================================================================
// Job Submission Helpers
// ============================================================================

/**
 * Submit a transaction job to the queue
 * Returns the job ID for tracking
 */
export async function submitTxJob(
  method: TxMethod,
  params: Record<string, unknown>,
  options?: {
    priority?: number;
    jobId?: string;
  }
): Promise<Job<TxJobData, TxJobResult>> {
  const queue = getTxQueue();

  const job = await queue.add(
    method,
    {
      method,
      params,
      priority: options?.priority ?? 10,
      createdAt: Date.now(),
    },
    {
      priority: options?.priority ?? 10,
      jobId: options?.jobId,
    }
  );

  console.log(`📤 TX Job submitted: ${method} (job: ${job.id})`);
  return job;
}

/**
 * Submit and wait for a transaction job to complete
 * Throws if the job fails
 */
export async function submitTxJobAndWait(
  method: TxMethod,
  params: Record<string, unknown>,
  options?: {
    priority?: number;
    jobId?: string;
    timeoutMs?: number;
  }
): Promise<TxJobResult> {
  const job = await submitTxJob(method, params, options);
  const timeoutMs = options?.timeoutMs ?? 120_000; // 2 minute default timeout

  // Wait for job completion
  const result = await job.waitUntilFinished(
    getQueueEvents(),
    timeoutMs
  );

  if (!result.success) {
    throw new Error(`TX Job failed: ${result.error}`);
  }

  return result;
}

/**
 * Get queue statistics
 */
export async function getTxQueueStats() {
  const queue = getTxQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
}

/**
 * Check if there's a backlog that needs attention
 */
export async function checkBacklog(): Promise<{
  hasBacklog: boolean;
  size: number;
  warning: boolean;
  critical: boolean;
}> {
  const stats = await getTxQueueStats();
  const backlogSize = stats.waiting + stats.active + stats.delayed;

  return {
    hasBacklog: backlogSize > 0,
    size: backlogSize,
    warning: backlogSize > 5,
    critical: backlogSize > 10,
  };
}
