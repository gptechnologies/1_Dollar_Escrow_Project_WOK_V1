/**
 * Escrow indexer service functions - interact with EscrowV2 / EscrowFactoryV2 (P2P model)
 *
 * - Push funding; isFunded() derived from on-chain balance
 * - sellerConfirm() is optional and requires live full funding
 * - One settlementDate + immutable termsHash
 * - 0/1/3 arbitration with 2-of-3 voting + 30-day mutual-resolution override
 * - No oracle confirmation, no bond
 *
 * Status codes (mirror the contract Status enum):
 *   0 CREATED, 1 ACTIVE, 2 PENDING_MUTUAL_RESOLUTION, 3 SETTLED, 4 REFUNDED
 */

import { parseEventLogs } from "viem";
import { publicClient, getPublicClient } from "../blockchain/client.js";
import { EscrowFactoryABI, EscrowABI } from "../contracts/abis.js";
import { ENV } from "../config/env.js";
import { getNetwork } from "../config/networks.js";
import { sql, hexToBuffer, bufferToHex } from "../db/client.js";
import { nanoid } from "nanoid";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

// Status enum (matches the EscrowV2 contract)
export enum Status {
  CREATED = 0,
  ACTIVE = 1,
  PENDING_MUTUAL_RESOLUTION = 2,
  SETTLED = 3,
  REFUNDED = 4,
}

export const STATUS_NAMES = [
  "Created",
  "Active",
  "PendingMutualResolution",
  "Settled",
  "Refunded",
];

const TERMINAL_STATUS = 3; // status >= 3 is terminal

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;

async function submitServerTx(
  method: "createEscrow" | "settle" | "refundUnderfunded" | "finalizeMutualResolution" | "sweepExcess" | "recoverLatePaymentToken",
  params: Record<string, unknown>,
  options?: { timeoutMs?: number },
) {
  if (!ENV.ENABLE_SERVER_TXS) {
    throw new Error("Server-signed transactions are disabled. Set ENABLE_SERVER_TXS=true to use this endpoint.");
  }

  const { submitTxJobAndWait } = await import("../blockchain/tx-queue.js");
  return submitTxJobAndWait(method, params, options);
}

function addressRole(address: string | null, parties: {
  sellerWallet: string;
  buyerRefundWallet: string;
  arbitrator1: string;
  arbitrator2: string;
  arbitrator3: string;
}): { role: string; tone: string } {
  const normalized = address?.toLowerCase();
  if (!normalized) return { role: "Contract", tone: "contract" };
  if (normalized === parties.sellerWallet.toLowerCase()) return { role: "Seller", tone: "seller" };
  if (normalized === parties.buyerRefundWallet.toLowerCase()) return { role: "Buyer", tone: "buyer" };
  if (
    normalized === parties.arbitrator1.toLowerCase() ||
    normalized === parties.arbitrator2.toLowerCase() ||
    normalized === parties.arbitrator3.toLowerCase()
  ) {
    return { role: "Arbitrator", tone: "arbitrator" };
  }
  return { role: "Wallet", tone: "wallet" };
}

function eventText(eventName: string, outcome?: number | null): string {
  switch (eventName) {
    case "EscrowCreated":
      return "Executed Function: Created";
    case "TokenTransfer":
      return "Called Function: Fund Escrow";
    case "SellerConfirmed":
      return "Called Function: Confirm";
    case "MutualSettleApproved":
      return "Called Function: Approve Mutual Settle";
    case "MutualRefundApproved":
      return "Called Function: Approve Mutual Refund";
    case "MutualResolutionPending":
      return outcome === 2 ? "Executed Function: Pending Mutual Refund" : "Executed Function: Pending Mutual Settle";
    case "MutualResolutionFinalized":
      return "Called Function: Finalize Mutual Resolution";
    case "ArbitratorVoted":
      return outcome === 2 ? "Called Function: Vote Refund" : "Called Function: Vote Settle";
    case "Settled":
      return "Executed Function: Settle";
    case "Refunded":
      return "Executed Function: Refund";
    case "UnderfundedRefunded":
      return "Executed Function: Refund Underfunded";
    case "LatePaymentTokenRecovered":
      return "Executed Function: Recover Late Payment";
    case "SweptExcess":
      return "Called Function: Sweep Excess";
    case "SweptStrayToken":
      return "Called Function: Sweep Stray Token";
    default:
      return `Executed Function: ${eventName}`;
  }
}

