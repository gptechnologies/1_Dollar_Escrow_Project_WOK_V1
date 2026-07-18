/** Network configuration for the unified Arbitrum + Ethereum indexer. */

import { ENV } from "./env.js";

export interface NetworkConfig {
  chainId: number;
  name: string;
  RPC_HTTP: string;
  RPC_WSS: string;
  FACTORY: string;
  PAYMENT_ROUTER: string;
  USDC: string;
  USDT: string;
  confirmationAmount: bigint; // $1 = 1e6 (6 decimals for both USDC/USDT)
  blockConfirmations: number; // reorg safety lag
  backfillIntervalMs: number;
  indexerStartBlock: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  // Arbitrum Sepolia (Test)
  "421614": {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    RPC_HTTP: process.env.RPC_HTTP || "https://sepolia-rollup.arbitrum.io/rpc",
    RPC_WSS: process.env.RPC_WSS || "wss://sepolia-rollup.arbitrum.io/rpc",
    FACTORY: process.env.FACTORY_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_FACTORY",
    PAYMENT_ROUTER: process.env.PAYMENT_ROUTER_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_ROUTER",
    USDC: process.env.USDC_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_MOCK_USDC",
    USDT: process.env.USDT_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_MOCK_USDT",
    confirmationAmount: 1_000_000n, // $1 (6 decimals)
    blockConfirmations: 2, // wait 2 blocks for reorg safety
    backfillIntervalMs: 10_000, // backfill every 10s
    indexerStartBlock: process.env.INDEXER_START_BLOCK || "",
  },
  // Arbitrum One (Production)
  "42161": {
    chainId: 42161,
    name: "Arbitrum One",
    RPC_HTTP: ENV.ARBITRUM_RPC_HTTP || "https://arb1.arbitrum.io/rpc",
    RPC_WSS: ENV.ARBITRUM_RPC_WSS || "wss://arb1.arbitrum.io/rpc",
    FACTORY: ENV.ARBITRUM_FACTORY_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_FACTORY",
    PAYMENT_ROUTER: process.env.PAYMENT_ROUTER_ADDRESS || "0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Real USDC on Arbitrum One
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Real USDT on Arbitrum One
    confirmationAmount: 1_000_000n, // $1 (6 decimals)
    blockConfirmations: 3, // more conservative on mainnet
    backfillIntervalMs: 15_000, // backfill every 15s
    indexerStartBlock: ENV.ARBITRUM_INDEXER_START_BLOCK,
  },
  "1": {
    chainId: 1,
    name: "Ethereum",
    RPC_HTTP: ENV.ETHEREUM_RPC_HTTP || "https://ethereum-rpc.publicnode.com",
    RPC_WSS: ENV.ETHEREUM_RPC_WSS || "wss://ethereum-rpc.publicnode.com",
    FACTORY: ENV.ETHEREUM_FACTORY_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_FACTORY",
    PAYMENT_ROUTER: "0x0000000000000000000000000000000000000000",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    confirmationAmount: 1_000_000n,
    blockConfirmations: 12,
    backfillIntervalMs: 15_000,
    indexerStartBlock: ENV.ETHEREUM_INDEXER_START_BLOCK,
  },
};

export const PRODUCTION_CHAIN_IDS = [42161, 1] as const;

export function getNetwork(chainId: number): NetworkConfig {
  const config = NETWORKS[chainId.toString()];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}
