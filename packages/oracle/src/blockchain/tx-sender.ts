/**
 * Transaction Sender Worker
 * 
 * Single-threaded worker that processes all blockchain transactions.
 * Features:
 * - Serialized transaction sending (no nonce conflicts)
 * - Stuck transaction detection and speed-up
 * - Persistent nonce tracking across restarts
 * - Backlog monitoring and alerting
 */

import { Worker, Job } from "bullmq";
import { encodeFunctionData, parseEventLogs, formatGwei } from "viem";
import { redisConnection } from "../watcher/queue.js";
import { publicClient, walletClient, oracleAccount } from "./client.js";
import { EscrowFactoryABI, EscrowABI, PaymentRouterABI } from "../contracts/abis.js";
import { getNetwork } from "../config/networks.js";
import { ENV } from "../config/env.js";
import { TxJobData, TxJobResult, TxMethod } from "./tx-queue.js";
import {
  trackPending,
  removePending,
  getPending,
  getStuckTxs,
  getBacklogSize,
  getStoredNonce,
  setStoredNonce,
  getDiagnostics,
  updatePending,
} from "./pending-tracker.js";

// ============================================================================
// Configuration
// ============================================================================

const network = getNetwork(ENV.CHAIN_ID);
const QUEUE_NAME = `tx-sender-${ENV.CHAIN_ID}`;

// Speed-up thresholds (configurable via env)
const SPEEDUP_THRESHOLD_MS = parseInt(process.env.TX_SPEEDUP_THRESHOLD_MS || "120000"); // 2 min
const REPLACE_THRESHOLD_MS = parseInt(process.env.TX_REPLACE_THRESHOLD_MS || "300000"); // 5 min
const ALERT_THRESHOLD_MS = parseInt(process.env.TX_ALERT_THRESHOLD_MS || "600000"); // 10 min
const BACKLOG_ALERT_SIZE = parseInt(process.env.TX_BACKLOG_ALERT || "10");

// Gas price multipliers for speed-up
const SPEEDUP_MULTIPLIER = 1.1; // 10% increase
const REPLACE_MULTIPLIER = 1.25; // 25% increase
const ALERT_MULTIPLIER = 1.5; // 50% increase

// ============================================================================
// Worker Instance
// ============================================================================

let txWorker: Worker<TxJobData, TxJobResult> | null = null;

/**
 * Start the TX sender worker
 */
export function startTxSender(): Worker<TxJobData, TxJobResult> {
  if (txWorker) {
    console.log("⚠️ TX Sender already running");
    return txWorker;
  }

  txWorker = new Worker<TxJobData, TxJobResult>(
    QUEUE_NAME,
    async (job) => processJob(job),
    {
      connection: redisConnection,
      concurrency: 1, // CRITICAL: Single-threaded to prevent nonce conflicts
      limiter: {
        max: 5,
        duration: 1000, // Max 5 TXs per second (gas limit safety)
      },
    }
  );

  // Event handlers
  txWorker.on("completed", (job, result) => {
    console.log(`✅ TX Job completed: ${job.name} (${job.id}) - txHash: ${result.txHash}`);
  });

  txWorker.on("failed", (job, error) => {
    console.error(`❌ TX Job failed: ${job?.name} (${job?.id}) - ${error.message}`);
  });

  txWorker.on("error", (error) => {
    console.error("❌ TX Worker error:", error);
  });

  console.log(`🚀 TX Sender worker started: ${QUEUE_NAME}`);
  console.log(`   Speed-up: ${SPEEDUP_THRESHOLD_MS / 1000}s, Replace: ${REPLACE_THRESHOLD_MS / 1000}s, Alert: ${ALERT_THRESHOLD_MS / 1000}s`);

  // Start monitoring loop
  startMonitoringLoop();

  return txWorker;
}

/**
 * Stop the TX sender worker
 */
export async function stopTxSender(): Promise<void> {
  if (txWorker) {
    await txWorker.close();
    txWorker = null;
    console.log("🛑 TX Sender worker stopped");
  }
}

// ============================================================================
// Job Processing
// ============================================================================

