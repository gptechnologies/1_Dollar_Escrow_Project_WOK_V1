/**
 * Event processor logic - Hybrid Confirmation Model
 * 
 * Key changes from V1:
 * - No longer calls recordFunding() - funding is derived from on-chain balance
 * - Bond detection: if seller sends >= bondCap to escrow, can call confirmByOracle()
 * - Seller can self-confirm without bond via confirm() (handled on-chain, not here)
 * 
 * Rules:
 * - Bond/Confirmation: seller sends >= bondCap ($1) to escrow within 24h
 *   -> Oracle calls confirmByOracle(txHash) if balance >= bondCap
 * - Funding: buyer sends tokens to escrow (no oracle call needed!)
 *   -> isFunded() is derived from balance >= targetAmount
 * - Late transfers: ignored (will be swept later)
 */

import { EscrowJobData } from "./queue.js";
import { publicClient } from "../blockchain/client.js";
import { EscrowABI, ERC20ABI } from "../contracts/abis.js";
import { confirmByOracle } from "../services/escrow.js";

export async function processEscrowJob(data: EscrowJobData) {
  const { escrow, eventType, args, txHash } = data;

  if (eventType === "Transfer") {
    // This is a token transfer to the escrow
    // In hybrid model, we only need to detect bond transfers for oracle confirmation
    // Funding is derived from balance - no oracle call needed
    
    // Validate transfer destination matches the escrow we're processing
    const to = (args.to as string).toLowerCase();
    if (to !== escrow.toLowerCase()) {
      console.log(`⚠️ Transfer destination ${to} != escrow ${escrow}. Skipping.`);
      return;
    }
    
    // Read current state from chain (including terminal state for pre-check)
    const [
      confirmed,
      bondPresent,
      bondCap,
      payout,
      confirmDeadline,
      token,
      resolved,
      expired,
    ] = await Promise.all([
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "confirmed",
      }),
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "bondPresent",
      }),
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "bondCap",
      }),
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "payout",
      }),
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "confirmDeadline",
      }),
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "token",
      }),
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "resolved",
      }),
      publicClient.readContract({
        address: escrow as `0x${string}`,
        abi: EscrowABI,
        functionName: "expired",
      }),
    ]);

    // Pre-check: Skip if escrow is already in terminal state (saves gas)
    if (resolved || expired) {
      console.log(`⏭️ Escrow ${escrow} already terminal (resolved=${resolved}, expired=${expired}). Skipping.`);
      return;
    }

    const transferAmount = BigInt(args.value);
    const from = (args.from as string).toLowerCase();
    const now = Math.floor(Date.now() / 1000);

    console.log(`🔍 Analyzing transfer of ${transferAmount} to ${escrow}`);
    console.log(`   Confirmed: ${confirmed}, BondPresent: ${bondPresent}`);
    console.log(`   From: ${from}, Payout (seller): ${payout}`);

    // Only process bond detection if not yet confirmed
    if (!confirmed && !bondPresent) {
      const payoutAddr = (payout as string).toLowerCase();
      
      // Check timing
      if (now > Number(confirmDeadline)) {
        console.log(`⏰ Transfer too late - confirm deadline passed (${confirmDeadline}). Ignoring.`);
        return;
      }
      
      // Check if this is a bond transfer from seller
      if (from !== payoutAddr) {
        console.log(`ℹ️ Transfer not from seller (${payoutAddr}). Could be buyer funding - no oracle action needed.`);
        console.log(`   Funding is derived from balance via isFunded()`);
        return;
      }
      
      // Check if transfer is large enough to be a bond
      if (transferAmount < bondCap) {
        console.log(`ℹ️ Transfer amount ${transferAmount} < bondCap ${bondCap}. Not a valid bond.`);
        return;
      }
      
      // Verify escrow balance has the bond
      const escrowBalance = await publicClient.readContract({
        address: token as `0x${string}`,
        abi: ERC20ABI,
        functionName: "balanceOf",
        args: [escrow as `0x${string}`],
      }) as bigint;
      
      if (escrowBalance < bondCap) {
        console.log(`⚠️ Escrow balance ${escrowBalance} < bondCap ${bondCap}. Bond not present.`);
        return;
      }
      
      console.log(`✅ Valid bond transfer detected! Calling confirmByOracle...`);
      try {
        await confirmByOracle({
          escrow: escrow as `0x${string}`,
          txHash: txHash,
        });
        console.log(`✅ confirmByOracle successful for ${escrow}`);
      } catch (error) {
        // This might fail if seller already self-confirmed
        console.log(`⚠️ confirmByOracle failed (seller may have self-confirmed):`, error);
      }
    } 
    else if (confirmed) {
      // Escrow already confirmed - this might be buyer funding
      // In hybrid model, no oracle call needed for funding
      // The isFunded() view function will return true when balance >= targetAmount
      console.log(`ℹ️ Escrow already confirmed. Transfer will be recognized via isFunded().`);
      console.log(`   No oracle action needed - funding is derived from balance.`);
    }
    else {
      console.log(`ℹ️ BondPresent=${bondPresent}, no further processing needed.`);
    }
  }
}
