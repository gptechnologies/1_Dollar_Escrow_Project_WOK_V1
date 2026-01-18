/**
 * Keeper - Periodic maintenance for Escrow contracts (Hybrid Confirmation Model)
 * 
 * Responsibilities:
 * 1. RECONCILIATION: Scan for missed Transfer events (bond/confirmation deposits)
 * 2. FINALIZATION: Pay seller after deadline if funded (no arbitrators)
 * 3. EXPIRATION: Expire stale escrows (not confirmed or not funded)
 * 4. SWEEPING: Sweep late funds from terminal escrows
 * 5. ARB WINDOW SWEEP: Sweep to treasury after arb window ends without resolution
 * 
 * Key change from V1:
 * - No longer calls recordFunding() - funding is derived from on-chain balance
 * - Detects bond transfers and calls confirmByOracle() when $1 bond is present
 * - Monitors arb window and calls sweepToTreasuryAfterArbWindow()
 */

import { publicClient } from "../blockchain/client.js";
import { EscrowABI, ERC20ABI } from "../contracts/abis.js";
import { getNetwork } from "../config/networks.js";
import { 
  getActiveEscrows,
  callFinalizeAfterDeadline,
  callExpireIfNotConfirmed,
  callExpireIfNotFunded,
  callSweepToTreasury,
  callSweepToTreasuryAfterArbWindow,
  confirmByOracle,
} from "../services/escrow.js";
import { sql, bufferToHex, hexToBuffer } from "../db/client.js";
import { ENV } from "../config/env.js";

const network = getNetwork(ENV.CHAIN_ID);
const KEEPER_INTERVAL_MS = 60_000; // Check every 60 seconds
const MAX_BLOCK_LOOKBACK = 1000n; // Max blocks to scan per escrow (total)
const CHUNK_SIZE = 9n; // Alchemy free tier allows max 10 blocks per getLogs call
const RECONCILE_DELAY_MS = 500; // Delay between escrow reconciliations to avoid rate limits
const CHUNK_DELAY_MS = 100; // Delay between chunks within a reconciliation

