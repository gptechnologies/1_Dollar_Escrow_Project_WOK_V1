/**
 * BullMQ queue setup for per-escrow job processing
 */

import { Queue, Worker, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { ENV } from "../config/env.js";

if (!ENV.REDIS_URL) {
  throw new Error("REDIS_URL is required");
}

const connection = new Redis(ENV.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Test connection
connection.ping().then(() => {
  console.log("✅ Redis connected");
}).catch((err: Error) => {
  console.error("❌ Redis connection failed:", err.message);
  process.exit(1);
});

export interface EscrowJobData {
  escrow: string;
  eventType: string;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  args: Record<string, any>;
}

/**
 * Get or create a queue for an escrow address
 */
export function getEscrowQueue(escrowAddress: string): Queue<EscrowJobData> {
  return new Queue<EscrowJobData>(`escrow-${escrowAddress}`, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: {
        count: 100, // Keep last 100 completed jobs
        age: 24 * 3600, // 24 hours
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // Keep failed jobs for 7 days
      },
    },
  });
}

/**
 * Create a worker for processing escrow events
 */
export function createEscrowWorker(
  escrowAddress: string,
  processor: (job: EscrowJobData) => Promise<void>
): Worker<EscrowJobData> {
  return new Worker<EscrowJobData>(
    `escrow-${escrowAddress}`,
    async (job) => {
      console.log(`[Worker ${escrowAddress}] Processing ${job.data.eventType} from tx ${job.data.txHash}`);
      await processor(job.data);
    },
    {
      connection,
      concurrency: 1, // Serialize per escrow
      limiter: {
        max: 10,
        duration: 1000, // Max 10 jobs per second
      },
    }
  );
}

export { connection as redisConnection };

