/**
 * Network configuration for Arbitrum Sepolia and Arbitrum One
 */

export interface NetworkConfig {
  chainId: number;
  name: string;
  RPC_HTTP: string;
  RPC_WSS: string;
  FACTORY: string;
  USDC: string;
  USDT: string;
  confirmationAmount: bigint; // $1 = 1e6 (6 decimals for both USDC/USDT)
  blockConfirmations: number; // reorg safety lag
  backfillIntervalMs: number;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  // Arbitrum Sepolia (Test)
  "421614": {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    RPC_HTTP: process.env.RPC_HTTP || "https://sepolia-rollup.arbitrum.io/rpc",
    RPC_WSS: process.env.RPC_WSS || "wss://sepolia-rollup.arbitrum.io/rpc",
    FACTORY: process.env.FACTORY_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_FACTORY",
    USDC: process.env.USDC_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_MOCK_USDC",
    USDT: process.env.USDT_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_MOCK_USDT",
    confirmationAmount: 1_000_000n, // $1 (6 decimals)
    blockConfirmations: 2, // wait 2 blocks for reorg safety
    backfillIntervalMs: 10_000, // backfill every 10s
  },
  // Arbitrum One (Production)
  "42161": {
    chainId: 42161,
    name: "Arbitrum One",
    RPC_HTTP: process.env.RPC_HTTP || "https://arb1.arbitrum.io/rpc",
    RPC_WSS: process.env.RPC_WSS || "wss://arb1.arbitrum.io/rpc",
    FACTORY: process.env.FACTORY_ADDRESS || "0x_REPLACE_WITH_DEPLOYED_FACTORY",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Real USDC on Arbitrum One
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Real USDT on Arbitrum One
    confirmationAmount: 1_000_000n, // $1 (6 decimals)
    blockConfirmations: 3, // more conservative on mainnet
    backfillIntervalMs: 15_000, // backfill every 15s
  },
};

export function getNetwork(chainId: number): NetworkConfig {
  const config = NETWORKS[chainId.toString()];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}

