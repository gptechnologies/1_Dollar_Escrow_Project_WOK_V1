/**
 * Event watcher - WSS subscriptions + HTTP backfill (Hybrid Confirmation Model)
 * 
 * Key changes from V1:
 * - No longer triggers recordFunding() - funding is derived from balance
 * - Detects bond transfers and triggers confirmByOracle()
 * - Watches for new escrow events: ConfirmedBySeller, ConfirmedByOracle, SweptAfterArbWindow
 */

import { parseEventLogs, Log } from "viem";
import { wsClient, publicClient } from "../blockchain/client.js";
import { EscrowFactoryABI, EscrowABI, ERC20ABI } from "../contracts/abis.js";
import { getNetwork } from "../config/networks.js";
import { ENV } from "../config/env.js";
import { sql, hexToBuffer, bufferToHex } from "../db/client.js";
import { getEscrowQueue, createEscrowWorker } from "./queue.js";
import { processEscrowJob } from "./processor.js";
import { Worker } from "bullmq";

const network = getNetwork(ENV.CHAIN_ID);

// Reorg safety buffer - re-scan this many blocks on backfill to handle reorgs
// 64 blocks is safe for Arbitrum (~1 minute of blocks)
const REORG_BUFFER_BLOCKS = 64n;

// Backfill configuration (Alchemy free tier allows max 10 blocks per getLogs)
const CHUNK_SIZE = 9n;
const CHUNK_DELAY_MS = 150; // Delay between chunks to avoid rate limits
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// Helper for delays
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Active escrow addresses we're watching
const activeEscrows = new Set<string>();
const activeWorkers = new Map<string, Worker>();

/**
 * Initialize active escrow set from database
 */
async function loadActiveEscrows() {
  const rows = await sql`
    SELECT escrow FROM escrows
    WHERE network = ${ENV.CHAIN_ID.toString()}
    AND phase_cached < 3
  `;

  rows.forEach((row) => {
    const addr = bufferToHex(row.escrow as Buffer).toLowerCase();
    activeEscrows.add(addr);
  });

  console.log(`📊 Loaded ${activeEscrows.size} active escrows`);
}

/**
 * Add escrow to active set
 */
export function addActiveEscrow(address: string) {
  const addr = address.toLowerCase();
  if (!activeEscrows.has(addr)) {
    activeEscrows.add(addr);
    
    // Start worker
    if (!activeWorkers.has(addr)) {
      console.log(`👷 Starting worker for ${addr}`);
      const worker = createEscrowWorker(addr, processEscrowJob);
      activeWorkers.set(addr, worker);
    }
  }
}

/**
 * Remove escrow from active set (when resolved/expired)
 */
export function removeActiveEscrow(address: string) {
  const addr = address.toLowerCase();
  activeEscrows.delete(addr);

  // Stop worker
  const worker = activeWorkers.get(addr);
  if (worker) {
    console.log(`🛑 Stopping worker for ${addr}`);
    worker.close();
    activeWorkers.delete(addr);
  }
}

/**
 * Check if transaction was already processed
 */
