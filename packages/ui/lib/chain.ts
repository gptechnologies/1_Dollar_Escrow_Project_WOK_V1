/**
 * Chain utilities for reading escrow state directly from Arbitrum or Ethereum.
 * No backend/indexer dependency for contract state - liveness is read from chain.
 */

import { createPublicClient, http, formatUnits, getAddress, parseEventLogs, type Address, type Hex } from 'viem';
import { arbitrum, mainnet } from 'viem/chains';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const ARBITRUM_CHAIN_ID = 42161;
export const ETHEREUM_CHAIN_ID = 1;
export type SupportedChainId = typeof ARBITRUM_CHAIN_ID | typeof ETHEREUM_CHAIN_ID;
export const ARBISCAN_BASE_URL = 'https://arbiscan.io';
export const ETHERSCAN_BASE_URL = 'https://etherscan.io';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Known token addresses on Arbitrum One
export const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const;
export const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as const;
export const ETHEREUM_USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
export const ETHEREUM_USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const;

// EscrowFactoryV2 address. Must be set after deploying the one-date factory.
export const FACTORY_ADDRESS = (
  process.env.NEXT_PUBLIC_ARBITRUM_FACTORY_ADDRESS ||
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  ZERO_ADDRESS
) as `0x${string}`;

export type ChainConfig = {
  chainId: SupportedChainId;
  name: string;
  shortName: string;
  factoryAddress: Address;
  explorerBaseUrl: string;
  rpcUrl: string;
  chain: typeof arbitrum | typeof mainnet;
  tokens: Record<'USDC' | 'USDT', { symbol: 'USDC' | 'USDT'; address: Address; decimals: 6 }>;
};

export const CHAIN_CONFIGS: Record<SupportedChainId, ChainConfig> = {
  [ARBITRUM_CHAIN_ID]: {
    chainId: ARBITRUM_CHAIN_ID,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    factoryAddress: FACTORY_ADDRESS,
    explorerBaseUrl: ARBISCAN_BASE_URL,
    rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC_HTTP || process.env.NEXT_PUBLIC_RPC_HTTP || 'https://arb1.arbitrum.io/rpc',
    chain: arbitrum,
    tokens: {
      USDC: { symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 },
      USDT: { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
    },
  },
  [ETHEREUM_CHAIN_ID]: {
    chainId: ETHEREUM_CHAIN_ID,
    name: 'Ethereum',
    shortName: 'Ethereum',
    factoryAddress: (process.env.NEXT_PUBLIC_ETHEREUM_FACTORY_ADDRESS || ZERO_ADDRESS) as Address,
    explorerBaseUrl: ETHERSCAN_BASE_URL,
    rpcUrl: process.env.NEXT_PUBLIC_ETHEREUM_RPC_HTTP || 'https://ethereum-rpc.publicnode.com',
    chain: mainnet,
    tokens: {
      USDC: { symbol: 'USDC', address: ETHEREUM_USDC_ADDRESS, decimals: 6 },
      USDT: { symbol: 'USDT', address: ETHEREUM_USDT_ADDRESS, decimals: 6 },
    },
  },
};

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return chainId === ARBITRUM_CHAIN_ID || chainId === ETHEREUM_CHAIN_ID;
}

export function getChainConfig(chainId: number): ChainConfig {
  if (!isSupportedChainId(chainId)) throw new Error(`Unsupported chain ID: ${chainId}`);
  return CHAIN_CONFIGS[chainId];
}

// PaymentRouter contract address
export const PAYMENT_ROUTER_ADDRESS = (process.env.NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS || '0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95') as `0x${string}`;

