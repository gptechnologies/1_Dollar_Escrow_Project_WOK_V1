import { Router } from "express";
import { requireAuth, validateBody } from "./middleware.js";
import { CreateEscrowSchema, RegisterEscrowSchema, CreatePaymentLinkSchema } from "./types.js";
import { createEscrow, registerEscrow, getEscrowStatus, listEscrows } from "../services/escrow.js";
import { createPaymentLink, getPaymentLink } from "../services/payment.js";
import { addActiveEscrow } from "../watcher/events.js";
import { processWebhookLogs } from "../watcher/events.js";
import { ENV } from "../config/env.js";

const router = Router();

/**
 * POST /escrow/create
 * Optional admin/internal server-signed creation path.
 * The product flow is wallet-direct createEscrowSimple + /escrow/register.
 * 
 * Disabled unless ENABLE_SERVER_TXS=true.
 */
router.post("/escrow/create", requireAuth, validateBody(CreateEscrowSchema), async (req, res, next) => {
  try {
    if (!ENV.ENABLE_SERVER_TXS) {
      res.status(503).json({
        error: "Server-signed escrow creation is disabled. Create from the wallet and call /escrow/register.",
      });
      return;
    }

    const result = await createEscrow({
      payout: req.body.payout as `0x${string}`,
      funder: req.body.funder as `0x${string}`,
      token: req.body.token as `0x${string}`,
      targetAmount: BigInt(req.body.targetAmount),
      settlementDate: req.body.settlementDate,
      termsHash: req.body.termsHash as `0x${string}` | undefined,
      termsText: req.body.termsText as string | undefined,
      arbitrator1: req.body.arbitrator1 as `0x${string}` | undefined,
      arbitrator2: req.body.arbitrator2 as `0x${string}` | undefined,
      arbitrator3: req.body.arbitrator3 as `0x${string}` | undefined,
    });

    res.json({
      escrow: result.escrow,
      code: result.code,
      txHash: result.txHash,
      token: result.token,
      status: 0,
      settlementDate: result.settlementDate,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /escrow/register
 * Public endpoint (no auth) - register an on-chain escrow by tx hash.
 * Verifies receipt, parses EscrowCreated event, upserts into DB.
 */
router.post("/escrow/register", validateBody(RegisterEscrowSchema), async (req, res, next) => {
  try {
    const result = await registerEscrow(req.body.chainId, req.body.txHash, req.body.termsText);
    addActiveEscrow(result.chainId, result.escrow);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /escrow/status/:code
 * Get escrow status by code
 */
router.get("/escrow/status/:code", async (req, res, next) => {
  try {
    const status = await getEscrowStatus(req.params.code);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /escrow/list
 * List escrows from Postgres (no chain reads)
 */
router.get("/escrow/list", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit);
    const query = typeof req.query.query === "string" ? req.query.query : undefined;
    const escrows = await listEscrows({
      limit: Number.isFinite(limit) ? limit : undefined,
      query,
    });

    res.json({ escrows });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /webhooks/chain
 * Chain provider webhook endpoint. Ingests factory, escrow, and ERC-20 logs
 * into the same database pipeline as the WSS watcher.
 */
async function handleChainWebhook(req: any, res: any, next: any, chainId: number) {
  try {
    if (ENV.WEBHOOK_SHARED_SECRET) {
      const provided =
        req.header("x-webhook-secret") ||
        req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (provided !== ENV.WEBHOOK_SHARED_SECRET) {
        res.status(401).json({ error: "Invalid webhook secret" });
        return;
      }
    }

    if (chainId !== 1 && chainId !== 42161) {
      res.status(400).json({ error: "Unsupported chain ID" });
      return;
    }
    const result = await processWebhookLogs(chainId, req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
}

router.post("/webhooks/chain/:chainId", (req, res, next) =>
  handleChainWebhook(req, res, next, Number(req.params.chainId))
);

// Temporary compatibility alias for existing Arbitrum webhook configuration.
router.post("/webhooks/chain", (req, res, next) =>
  handleChainWebhook(req, res, next, 42161)
);

/**
 * POST /payment/create
 * Create a payment link (public, no auth)
 */
router.post("/payment/create", validateBody(CreatePaymentLinkSchema), async (req, res, next) => {
  try {
    const result = await createPaymentLink(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payment/:code
 * Get payment link details by code (public)
 */
router.get("/payment/:code", async (req, res, next) => {
  try {
    const link = await getPaymentLink(req.params.code);
    res.json(link);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;
