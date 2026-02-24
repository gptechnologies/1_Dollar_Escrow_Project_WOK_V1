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
  targetAmount: z.string().regex(/^\d+$/, "Must be a valid integer string"),
  deadline: z.number().int().positive("Deadline must be a future timestamp"),
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
  phase: number;
  phaseName: string;
  payout: string;
  funder: string;
  token: string;
  targetAmount: string;
  fundedRecorded: string;
  confirmationAmount: string;
  deadline: number;
  confirmDeadline: number;
  arbWindowEnd: number;
  createdAt: number;
  confirmationRecorded: boolean;
  fundingRecorded: boolean;
  // Arbitration (0, 1, or 3 arbitrators)
  arbitrator1: string;
  arbitrator2: string;
  arbitrator3: string;  // Deadlock arbitrator (3-arb setup only)
  arbitratorCount: number;  // 0, 1, or 3 (never 2)
  deadlocked: boolean;  // True if arb1 and arb2 voted differently
  isPayable: boolean;
  isExpirableNoConfirm: boolean;
  isExpirableNoFund: boolean;
  isTerminal: boolean;
  isInArbWindow: boolean;
  isSweepableAfterArbWindow: boolean;
}

export interface CreateEscrowResponse {
  escrow: string;
  code: string;
  txHash: string;
  token: string;
  phase: number;
  confirmDeadline: number;
}

export interface EscrowListItem {
  escrow: string;
  code: string;
  phase: number;
  phaseName: string;
  deadline: number | null;
  targetAmount: string | null;
  payout: string;
  funder: string;
}

export interface EscrowListResponse {
  escrows: EscrowListItem[];
}

export type CreateEscrowRequest = z.infer<typeof CreateEscrowSchema>;

export const RegisterEscrowSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
});

export type RegisterEscrowRequest = z.infer<typeof RegisterEscrowSchema>;