// Token metadata
export const TOKEN_INFO: Record<string, { symbol: string; decimals: number }> = {
  [USDC_ADDRESS.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
  [USDT_ADDRESS.toLowerCase()]: { symbol: 'USDT', decimals: 6 },
  [ETHEREUM_USDC_ADDRESS.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
  [ETHEREUM_USDT_ADDRESS.toLowerCase()]: { symbol: 'USDT', decimals: 6 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Public Client
// ═══════════════════════════════════════════════════════════════════════════════

const publicClients = new Map<SupportedChainId, ReturnType<typeof createPublicClient>>();

export function getPublicClient(chainId: SupportedChainId) {
  const existing = publicClients.get(chainId);
  if (existing) return existing;
  const config = getChainConfig(chainId);
  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  publicClients.set(chainId, client);
  return client;
}

// Backward-compatible Arbitrum client for legacy payment-link and fallback routes.
export const publicClient = getPublicClient(ARBITRUM_CHAIN_ID);

// ═══════════════════════════════════════════════════════════════════════════════
// Contract ABIs (minimal for reads)
// ═══════════════════════════════════════════════════════════════════════════════

export const EscrowFactoryABI = [
  {
    inputs: [
      { name: '_payout', type: 'address' },
      { name: '_funder', type: 'address' },
      { name: '_token', type: 'address' },
      { name: '_targetAmount', type: 'uint256' },
      { name: '_settlementDate', type: 'uint64' },
      { name: '_termsHash', type: 'bytes32' },
      { name: '_arbitrator1', type: 'address' },
      { name: '_arbitrator2', type: 'address' },
      { name: '_arbitrator3', type: 'address' },
    ],
    name: 'createEscrowSimple',
    outputs: [{ name: 'escrow', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrow', type: 'address' },
      { indexed: true, name: 'funder', type: 'address' },
      { indexed: true, name: 'payout', type: 'address' },
      { indexed: false, name: 'token', type: 'address' },
      { indexed: false, name: 'targetAmount', type: 'uint256' },
      { indexed: false, name: 'settlementDate', type: 'uint64' },
      { indexed: false, name: 'createdAt', type: 'uint64' },
      { indexed: false, name: 'termsHash', type: 'bytes32' },
      { indexed: false, name: 'arbitrationMode', type: 'uint8' },
      { indexed: false, name: 'arbitrator1', type: 'address' },
      { indexed: false, name: 'arbitrator2', type: 'address' },
      { indexed: false, name: 'arbitrator3', type: 'address' },
    ],
    name: 'EscrowCreated',
    type: 'event',
  },
] as const;

export const EscrowABI = [
  // Immutable getters
  { inputs: [], name: 'sellerWallet', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'buyerRefundWallet', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'targetAmount', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'settlementDate', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'createdAt', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'termsHash', outputs: [{ type: 'bytes32' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator1', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator2', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator3', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrationMode', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'treasury', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  // Dynamic state
  { inputs: [], name: 'status', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'statusCode', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pendingOutcome', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'overrideWindowEnd', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'settleVotes', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'refundVotes', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isFunded', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'balance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  // Mutual approval state
  { inputs: [], name: 'mutualSettleApprovedByBuyer', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mutualSettleApprovedBySeller', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mutualRefundApprovedByBuyer', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mutualRefundApprovedBySeller', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  // Actionable states
  { inputs: [], name: 'isTerminal', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isActivatable', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isRefundableUnderfunded', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isSettleable', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isVotable', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isInOverrideWindow', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isFinalizable', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'calculateFee', outputs: [{ type: 'uint256' }], stateMutability: 'pure', type: 'function' },
  // Write functions (for encoding)
  { inputs: [], name: 'sellerConfirm', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'settle', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'refundUnderfunded', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'approveMutualSettle', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'approveMutualRefund', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'finalizeMutualResolution', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'arbSettle', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'arbRefund', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'arbVoteSettle', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'arbVoteRefund', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'sweepExcess', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'recoverLatePaymentToken', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'erc20', type: 'address' }, { name: 'amt', type: 'uint256' }], name: 'sweepStrayToken', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  // Events (for activity feeds)
  { anonymous: false, inputs: [{ indexed: true, name: 'seller', type: 'address' }, { indexed: false, name: 'balance', type: 'uint256' }, { indexed: false, name: 'at', type: 'uint64' }], name: 'SellerConfirmed', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'seller', type: 'address' }, { indexed: false, name: 'principal', type: 'uint256' }, { indexed: false, name: 'fee', type: 'uint256' }, { indexed: false, name: 'excessSwept', type: 'uint256' }, { indexed: true, name: 'treasury', type: 'address' }], name: 'Settled', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'buyerRefundWallet', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }], name: 'Refunded', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'buyerRefundWallet', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }, { indexed: false, name: 'at', type: 'uint64' }], name: 'UnderfundedRefunded', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'approver', type: 'address' }], name: 'MutualSettleApproved', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'approver', type: 'address' }], name: 'MutualRefundApproved', type: 'event' },
  { anonymous: false, inputs: [{ indexed: false, name: 'outcome', type: 'uint8' }, { indexed: false, name: 'overrideWindowEnd', type: 'uint64' }], name: 'MutualResolutionPending', type: 'event' },
  { anonymous: false, inputs: [{ indexed: false, name: 'outcome', type: 'uint8' }], name: 'MutualResolutionFinalized', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'arbitrator', type: 'address' }, { indexed: false, name: 'outcome', type: 'uint8' }], name: 'ArbitratorVoted', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'treasury', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }], name: 'SweptExcess', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'erc20', type: 'address' }, { indexed: true, name: 'treasury', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }], name: 'SweptStrayToken', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, name: 'buyerRefundWallet', type: 'address' }, { indexed: false, name: 'amount', type: 'uint256' }, { indexed: false, name: 'at', type: 'uint64' }], name: 'LatePaymentTokenRecovered', type: 'event' },
] as const;

