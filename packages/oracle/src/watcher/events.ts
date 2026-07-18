/**
 * Event watcher - WSS subscriptions + HTTP backfill for EscrowV2.
 *
 * Funding is push-based: deposits are ERC-20 Transfer logs to escrow addresses.
 * The watcher indexes factory-created escrows, escrow action events, and token
 * transfers for dashboard lookup/history. It does not submit funding txs.
 */

import { getWsClient, getPublicClient } from "../blockchain/client.js";
import { EscrowFactoryABI, EscrowABI, ERC20ABI } from "../contracts/abis.js";
import { getNetwork } from "../config/networks.js";
import { sql, hexToBuffer, bufferToHex } from "../db/client.js";
import { upsertEscrowFromEvent } from "../services/escrow.js";
import { decodeEventLog } from "viem";

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
const activeEscrows = new Map<number, Set<string>>();
const activeUnwatchers = new Map<string, Array<() => void>>();

function chainEscrows(chainId: number): Set<string> {
  const existing = activeEscrows.get(chainId);
  if (existing) return existing;
  const created = new Set<string>();
  activeEscrows.set(chainId, created);
  return created;
}

const escrowKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

const ESCROW_EVENT_NAMES = [
  "SellerConfirmed",
  "Settled",
  "Refunded",
  "UnderfundedRefunded",
  "MutualSettleApproved",
  "MutualRefundApproved",
  "MutualResolutionPending",
  "MutualResolutionFinalized",
  "ArbitratorVoted",
  "SweptExcess",
  "SweptStrayToken",
  "LatePaymentTokenRecovered",
] as const;

function escrowEventAbi(eventName: string) {
  const event = EscrowABI.find((entry: any) => entry.type === "event" && entry.name === eventName);
  if (!event) {
    throw new Error(`Escrow ABI event not found: ${eventName}`);
  }
  return event as any;
}

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, jsonSafe(val)]));
  }
  return value;
}

/**
 * Initialize active escrow set from database
 */
async function loadActiveEscrows(chainId: number) {
  const rows = await sql`
    SELECT escrow FROM escrows
    WHERE network = ${chainId.toString()}
    AND phase_cached < 3
  `;

  rows.forEach((row) => {
    const addr = bufferToHex(row.escrow as Buffer).toLowerCase();
    chainEscrows(chainId).add(addr);
  });

  console.log(`📊 Loaded ${chainEscrows(chainId).size} active escrows on chain ${chainId}`);
}

/**
 * Add escrow to active set
 */
export function addActiveEscrow(chainId: number, address: string, tokenAddress?: string) {
  const addr = address.toLowerCase();
  if (!chainEscrows(chainId).has(addr)) {
    chainEscrows(chainId).add(addr);
  }

  void startEscrowSubscriptions(chainId, addr, tokenAddress);
}

/**
 * Remove escrow from active set (when resolved/expired)
 */
export function removeActiveEscrow(chainId: number, address: string) {
  const addr = address.toLowerCase();
  chainEscrows(chainId).delete(addr);

  const key = escrowKey(chainId, addr);
  const unwatchers = activeUnwatchers.get(key);
  if (unwatchers) {
    console.log(`🛑 Stopping event subscriptions for ${addr}`);
    for (const unwatch of unwatchers) {
      unwatch();
    }
    activeUnwatchers.delete(key);
  }
}

/**
 * Check if log was already processed
 */
