/**
 * Escrow service functions - interact with smart contracts
 * 
 * Hybrid Confirmation Model:
 * - Seller can self-confirm via confirm() (no bond required)
 * - Oracle can confirm via confirmByOracle(txHash) when $1 bond is present
 * - Funding is derived from on-chain balance (isFunded()) - no recordFunding()
 * - Arbitrators can only act during [deadline, arbWindowEnd]
 * 
 * TX Queue Integration:
 * - All blockchain transactions go through the TX queue for reliability
 * - Enables speed-up/replacement of stuck transactions
 * - Prevents nonce conflicts and wallet lockup
 */

import { parseEventLogs } from "viem";
import { publicClient } from "../blockchain/client.js";
import { EscrowFactoryABI, EscrowABI } from "../contracts/abis.js";
import { ENV } from "../config/env.js";
import { getNetwork } from "../config/networks.js";
import { sql, hexToBuffer, bufferToHex } from "../db/client.js";
import { nanoid } from "nanoid";
import { submitTxJobAndWait } from "../blockchain/tx-queue.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Phase enum matching the contract (synthetic/legacy)
export enum Phase {
  AwaitingConfirmation = 0,
  ConfirmedAwaitingFunding = 1,
  Funded = 2,
  Resolved = 3,
  Expired = 4,
}

const PHASE_NAMES = [
  "AwaitingConfirmation",
  "ConfirmedAwaitingFunding", 
  "Funded",
  "Resolved",
  "Expired",
];

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;

/**
 * Create a new escrow via EscrowFactory
 * Both payout (seller) and funder (buyer) are bound immutably
 * Token must be USDC or USDT (allowlisted in factory)
 * 
 * Arbitrator rules: 0, 1, or 3 arbitrators only (never 2)
 * - 0: No arbitration
 * - 1: Single arbitrator (first vote resolves)
 * - 3: Three arbitrators (arb1+arb2 must agree, or arb3 breaks deadlock)
 */
