/**
 * V2 Keeper - Permissionless maintenance for Escrow contracts (Hybrid Confirmation Model)
 * 
 * Key characteristics:
 * - NO special privileges: anyone can call these functions
 * - Cannot change outcomes, only execute allowed transitions
 * - If this keeper goes down, parties (or anyone) can still finalize
 * 
 * This module provides functions to:
 * - Check if an escrow is ready for settlement
 * - Call permissionless maintenance functions
 * - Watch for escrows that need finalization
 * - Handle arb window sweep after deadline+7d
 */

import { publicClient, walletClient, oracleAccount } from "../blockchain/client.js";
import { EscrowABI, ERC20ABI } from "../contracts/abis.js";
import { nonceManager, retryWithBackoff } from "../blockchain/nonce-manager.js";

// Phase enum (synthetic, derived from state)
export enum Phase {
  AwaitingConfirmation = 0,
  ConfirmedAwaitingFunding = 1,
  Funded = 2,
  Resolved = 3,
  Expired = 4,
}

/**
 * Get full status of an escrow (hybrid confirmation model)
 */
export async function getEscrowStatus(escrowAddress: `0x${string}`) {
  const [
    phase,
    payout,
    funder,
    treasury,
    targetAmount,
    bondCap,
    deadline,
    confirmDeadline,
    arbWindowEnd,
    confirmed,
    resolved,
    expired,
    bondPresent,
    isFunded,
    fundedAmount,
    bondAvailable,
    arbitrator1,
    arbitrator2,
    arbitrator3,
    arbitratorCount,
    deadlocked,
    isPayable,
    isExpirableNoConfirm,
    isExpirableNoFund,
    isTerminal,
    isInArbWindow,
    isSweepableAfterArbWindow,
  ] = await Promise.all([
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "phase" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "payout" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "funder" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "treasury" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "targetAmount" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "bondCap" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "deadline" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "confirmDeadline" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "arbWindowEnd" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "confirmed" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "resolved" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "expired" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "bondPresent" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isFunded" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "fundedAmount" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "bondAvailable" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "arbitrator1" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "arbitrator2" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "arbitrator3" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "arbitratorCount" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "deadlocked" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isPayable" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isExpirableNoConfirm" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isExpirableNoFund" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isTerminal" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isInArbWindow" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isSweepableAfterArbWindow" }),
  ]);

  const phaseNames = [
    "AwaitingConfirmation",
    "ConfirmedAwaitingFunding", 
    "Funded",
    "Resolved",
    "Expired",
  ];

  return {
    escrow: escrowAddress,
    phase: Number(phase),
    phaseName: phaseNames[Number(phase)] || "Unknown",
    payout,
    funder,
    treasury,
    targetAmount: targetAmount.toString(),
    bondCap: bondCap.toString(),
    deadline: Number(deadline),
    confirmDeadline: Number(confirmDeadline),
    arbWindowEnd: Number(arbWindowEnd),
    // New hybrid model fields
    confirmed,
    resolved,
    expired,
    bondPresent,
    isFunded,
    fundedAmount: fundedAmount.toString(),
    bondAvailable: bondAvailable.toString(),
    // Arbitration (0, 1, or 3 arbitrators)
    arbitrator1,
    arbitrator2,
    arbitrator3,  // Deadlock arbitrator (3-arb setup only)
    arbitratorCount: Number(arbitratorCount),  // 0, 1, or 3 (never 2)
    deadlocked,  // True if arb1 and arb2 voted differently
    // Actionable states
    isPayable,
    isExpirableNoConfirm,
    isExpirableNoFund,
    isTerminal,
    isInArbWindow,
    isSweepableAfterArbWindow,
  };
}

/**
 * Call expireIfNotConfirmed() - permissionless
 * Expires escrow if confirm deadline passed without confirmation
 */
