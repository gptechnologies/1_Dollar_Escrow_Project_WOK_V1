import { createPublicClient, createWalletClient, http, webSocket, type PublicClient } from "viem";
import { arbitrumSepolia, arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ENV } from "../config/env.js";

// Select chain based on CHAIN_ID
const chain = ENV.CHAIN_ID === 42161 ? arbitrum : arbitrumSepolia;

if (!ENV.ORACLE_PRIVATE_KEY) {
  throw new Error("ORACLE_PRIVATE_KEY is required");
}

// Oracle account
export const oracleAccount = privateKeyToAccount(ENV.ORACLE_PRIVATE_KEY as `0x${string}`);

// HTTP client for reads and writes
export const publicClient = createPublicClient({
  chain,
  transport: http(ENV.RPC_HTTP),
});

// Wallet client for signing transactions
export const walletClient = createWalletClient({
  account: oracleAccount,
  chain,
  transport: http(ENV.RPC_HTTP),
});

// WebSocket client for event subscriptions (Phase 5)
export const wsClient: PublicClient = createPublicClient({
  chain,
  transport: webSocket(ENV.RPC_WSS, {
    reconnect: {
      attempts: 10,
      delay: 1000,
    },
  }),
});

console.log(`✅ Blockchain clients initialized for ${chain.name}`);
console.log(`   Oracle address: ${oracleAccount.address}`);