async function processJob(job: Job<TxJobData, TxJobResult>): Promise<TxJobResult> {
  const { method, params } = job.data;
  console.log(`📤 Processing TX Job: ${method} (${job.id})`);

  try {
    // First, check and handle any stuck transactions
    await handleStuckTransactions();

    // Get the correct nonce
    const nonce = await getNextNonce();

    // Build and send the transaction
    const result = await sendTransaction(method, params, nonce);

    return result;
  } catch (error: any) {
    console.error(`❌ TX Job error: ${method} - ${error.message}`);
    return {
      txHash: "",
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// Transaction Building
// ============================================================================

async function sendTransaction(
  method: TxMethod,
  params: Record<string, unknown>,
  nonce: number
): Promise<TxJobResult> {
  let to: `0x${string}`;
  let data: `0x${string}`;

  // Build transaction data based on method
  switch (method) {
    case "createEscrow":
      to = network.FACTORY as `0x${string}`;
      data = encodeFunctionData({
        abi: EscrowFactoryABI,
        functionName: "createEscrowSimple",
        args: [
          params.payout as `0x${string}`,
          params.funder as `0x${string}`,
          params.token as `0x${string}`,
          BigInt(params.targetAmount as string),
          BigInt(params.deadline as number),
          (params.arbitrator1 as `0x${string}`) || "0x0000000000000000000000000000000000000000",
          (params.arbitrator2 as `0x${string}`) || "0x0000000000000000000000000000000000000000",
          (params.arbitrator3 as `0x${string}`) || "0x0000000000000000000000000000000000000000",
        ],
      });
      break;

    case "confirmByOracle":
      to = params.escrow as `0x${string}`;
      data = encodeFunctionData({
        abi: EscrowABI,
        functionName: "confirmByOracle",
        args: [params.txHash as `0x${string}`],
      });
      break;

    case "finalizeAfterDeadline":
      to = params.escrow as `0x${string}`;
      data = encodeFunctionData({
        abi: EscrowABI,
        functionName: "finalizeAfterDeadline",
        args: [],
      });
      break;

    case "expireIfNotConfirmed":
      to = params.escrow as `0x${string}`;
      data = encodeFunctionData({
        abi: EscrowABI,
        functionName: "expireIfNotConfirmed",
        args: [],
      });
      break;

    case "expireIfNotFunded":
      to = params.escrow as `0x${string}`;
      data = encodeFunctionData({
        abi: EscrowABI,
        functionName: "expireIfNotFunded",
        args: [],
      });
      break;

    case "sweepToTreasury":
      to = params.escrow as `0x${string}`;
      data = encodeFunctionData({
        abi: EscrowABI,
        functionName: "sweepToTreasury",
        args: [],
      });
      break;

    case "sweepToTreasuryAfterArbWindow":
      to = params.escrow as `0x${string}`;
      data = encodeFunctionData({
        abi: EscrowABI,
        functionName: "sweepToTreasuryAfterArbWindow",
        args: [],
      });
      break;

    case "createPaymentLink":
      to = network.PAYMENT_ROUTER as `0x${string}`;
      data = encodeFunctionData({
        abi: PaymentRouterABI,
        functionName: "createLink",
        args: [
          params.linkId as `0x${string}`,
          params.token as `0x${string}`,
          params.recipient as `0x${string}`,
          BigInt(params.amount as string),
        ],
      });
      break;

    default:
      throw new Error(`Unknown method: ${method}`);
  }

  // Get current gas prices
  const feeData = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = feeData.maxFeePerGas || 0n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 0n;

  console.log(`📤 Sending TX: method=${method}, nonce=${nonce}, maxFee=${formatGwei(maxFeePerGas)} gwei`);

  // Send transaction
  const txHash = await walletClient.sendTransaction({
    to,
    data,
    nonce,
    account: oracleAccount,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });

  // Track as pending
  await trackPending(nonce, {
    txHash,
    gasPrice: maxFeePerGas.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    submittedAt: Date.now(),
    method,
    attempt: 1,
  });

  // Update stored nonce
  await setStoredNonce(nonce + 1);

  // Wait for confirmation
  console.log(`⏳ Waiting for TX confirmation: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000, // 1 minute timeout
  });

  // Remove from pending
  await removePending(nonce);

  console.log(`✅ TX confirmed: ${txHash} (block: ${receipt.blockNumber}, gas: ${receipt.gasUsed})`);

  return {
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    success: receipt.status === "success",
  };
}

// ============================================================================
// Nonce Management
// ============================================================================

async function getNextNonce(): Promise<number> {
  // Get nonce from chain (pending includes unconfirmed TXs)
  const chainNonce = await publicClient.getTransactionCount({
    address: oracleAccount.address,
    blockTag: "pending",
  });

  // Get stored nonce (what we think the next nonce should be)
  const storedNonce = await getStoredNonce();

  // Use the higher of the two (handles restarts and external TXs)
  const nonce = Math.max(chainNonce, storedNonce || 0);

  console.log(`🔢 Nonce: chain=${chainNonce}, stored=${storedNonce}, using=${nonce}`);

  return nonce;
}

// ============================================================================
// Stuck Transaction Handling
// ============================================================================

async function handleStuckTransactions(): Promise<void> {
  const now = Date.now();

  // Check for stuck TXs at different thresholds
  const alertStuck = await getStuckTxs(ALERT_THRESHOLD_MS);
  const replaceStuck = await getStuckTxs(REPLACE_THRESHOLD_MS);
  const speedupStuck = await getStuckTxs(SPEEDUP_THRESHOLD_MS);

  // Handle alert-level stuck TXs (> 10 min)
  for (const tx of alertStuck) {
    if (tx.attempt < 4) {
      console.error(`🚨 ALERT: TX stuck for ${Math.round((now - tx.submittedAt) / 60000)} min - nonce=${tx.nonce}, txHash=${tx.txHash}`);
      await speedUpTransaction(tx, ALERT_MULTIPLIER);
    }
  }

  // Handle replace-level stuck TXs (> 5 min)
  for (const tx of replaceStuck) {
    if (!alertStuck.includes(tx) && tx.attempt < 3) {
      console.warn(`⚠️ TX stuck for ${Math.round((now - tx.submittedAt) / 60000)} min - speeding up aggressively`);
      await speedUpTransaction(tx, REPLACE_MULTIPLIER);
    }
  }

  // Handle speedup-level stuck TXs (> 2 min)
  for (const tx of speedupStuck) {
    if (!alertStuck.includes(tx) && !replaceStuck.includes(tx) && tx.attempt < 2) {
      console.log(`⏰ TX stuck for ${Math.round((now - tx.submittedAt) / 60000)} min - speeding up`);
      await speedUpTransaction(tx, SPEEDUP_MULTIPLIER);
    }
  }
}

async function speedUpTransaction(
  pendingTx: { nonce: number; txHash: string; gasPrice: string; method: string; attempt: number },
  multiplier: number
): Promise<void> {
  try {
    const oldGasPrice = BigInt(pendingTx.gasPrice);
    const newGasPrice = (oldGasPrice * BigInt(Math.round(multiplier * 100))) / 100n;

    console.log(`🚀 Speeding up TX: nonce=${pendingTx.nonce}, oldGas=${formatGwei(oldGasPrice)} gwei, newGas=${formatGwei(newGasPrice)} gwei`);

    // Send replacement transaction (same nonce, higher gas)
    const txHash = await walletClient.sendTransaction({
      to: oracleAccount.address, // Self-transfer as placeholder
      value: 0n,
      nonce: pendingTx.nonce,
      account: oracleAccount,
      maxFeePerGas: newGasPrice,
      maxPriorityFeePerGas: newGasPrice / 2n,
    });

    // Update pending record
    await updatePending(pendingTx.nonce, {
      txHash,
      gasPrice: newGasPrice.toString(),
      maxFeePerGas: newGasPrice.toString(),
      submittedAt: Date.now(),
      attempt: pendingTx.attempt + 1,
    });

    console.log(`✅ Speed-up TX sent: ${txHash}`);
  } catch (error: any) {
    // If the original TX was already mined, this will fail with "nonce too low"
    if (error.message?.includes("nonce too low") || error.message?.includes("already known")) {
      console.log(`ℹ️ Original TX may have been mined, removing from pending`);
      await removePending(pendingTx.nonce);
    } else {
      console.error(`❌ Speed-up failed: ${error.message}`);
    }
  }
}

// ============================================================================
// Monitoring
// ============================================================================

let monitoringInterval: NodeJS.Timeout | null = null;

function startMonitoringLoop(): void {
  if (monitoringInterval) return;

  monitoringInterval = setInterval(async () => {
    try {
      const diag = await getDiagnostics();
      const backlogSize = await getBacklogSize();

      // Log status
      if (backlogSize > 0) {
        console.log(`📊 TX Status: backlog=${backlogSize}, stuck=${diag.stuckCount}, oldest=${diag.oldestPendingAge ? Math.round(diag.oldestPendingAge / 1000) + "s" : "n/a"}`);
      }

      // Alert on backlog
      if (backlogSize >= BACKLOG_ALERT_SIZE) {
        console.error(`🚨 BACKLOG ALERT: ${backlogSize} pending TXs (threshold: ${BACKLOG_ALERT_SIZE})`);
        // TODO: Send webhook alert
      }

      // Handle stuck TXs
      await handleStuckTransactions();
    } catch (error: any) {
      console.error(`❌ Monitoring error: ${error.message}`);
    }
  }, 30_000); // Check every 30 seconds

  console.log("📊 TX monitoring loop started");
}

export function stopMonitoringLoop(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log("📊 TX monitoring loop stopped");
  }
}

// ============================================================================
// Exports for testing/debugging
// ============================================================================

export {
  getNextNonce,
  handleStuckTransactions,
  speedUpTransaction,
};

/**
 * Get TX sender status for health checks
 */
export async function getTxSenderStatus(): Promise<{
  running: boolean;
  backlogSize: number;
  stuckCount: number;
  oldestPendingAge: number | null;
}> {
  const diag = await getDiagnostics();
  return {
    running: txWorker !== null,
    backlogSize: diag.backlogSize,
    stuckCount: diag.stuckCount,
    oldestPendingAge: diag.oldestPendingAge,
  };
}