export async function createEscrow(params: {
  payout: `0x${string}`;      // seller - receives funds
  funder: `0x${string}`;      // buyer - must fund
  token: `0x${string}`;       // USDC or USDT address
  targetAmount: bigint;       // amount buyer must fund
  deadline: number;           // unix timestamp for payout
  arbitrator1?: `0x${string}`;
  arbitrator2?: `0x${string}`;
  arbitrator3?: `0x${string}`; // deadlock arbitrator (requires arb1 + arb2)
}): Promise<{ 
  escrow: string; 
  code: string; 
  txHash: string;
  token: string;
  confirmDeadline: number;
  arbWindowEnd: number;
}> {
  
  const code = nanoid(10); // Generate unique 10-char code

  // Validate arbitrators - enforce 0/1/3 rule
  const arbitrator1 = params.arbitrator1 ?? ZERO_ADDRESS;
  const arbitrator2 = params.arbitrator2 ?? ZERO_ADDRESS;
  const arbitrator3 = params.arbitrator3 ?? ZERO_ADDRESS;

  const hasArb1 = arbitrator1 !== ZERO_ADDRESS;
  const hasArb2 = arbitrator2 !== ZERO_ADDRESS;
  const hasArb3 = arbitrator3 !== ZERO_ADDRESS;

  // Enforce 0/1/3 rule: either none, only arb1, or all three
  if (hasArb2 || hasArb3) {
    if (!hasArb1 || !hasArb2 || !hasArb3) {
      throw new Error("Must have 0, 1, or 3 arbitrators (2 not allowed)");
    }
  }

  // Submit TX via queue and wait for completion
  const result = await submitTxJobAndWait("createEscrow", {
    payout: params.payout,
    funder: params.funder,
    token: params.token,
    targetAmount: params.targetAmount.toString(),
    deadline: params.deadline,
    arbitrator1,
    arbitrator2,
    arbitrator3,
  }, {
    timeoutMs: 180_000, // 3 minute timeout for creation
  });

  const txHash = result.txHash;
  console.log(`📝 Escrow creation tx completed: ${txHash}`);

  // Get receipt and parse EscrowCreated event
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  
  const logs = parseEventLogs({
    abi: EscrowFactoryABI,
    logs: receipt.logs,
    eventName: "EscrowCreated",
  });

  if (logs.length === 0) {
    throw new Error("EscrowCreated event not found in receipt");
  }

  const event = logs[0].args as any;
  const escrowAddress = event.escrow as string;
  const tokenAddress = event.token as string;
  const confirmDeadline = Number(event.confirmDeadline);
  const arbWindowEnd = Number(event.arbWindowEnd);
  const createdBlock = receipt.blockNumber;

  // Store in database
  const arbitrator1Stored = arbitrator1 === ZERO_ADDRESS ? null : hexToBuffer(arbitrator1);
  const arbitrator2Stored = arbitrator2 === ZERO_ADDRESS ? null : hexToBuffer(arbitrator2);
  const arbitrator3Stored = arbitrator3 === ZERO_ADDRESS ? null : hexToBuffer(arbitrator3);

  await sql`
    INSERT INTO escrows (
      escrow, code, network, payout, funder, token, target_amount, 
      deadline, confirm_deadline, phase_cached, created_tx, created_block,
      arbitrator1, arbitrator2, arbitrator3, arb_window_end
    )
    VALUES (
      ${hexToBuffer(escrowAddress)},
      ${code},
      ${ENV.CHAIN_ID.toString()},
      ${hexToBuffer(params.payout)},
      ${hexToBuffer(params.funder)},
      ${hexToBuffer(tokenAddress)},
      ${params.targetAmount.toString()},
      ${params.deadline},
      ${confirmDeadline},
      0,
      ${txHash},
      ${createdBlock.toString()},
      ${arbitrator1Stored},
      ${arbitrator2Stored},
      ${arbitrator3Stored},
      ${arbWindowEnd}
    )
  `;

  console.log(`✅ Escrow created: ${escrowAddress} (code: ${code}, token: ${tokenAddress})`);

  return {
    escrow: escrowAddress,
    code,
    txHash,
    token: tokenAddress,
    confirmDeadline,
    arbWindowEnd,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Permissionless Registration (index on-chain escrow into DB)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shared upsert for both registerEscrow() and watcher backfill.
 * Idempotent: ON CONFLICT (escrow) preserves existing code and only back-fills
 * missing created_tx / created_block.
 */
export async function upsertEscrowFromEvent(params: {
  escrowAddress: string;
  payout: string;
  funder: string;
  tokenAddress: string;
  targetAmount: string;
  deadline: number;
  confirmDeadline: number;
  arbWindowEnd: number;
  arbitrator1: string;
  arbitrator2: string;
  arbitrator3: string;
  txHash: string;
  createdBlock: string;
}): Promise<{ code: string; isNew: boolean }> {
  const arb1Buf = params.arbitrator1 === ZERO_ADDRESS ? null : hexToBuffer(params.arbitrator1);
  const arb2Buf = params.arbitrator2 === ZERO_ADDRESS ? null : hexToBuffer(params.arbitrator2);
  const arb3Buf = params.arbitrator3 === ZERO_ADDRESS ? null : hexToBuffer(params.arbitrator3);

  // Check if already indexed
  const existing = await sql`
    SELECT code FROM escrows WHERE escrow = ${hexToBuffer(params.escrowAddress)}
  `;

  if (existing.length > 0) {
    // Back-fill created_tx / created_block if they were missing
    await sql`
      UPDATE escrows
      SET created_tx = COALESCE(escrows.created_tx, ${params.txHash}),
          created_block = COALESCE(escrows.created_block, ${params.createdBlock}),
          updated_at = NOW()
      WHERE escrow = ${hexToBuffer(params.escrowAddress)}
    `;
    return { code: existing[0].code as string, isNew: false };
  }

  const code = nanoid(10);

  await sql`
    INSERT INTO escrows (
      escrow, code, network, payout, funder, token, target_amount,
      deadline, confirm_deadline, phase_cached, created_tx, created_block,
      arbitrator1, arbitrator2, arbitrator3, arb_window_end
    )
    VALUES (
      ${hexToBuffer(params.escrowAddress)},
      ${code},
      ${ENV.CHAIN_ID.toString()},
      ${hexToBuffer(params.payout)},
      ${hexToBuffer(params.funder)},
      ${hexToBuffer(params.tokenAddress)},
      ${params.targetAmount},
      ${params.deadline},
      ${params.confirmDeadline},
      0,
      ${params.txHash},
      ${params.createdBlock},
      ${arb1Buf},
      ${arb2Buf},
      ${arb3Buf},
      ${params.arbWindowEnd}
    )
    ON CONFLICT (escrow) DO UPDATE SET
      created_tx = COALESCE(escrows.created_tx, EXCLUDED.created_tx),
      created_block = COALESCE(escrows.created_block, EXCLUDED.created_block),
      updated_at = NOW()
  `;

  return { code, isNew: true };
}

/**
 * Register an on-chain escrow by verifying a transaction receipt.
 * Public endpoint — validates receipt, parses event, upserts into DB.
 */
export async function registerEscrow(txHash: string): Promise<{
  escrow: string;
  code: string;
  txHash: string;
  token: string;
  phase: number;
  confirmDeadline: number;
  arbWindowEnd: number;
}> {
  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  if (receipt.status !== "success") {
    throw new Error("Transaction failed or was reverted");
  }

  // Verify the tx was sent to the factory for this network
  const network = getNetwork(ENV.CHAIN_ID);
  if (receipt.to?.toLowerCase() !== network.FACTORY.toLowerCase()) {
    throw new Error("Transaction was not sent to the EscrowFactory");
  }

  const logs = parseEventLogs({
    abi: EscrowFactoryABI,
    logs: receipt.logs,
    eventName: "EscrowCreated",
  });

  if (logs.length === 0) {
    throw new Error("EscrowCreated event not found in receipt");
  }

  const event = logs[0].args as any;
  const escrowAddress = (event.escrow as string).toLowerCase();
  const tokenAddress = event.token as string;
  const confirmDeadline = Number(event.confirmDeadline);
  const arbWindowEnd = Number(event.arbWindowEnd);

  const { code } = await upsertEscrowFromEvent({
    escrowAddress,
    payout: event.payout as string,
    funder: event.funder as string,
    tokenAddress,
    targetAmount: event.targetAmount.toString(),
    deadline: Number(event.deadline),
    confirmDeadline,
    arbWindowEnd,
    arbitrator1: event.arbitrator1 as string,
    arbitrator2: event.arbitrator2 as string,
    arbitrator3: event.arbitrator3 as string,
    txHash,
    createdBlock: receipt.blockNumber.toString(),
  });

  console.log(`📋 Escrow registered: ${escrowAddress} (code: ${code})`);

  return {
    escrow: escrowAddress,
    code,
    txHash,
    token: tokenAddress,
    phase: 0,
    confirmDeadline,
    arbWindowEnd,
  };
}

/**
 * Get escrow status from chain and DB
 * Now reads new fields: confirmed, resolved, expired, bondPresent, isFunded(), arbWindowEnd
 */
export async function getEscrowStatus(code: string): Promise<{
  escrow: string;
  code: string;
  phase: number;
  phaseName: string;
  payout: string;
  funder: string;
  token: string;
  targetAmount: string;
  fundedAmount: string;
  bondCap: string;
  deadline: number;
  confirmDeadline: number;
  arbWindowEnd: number;
  createdAt: number;
  // New hybrid model fields
  confirmed: boolean;
  resolved: boolean;
  expired: boolean;
  bondPresent: boolean;
  isFunded: boolean;
  // Arbitration (0, 1, or 3 arbitrators)
  arbitrator1: string;
  arbitrator2: string;
  arbitrator3: string;  // Deadlock arbitrator (3-arb setup only)
  arbitratorCount: number;  // 0, 1, or 3 (never 2)
  deadlocked: boolean;  // True if arb1 and arb2 voted differently
  // Actionable states
  isPayable: boolean;
  isExpirableNoConfirm: boolean;
  isExpirableNoFund: boolean;
  isTerminal: boolean;
  isInArbWindow: boolean;
  isSweepableAfterArbWindow: boolean;
}> {
  
  // Look up in DB
  const rows = await sql`
    SELECT escrow FROM escrows WHERE code = ${code}
  `;

  if (rows.length === 0) {
    throw new Error(`Escrow not found for code: ${code}`);
  }

  const escrowAddress = bufferToHex(rows[0].escrow as Buffer) as `0x${string}`;

  // Read all state from chain
  const [
    phase,
    payout,
    funder,
    token,
    targetAmount,
    fundedAmount,
    bondCap,
    deadline,
    confirmDeadline,
    arbWindowEnd,
    createdAt,
    confirmed,
    resolved,
    expired,
    bondPresent,
    isFunded,
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
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "token" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "targetAmount" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "fundedAmount" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "bondCap" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "deadline" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "confirmDeadline" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "arbWindowEnd" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "createdAt" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "confirmed" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "resolved" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "expired" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "bondPresent" }),
    publicClient.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isFunded" }),
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

  // Update phase cache in DB
  await sql`
    UPDATE escrows SET phase_cached = ${Number(phase)}, updated_at = NOW()
    WHERE code = ${code}
  `;

  return {
    escrow: escrowAddress,
    code,
    phase: Number(phase),
    phaseName: PHASE_NAMES[Number(phase)] || "Unknown",
    payout: payout as string,
    funder: funder as string,
    token: token as string,
    targetAmount: (targetAmount as bigint).toString(),
    fundedAmount: (fundedAmount as bigint).toString(),
    bondCap: (bondCap as bigint).toString(),
    deadline: Number(deadline),
    confirmDeadline: Number(confirmDeadline),
    arbWindowEnd: Number(arbWindowEnd),
    createdAt: Number(createdAt),
    confirmed: confirmed as boolean,
    resolved: resolved as boolean,
    expired: expired as boolean,
    bondPresent: bondPresent as boolean,
    isFunded: isFunded as boolean,
    arbitrator1: arbitrator1 as string,
    arbitrator2: arbitrator2 as string,
    arbitrator3: arbitrator3 as string,
    arbitratorCount: Number(arbitratorCount),  // 0, 1, or 3 (never 2)
    deadlocked: deadlocked as boolean,
    isPayable: isPayable as boolean,
    isExpirableNoConfirm: isExpirableNoConfirm as boolean,
    isExpirableNoFund: isExpirableNoFund as boolean,
    isTerminal: isTerminal as boolean,
    isInArbWindow: isInArbWindow as boolean,
    isSweepableAfterArbWindow: isSweepableAfterArbWindow as boolean,
  };
}

/**
 * Oracle confirms escrow after detecting seller's bond transfer ($1).
 * Called when oracle detects USDC/USDT transfer from seller to escrow.
 * Requires bond to already be present in escrow balance.
 */
export async function confirmByOracle(params: {
  escrow: `0x${string}`;
  txHash: string;
}): Promise<string> {
  const result = await submitTxJobAndWait("confirmByOracle", {
    escrow: params.escrow,
    txHash: params.txHash,
  });

  console.log(`📝 confirmByOracle tx completed: ${result.txHash}`);
  
  // Update DB
  await sql`
    UPDATE escrows SET phase_cached = 1, updated_at = NOW()
    WHERE escrow = ${hexToBuffer(params.escrow)}
  `;
  
  return result.txHash;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Keeper functions (permissionless on chain, but we call them for convenience)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Finalize and pay seller after deadline (no arbitrators only)
 */
export async function callFinalizeAfterDeadline(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling finalizeAfterDeadline on ${escrowAddress}`);
  
  const result = await submitTxJobAndWait("finalizeAfterDeadline", {
    escrow: escrowAddress,
  });

  console.log(`✅ finalizeAfterDeadline tx: ${result.txHash}`);
  
  // Update DB
  await sql`
    UPDATE escrows SET phase_cached = 3, updated_at = NOW()
    WHERE escrow = ${hexToBuffer(escrowAddress)}
  `;
  
  return result.txHash;
}

/**
 * Expire escrow if not confirmed within 24h
 */
export async function callExpireIfNotConfirmed(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling expireIfNotConfirmed on ${escrowAddress}`);
  
  const result = await submitTxJobAndWait("expireIfNotConfirmed", {
    escrow: escrowAddress,
  });

  console.log(`✅ expireIfNotConfirmed tx: ${result.txHash}`);
  
  // Update DB
  await sql`
    UPDATE escrows SET phase_cached = 4, updated_at = NOW()
    WHERE escrow = ${hexToBuffer(escrowAddress)}
  `;
  
  return result.txHash;
}

/**
 * Expire escrow if confirmed but not funded by deadline
 */
export async function callExpireIfNotFunded(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling expireIfNotFunded on ${escrowAddress}`);
  
  const result = await submitTxJobAndWait("expireIfNotFunded", {
    escrow: escrowAddress,
  });

  console.log(`✅ expireIfNotFunded tx: ${result.txHash}`);
  
  // Update DB
  await sql`
    UPDATE escrows SET phase_cached = 4, updated_at = NOW()
    WHERE escrow = ${hexToBuffer(escrowAddress)}
  `;
  
  return result.txHash;
}

/**
 * Sweep late/stray funds to treasury (after terminal state)
 */
export async function callSweepToTreasury(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling sweepToTreasury on ${escrowAddress}`);
  
  const result = await submitTxJobAndWait("sweepToTreasury", {
    escrow: escrowAddress,
  });

  console.log(`✅ sweepToTreasury tx: ${result.txHash}`);
  
  return result.txHash;
}