async function getIndexedActivity(escrowAddress: `0x${string}`, parties: {
  sellerWallet: string;
  buyerRefundWallet: string;
  arbitrator1: string;
  arbitrator2: string;
  arbitrator3: string;
}, createdAt: number, chainId: number) {
  const rows = await sql`
    SELECT *
    FROM (
      SELECT
        event_name,
        tx_hash,
        block_number,
        log_index,
        actor,
        amount,
        outcome,
        created_at
      FROM escrow_events
      WHERE network = ${chainId.toString()}
      AND escrow = ${hexToBuffer(escrowAddress)}
      UNION ALL
      SELECT
        'TokenTransfer' AS event_name,
        tx_hash,
        block_number,
        log_index,
        from_address AS actor,
        amount,
        NULL::smallint AS outcome,
        created_at
      FROM escrow_token_transfers
      WHERE network = ${chainId.toString()}
      AND escrow = ${hexToBuffer(escrowAddress)}
    ) activity
    ORDER BY block_number DESC, log_index DESC
    LIMIT 24
  `;

  const activity: Array<{
    id: string;
    timestamp: number | null;
    role: string;
    tone: string;
    text: string;
    txHash?: string;
    blockNumber?: number;
    logIndex?: number;
  }> = rows.map((row: any) => {
    const actor = row.actor ? bufferToHex(row.actor as Buffer) : null;
    const { role, tone } = addressRole(actor, parties);
    const timestamp = row.created_at instanceof Date
      ? Math.floor(row.created_at.getTime() / 1000)
      : null;
    return {
      id: `${row.tx_hash}-${row.log_index}`,
      timestamp,
      role,
      tone,
      text: eventText(row.event_name, row.outcome === null ? null : Number(row.outcome)),
      txHash: row.tx_hash,
      blockNumber: Number(row.block_number),
      logIndex: Number(row.log_index),
    };
  });

  activity.push({
    id: `created-${escrowAddress}`,
    timestamp: createdAt || null,
    role: "Contract",
    tone: "contract",
    text: eventText("EscrowCreated"),
  });

  return activity;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Creation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new escrow via EscrowFactoryV2 (server-signed convenience path).
 * Most creation happens client-side; this is kept for server-side automation.
 */
export async function createEscrow(params: {
  payout: `0x${string}`;             // seller - receives funds on settle
  funder: `0x${string}`;             // buyer - receives funds on refund
  token: `0x${string}`;              // USDC or USDT address
  targetAmount: bigint;              // amount that must be funded
  settlementDate: number;            // unix timestamp
  termsHash?: `0x${string}`;
  termsText?: string;
  arbitrator1?: `0x${string}`;
  arbitrator2?: `0x${string}`;
  arbitrator3?: `0x${string}`;
}): Promise<{
  escrow: string;
  code: string;
  txHash: string;
  token: string;
  settlementDate: number;
}> {
  const code = nanoid(10);

  const arbitrator1 = params.arbitrator1 ?? ZERO_ADDRESS;
  const arbitrator2 = params.arbitrator2 ?? ZERO_ADDRESS;
  const arbitrator3 = params.arbitrator3 ?? ZERO_ADDRESS;
  const termsHash = params.termsHash ?? ZERO_HASH;

  const hasArb1 = arbitrator1 !== ZERO_ADDRESS;
  const hasArb2 = arbitrator2 !== ZERO_ADDRESS;
  const hasArb3 = arbitrator3 !== ZERO_ADDRESS;
  if (hasArb2 || hasArb3) {
    if (!hasArb1 || !hasArb2 || !hasArb3) {
      throw new Error("Must have 0, 1, or 3 arbitrators (2 not allowed)");
    }
  }

  const result = await submitServerTx("createEscrow", {
    payout: params.payout,
    funder: params.funder,
    token: params.token,
    targetAmount: params.targetAmount.toString(),
    settlementDate: params.settlementDate,
    termsHash,
    arbitrator1,
    arbitrator2,
    arbitrator3,
  }, {
    timeoutMs: 180_000,
  });

  const txHash = result.txHash;
  console.log(`📝 Escrow creation tx completed: ${txHash}`);

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  const logs = parseEventLogs({ abi: EscrowFactoryABI, logs: receipt.logs, eventName: "EscrowCreated" });
  if (logs.length === 0) {
    throw new Error("EscrowCreated event not found in receipt");
  }

  const event = logs[0].args as any;
  const escrowAddress = event.escrow as string;
  const tokenAddress = event.token as string;
  const settlementDate = Number(event.settlementDate);

  await upsertEscrowFromEvent({
    escrowAddress,
    payout: params.payout,
    funder: params.funder,
    tokenAddress,
    targetAmount: params.targetAmount.toString(),
    settlementDate,
    termsHash: event.termsHash as string,
    termsText: params.termsText ?? null,
    arbitrator1,
    arbitrator2,
    arbitrator3,
    txHash,
    createdBlock: receipt.blockNumber.toString(),
    code,
  });

  console.log(`✅ Escrow created: ${escrowAddress} (code: ${code}, token: ${tokenAddress})`);

  return { escrow: escrowAddress, code, txHash, token: tokenAddress, settlementDate };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Registration / indexing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shared upsert for registerEscrow() and watcher backfill.
 * Idempotent on the escrow address.
 */
export async function upsertEscrowFromEvent(params: {
  chainId?: number;
  escrowAddress: string;
  payout: string;
  funder: string;
  tokenAddress: string;
  targetAmount: string;
  settlementDate: number;
  termsHash: string;
  termsText?: string | null;
  arbitrator1: string;
  arbitrator2: string;
  arbitrator3: string;
  txHash: string;
  createdBlock: string;
  code?: string;
}): Promise<{ code: string; isNew: boolean }> {
  const chainId = params.chainId ?? ENV.CHAIN_ID;
  const arb1Buf = params.arbitrator1 === ZERO_ADDRESS ? null : hexToBuffer(params.arbitrator1);
  const arb2Buf = params.arbitrator2 === ZERO_ADDRESS ? null : hexToBuffer(params.arbitrator2);
  const arb3Buf = params.arbitrator3 === ZERO_ADDRESS ? null : hexToBuffer(params.arbitrator3);
  const termsHash = params.termsHash && params.termsHash !== ZERO_HASH ? params.termsHash : null;

  const existing = await sql`
    SELECT code FROM escrows
    WHERE network = ${chainId.toString()}
    AND escrow = ${hexToBuffer(params.escrowAddress)}
  `;

  if (existing.length > 0) {
    await sql`
      UPDATE escrows
      SET created_tx = COALESCE(escrows.created_tx, ${params.txHash}),
          created_block = COALESCE(escrows.created_block, ${params.createdBlock}),
          terms_text = COALESCE(${params.termsText ?? null}, escrows.terms_text),
          updated_at = NOW()
      WHERE network = ${chainId.toString()}
      AND escrow = ${hexToBuffer(params.escrowAddress)}
    `;
    return { code: existing[0].code as string, isNew: false };
  }

  const code = params.code ?? nanoid(10);

  await sql`
    INSERT INTO escrows (
      escrow, code, network, payout, funder, token, target_amount,
      settlement_date,
      terms_hash, terms_text, phase_cached, created_tx, created_block,
      arbitrator1, arbitrator2, arbitrator3
    )
    VALUES (
      ${hexToBuffer(params.escrowAddress)},
      ${code},
      ${chainId.toString()},
      ${hexToBuffer(params.payout)},
      ${hexToBuffer(params.funder)},
      ${hexToBuffer(params.tokenAddress)},
      ${params.targetAmount},
      ${params.settlementDate},
      ${termsHash},
      ${params.termsText ?? null},
      0,
      ${params.txHash},
      ${params.createdBlock},
      ${arb1Buf},
      ${arb2Buf},
      ${arb3Buf}
    )
    ON CONFLICT (network, escrow) DO UPDATE SET
      created_tx = COALESCE(escrows.created_tx, EXCLUDED.created_tx),
      created_block = COALESCE(escrows.created_block, EXCLUDED.created_block),
      updated_at = NOW()
  `;

  return { code, isNew: true };
}

/**
 * Register an on-chain escrow by verifying its creation transaction receipt.
 * Public endpoint — validates receipt, parses event, upserts into DB.
 */
export async function registerEscrow(chainId: number, txHash: string, termsText?: string): Promise<{
  chainId: number;
  escrow: string;
  code: string;
  txHash: string;
  token: string;
  status: number;
  statusName: string;
  settlementDate: number;
}> {
  const client = getPublicClient(chainId);
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (receipt.status !== "success") {
    throw new Error("Transaction failed or was reverted");
  }

  const network = getNetwork(chainId);
  if (receipt.to?.toLowerCase() !== network.FACTORY.toLowerCase()) {
    throw new Error("Transaction was not sent to the EscrowFactory");
  }

  const logs = parseEventLogs({ abi: EscrowFactoryABI, logs: receipt.logs, eventName: "EscrowCreated" });
  if (logs.length === 0) {
    throw new Error("EscrowCreated event not found in receipt");
  }

  const event = logs[0].args as any;
  const escrowAddress = (event.escrow as string).toLowerCase();
  const tokenAddress = event.token as string;
  const settlementDate = Number(event.settlementDate);

  const { code } = await upsertEscrowFromEvent({
    chainId,
    escrowAddress,
    payout: event.payout as string,
    funder: event.funder as string,
    tokenAddress,
    targetAmount: event.targetAmount.toString(),
    settlementDate,
    termsHash: event.termsHash as string,
    termsText: termsText ?? null,
    arbitrator1: event.arbitrator1 as string,
    arbitrator2: event.arbitrator2 as string,
    arbitrator3: event.arbitrator3 as string,
    txHash,
    createdBlock: receipt.blockNumber.toString(),
  });

  console.log(`📋 Escrow registered: ${escrowAddress} (code: ${code})`);

  return {
    chainId,
    escrow: escrowAddress,
    code,
    txHash,
    token: tokenAddress,
    status: 0,
    statusName: STATUS_NAMES[0],
    settlementDate,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Status
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Read escrow status from DB metadata plus live on-chain state.
 * Immutable creation data and history come from the webhook-backed database;
 * balance/status/actionability come from chain for liveness.
 */
export async function getEscrowStatus(code: string): Promise<any> {
  const rows = await sql`
    SELECT network, escrow, code, payout, funder, token, target_amount, settlement_date,
           terms_hash, terms_text, created_at, arbitrator1, arbitrator2, arbitrator3
    FROM escrows
    WHERE code = ${code}
  `;
  if (rows.length === 0) {
    throw new Error(`Escrow not found for code: ${code}`);
  }

  const row = rows[0] as any;
  const chainId = Number(row.network);
  const network = getNetwork(chainId);
  const client = getPublicClient(chainId);
  const escrowAddress = bufferToHex(row.escrow as Buffer) as `0x${string}`;
  const sellerWallet = bufferToHex(row.payout as Buffer);
  const buyerRefundWallet = bufferToHex(row.funder as Buffer);
  const token = bufferToHex(row.token as Buffer);
  const arbitrator1 = row.arbitrator1 ? bufferToHex(row.arbitrator1 as Buffer) : ZERO_ADDRESS;
  const arbitrator2 = row.arbitrator2 ? bufferToHex(row.arbitrator2 as Buffer) : ZERO_ADDRESS;
  const arbitrator3 = row.arbitrator3 ? bufferToHex(row.arbitrator3 as Buffer) : ZERO_ADDRESS;
  const createdAt = row.created_at instanceof Date ? Math.floor(row.created_at.getTime() / 1000) : null;
  const arbitrationMode = arbitrator3 !== ZERO_ADDRESS ? 3 : (arbitrator1 !== ZERO_ADDRESS ? 1 : 0);

  const [
    status,
    balance,
    pendingOutcome,
    overrideWindowEnd,
    settleVotes,
    refundVotes,
    mutualSettleApprovedByBuyer,
    mutualSettleApprovedBySeller,
    mutualRefundApprovedByBuyer,
    mutualRefundApprovedBySeller,
    isFunded,
    isTerminal,
    isActivatable,
    isRefundableUnderfunded,
    isSettleable,
    isVotable,
    isInOverrideWindow,
    isFinalizable,
  ] = await Promise.all([
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "statusCode" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "balance" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "pendingOutcome" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "overrideWindowEnd" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "settleVotes" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "refundVotes" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "mutualSettleApprovedByBuyer" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "mutualSettleApprovedBySeller" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "mutualRefundApprovedByBuyer" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "mutualRefundApprovedBySeller" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isFunded" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isTerminal" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isActivatable" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isRefundableUnderfunded" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isSettleable" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isVotable" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isInOverrideWindow" }),
    client.readContract({ address: escrowAddress, abi: EscrowABI, functionName: "isFinalizable" }),
  ]);

  const statusNum = Number(status);

  await sql`
    UPDATE escrows SET phase_cached = ${statusNum}, updated_at = NOW()
    WHERE code = ${code}
  `;

  const parties = {
    sellerWallet,
    buyerRefundWallet,
    arbitrator1,
    arbitrator2,
    arbitrator3,
  };
  const activity = await getIndexedActivity(escrowAddress, parties, createdAt ?? 0, chainId);

  return {
    chainId,
    chainName: network.name,
    escrow: escrowAddress,
    code,
    status: statusNum,
    statusName: STATUS_NAMES[statusNum] || "Unknown",
    sellerWallet,
    buyerRefundWallet,
    token,
    tokenSymbol: token.toLowerCase() === network.USDT.toLowerCase() ? "USDT" : "USDC",
    tokenDecimals: 6,
    targetAmount: row.target_amount,
    balance: (balance as bigint).toString(),
    settlementDate: row.settlement_date ?? null,
    createdAt,
    termsHash: row.terms_hash,
    termsText: row.terms_text ?? null,
    arbitrator1,
    arbitrator2,
    arbitrator3,
    arbitrationMode,
    pendingOutcome: Number(pendingOutcome),
    overrideWindowEnd: Number(overrideWindowEnd),
    settleVotes: Number(settleVotes),
    refundVotes: Number(refundVotes),
    mutualSettleApprovedByBuyer: mutualSettleApprovedByBuyer as boolean,
    mutualSettleApprovedBySeller: mutualSettleApprovedBySeller as boolean,
    mutualRefundApprovedByBuyer: mutualRefundApprovedByBuyer as boolean,
    mutualRefundApprovedBySeller: mutualRefundApprovedBySeller as boolean,
    isFunded: isFunded as boolean,
    isTerminal: isTerminal as boolean,
    isActivatable: isActivatable as boolean,
    isRefundableUnderfunded: isRefundableUnderfunded as boolean,
    isSettleable: isSettleable as boolean,
    isVotable: isVotable as boolean,
    isInOverrideWindow: isInOverrideWindow as boolean,
    isFinalizable: isFinalizable as boolean,
    isPartial: false,
    activity,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Keeper convenience callers (all permissionless on-chain)
// ═══════════════════════════════════════════════════════════════════════════════

export async function callSettle(chainId: number, escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling settle on ${escrowAddress}`);
  const result = await submitServerTx("settle", { escrow: escrowAddress });
  await sql`UPDATE escrows SET phase_cached = ${Status.SETTLED}, updated_at = NOW() WHERE network = ${chainId.toString()} AND escrow = ${hexToBuffer(escrowAddress)}`;
  return result.txHash;
}

export async function callRefundUnderfunded(chainId: number, escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling refundUnderfunded on ${escrowAddress}`);
  const result = await submitServerTx("refundUnderfunded", { escrow: escrowAddress });
  await sql`UPDATE escrows SET phase_cached = ${Status.REFUNDED}, updated_at = NOW() WHERE network = ${chainId.toString()} AND escrow = ${hexToBuffer(escrowAddress)}`;
  return result.txHash;
}

export async function callFinalizeMutualResolution(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling finalizeMutualResolution on ${escrowAddress}`);
  const result = await submitServerTx("finalizeMutualResolution", { escrow: escrowAddress });
  return result.txHash;
}

export async function callSweepExcess(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling sweepExcess on ${escrowAddress}`);
  const result = await submitServerTx("sweepExcess", { escrow: escrowAddress });
  return result.txHash;
}

export async function callRecoverLatePaymentToken(escrowAddress: `0x${string}`): Promise<string> {
  console.log(`🔄 Calling recoverLatePaymentToken on ${escrowAddress}`);
  const result = await submitServerTx("recoverLatePaymentToken", { escrow: escrowAddress });
  return result.txHash;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Listings
// ═══════════════════════════════════════════════════════════════════════════════

export async function listEscrows(params?: {
  limit?: number;
  query?: string;
}): Promise<Array<{
  escrow: string;
  code: string;
  status: number;
  statusName: string;
  settlementDate: number | null;
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
    SELECT network, escrow, code, phase_cached, settlement_date, target_amount, payout, funder
    FROM escrows
    WHERE 1 = 1
    ${query ? sql`AND (
      code ILIKE ${codeQuery}
      OR lower(encode(escrow, 'hex')) ILIKE ${escrowLike}
    )` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row: any) => {
    const status = Number(row.phase_cached);
    return {
      chainId: Number(row.network),
      escrow: bufferToHex(row.escrow as Buffer),
      code: row.code,
      status,
      statusName: STATUS_NAMES[status] || "Unknown",
      settlementDate: row.settlement_date ?? null,
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
  chainId: number;
  escrow: string;
  code: string;
  status: number;
  settlementDate: number | null;
  payout: string;
  funder: string;
  token: string | null;
  targetAmount: string;
  createdBlock: bigint | null;
  arbitrationMode: number;
}>> {
  const rows = await sql`
    SELECT network, escrow, code, phase_cached, settlement_date,
           payout, funder, token, target_amount, created_block,
           CASE
             WHEN arbitrator3 IS NOT NULL THEN 3
             WHEN arbitrator1 IS NOT NULL THEN 1
             ELSE 0
           END as arb_mode
    FROM escrows
    WHERE phase_cached < ${TERMINAL_STATUS}
  `;

  return rows.map((row: any) => ({
    chainId: Number(row.network),
    escrow: bufferToHex(row.escrow as Buffer),
    code: row.code,
    status: row.phase_cached,
    settlementDate: row.settlement_date ?? null,
    payout: bufferToHex(row.payout as Buffer),
    funder: bufferToHex(row.funder as Buffer),
    token: row.token ? bufferToHex(row.token as Buffer) : null,
    targetAmount: row.target_amount,
    createdBlock: row.created_block ? BigInt(row.created_block) : null,
    arbitrationMode: row.arb_mode ?? 0,
  }));
}
