import { createPublicClient, createWalletClient, http, webSocket, type PublicClient } from "viem";
import { arbitrumSepolia, arbitrum, mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ENV } from "../config/env.js";
import { getNetwork } from "../config/networks.js";

function chainDefinition(chainId: number) {
  if (chainId === 1) return mainnet;
  if (chainId === 42161) return arbitrum;
  if (chainId === 421614) return arbitrumSepolia;
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

const publicClients = new Map<number, PublicClient>();
const wsClients = new Map<number, PublicClient>();

export function getPublicClient(chainId: number): PublicClient {
  const existing = publicClients.get(chainId);
  if (existing) return existing;
  const network = getNetwork(chainId);
  const client = createPublicClient({
    chain: chainDefinition(chainId),
    transport: http(network.RPC_HTTP),
  }) as PublicClient;
  publicClients.set(chainId, client);
  return client;
}

export function getWsClient(chainId: number): PublicClient {
  const existing = wsClients.get(chainId);
  if (existing) return existing;
  const network = getNetwork(chainId);
  const client = createPublicClient({
    chain: chainDefinition(chainId),
    transport: webSocket(network.RPC_WSS, {
      reconnect: { attempts: 10, delay: 1000 },
    }),
  }) as PublicClient;
  wsClients.set(chainId, client);
  return client;
}

// Backward-compatible aliases for optional server-signed jobs (disabled at launch).
export const publicClient = getPublicClient(ENV.CHAIN_ID);
export const wsClient = getWsClient(ENV.CHAIN_ID);

export function getServerSigner() {
  if (!ENV.ORACLE_PRIVATE_KEY) {
    throw new Error("ORACLE_PRIVATE_KEY is required when ENABLE_SERVER_TXS=true");
  }

  const account = privateKeyToAccount(ENV.ORACLE_PRIVATE_KEY as `0x${string}`);
  const chain = chainDefinition(ENV.CHAIN_ID);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(ENV.RPC_HTTP),
  });

  return { account, walletClient };
}

console.log(`✅ Blockchain read clients initialized for configured networks`);