/**
 * Sweep to treasury after arb window ends without resolution
 * (permissionless, but good ops hygiene to call it)
 */
export async function callSweepToTreasuryAfterArbWindow(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling sweepToTreasuryAfterArbWindow on ${escrowAddress}`);
  
  const result = await submitTxJobAndWait("sweepToTreasuryAfterArbWindow", {
    escrow: escrowAddress,
  });

  console.log(`✅ sweepToTreasuryAfterArbWindow tx: ${result.txHash}`);
  
  // Update DB
  await sql`
    UPDATE escrows SET phase_cached = 3, updated_at = NOW()
    WHERE escrow = ${hexToBuffer(escrowAddress)}
  `;
  
  return result.txHash;
}

/**
 * List escrows stored in the DB (no chain reads)
 */
export async function listEscrows(params?: {
  limit?: number;
  query?: string;
}): Promise<Array<{
  escrow: string;
  code: string;
  phase: number;
  phaseName: string;
  deadline: number | null;
  targetAmount: string | null;
  payout: string;
  funder: string;
}>> {
  const rawLimit = params?.limit;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Number(rawLimit), 1), MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;
  const query = params?.query?.trim();
  const escrowQuery = query ? query.replace(/^0x/i, "").toLowerCase() : "";
  const codeQuery = query ? `%${query}%` : null;
  const escrowLike = query ? `%${escrowQuery}%` : null;

  const rows = await sql`
    SELECT escrow, code, phase_cached, deadline, target_amount, payout, funder
    FROM escrows
    WHERE network = ${ENV.CHAIN_ID.toString()}
    ${query ? sql`AND (
      code ILIKE ${codeQuery}
      OR lower(encode(escrow, 'hex')) ILIKE ${escrowLike}
    )` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row: any) => {
    const phase = Number(row.phase_cached);
    return {
      escrow: bufferToHex(row.escrow as Buffer),
      code: row.code,
      phase,
      phaseName: PHASE_NAMES[phase] || "Unknown",
      deadline: row.deadline ?? null,
      targetAmount: row.target_amount ?? null,
      payout: bufferToHex(row.payout as Buffer),
      funder: bufferToHex(row.funder as Buffer),
    };
  });
}

