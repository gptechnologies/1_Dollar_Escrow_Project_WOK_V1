/**
 * Chain utilities for reading escrow state directly from Arbitrum
 * No Oracle dependency - all state derived from chain
 */

import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { arbitrum } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const ARBITRUM_CHAIN_ID = 42161;
export const ARBISCAN_BASE_URL = 'https://arbiscan.io';

// Known token addresses on Arbitrum One
export const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const;
export const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as const;

// Factory contract address
export const FACTORY_ADDRESS = '0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9' as const;

// Token metadata
export const TOKEN_INFO: Record<string, { symbol: string; decimals: number }> = {
  [USDC_ADDRESS.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
  [USDT_ADDRESS.toLowerCase()]: { symbol: 'USDT', decimals: 6 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Public Client
// ═══════════════════════════════════════════════════════════════════════════════

// Use public Arbitrum RPC for read-only operations
export const publicClient = createPublicClient({
  chain: arbitrum,
  transport: http(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Contract ABIs (minimal for reads)
// ═══════════════════════════════════════════════════════════════════════════════

export const EscrowABI = [
  // Immutable getters
  { inputs: [], name: 'payout', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'funder', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'targetAmount', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'bondCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'deadline', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'confirmDeadline', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbWindowEnd', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'createdAt', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'originalDeadline', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator1', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator2', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator3', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitratorCount', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'deadlocked', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'treasury', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  // Dynamic state
  { inputs: [], name: 'confirmed', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'resolved', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'expired', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'bondPresent', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isFunded', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'fundedAmount', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  // Mutual action state
  { inputs: [], name: 'mutualReleaseApprovedByFunder', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mutualReleaseApprovedByPayout', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mutualRefundApprovedByFunder', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mutualRefundApprovedByPayout', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pendingExtensionDeadline', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'extensionApprovedByFunder', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'extensionApprovedByPayout', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pendingSwapArb1', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pendingSwapArb2', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pendingSwapArb3', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'swapApprovedByFunder', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'swapApprovedByPayout', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalExtensionUsed', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'extensionRemaining', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  // Actionable states
  { inputs: [], name: 'isPayable', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isTerminal', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isExpirableNoConfirm', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isExpirableNoFund', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isInArbWindow', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isSweepableAfterArbWindow', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  // Write functions (for encoding)
  { inputs: [], name: 'confirm', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'finalizeAfterDeadline', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'sweepToTreasury', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  // Mutual action write functions
  { inputs: [], name: 'approveMutualRelease', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'approveMutualRefund', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'newDeadline', type: 'uint64' }], name: 'approveDeadlineExtension', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'newArb1', type: 'address' }, { name: 'newArb2', type: 'address' }, { name: 'newArb3', type: 'address' }], name: 'approveArbitratorSwap', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

export const ERC20ABI = [
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type EscrowState = {
  // Addresses
  escrow: Address;
  payout: Address;
  funder: Address;
  token: Address;
  treasury: Address;
  arbitrator1: Address;
  arbitrator2: Address;
  arbitrator3: Address;  // Deadlock arbitrator (for 3-arb setup)
  // Amounts (as bigint)
  targetAmount: bigint;
  bondCap: bigint;
  fundedAmount: bigint;
  // Timestamps (as number for easy comparison)
  deadline: number;
  confirmDeadline: number;
  arbWindowEnd: number;
  createdAt: number;
  originalDeadline: number;  // Original deadline (for extension cap calculation)
  // State flags
  confirmed: boolean;
  resolved: boolean;
  expired: boolean;
  bondPresent: boolean;
  isFunded: boolean;
  deadlocked: boolean;  // True if arb1 and arb2 voted differently (3-arb mode)
  // Mutual action state
  mutualReleaseApprovedByFunder: boolean;
  mutualReleaseApprovedByPayout: boolean;
  mutualRefundApprovedByFunder: boolean;
  mutualRefundApprovedByPayout: boolean;
  pendingExtensionDeadline: number;
  extensionApprovedByFunder: boolean;
  extensionApprovedByPayout: boolean;
  pendingSwapArb1: Address;
  pendingSwapArb2: Address;
  pendingSwapArb3: Address;
  swapApprovedByFunder: boolean;
  swapApprovedByPayout: boolean;
  totalExtensionUsed: number;
  extensionRemaining: number;
  // Computed actionable states
  isPayable: boolean;
  isTerminal: boolean;
  isExpirableNoConfirm: boolean;
  isExpirableNoFund: boolean;
  isInArbWindow: boolean;
  isSweepableAfterArbWindow: boolean;
  arbitratorCount: number;  // 0, 1, or 3 (never 2)
  // Token metadata
  tokenSymbol: string;
  tokenDecimals: number;
  // Escrow token balance (for sweep gating)
  escrowTokenBalance: bigint;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Chain Read Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Read all escrow state from chain via multicall
 */
export async function readEscrowState(escrowAddress: Address): Promise<EscrowState> {
  // First batch: get basic escrow data including token address
  const basicResults = await publicClient.multicall({
    contracts: [
      { address: escrowAddress, abi: EscrowABI, functionName: 'payout' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'funder' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'token' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'targetAmount' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'bondCap' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'deadline' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'confirmDeadline' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbWindowEnd' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'createdAt' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'originalDeadline' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitrator1' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitrator2' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitrator3' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitratorCount' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'treasury' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'confirmed' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'resolved' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'expired' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'bondPresent' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isFunded' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'fundedAmount' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'deadlocked' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isPayable' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isTerminal' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isExpirableNoConfirm' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isExpirableNoFund' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isInArbWindow' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isSweepableAfterArbWindow' },
    ],
    allowFailure: false,
  });

  const tokenAddress = basicResults[2] as Address;

  // Second batch: mutual action state
  const mutualResults = await publicClient.multicall({
    contracts: [
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualReleaseApprovedByFunder' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualReleaseApprovedByPayout' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualRefundApprovedByFunder' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualRefundApprovedByPayout' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'pendingExtensionDeadline' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'extensionApprovedByFunder' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'extensionApprovedByPayout' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'pendingSwapArb1' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'pendingSwapArb2' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'pendingSwapArb3' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'swapApprovedByFunder' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'swapApprovedByPayout' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'totalExtensionUsed' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'extensionRemaining' },
    ],
    allowFailure: false,
  });

  // Third batch: get token metadata and balance
  const tokenResults = await publicClient.multicall({
    contracts: [
      { address: tokenAddress, abi: ERC20ABI, functionName: 'symbol' },
      { address: tokenAddress, abi: ERC20ABI, functionName: 'decimals' },
      { address: tokenAddress, abi: ERC20ABI, functionName: 'balanceOf', args: [escrowAddress] },
    ],
    allowFailure: false,
  });

  return {
    escrow: escrowAddress,
    payout: basicResults[0] as Address,
    funder: basicResults[1] as Address,
    token: tokenAddress,
    targetAmount: basicResults[3] as bigint,
    bondCap: basicResults[4] as bigint,
    deadline: Number(basicResults[5]),
    confirmDeadline: Number(basicResults[6]),
    arbWindowEnd: Number(basicResults[7]),
    createdAt: Number(basicResults[8]),
    originalDeadline: Number(basicResults[9]),
    arbitrator1: basicResults[10] as Address,
    arbitrator2: basicResults[11] as Address,
    arbitrator3: basicResults[12] as Address,
    arbitratorCount: Number(basicResults[13]),
    treasury: basicResults[14] as Address,
    confirmed: basicResults[15] as boolean,
    resolved: basicResults[16] as boolean,
    expired: basicResults[17] as boolean,
    bondPresent: basicResults[18] as boolean,
    isFunded: basicResults[19] as boolean,
    fundedAmount: basicResults[20] as bigint,
    deadlocked: basicResults[21] as boolean,
    isPayable: basicResults[22] as boolean,
    isTerminal: basicResults[23] as boolean,
    isExpirableNoConfirm: basicResults[24] as boolean,
    isExpirableNoFund: basicResults[25] as boolean,
    isInArbWindow: basicResults[26] as boolean,
    isSweepableAfterArbWindow: basicResults[27] as boolean,
    // Mutual action state
    mutualReleaseApprovedByFunder: mutualResults[0] as boolean,
    mutualReleaseApprovedByPayout: mutualResults[1] as boolean,
    mutualRefundApprovedByFunder: mutualResults[2] as boolean,
    mutualRefundApprovedByPayout: mutualResults[3] as boolean,
    pendingExtensionDeadline: Number(mutualResults[4]),
    extensionApprovedByFunder: mutualResults[5] as boolean,
    extensionApprovedByPayout: mutualResults[6] as boolean,
    pendingSwapArb1: mutualResults[7] as Address,
    pendingSwapArb2: mutualResults[8] as Address,
    pendingSwapArb3: mutualResults[9] as Address,
    swapApprovedByFunder: mutualResults[10] as boolean,
    swapApprovedByPayout: mutualResults[11] as boolean,
    totalExtensionUsed: Number(mutualResults[12]),
    extensionRemaining: Number(mutualResults[13]),
    // Token metadata
    tokenSymbol: tokenResults[0] as string,
    tokenDecimals: Number(tokenResults[1]),
    escrowTokenBalance: tokenResults[2] as bigint,
  };
}

/**
 * Get token balance for an address
 */
export async function getTokenBalance(
  tokenAddress: Address,
  accountAddress: Address
): Promise<bigint> {
  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'balanceOf',
    args: [accountAddress],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: bigint, decimals: number = 6): string {
  return formatUnits(amount, decimals);
}

/**
 * Format address for display (shortened)
 */
export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Get Arbiscan URL for address
 */
export function getArbiscanAddressUrl(address: string): string {
  return `${ARBISCAN_BASE_URL}/address/${address}`;
}

/**
 * Get Arbiscan URL for transaction
 */
export function getArbiscanTxUrl(txHash: string): string {
  return `${ARBISCAN_BASE_URL}/tx/${txHash}`;
}

/**
 * Get token info by address
 */
export function getTokenInfo(tokenAddress: string): { symbol: string; decimals: number } {
  const info = TOKEN_INFO[tokenAddress.toLowerCase()];
  return info || { symbol: 'TOKEN', decimals: 18 };
}

/**
 * Check if address is valid
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Format timestamp to locale string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Get time remaining until timestamp
 */
export function getTimeRemaining(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;
  
  if (diff <= 0) return 'Passed';
  
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}