async function isProcessed(txHash: string, escrow: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM processed_tx
    WHERE tx_hash = ${txHash} AND escrow = ${hexToBuffer(escrow)}
  `;
  return rows.length > 0;
}

/**
 * Mark transaction as processed
 */
async function markProcessed(txHash: string, escrow: string, eventType: string) {
  await sql`
    INSERT INTO processed_tx (tx_hash, escrow, event_type)
    VALUES (${txHash}, ${hexToBuffer(escrow)}, ${eventType})
    ON CONFLICT (tx_hash, escrow) DO NOTHING
  `;
}

/**
 * Process EscrowFactory.EscrowCreated event
 */
async function handleEscrowCreated(log: any) {
  const escrowAddress = log.args.escrow.toLowerCase();
  
  console.log(`🆕 EscrowCreated: ${escrowAddress}`);
  
  addActiveEscrow(escrowAddress);
}

/**
 * Process Token Transfer events to active escrows
 * In hybrid model, this is used for bond detection (confirmation), not funding
 */
async function handleTokenTransfer(log: any, escrowAddress: string) {
  const { from, to, value } = log.args;
  
  if (await isProcessed(log.transactionHash, escrowAddress)) {
    console.log(`⏭️  Already processed: ${log.transactionHash}`);
    return;
  }

  console.log(`💸 Transfer to ${escrowAddress}: ${value.toString()} from ${from}`);

  // Queue job to check if this needs processing (bond detection)
  const queue = getEscrowQueue(escrowAddress);
  await queue.add("transfer", {
    escrow: escrowAddress,
    eventType: "Transfer",
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    args: { from, to, value: value.toString() },
  });

  await markProcessed(log.transactionHash, escrowAddress, "Transfer");
}

/**
 * Process Escrow events (Hybrid Confirmation Model)
 * Handles: ConfirmedBySeller, ConfirmedByOracle, FinalizedPaid, ResolvedReleased,
 *          ResolvedRefunded, ExpiredNotConfirmed, ExpiredNotFunded, SweptAfterArbWindow
 */
async function handleEscrowEvent(log: any, eventName: string) {
  const escrowAddress = (log.address as string).toLowerCase();
  
  if (await isProcessed(log.transactionHash, escrowAddress)) {
    console.log(`⏭️  Already processed: ${log.transactionHash}`);
    return;
  }

  console.log(`📢 ${eventName} on ${escrowAddress}`);

  // Phase mapping for DB update (synthetic phase for backward compatibility)
  // Phase 0: AwaitingConfirmation (not confirmed)
  // Phase 1: ConfirmedAwaitingFunding (confirmed but not isFunded)
  // Phase 2: Funded (confirmed and isFunded)
  // Phase 3: Resolved
  // Phase 4: Expired
  const phaseMap: Record<string, number> = {
    // Confirmation events -> phase 1 (but funding status is derived, so UI should check isFunded)
    "ConfirmedBySeller": 1,
    "ConfirmedByOracle": 1,
    // Terminal events -> phase 3 (resolved) or 4 (expired)
    "FinalizedPaid": 3,
    "ResolvedReleased": 3,
    "ResolvedRefunded": 3,
    "SweptAfterArbWindow": 3,
    "ExpiredNotConfirmed": 4,
    "ExpiredNotFunded": 4,
  };

  if (eventName in phaseMap) {
    const newPhase = phaseMap[eventName];
    await sql`
      UPDATE escrows
      SET phase_cached = ${newPhase}, updated_at = NOW()
      WHERE escrow = ${hexToBuffer(escrowAddress)}
    `;

    // Remove from active set if terminal
    if (newPhase >= 3) {
      removeActiveEscrow(escrowAddress);
    }
  }

  await markProcessed(log.transactionHash, escrowAddress, eventName);
}

/**
 * Start WebSocket subscriptions
 */
export async function startWSS() {
  await loadActiveEscrows();

  // Start workers for all initial active escrows
  for (const escrow of activeEscrows) {
    if (!activeWorkers.has(escrow)) {
      console.log(`👷 Starting worker for ${escrow}`);
      const worker = createEscrowWorker(escrow, processEscrowJob);
      activeWorkers.set(escrow, worker);
    }
  }

  console.log(`✅ Started ${activeWorkers.size} workers`);

  console.log("🔌 Starting WebSocket subscriptions...");

  // Subscribe to EscrowFactory.EscrowCreated
  wsClient.watchEvent({
    address: network.FACTORY as `0x${string}`,
    event: {
      type: "event",
      name: "EscrowCreated",
      inputs: EscrowFactoryABI[0].inputs,
    },
    onLogs: async (logs) => {
      for (const log of logs) {
        await handleEscrowCreated(log);
      }
    },
    onError: (error) => {
      console.error("❌ WSS EscrowCreated error:", error);
    },
  });

  // Note: Token transfers to escrows are detected by the keeper's reconciliation loop
  // which does targeted per-escrow log queries. This avoids the complexity of
  // subscribing to all possible escrow addresses.
  
  console.log("✅ WSS subscriptions active (hybrid confirmation model)");
}

/**
 * Backfill / Replay from last block
 * 
 * This function can replay EscrowCreated events from a given block range
 * to recover if the oracle goes down. Transfer events are handled by the
 * keeper's reconciliation loop which does per-escrow queries.
 */
export async function startBackfill() {
  console.log(`🔄 Starting backfill check...`);
  
  try {
    // Get cursor (last processed block)
    const cursorRows = await sql`
      SELECT last_block FROM cursor WHERE network = ${ENV.CHAIN_ID.toString()}
    `;
    
    const lastBlock = cursorRows.length > 0 ? BigInt(cursorRows[0].last_block) : 0n;
    const latestBlock = await publicClient.getBlockNumber();
    
    console.log(`📊 Cursor at block ${lastBlock}, latest block ${latestBlock}`);
    
    // Calculate safe start block with reorg buffer
    // This re-scans recent blocks to catch any events that might have been reorged
    const safeStartBlock = lastBlock > REORG_BUFFER_BLOCKS 
      ? lastBlock - REORG_BUFFER_BLOCKS 
      : 0n;
    
    // Track the last successfully processed block
    let lastSuccessfulBlock = safeStartBlock;
    
    // If we're behind, backfill EscrowCreated events
    if (lastBlock > 0 && latestBlock > safeStartBlock) {
      const gap = latestBlock - safeStartBlock;
      console.log(`📥 Backfilling ${gap} blocks of EscrowCreated events (with ${REORG_BUFFER_BLOCKS} block reorg buffer)...`);
      console.log(`   Using chunk size of ${CHUNK_SIZE} blocks (Alchemy free tier limit)`);
      
      let fromBlock = safeStartBlock + 1n;
      
      while (fromBlock <= latestBlock) {
        const toBlock = fromBlock + CHUNK_SIZE - 1n > latestBlock ? latestBlock : fromBlock + CHUNK_SIZE - 1n;
        
        let success = false;
        let retries = 0;
        
        while (!success && retries < MAX_RETRIES) {
          try {
            const logs = await publicClient.getLogs({
              address: network.FACTORY as `0x${string}`,
              event: {
                type: "event",
                name: "EscrowCreated",
                inputs: EscrowFactoryABI[0].inputs,
              },
              fromBlock,
              toBlock,
            });
            
            for (const log of logs) {
              await handleEscrowCreated(log);
            }
            
            console.log(`   Processed blocks ${fromBlock}-${toBlock}, found ${logs.length} EscrowCreated events`);
            lastSuccessfulBlock = toBlock;
            success = true;
            
            // Delay between chunks to avoid rate limits
            await sleep(CHUNK_DELAY_MS);
            
          } catch (error: any) {
            retries++;
            
            // Check if it's a rate limit error (429)
            const isRateLimit = error?.status === 429 || 
              error?.details?.includes?.('Too Many Requests') ||
              error?.shortMessage?.includes?.('429');
            
            if (isRateLimit && retries < MAX_RETRIES) {
              const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, retries - 1);
              console.warn(`   ⚠️ Rate limited on blocks ${fromBlock}-${toBlock}, backing off ${backoffMs}ms (retry ${retries}/${MAX_RETRIES})`);
              await sleep(backoffMs);
            } else if (retries < MAX_RETRIES) {
              console.warn(`   ⚠️ Error on blocks ${fromBlock}-${toBlock}, retrying (${retries}/${MAX_RETRIES}):`, error?.shortMessage || error);
              await sleep(INITIAL_BACKOFF_MS);
            } else {
              console.error(`   ❌ Failed to process blocks ${fromBlock}-${toBlock} after ${MAX_RETRIES} retries:`, error?.shortMessage || error);
              // Don't advance past this failed block - stop backfill here
              // This prevents skipping events
            }
          }
        }
        
        // If we failed after all retries, stop backfill to avoid skipping blocks
        if (!success) {
          console.error(`   ❌ Stopping backfill at block ${fromBlock} due to persistent errors`);
          break;
        }
        
        fromBlock = toBlock + 1n;
      }
    }
    
    // Only update cursor to last successfully processed block
    if (lastSuccessfulBlock > safeStartBlock) {
      await sql`
        INSERT INTO cursor (network, last_block, updated_at)
        VALUES (${ENV.CHAIN_ID.toString()}, ${lastSuccessfulBlock.toString()}, NOW())
        ON CONFLICT (network) DO UPDATE SET last_block = ${lastSuccessfulBlock.toString()}, updated_at = NOW()
      `;
      console.log(`✅ Backfill complete, cursor updated to block ${lastSuccessfulBlock}`);
    } else {
      console.log(`✅ Backfill complete, cursor unchanged at block ${lastBlock}`);
    }
    
    console.log(`   Note: Transfer reconciliation is handled by keeper loop`);
  } catch (error) {
    console.error("❌ Backfill error:", error);
  }
}

/**
 * Get all active escrow addresses
 */
export function getActiveEscrowAddresses(): string[] {
  return Array.from(activeEscrows);
}