async function isProcessed(chainId: number, txHash: string, logIndex: number): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM processed_logs
    WHERE network = ${chainId.toString()}
    AND tx_hash = ${txHash}
    AND log_index = ${logIndex}
  `;
  return rows.length > 0;
}

/**
 * Mark log as processed
 */
async function markProcessed(chainId: number, txHash: string, logIndex: number, escrow: string, eventType: string) {
  await sql`
    INSERT INTO processed_logs (network, tx_hash, log_index, escrow, event_type)
    VALUES (${chainId.toString()}, ${txHash}, ${logIndex}, ${hexToBuffer(escrow)}, ${eventType})
    ON CONFLICT (network, tx_hash, log_index) DO NOTHING
  `;
}

async function getEscrowToken(chainId: number, escrowAddress: string): Promise<string | null> {
  const rows = await sql`
    SELECT token FROM escrows
    WHERE network = ${chainId.toString()}
    AND escrow = ${hexToBuffer(escrowAddress)}
    LIMIT 1
  `;
  if (rows.length === 0 || !rows[0].token) return null;
  return bufferToHex(rows[0].token as Buffer).toLowerCase();
}

async function isKnownEscrow(chainId: number, escrowAddress: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM escrows
    WHERE network = ${chainId.toString()}
    AND escrow = ${hexToBuffer(escrowAddress)}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function recordEscrowEvent(chainId: number, log: any, eventName: string) {
  const escrowAddress = (log.address as string).toLowerCase();
  const args = log.args ?? {};
  const actor =
    args.seller ??
    args.buyerRefundWallet ??
    args.approver ??
    args.arbitrator ??
    args.treasury ??
    args.erc20 ??
    null;
  const amount =
    args.amount?.toString?.() ??
    args.principal?.toString?.() ??
    args.value?.toString?.() ??
    null;
  const outcome = args.outcome === undefined ? null : Number(args.outcome);

  await sql`
    INSERT INTO escrow_events (
      network, escrow, event_name, tx_hash, block_number, log_index,
      actor, amount, outcome, raw_args
    )
    VALUES (
      ${chainId.toString()},
      ${hexToBuffer(escrowAddress)},
      ${eventName},
      ${log.transactionHash},
      ${log.blockNumber.toString()},
      ${Number(log.logIndex)},
      ${actor ? hexToBuffer(actor as string) : null},
      ${amount},
      ${outcome},
      ${sql.json(jsonSafe(args))}
    )
    ON CONFLICT (network, tx_hash, log_index) DO NOTHING
  `;
}

async function recordTokenTransfer(chainId: number, log: any, escrowAddress: string) {
  const { from, to, value } = log.args;
  await sql`
    INSERT INTO escrow_token_transfers (
      network, token, escrow, from_address, to_address, amount,
      tx_hash, block_number, log_index
    )
    VALUES (
      ${chainId.toString()},
      ${hexToBuffer(log.address as string)},
      ${hexToBuffer(escrowAddress)},
      ${hexToBuffer(from as string)},
      ${hexToBuffer(to as string)},
      ${value.toString()},
      ${log.transactionHash},
      ${log.blockNumber.toString()},
      ${Number(log.logIndex)}
    )
    ON CONFLICT (network, tx_hash, log_index) DO NOTHING
  `;
}

async function startEscrowSubscriptions(chainId: number, escrowAddress: string, tokenAddress?: string) {
  const addr = escrowAddress.toLowerCase();
  const key = escrowKey(chainId, addr);
  if (activeUnwatchers.has(key)) return;

  const token = (tokenAddress ?? await getEscrowToken(chainId, addr))?.toLowerCase();
  const wsClient = getWsClient(chainId);
  const unwatchers: Array<() => void> = [];

  for (const eventName of ESCROW_EVENT_NAMES) {
    const event = escrowEventAbi(eventName);
    const unwatch = wsClient.watchEvent({
      address: addr as `0x${string}`,
      event: {
        type: "event",
        name: event.name,
        inputs: event.inputs,
      },
      onLogs: async (logs) => {
        for (const log of logs) {
          await handleEscrowEvent(chainId, log, eventName);
        }
      },
      onError: (error) => {
        console.error(`❌ WSS ${eventName} error for ${addr}:`, error);
      },
    });
    unwatchers.push(unwatch);
  }

  if (token) {
    const unwatchTransfer = wsClient.watchEvent({
      address: token as `0x${string}`,
      event: ERC20ABI[0],
      args: { to: addr as `0x${string}` },
      onLogs: async (logs) => {
        for (const log of logs) {
          await handleTokenTransfer(chainId, log, addr);
        }
      },
      onError: (error) => {
        console.error(`❌ WSS Transfer error for ${addr}:`, error);
      },
    });
    unwatchers.push(unwatchTransfer);
  }

  activeUnwatchers.set(key, unwatchers);
  console.log(`✅ Subscribed to ${unwatchers.length} event streams for ${addr}`);
}

/**
 * Process EscrowFactory.EscrowCreated event.
 * Activates the escrow worker AND persists it in the DB if not already indexed
 * (safety net for escrows created outside the UI register flow).
 */
async function handleEscrowCreated(chainId: number, log: any) {
  const escrowAddress = (log.args.escrow as string).toLowerCase();
  
  console.log(`🆕 EscrowCreated: ${escrowAddress}`);

  // Persist if missing (idempotent upsert)
  try {
    const event = log.args;
    const { code, isNew } = await upsertEscrowFromEvent({
      chainId,
      escrowAddress,
      payout: event.payout as string,
      funder: event.funder as string,
      tokenAddress: event.token as string,
      targetAmount: event.targetAmount.toString(),
      settlementDate: Number(event.settlementDate),
      termsHash: event.termsHash as string,
      arbitrator1: event.arbitrator1 as string,
      arbitrator2: event.arbitrator2 as string,
      arbitrator3: event.arbitrator3 as string,
      txHash: log.transactionHash,
      createdBlock: log.blockNumber.toString(),
    });
    if (isNew) {
      console.log(`📋 Watcher indexed new escrow: ${escrowAddress} (code: ${code})`);
    }
  } catch (err) {
    console.error(`⚠️ Failed to upsert escrow ${escrowAddress} from watcher:`, err);
  }

  addActiveEscrow(chainId, escrowAddress, log.args.token as string);
}

/**
 * Process Token Transfer events to active escrows
 * Funding is push-based, so transfers are indexed as funding/deposit activity.
 */
async function handleTokenTransfer(chainId: number, log: any, escrowAddress: string) {
  const { from, to, value } = log.args;
  
  if (await isProcessed(chainId, log.transactionHash, Number(log.logIndex))) {
    console.log(`⏭️  Already processed: ${log.transactionHash}:${log.logIndex}`);
    return;
  }

  console.log(`💸 Transfer to ${escrowAddress}: ${value.toString()} from ${from}`);
  await recordTokenTransfer(chainId, log, escrowAddress);

  await markProcessed(chainId, log.transactionHash, Number(log.logIndex), escrowAddress, "Transfer");
}

/**
 * Process Escrow events.
 */
async function handleEscrowEvent(chainId: number, log: any, eventName: string) {
  const escrowAddress = (log.address as string).toLowerCase();
  
  if (await isProcessed(chainId, log.transactionHash, Number(log.logIndex))) {
    console.log(`⏭️  Already processed: ${log.transactionHash}:${log.logIndex}`);
    return;
  }

  console.log(`📢 ${eventName} on ${escrowAddress}`);
  await recordEscrowEvent(chainId, log, eventName);

  // Status mapping (mirrors the EscrowV2 Status enum)
  //   0 CREATED, 1 ACTIVE, 2 PENDING_MUTUAL_RESOLUTION, 3 SETTLED, 4 REFUNDED
  // Note: mutual-resolution finalize and arbitrator overrides ultimately emit
  // Settled/Refunded via the internal payout helpers, so those terminal states
  // are caught here. status >= 3 is terminal.
  const statusMap: Record<string, number> = {
    "SellerConfirmed": 1,
    "MutualResolutionPending": 2,
    "Settled": 3,
    "Refunded": 4,
    "UnderfundedRefunded": 4,
  };

  if (eventName in statusMap) {
    const newStatus = statusMap[eventName];
    await sql`
      UPDATE escrows
      SET phase_cached = ${newStatus}, updated_at = NOW()
      WHERE network = ${chainId.toString()}
      AND escrow = ${hexToBuffer(escrowAddress)}
    `;

    // Remove from active set if terminal
    if (newStatus >= 3) {
      removeActiveEscrow(chainId, escrowAddress);
    }
  }

  await markProcessed(chainId, log.transactionHash, Number(log.logIndex), escrowAddress, eventName);
}

function normalizeWebhookLogs(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.logs)) return payload.logs;
  if (Array.isArray(payload?.event?.data?.block?.logs)) return payload.event.data.block.logs;
  if (Array.isArray(payload?.event?.data?.logs)) return payload.event.data.logs;
  return [];
}

function normalizeRawLog(raw: any): any {
  return {
    address: String(raw.address ?? "").toLowerCase(),
    data: raw.data,
    topics: raw.topics,
    transactionHash: raw.transactionHash ?? raw.transaction?.hash,
    blockNumber: BigInt(raw.blockNumber ?? raw.block?.number ?? 0),
    logIndex: Number(raw.logIndex ?? raw.index ?? 0),
  };
}

function decodeKnownEvent(rawLog: any): { eventName: string; args: any } | null {
  for (const abi of [EscrowFactoryABI, EscrowABI, ERC20ABI]) {
    try {
      const decoded = decodeEventLog({
        abi,
        data: rawLog.data,
        topics: rawLog.topics,
      });
      return {
        eventName: decoded.eventName,
        args: decoded.args,
      };
    } catch {
      // Try next ABI.
    }
  }
  return null;
}

/**
 * Process logs delivered by a chain webhook provider.
 * Supports payloads with either a top-level `logs` array or Alchemy-style
 * `event.data.block.logs`.
 */
export async function processWebhookLogs(chainId: number, payload: any): Promise<{ processed: number; ignored: number }> {
  const network = getNetwork(chainId);
  const rawLogs = normalizeWebhookLogs(payload);
  let processed = 0;
  let ignored = 0;

  for (const raw of rawLogs) {
    const log = normalizeRawLog(raw);
    if (!log.address || !log.transactionHash || !Array.isArray(log.topics)) {
      ignored++;
      continue;
    }

    const decoded = decodeKnownEvent(log);
    if (!decoded) {
      ignored++;
      continue;
    }

    const decodedLog = { ...log, args: decoded.args };
    const eventName = decoded.eventName;

    if (log.address === network.FACTORY.toLowerCase() && eventName === "EscrowCreated") {
      await handleEscrowCreated(chainId, decodedLog);
      processed++;
      continue;
    }

    if (eventName === "Transfer") {
      const to = String((decoded.args as any).to ?? "").toLowerCase();
      if (to && await isKnownEscrow(chainId, to)) {
        await handleTokenTransfer(chainId, decodedLog, to);
        processed++;
      } else {
        ignored++;
      }
      continue;
    }

    if (ESCROW_EVENT_NAMES.includes(eventName as any) && await isKnownEscrow(chainId, log.address)) {
      await handleEscrowEvent(chainId, decodedLog, eventName);
      processed++;
      continue;
    }

    ignored++;
  }

  return { processed, ignored };
}

/**
 * Start WebSocket subscriptions
 */
export async function startWSS(chainId: number) {
  const network = getNetwork(chainId);
  const wsClient = getWsClient(chainId);
  await loadActiveEscrows(chainId);

  for (const escrow of chainEscrows(chainId)) {
    await startEscrowSubscriptions(chainId, escrow);
  }

  console.log(`✅ Loaded ${chainEscrows(chainId).size} active escrow subscriptions on ${network.name}`);

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
        await handleEscrowCreated(chainId, log);
      }
    },
    onError: (error) => {
      console.error("❌ WSS EscrowCreated error:", error);
    },
  });

  console.log("✅ WSS subscriptions active (factory, escrow actions, and token transfers)");
}

/**
 * Backfill / Replay from last block
 * 
 * This function can replay EscrowCreated events from a given block range
 * to recover if the oracle goes down. Transfer events are handled by the
 * keeper's reconciliation loop which does per-escrow queries.
 */
export async function startBackfill(chainId: number) {
  const network = getNetwork(chainId);
  const publicClient = getPublicClient(chainId);
  console.log(`🔄 Starting ${network.name} backfill check...`);
  
  try {
    // Get cursor (last processed block)
    const cursorRows = await sql`
      SELECT last_block FROM cursor WHERE network = ${chainId.toString()}
    `;
    
    const storedLastBlock = cursorRows.length > 0 ? BigInt(cursorRows[0].last_block) : 0n;
    const latestBlock = await publicClient.getBlockNumber();
    const configuredStartBlock = network.indexerStartBlock ? BigInt(network.indexerStartBlock) : 0n;
    const lastBlock = storedLastBlock === 0n
      ? (configuredStartBlock > 0n ? configuredStartBlock - 1n : latestBlock)
      : storedLastBlock;
    
    console.log(`📊 Cursor at block ${storedLastBlock}, effective start ${lastBlock}, latest block ${latestBlock}`);
    
    // Calculate safe start block with reorg buffer
    // This re-scans recent blocks to catch any events that might have been reorged
    const safeStartBlock = lastBlock > REORG_BUFFER_BLOCKS 
      ? lastBlock - REORG_BUFFER_BLOCKS 
      : 0n;
    
    // Track the last successfully processed block
    let lastSuccessfulBlock = safeStartBlock;
    
    // If we're behind, backfill EscrowCreated events
    if (latestBlock > safeStartBlock) {
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
              await handleEscrowCreated(chainId, log);
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
        VALUES (${chainId.toString()}, ${lastSuccessfulBlock.toString()}, NOW())
        ON CONFLICT (network) DO UPDATE SET last_block = ${lastSuccessfulBlock.toString()}, updated_at = NOW()
      `;
      console.log(`✅ Backfill complete, cursor updated to block ${lastSuccessfulBlock}`);
    } else {
      console.log(`✅ Backfill complete, cursor unchanged at block ${lastBlock}`);
    }
    
      console.log(`   Note: token transfers are indexed through active WSS subscriptions and webhooks`);
  } catch (error) {
    console.error("❌ Backfill error:", error);
  }
}

/**
 * Get all active escrow addresses
 */
export function getActiveEscrowAddresses(): string[] {
  return Array.from(activeEscrows.values()).flatMap((addresses) => Array.from(addresses));
}
