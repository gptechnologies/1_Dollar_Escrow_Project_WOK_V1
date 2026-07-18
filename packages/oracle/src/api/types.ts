import { z } from "zod";

// Request schemas
// Note: Arbitrator count must be 0, 1, or 3 (never 2)
// - 0: No arbitration
// - 1: Only arbitrator1 (first vote resolves)
// - 3: All three arbitrators (arb1+arb2 must agree, or arb3 breaks deadlock)
export const CreateEscrowSchema = z.object({
  payout: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid payout address"),
  funder: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid funder address"),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token address (must be USDC or USDT)"),
  targetAmount: z.string().regex(/^\d+$/, "Must be a valid integer string")
    .refine((value) => BigInt(value) >= 1_000_000n, "Minimum escrow amount is $1"),
  settlementDate: z.number().int().positive("settlementDate must be a future timestamp"),
  termsHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid terms hash").optional(),
  termsText: z.string().max(10000, "Terms text too long").optional(),
  arbitrator1: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid arbitrator1 address").optional(),
  arbitrator2: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid arbitrator2 address").optional(),
  arbitrator3: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid arbitrator3 address (deadlock arbitrator)").optional(),
}).refine((data) => {
  // Enforce 0/1/3 rule
  const hasArb1 = !!data.arbitrator1;
  const hasArb2 = !!data.arbitrator2;
  const hasArb3 = !!data.arbitrator3;
  
  // If arb2 or arb3 is set, all three must be set
  if (hasArb2 || hasArb3) {
    return hasArb1 && hasArb2 && hasArb3;
  }
  return true;
}, {
  message: "Must have 0, 1, or 3 arbitrators (2 not allowed). If setting arb2 or arb3, all three must be provided."
});

// Response types
export interface EscrowStatusResponse {
  escrow: string;
  code: string;
  status: number;       // EscrowV2 Status code (0..4)
  statusName: string;
  sellerWallet: string;
  buyerRefundWallet: string;
  token: string;
  targetAmount: string;
  balance: string;
  settlementDate: number;
  createdAt: number;
  termsHash: string;
  termsText: string | null;
  // Arbitration (0, 1, or 3 arbitrators)
  arbitrator1: string;
  arbitrator2: string;
  arbitrator3: string;
  arbitrationMode: number;     // 0, 1, or 3 (never 2)
  pendingOutcome: number;      // 0 None, 1 Settle, 2 Refund
  overrideWindowEnd: number;
  settleVotes: number;
  refundVotes: number;
  mutualSettleApprovedByBuyer: boolean;
  mutualSettleApprovedBySeller: boolean;
  mutualRefundApprovedByBuyer: boolean;
  mutualRefundApprovedBySeller: boolean;
  isFunded: boolean;
  isTerminal: boolean;
  isActivatable: boolean;
  isRefundableUnderfunded: boolean;
  isSettleable: boolean;
  isVotable: boolean;
  isInOverrideWindow: boolean;
  isFinalizable: boolean;
  isPartial: boolean;
  activity: Array<{
    id: string;
    timestamp: number | null;
    role: string;
    tone: string;
    text: string;
    txHash?: string;
    blockNumber?: number;
    logIndex?: number;
  }>;
}

export interface CreateEscrowResponse {
  escrow: string;
  code: string;
  txHash: string;
  token: string;
  status: number;
  settlementDate: number;
}

export interface EscrowListItem {
  escrow: string;
  code: string;
  status: number;
  statusName: string;
  settlementDate: number | null;
  targetAmount: string | null;
  payout: string;
  funder: string;
}

export interface EscrowListResponse {
  escrows: EscrowListItem[];
}

export type CreateEscrowRequest = z.infer<typeof CreateEscrowSchema>;

export const CreatePaymentLinkSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address"),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token address"),
  amount: z.string().regex(/^\d+$/, "Must be a valid integer string (raw token units)"),
  description: z.string().max(120, "Description must be 120 characters or less").optional(),
});

export type CreatePaymentLinkRequest = z.infer<typeof CreatePaymentLinkSchema>;

export interface PaymentLinkResponse {
  code: string;
  wallet: string;
  token: string;
  amount: string;
  description: string | null;
  createdAt: string;
}

export const RegisterEscrowSchema = z.object({
  chainId: z.union([z.literal(1), z.literal(42161)]),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
  termsText: z.string().max(10000, "Terms text too long").optional(),
});

export type RegisterEscrowRequest = z.infer<typeof RegisterEscrowSchema>;