export async function callExpireIfNotConfirmed(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling expireIfNotConfirmed on ${escrowAddress}`);
  
  const txHash = await retryWithBackoff(async () => {
    const nonce = await nonceManager.getNonce();
    
    const hash = await walletClient.writeContract({
      address: escrowAddress,
      abi: EscrowABI,
      functionName: "expireIfNotConfirmed",
      nonce,
      account: oracleAccount,
    });

    nonceManager.increment();
    return hash;
  }, 3, 1000, "expireIfNotConfirmed");

  console.log(`✅ expireIfNotConfirmed tx: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Call expireIfNotFunded() - permissionless
 * Expires escrow if deadline passed without funding
 */
export async function callExpireIfNotFunded(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling expireIfNotFunded on ${escrowAddress}`);
  
  const txHash = await retryWithBackoff(async () => {
    const nonce = await nonceManager.getNonce();
    
    const hash = await walletClient.writeContract({
      address: escrowAddress,
      abi: EscrowABI,
      functionName: "expireIfNotFunded",
      nonce,
      account: oracleAccount,
    });

    nonceManager.increment();
    return hash;
  }, 3, 1000, "expireIfNotFunded");

  console.log(`✅ expireIfNotFunded tx: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Call finalizeAfterDeadline() - permissionless
 * Pays seller when confirmed, funded, no arbs, and deadline reached
 */
export async function callFinalizeAfterDeadline(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling finalizeAfterDeadline on ${escrowAddress}`);
  
  const txHash = await retryWithBackoff(async () => {
    const nonce = await nonceManager.getNonce();
    
    const hash = await walletClient.writeContract({
      address: escrowAddress,
      abi: EscrowABI,
      functionName: "finalizeAfterDeadline",
      nonce,
      account: oracleAccount,
    });

    nonceManager.increment();
    return hash;
  }, 3, 1000, "finalizeAfterDeadline");

  console.log(`✅ finalizeAfterDeadline tx: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Call sweepToTreasury() - permissionless
 * Sweeps late/stray funds after terminal state
 */
export async function callSweepToTreasury(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling sweepToTreasury on ${escrowAddress}`);
  
  const txHash = await retryWithBackoff(async () => {
    const nonce = await nonceManager.getNonce();
    
    const hash = await walletClient.writeContract({
      address: escrowAddress,
      abi: EscrowABI,
      functionName: "sweepToTreasury",
      nonce,
      account: oracleAccount,
    });

    nonceManager.increment();
    return hash;
  }, 3, 1000, "sweepToTreasury");

  console.log(`✅ sweepToTreasury tx: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Call sweepToTreasuryAfterArbWindow() - permissionless
 * Sweeps all funds to treasury when arb window ends without resolution
 */
export async function callSweepToTreasuryAfterArbWindow(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling sweepToTreasuryAfterArbWindow on ${escrowAddress}`);
  
  const txHash = await retryWithBackoff(async () => {
    const nonce = await nonceManager.getNonce();
    
    const hash = await walletClient.writeContract({
      address: escrowAddress,
      abi: EscrowABI,
      functionName: "sweepToTreasuryAfterArbWindow",
      nonce,
      account: oracleAccount,
    });

    nonceManager.increment();
    return hash;
  }, 3, 1000, "sweepToTreasuryAfterArbWindow");

  console.log(`✅ sweepToTreasuryAfterArbWindow tx: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Process a single escrow - check if any maintenance is needed
 * Returns action taken or null if no action needed
 */
export async function processEscrow(escrowAddress: `0x${string}`): Promise<string | null> {
  const status = await getEscrowStatus(escrowAddress);
  
  // Already resolved or expired
  if (status.isTerminal) {
    return null;
  }

  // Check if expirable (not confirmed by deadline)
  if (status.isExpirableNoConfirm) {
    console.log(`⏰ Escrow ${escrowAddress} is expirable (no confirm) - calling expireIfNotConfirmed`);
    await callExpireIfNotConfirmed(escrowAddress);
    return "expired_no_confirm";
  }

  // Check if expirable (not funded by deadline)
  if (status.isExpirableNoFund) {
    console.log(`⏰ Escrow ${escrowAddress} is expirable (no fund) - calling expireIfNotFunded`);
    await callExpireIfNotFunded(escrowAddress);
    return "expired_no_fund";
  }

  // Check if payable (no arbs, confirmed, funded, past deadline)
  if (status.isPayable) {
    console.log(`💰 Escrow ${escrowAddress} is payable - calling finalizeAfterDeadline`);
    await callFinalizeAfterDeadline(escrowAddress);
    return "finalized";
  }

  // Check if arb window ended without resolution
  if (status.isSweepableAfterArbWindow) {
    console.log(`🧹 Escrow ${escrowAddress} arb window ended - calling sweepToTreasuryAfterArbWindow`);
    await callSweepToTreasuryAfterArbWindow(escrowAddress);
    return "swept_after_arb_window";
  }

  // No action needed yet
  return null;
}

/**
 * Batch process multiple escrows
 */
export async function batchProcessEscrows(escrowAddresses: `0x${string}`[]): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  for (const addr of escrowAddresses) {
    try {
      const action = await processEscrow(addr);
      results.set(addr, action);
    } catch (error) {
      console.error(`❌ Error processing ${addr}:`, error);
      results.set(addr, null);
    }
  }
  
  return results;
}