/**
 * Get all active (non-terminal) escrows from DB
 */
export async function getActiveEscrows(): Promise<Array<{
  escrow: string;
  code: string;
  phase: number;
  deadline: number;
  confirmDeadline: number;
  arbWindowEnd: number | null;
  payout: string;
  funder: string;
  token: string | null;
  targetAmount: string;
  createdBlock: bigint | null;
  arbitratorCount: number;  // 0, 1, or 3 (never 2)
}>> {
  const rows = await sql`
    SELECT escrow, code, phase_cached, deadline, confirm_deadline, arb_window_end,
           payout, funder, token, target_amount, created_block,
           CASE 
             WHEN arbitrator3 IS NOT NULL THEN 3
             WHEN arbitrator1 IS NOT NULL THEN 1
             ELSE 0
           END as arb_count
    FROM escrows
    WHERE network = ${ENV.CHAIN_ID.toString()}
    AND phase_cached < 3
  `;

  return rows.map((row: any) => ({
    escrow: bufferToHex(row.escrow as Buffer),
    code: row.code,
    phase: row.phase_cached,
    deadline: row.deadline,
    confirmDeadline: row.confirm_deadline,
    arbWindowEnd: row.arb_window_end ?? null,
    payout: bufferToHex(row.payout as Buffer),
    funder: bufferToHex(row.funder as Buffer),
    token: row.token ? bufferToHex(row.token as Buffer) : null,
    targetAmount: row.target_amount,
    createdBlock: row.created_block ? BigInt(row.created_block) : null,
    arbitratorCount: row.arb_count ?? 0,  // 0, 1, or 3 (never 2)
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Legacy/deprecated functions (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Use confirmByOracle() instead
 * Legacy: Record confirmation (was recordConfirmation in V1)
 */
export async function recordConfirmation(params: {
  escrow: `0x${string}`;
  confirmer: `0x${string}`;
  amount: string;
  txHash: string;
}): Promise<string> {
  // In the new model, we just call confirmByOracle with the txHash
  // The confirmer and amount validation happens on-chain
  return confirmByOracle({
    escrow: params.escrow,
    txHash: params.txHash,
  });
}

/**
 * @deprecated Funding is now derived from on-chain balance
 * Legacy: Record funding (was recordFunding in V1)
 * This function is now a no-op since funding is derived from balance.
 */
export async function recordFunding(params: {
  escrow: `0x${string}`;
  funder: `0x${string}`;
  amount: string;
  txHash: string;
}): Promise<string> {
  console.log(`⚠️ recordFunding() is deprecated - funding is now derived from balance`);
  console.log(`   Escrow: ${params.escrow}, Amount: ${params.amount}, TxHash: ${params.txHash}`);
  
  // No-op - funding status is derived from on-chain balance via isFunded()
  // Just return empty string to indicate no tx was sent
  return "";
}
