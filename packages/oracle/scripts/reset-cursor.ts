/**
 * Reset cursor to current block
 * 
 * Use this when you know there are no escrows to backfill and want to skip
 * the slow backfill process (especially on Alchemy free tier).
 * 
 * Usage: npm run reset-cursor
 */

import { sql } from "../src/db/client.js";
import { publicClient } from "../src/blockchain/client.js";
import { ENV } from "../src/config/env.js";

async function resetCursor() {
  console.log(`🔄 Resetting cursor for network ${ENV.CHAIN_ID}...`);
  
  try {
    // Get current block from chain
    const latestBlock = await publicClient.getBlockNumber();
    
    // Get current cursor value
    const cursorRows = await sql`
      SELECT last_block FROM cursor WHERE network = ${ENV.CHAIN_ID.toString()}
    `;
    const currentCursor = cursorRows.length > 0 ? BigInt(cursorRows[0].last_block) : 0n;
    
    console.log(`📊 Current cursor: block ${currentCursor}`);
    console.log(`📊 Latest block:   ${latestBlock}`);
    
    if (currentCursor >= latestBlock) {
      console.log(`✅ Cursor is already up to date, nothing to do.`);
      process.exit(0);
    }
    
    const gap = latestBlock - currentCursor;
    console.log(`📊 Gap: ${gap} blocks`);
    
    // Update cursor to latest block
    await sql`
      INSERT INTO cursor (network, last_block, updated_at)
      VALUES (${ENV.CHAIN_ID.toString()}, ${latestBlock.toString()}, NOW())
      ON CONFLICT (network) DO UPDATE SET last_block = ${latestBlock.toString()}, updated_at = NOW()
    `;
    
    console.log(`✅ Cursor reset to block ${latestBlock} for network ${ENV.CHAIN_ID}`);
    console.log(`   Skipped ${gap} blocks of backfill`);
    process.exit(0);
  } catch (error) {
    console.error(`❌ Failed to reset cursor:`, error);
    process.exit(1);
  }
}

resetCursor();
