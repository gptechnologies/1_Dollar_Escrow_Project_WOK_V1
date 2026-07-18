import dotenv from "dotenv";
import { resolve } from "path";

// Load env from workspace root
const envFile = process.env.NODE_ENV === "production" 
  ? ".env.prod" 
  : process.env.NODE_ENV === "test" 
  ? ".env.test" 
  : ".env.local";

dotenv.config({ path: resolve(process.cwd(), "../..", envFile) });

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "local",
  CHAIN_ID: parseInt(process.env.CHAIN_ID || "42161", 10),
  
  // RPC
  RPC_HTTP: process.env.RPC_HTTP || "",
  RPC_WSS: process.env.RPC_WSS || "",
  
  // Optional backend transaction signer. Not required for the manual P2P flow.
  ORACLE_PRIVATE_KEY: process.env.ORACLE_PRIVATE_KEY || "",
  ENABLE_SERVER_TXS: process.env.ENABLE_SERVER_TXS === "true",
  
  // Contracts
  FACTORY_ADDRESS: process.env.FACTORY_ADDRESS || "",
  USDC_ADDRESS: process.env.USDC_ADDRESS || "",
  USDT_ADDRESS: process.env.USDT_ADDRESS || "",
  INDEXER_START_BLOCK: process.env.INDEXER_START_BLOCK || "",

  // Dual-chain production indexer. Legacy values above remain Arbitrum aliases.
  ARBITRUM_RPC_HTTP: process.env.ARBITRUM_RPC_HTTP || process.env.RPC_HTTP || "",
  ARBITRUM_RPC_WSS: process.env.ARBITRUM_RPC_WSS || process.env.RPC_WSS || "",
  ARBITRUM_FACTORY_ADDRESS: process.env.ARBITRUM_FACTORY_ADDRESS || process.env.FACTORY_ADDRESS || "",
  ARBITRUM_INDEXER_START_BLOCK: process.env.ARBITRUM_INDEXER_START_BLOCK || process.env.INDEXER_START_BLOCK || "",
  ETHEREUM_RPC_HTTP: process.env.ETHEREUM_RPC_HTTP || "",
  ETHEREUM_RPC_WSS: process.env.ETHEREUM_RPC_WSS || "",
  ETHEREUM_FACTORY_ADDRESS: process.env.ETHEREUM_FACTORY_ADDRESS || "",
  ETHEREUM_INDEXER_START_BLOCK: process.env.ETHEREUM_INDEXER_START_BLOCK || "",
  
  // Database
  POSTGRES_URL: process.env.POSTGRES_URL || "",
  REDIS_URL: process.env.REDIS_URL || "",
  
  // API
  PORT: parseInt(process.env.PORT || "3000", 10),
  WEBHOOK_SHARED_SECRET: process.env.WEBHOOK_SHARED_SECRET || "",
  
  // DM Platform (future use)
  DM_PLATFORM: process.env.DM_PLATFORM || "twitter",
  TWITTER_BEARER: process.env.TWITTER_BEARER || "",
  TWITTER_APP_KEY: process.env.TWITTER_APP_KEY || "",
  TWITTER_APP_SECRET: process.env.TWITTER_APP_SECRET || "",
  TWITTER_WEBHOOK_SECRET: process.env.TWITTER_WEBHOOK_SECRET || "",
  
  // Airtable (future use)
  AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY || "",
  AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID || "",
  AIRTABLE_TABLE: process.env.AIRTABLE_TABLE || "Escrows",
};

// Validate required env vars
function validateEnv() {
  const required = [
    "ARBITRUM_RPC_HTTP",
    "ARBITRUM_RPC_WSS",
    "ARBITRUM_FACTORY_ADDRESS",
    "ETHEREUM_RPC_HTTP",
    "ETHEREUM_RPC_WSS",
    "ETHEREUM_FACTORY_ADDRESS",
    "POSTGRES_URL",
    "WEBHOOK_SHARED_SECRET",
  ];

  if (ENV.ENABLE_SERVER_TXS) {
    required.push("ORACLE_PRIVATE_KEY", "REDIS_URL");
  }

  const missing = required.filter((key) => !ENV[key as keyof typeof ENV]);
  
  if (missing.length > 0) {
    console.warn(`⚠️  Missing required environment variables: ${missing.join(", ")}`);
    console.warn(`⚠️  Please copy env.${ENV.NODE_ENV}.template and fill in values`);
  }
}

validateEnv();