export const ERC20ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export const PaymentRouterABI = [
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'pay', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'linkExists', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '', type: 'bytes32' }], name: 'links', outputs: [{ name: 'token', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

// Status enum mirrors EscrowV2.Status
export enum EscrowStatus {
  CREATED = 0,
  ACTIVE = 1,
  PENDING_MUTUAL_RESOLUTION = 2,
  SETTLED = 3,
  REFUNDED = 4,
}

// Outcome enum mirrors EscrowV2.Outcome
export enum EscrowOutcome {
  NONE = 0,
  SETTLE = 1,
  REFUND = 2,
}

export type EscrowState = {
  chainId: SupportedChainId;
  // Addresses
  escrow: Address;
  sellerWallet: Address;      // payout - receives funds on settle
  buyerRefundWallet: Address; // funder - receives funds on refund
  token: Address;
  treasury: Address;
  arbitrator1: Address;
  arbitrator2: Address;
  arbitrator3: Address;
  arbitrationMode: number;    // 0, 1, or 3 (never 2)
  // Amounts (as bigint)
  targetAmount: bigint;
  balance: bigint;            // current escrow token balance
  // Timestamps (as number for easy comparison)
  settlementDate: number;
  createdAt: number;
  overrideWindowEnd: number;
  // Terms
  termsHash: string;
  // Status
  status: EscrowStatus;
  pendingOutcome: EscrowOutcome;
  settleVotes: number;
  refundVotes: number;
  isFunded: boolean;
  // Mutual approval state
  mutualSettleApprovedByBuyer: boolean;
  mutualSettleApprovedBySeller: boolean;
  mutualRefundApprovedByBuyer: boolean;
  mutualRefundApprovedBySeller: boolean;
  // Computed actionable states
  isTerminal: boolean;
  isActivatable: boolean;
  isRefundableUnderfunded: boolean;
  isSettleable: boolean;
  isVotable: boolean;
  isInOverrideWindow: boolean;
  isFinalizable: boolean;
  // Token metadata
  tokenSymbol: string;
  tokenDecimals: number;
  // Escrow token balance (alias of balance, kept for callers expecting it)
  escrowTokenBalance: bigint;
};

export type EscrowActivity = {
  id: string;
  timestamp: number | null;
  role: 'Buyer' | 'Seller' | 'Arbitrator' | 'Contract' | 'Wallet';
  tone: 'buyer' | 'seller' | 'arbitrator' | 'contract' | 'wallet';
  text: string;
  txHash?: Hex;
  blockNumber?: bigint;
  logIndex?: number;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Chain Read Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Read all escrow state from chain via multicall
 */
export async function readEscrowState(
  escrowAddress: Address,
  chainId: SupportedChainId = ARBITRUM_CHAIN_ID
): Promise<EscrowState> {
  const client = getPublicClient(chainId);
  const basicResults = await client.multicall({
    contracts: [
      { address: escrowAddress, abi: EscrowABI, functionName: 'sellerWallet' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'buyerRefundWallet' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'token' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'targetAmount' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'balance' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'settlementDate' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'createdAt' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'overrideWindowEnd' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'termsHash' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitrator1' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitrator2' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitrator3' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'arbitrationMode' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'treasury' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'statusCode' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'pendingOutcome' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'settleVotes' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'refundVotes' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isFunded' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isTerminal' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isActivatable' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isRefundableUnderfunded' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isSettleable' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isVotable' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isInOverrideWindow' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'isFinalizable' },
    ],
    allowFailure: false,
  });

  const tokenAddress = basicResults[2] as Address;
  const escrowBalance = basicResults[4] as bigint;

  // Mutual approval state
  const mutualResults = await client.multicall({
    contracts: [
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualSettleApprovedByBuyer' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualSettleApprovedBySeller' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualRefundApprovedByBuyer' },
      { address: escrowAddress, abi: EscrowABI, functionName: 'mutualRefundApprovedBySeller' },
    ],
    allowFailure: false,
  });

  // Token metadata
  const tokenResults = await client.multicall({
    contracts: [
      { address: tokenAddress, abi: ERC20ABI, functionName: 'symbol' },
      { address: tokenAddress, abi: ERC20ABI, functionName: 'decimals' },
    ],
    allowFailure: false,
  });

  return {
    chainId,
    escrow: escrowAddress,
    sellerWallet: basicResults[0] as Address,
    buyerRefundWallet: basicResults[1] as Address,
    token: tokenAddress,
    targetAmount: basicResults[3] as bigint,
    balance: escrowBalance,
    settlementDate: Number(basicResults[5]),
    createdAt: Number(basicResults[6]),
    overrideWindowEnd: Number(basicResults[7]),
    termsHash: basicResults[8] as string,
    arbitrator1: basicResults[9] as Address,
    arbitrator2: basicResults[10] as Address,
    arbitrator3: basicResults[11] as Address,
    arbitrationMode: Number(basicResults[12]),
    treasury: basicResults[13] as Address,
    status: Number(basicResults[14]) as EscrowStatus,
    pendingOutcome: Number(basicResults[15]) as EscrowOutcome,
    settleVotes: Number(basicResults[16]),
    refundVotes: Number(basicResults[17]),
    isFunded: basicResults[18] as boolean,
    isTerminal: basicResults[19] as boolean,
    isActivatable: basicResults[20] as boolean,
    isRefundableUnderfunded: basicResults[21] as boolean,
    isSettleable: basicResults[22] as boolean,
    isVotable: basicResults[23] as boolean,
    isInOverrideWindow: basicResults[24] as boolean,
    isFinalizable: basicResults[25] as boolean,
    // Mutual approval state
    mutualSettleApprovedByBuyer: mutualResults[0] as boolean,
    mutualSettleApprovedBySeller: mutualResults[1] as boolean,
    mutualRefundApprovedByBuyer: mutualResults[2] as boolean,
    mutualRefundApprovedBySeller: mutualResults[3] as boolean,
    // Token metadata
    tokenSymbol: tokenResults[0] as string,
    tokenDecimals: Number(tokenResults[1]),
    escrowTokenBalance: escrowBalance,
  };
}

/**
 * Get token balance for an address
 */
export async function getTokenBalance(
  tokenAddress: Address,
  accountAddress: Address,
  chainId: SupportedChainId = ARBITRUM_CHAIN_ID
): Promise<bigint> {
  return getPublicClient(chainId).readContract({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'balanceOf',
    args: [accountAddress],
  });
}

const RECENT_ACTION_BLOCK_RANGE = BigInt(500_000);
const ZERO_BIGINT = BigInt(0);
const SORT_BLOCK_MULTIPLIER = BigInt(1_000_000);

function addressTone(address: string | undefined, state: EscrowState): Pick<EscrowActivity, 'role' | 'tone'> {
  const normalized = address?.toLowerCase();
  if (!normalized) return { role: 'Wallet', tone: 'wallet' };
  if (normalized === state.buyerRefundWallet.toLowerCase()) return { role: 'Buyer', tone: 'buyer' };
  if (normalized === state.sellerWallet.toLowerCase()) return { role: 'Seller', tone: 'seller' };
  if (
    normalized === state.arbitrator1.toLowerCase() ||
    normalized === state.arbitrator2.toLowerCase() ||
    normalized === state.arbitrator3.toLowerCase()
  ) {
    return { role: 'Arbitrator', tone: 'arbitrator' };
  }
  return { role: 'Wallet', tone: 'wallet' };
}

async function getBlockTimestamps(blockNumbers: bigint[], chainId: SupportedChainId): Promise<Map<string, number>> {
  const client = getPublicClient(chainId);
  const uniqueBlocks = Array.from(new Set(blockNumbers.map((block) => block.toString())));
  const timestampEntries = await Promise.all(
    uniqueBlocks.map(async (block) => {
      const data = await client.getBlock({ blockNumber: BigInt(block) });
      return [block, Number(data.timestamp)] as const;
    })
  );

  return new Map(timestampEntries);
}

function activitySortValue(activity: EscrowActivity): bigint {
  const block = activity.blockNumber ?? ZERO_BIGINT;
  const index = BigInt((activity.logIndex ?? 0) + 1);
  return block * SORT_BLOCK_MULTIPLIER + index;
}

/**
 * Build a recent activity feed directly from RPC logs.
 * The returned rows are display helpers only; contract reads remain the source of truth.
 */
export async function readEscrowActivity(
  state: EscrowState,
  limit = 12
): Promise<{ activity: EscrowActivity[]; partial: boolean }> {
  const client = getPublicClient(state.chainId);
  let latestBlock: bigint;
  try {
    latestBlock = await client.getBlockNumber();
  } catch {
    return {
      partial: true,
      activity: [{
        id: `created-${state.escrow}`,
        timestamp: state.createdAt || null,
        role: 'Contract',
        tone: 'contract',
        text: 'Executed Function: Created',
      }],
    };
  }

  const fromBlock = latestBlock > RECENT_ACTION_BLOCK_RANGE ? latestBlock - RECENT_ACTION_BLOCK_RANGE : ZERO_BIGINT;
  let partial = false;

  const [escrowLogs, transferLogs] = await Promise.all([
    client.getLogs({
      address: state.escrow,
      fromBlock,
      toBlock: latestBlock,
    }).catch(() => {
      partial = true;
      return [];
    }),
    client.getLogs({
      address: state.token,
      event: ERC20ABI[0],
      args: { to: state.escrow },
      fromBlock,
      toBlock: latestBlock,
    }).catch(() => {
      partial = true;
      return [];
    }),
  ]);

  const blockTimestamps = await getBlockTimestamps(
    [...escrowLogs, ...transferLogs]
      .map((log) => log.blockNumber)
      .filter((block): block is bigint => typeof block === 'bigint'),
    state.chainId
  ).catch(() => {
    partial = true;
    return new Map<string, number>();
  });

  const activity: EscrowActivity[] = [{
    id: `created-${state.escrow}`,
    timestamp: state.createdAt || null,
    role: 'Contract',
    tone: 'contract',
    text: 'Executed Function: Created',
  }];

  try {
    const parsedEscrowLogs = parseEventLogs({ abi: EscrowABI, logs: escrowLogs }) as Array<{
      eventName: string;
      args: Record<string, unknown>;
      transactionHash: Hex;
      blockNumber?: bigint;
      logIndex?: number;
    }>;

    for (const log of parsedEscrowLogs) {
      const timestamp = log.blockNumber ? blockTimestamps.get(log.blockNumber.toString()) ?? null : null;
      const base = {
        id: `${log.transactionHash}-${log.logIndex}`,
        timestamp,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      };
      const args = log.args as Record<string, unknown>;

      switch (log.eventName) {
        case 'SellerConfirmed':
          activity.push({
            ...base,
            ...addressTone(args.seller as string | undefined, state),
            text: 'Called Function: Confirm',
          });
          break;
        case 'MutualSettleApproved':
          activity.push({
            ...base,
            ...addressTone(args.approver as string | undefined, state),
            text: 'Called Function: Approve Mutual Settle',
          });
          break;
        case 'MutualRefundApproved':
          activity.push({
            ...base,
            ...addressTone(args.approver as string | undefined, state),
            text: 'Called Function: Approve Mutual Refund',
          });
          break;
        case 'MutualResolutionPending':
          activity.push({
            ...base,
            role: 'Contract',
            tone: 'contract',
            text: Number(args.outcome) === 2 ? 'Executed Function: Pending Mutual Refund' : 'Executed Function: Pending Mutual Settle',
          });
          break;
        case 'MutualResolutionFinalized':
          activity.push({
            ...base,
            role: 'Contract',
            tone: 'contract',
            text: 'Called Function: Finalize Mutual Resolution',
          });
          break;
        case 'ArbitratorVoted':
          activity.push({
            ...base,
            ...addressTone(args.arbitrator as string | undefined, state),
            text: Number(args.outcome) === 2 ? 'Called Function: Vote Refund' : 'Called Function: Vote Settle',
          });
          break;
        case 'Settled':
          activity.push({
            ...base,
            role: 'Contract',
            tone: 'contract',
            text: 'Executed Function: Settle',
          });
          break;
        case 'Refunded':
          activity.push({
            ...base,
            role: 'Contract',
            tone: 'contract',
            text: 'Executed Function: Refund',
          });
          break;
        case 'UnderfundedRefunded':
          activity.push({
            ...base,
            role: 'Contract',
            tone: 'contract',
            text: 'Executed Function: Refund Underfunded',
          });
          break;
        case 'LatePaymentTokenRecovered':
          activity.push({
            ...base,
            role: 'Contract',
            tone: 'contract',
            text: 'Executed Function: Recover Late Payment',
          });
          break;
        case 'SweptExcess':
        case 'SweptStrayToken':
          activity.push({
            ...base,
            role: 'Contract',
            tone: 'contract',
            text: 'Executed Function: Sweep',
          });
          break;
        default:
          break;
      }
    }
  } catch {
    partial = true;
  }

  let runningInbound = ZERO_BIGINT;
  let fundedMarkerAdded = false;
  const sortedTransfers = [...transferLogs].sort((a, b) => {
    const blockDiff = (a.blockNumber ?? ZERO_BIGINT) - (b.blockNumber ?? ZERO_BIGINT);
    if (blockDiff !== ZERO_BIGINT) return blockDiff > ZERO_BIGINT ? 1 : -1;
    return Number((a.logIndex ?? 0) - (b.logIndex ?? 0));
  });

  for (const log of sortedTransfers) {
    const timestamp = log.blockNumber ? blockTimestamps.get(log.blockNumber.toString()) ?? null : null;
    const args = log.args as { from?: Address; value?: bigint };
    const actor = addressTone(args.from, state);

    activity.push({
      id: `${log.transactionHash}-${log.logIndex}-transfer`,
      timestamp,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      ...actor,
      text: 'Called Function: Fund Escrow',
    });

    runningInbound += args.value ?? ZERO_BIGINT;
    if (!fundedMarkerAdded && runningInbound >= state.targetAmount) {
      fundedMarkerAdded = true;
      activity.push({
        id: `${log.transactionHash}-${log.logIndex}-funded`,
        timestamp,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: (log.logIndex ?? 0) + 1,
        role: 'Contract',
        tone: 'contract',
        text: 'Executed Function: Set Funded',
      });
    }
  }

  const deduped = Array.from(new Map(activity.map((row) => [row.id, row])).values());
  const sorted = deduped
    .sort((a, b) => {
      const diff = activitySortValue(b) - activitySortValue(a);
      if (diff === ZERO_BIGINT) return (b.timestamp ?? 0) - (a.timestamp ?? 0);
      return diff > ZERO_BIGINT ? 1 : -1;
    })
    .slice(0, limit);

  return { activity: sorted, partial };
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
export function getArbiscanAddressUrl(address: string, chainId: SupportedChainId = ARBITRUM_CHAIN_ID): string {
  return `${getChainConfig(chainId).explorerBaseUrl}/address/${address}`;
}

/**
 * Get Arbiscan URL for transaction
 */
export function getArbiscanTxUrl(txHash: string, chainId: SupportedChainId = ARBITRUM_CHAIN_ID): string {
  return `${getChainConfig(chainId).explorerBaseUrl}/tx/${txHash}`;
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
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return false;
  try {
    getAddress(address);
    return true;
  } catch {
    return false;
  }
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
