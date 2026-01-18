/**
 * Escrow Oracle Service
 * Main entry point
 * 
 * Deterministic V1 - immutable parties, no refunds once funded
 */

import express from "express";
import { ENV } from "./config/env.js";
import routes from "./api/routes.js";
import { errorHandler } from "./api/middleware.js";
import { startWSS, startBackfill } from "./watcher/events.js";
import { startKeeper } from "./watcher/keeper.js";
import { startTxSender, stopTxSender, getTxSenderStatus } from "./blockchain/tx-sender.js";

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use("/", routes);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(ENV.PORT, () => {
  console.log(`\n🚀 Oracle API listening on port ${ENV.PORT}`);
  console.log(`   Environment: ${ENV.NODE_ENV}`);
  console.log(`   Chain ID: ${ENV.CHAIN_ID}`);
  console.log(`   Factory: ${ENV.FACTORY_ADDRESS}`);
  console.log(`   USDC: ${ENV.USDC_ADDRESS}`);
  console.log(`\n📡 Available endpoints:`);
  console.log(`   POST /escrow/create     - Create escrow with immutable payout + funder`);
  console.log(`   GET  /escrow/status/:code - Get escrow status`);
  console.log(`   GET  /escrow/list       - List escrows from Postgres`);
  console.log(`   GET  /health            - Health check`);
  console.log(`\n🔐 Authentication: Bearer token required for POST endpoints`);
  console.log(`\n`);
});

// Start event watcher
async function startWatcher() {
  console.log("🔭 Starting event watcher...\n");
  
  try {
    await startWSS();
    await startBackfill();
    console.log("\n✅ Event watcher started successfully\n");
  } catch (error) {
    console.error("❌ Failed to start watcher:", error);
    process.exit(1);
  }
}

// Start keeper (periodic maintenance)
function startKeeperLoop() {
  console.log("🤖 Starting keeper loop...\n");
  startKeeper();
}

// Start TX sender worker
function startTxSenderWorker() {
  console.log("💳 Starting TX sender worker...\n");
  startTxSender();
}

// Initialize all background services
startTxSenderWorker(); // Start TX sender first (needed for other services)
startWatcher();
startKeeperLoop();

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  
  // Stop TX sender worker
  await stopTxSender();
  
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