// Helper for delays
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function isProcessed(txHash: string, escrow: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM processed_tx
    WHERE tx_hash = ${txHash} AND escrow = ${hexToBuffer(escrow)}
  `;
  return rows.length > 0;
}

async function markProcessed(txHash: string, escrow: string, eventType: string) {
  await sql`
    INSERT INTO processed_tx (tx_hash, escrow, event_type)
    VALUES (${txHash}, ${hexToBuffer(escrow)}, ${eventType})
    ON CONFLICT (tx_hash, escrow) DO NOTHING
  `;
}

/**
 * Reconcile a single escrow - scan for missed Transfer events
 * 
 * In the hybrid model:
 * - Phase 0 (not confirmed): Look for bond transfer from seller, then call confirmByOracle()
 * - Phase 1+ (confirmed): No recordFunding needed - funding is derived from balance
 * 
 * This handles the case where WSS missed a transfer (e.g., oracle was down).
 */
async function reconcileEscrow(escrow: {
  escrow: string;
  phase: number;
  payout: string;
  funder: string;
  token: string | null;
  targetAmount: string;
  createdBlock: bigint | null;
}): Promise<string | null> {
  const escrowAddress = escrow.escrow as `0x${string}`;
  const payoutAddress = escrow.payout.toLowerCase() as `0x${string}`;
  
  try {
    // Get current chain state including token address
    const [confirmed, bondPresent, bondCap, tokenAddress] = await Promise.all([
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "confirmed" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "bondPresent" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "bondCap" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "token" }),
    ]);

    // Use on-chain token if DB doesn't have it (backward compatibility)
    const escrowToken = (escrow.token || tokenAddress) as `0x${string}`;

    const latestBlock = await publicClient.getBlockNumber();
    
    // Calculate bounded block range - limit total lookback
    const scanFromBlock = escrow.createdBlock 
      ? (latestBlock - escrow.createdBlock > MAX_BLOCK_LOOKBACK 
          ? latestBlock - MAX_BLOCK_LOOKBACK 
          : escrow.createdBlock)
      : latestBlock - MAX_BLOCK_LOOKBACK;

    // Helper to scan in 10-block chunks (Alchemy free tier limit)
    async function scanForTransfer(
      tokenAddr: `0x${string}`,
      fromAddr: `0x${string}`,
      toAddr: `0x${string}`,
      fromBlock: bigint,
      toBlock: bigint
    ) {
      const allLogs: any[] = [];
      let cursor = fromBlock;
      
      while (cursor <= toBlock) {
        const chunkEnd = cursor + CHUNK_SIZE <= toBlock ? cursor + CHUNK_SIZE : toBlock;
        
        const logs = await publicClient.getLogs({
          address: tokenAddr,
          event: ERC20ABI[0],
          args: {
            from: fromAddr,
            to: toAddr,
          },
          fromBlock: cursor,
          toBlock: chunkEnd,
        });
        
        allLogs.push(...logs);
        
        cursor = chunkEnd + 1n;
        
        // Small delay between chunks to avoid rate limits
        if (cursor <= toBlock) {
          await sleep(CHUNK_DELAY_MS);
        }
      }
      
      return allLogs;
    }

    // Only reconcile bond confirmation if not yet confirmed
    // In hybrid model, seller can self-confirm or oracle can confirm with bond
    if (!confirmed && !bondPresent) {
      console.log(`🔍 Scanning for bond transfer to ${escrowAddress} from ${payoutAddress} (token: ${escrowToken})`);
      
      const transferLogs = await scanForTransfer(
        escrowToken,
        payoutAddress,
        escrowAddress,
        scanFromBlock,
        latestBlock
      );

      // Find valid bond transfer (>= bondCap)
      for (const log of transferLogs) {
        const value = log.args.value as bigint;
        
        // Must be at least bondCap ($1)
        if (value >= bondCap) {
          if (await isProcessed(log.transactionHash, escrowAddress)) {
            continue;
          }
          
          // Check if escrow now has the bond
          const balance = await publicClient.readContract({
            address: escrowToken,
            abi: ERC20ABI,
            functionName: "balanceOf",
            args: [escrowAddress],
          }) as bigint;
          
          if (balance >= bondCap) {
            console.log(`✅ Found bond transfer: ${value} from ${payoutAddress} in tx ${log.transactionHash}`);
            
            await confirmByOracle({
              escrow: escrowAddress,
              txHash: log.transactionHash,
            });
            await markProcessed(log.transactionHash, escrowAddress, "BondTransfer");
            
            return "reconciled_bond_confirmation";
          }
        }
      }
    }

    // Note: We no longer call recordFunding() for buyer deposits.
    // Funding is derived from on-chain balance via isFunded().
    // The keeper will detect when isFunded() becomes true and can finalize.

    return null; // No reconciliation needed
  } catch (error) {
    console.error(`❌ Reconciliation error for ${escrowAddress}:`, error);
    return null;
  }
}

/**
 * Process a single escrow - check if any action is needed
 */
async function processEscrow(escrowAddress: `0x${string}`, arbitratorCount: number): Promise<string | null> {
  try {
    // Read actionable states from chain
    const [
      confirmed,
      resolved,
      expired,
      isFunded,
      isPayable,
      isExpirableNoConfirm,
      isExpirableNoFund,
      isTerminal,
      isSweepableAfterArbWindow,
    ] = await Promise.all([
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "confirmed" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "resolved" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "expired" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isFunded" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isPayable" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isExpirableNoConfirm" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isExpirableNoFund" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isTerminal" }),
      publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isSweepableAfterArbWindow" }),
    ]);

    // Calculate synthetic phase for DB update
    let phase = 0;
    if (expired) phase = 4;
    else if (resolved) phase = 3;
    else if (!confirmed) phase = 0;
    else if (!isFunded) phase = 1;
    else phase = 2;

    // Priority order of actions

    // 1. Finalize if payable (no arbs, confirmed, funded, past deadline)
    if (isPayable) {
      console.log(`💰 Escrow ${escrowAddress} is payable - finalizing...`);
      await callFinalizeAfterDeadline(escrowAddress);
      return "finalized";
    }

    // 2. Expire if not confirmed within 24h
    if (isExpirableNoConfirm) {
      console.log(`⏰ Escrow ${escrowAddress} expired (no confirmation) - expiring...`);
      await callExpireIfNotConfirmed(escrowAddress);
      return "expired_no_confirm";
    }

    // 3. Expire if confirmed but not funded by deadline
    if (isExpirableNoFund) {
      console.log(`⏰ Escrow ${escrowAddress} expired (no funding) - expiring and returning bond...`);
      await callExpireIfNotFunded(escrowAddress);
      return "expired_no_fund";
    }

    // 4. Sweep to treasury after arb window ends (for escrows with arbitrators)
    if (isSweepableAfterArbWindow) {
      console.log(`🧹 Escrow ${escrowAddress} arb window ended without resolution - sweeping to treasury...`);
      await callSweepToTreasuryAfterArbWindow(escrowAddress);
      return "swept_after_arb_window";
    }

    // 5. If terminal, check if there's anything to sweep (late/stray funds)
    if (isTerminal) {
      // Update phase in DB
      await sql`
        UPDATE escrows SET phase_cached = ${phase}, updated_at = NOW()
        WHERE escrow = ${hexToBuffer(escrowAddress)}
      `;

      const token = await publicClient.readContract({
        address: escrowAddress,
        abi: EscrowABI,
        functionName: "token",
      }) as `0x${string}`;

      // Check token balance
      const tokenBalance = await publicClient.readContract({
        address: token,
        abi: ERC20ABI,
        functionName: "balanceOf",
        args: [escrowAddress],
      }) as bigint;

      if (tokenBalance > 0n) {
        console.log(`🧹 Escrow ${escrowAddress} has ${tokenBalance} to sweep...`);
        await callSweepToTreasury(escrowAddress);
        return "swept";
      }
    }

    // Update phase cache in DB if changed
    await sql`
      UPDATE escrows SET phase_cached = ${phase}, updated_at = NOW()
      WHERE escrow = ${hexToBuffer(escrowAddress)}
      AND phase_cached != ${phase}
    `;

    return null; // No action needed
  } catch (error) {
    console.error(`❌ Error processing ${escrowAddress}:`, error);
    return null;
  }
}

/**
 * Run a single keeper round
 * 
 * Steps:
 * 1. RECONCILE: Scan for missed bond Transfer events (for confirmation)
 * 2. PROCESS: Check for actions (finalize, expire, sweep, arb window sweep)
 */
async function keeperRound() {
  console.log(`\n🔄 Keeper round starting...`);
  
  try {
    const activeEscrows = await getActiveEscrows();
    console.log(`📊 Found ${activeEscrows.length} active escrows`);

    let reconciliations = 0;
    let actions = 0;
    
    // Step 1: Reconcile - scan for missed bond transfers
    // Only reconcile escrows in phase 0 (awaiting confirmation)
    const escrowsNeedingReconciliation = activeEscrows.filter(e => e.phase === 0);
    
    if (escrowsNeedingReconciliation.length > 0) {
      console.log(`🔍 Reconciling ${escrowsNeedingReconciliation.length} escrows awaiting confirmation...`);
      
      for (const escrow of escrowsNeedingReconciliation) {
        const result = await reconcileEscrow(escrow);
        if (result) {
          console.log(`  ✅ ${escrow.escrow}: ${result}`);
          reconciliations++;
        }
        
        // Delay between reconciliations to avoid rate limits
        if (escrowsNeedingReconciliation.length > 1) {
          await sleep(RECONCILE_DELAY_MS);
        }
      }
    }

    // Step 2: Process - check for actions (finalize, expire, sweep, arb window sweep)
    // Re-fetch active escrows in case reconciliation changed phases
    const escrowsForProcessing = reconciliations > 0 ? await getActiveEscrows() : activeEscrows;
    
    for (const escrow of escrowsForProcessing) {
      const result = await processEscrow(escrow.escrow as `0x${string}`, escrow.arbitratorCount);
      if (result) {
        console.log(`  ✅ ${escrow.escrow}: ${result}`);
        actions++;
      }
      
      // Small delay between processing to avoid rate limits
      if (escrowsForProcessing.length > 1) {
        await sleep(200);
      }
    }

    // Also check recently-terminal escrows for sweeping
    const terminalRows = await sql`
      SELECT escrow FROM escrows
      WHERE network = ${ENV.CHAIN_ID.toString()}
      AND phase_cached >= 3
      AND updated_at > NOW() - INTERVAL '1 hour'
    `;

    for (const row of terminalRows) {
      const escrowAddress = bufferToHex(row.escrow as Buffer) as `0x${string}`;
      const result = await processEscrow(escrowAddress, 0);
      if (result) {
        console.log(`  ✅ ${escrowAddress}: ${result}`);
        actions++;
      }
    }

    console.log(`🔄 Keeper round complete. Reconciliations: ${reconciliations}, Actions: ${actions}\n`);
  } catch (error) {
    console.error(`❌ Keeper round error:`, error);
  }
}

/**
 * Start the keeper loop
 */
export function startKeeper() {
  console.log(`🤖 Starting keeper loop (interval: ${KEEPER_INTERVAL_MS / 1000}s)...`);
  console.log(`   Hybrid confirmation model: bond detection + derived funding`);
  
  // Run immediately
  keeperRound();
  
  // Then on interval
  setInterval(keeperRound, KEEPER_INTERVAL_MS);
}

/**
 * Run a single keeper round (for testing/manual trigger)
 */
export { keeperRound };
