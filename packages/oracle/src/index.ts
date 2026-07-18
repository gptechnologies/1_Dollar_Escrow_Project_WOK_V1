/**
 * Escrow Indexer/API Service
 * Main entry point
 * 
 * P2P EscrowV2 - manual transactions, webhook/WSS indexing, DB lookup codes.
 */

import express from "express";
import { ENV } from "./config/env.js";
import routes from "./api/routes.js";
import { errorHandler } from "./api/middleware.js";
import { startWSS, startBackfill } from "./watcher/events.js";
import { PRODUCTION_CHAIN_IDS, getNetwork } from "./config/networks.js";

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use("/", routes);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(ENV.PORT, () => {
  console.log(`\n🚀 Indexer API listening on port ${ENV.PORT}`);
  console.log(`   Environment: ${ENV.NODE_ENV}`);
  for (const chainId of PRODUCTION_CHAIN_IDS) {
    const network = getNetwork(chainId);
    console.log(`   ${network.name} (${chainId}): ${network.FACTORY}`);
  }
  console.log(`\n📡 Available endpoints:`);
  console.log(`   POST /escrow/register   - Register wallet-created escrow tx`);
  console.log(`   GET  /escrow/status/:code - Get escrow status`);
  console.log(`   GET  /escrow/list       - List escrows from Postgres`);
  console.log(`   POST /webhooks/chain/:chainId - Ingest chain provider logs`);
  console.log(`   GET  /health            - Health check`);
  console.log(`\n🔐 Authentication: webhook secret required for /webhooks/chain`);
  console.log(`   Server-signed transactions: ${ENV.ENABLE_SERVER_TXS ? "enabled" : "disabled"}`);
  console.log(`\n`);
});

// Start event watcher
async function startWatcher() {
  console.log("🔭 Starting event watcher...\n");
  
  try {
    for (const chainId of PRODUCTION_CHAIN_IDS) {
      await startWSS(chainId);
      await startBackfill(chainId);
    }
    console.log("\n✅ Event watcher started successfully\n");
  } catch (error) {
    console.error("❌ Failed to start watcher:", error);
    process.exit(1);
  }
}

// Start TX sender worker
let stopServerTxSender: (() => Promise<void>) | null = null;

async function startTxSenderWorker() {
  if (!ENV.ENABLE_SERVER_TXS) {
    console.log("💳 TX sender disabled (manual transactions only)\n");
    return;
  }

  console.log("💳 Starting optional TX sender worker...\n");
  const { startTxSender, stopTxSender } = await import("./blockchain/tx-sender.js");
  startTxSender();
  stopServerTxSender = stopTxSender;
}

// Initialize all background services
startTxSenderWorker();
startWatcher();

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  
  if (stopServerTxSender) {
    await stopServerTxSender();
  }
  
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
