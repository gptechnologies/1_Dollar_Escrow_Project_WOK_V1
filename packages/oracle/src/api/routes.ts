import { Router } from "express";
import { requireAuth, validateBody } from "./middleware.js";
import { CreateEscrowSchema, RegisterEscrowSchema, CreatePaymentLinkSchema } from "./types.js";
import { createEscrow, registerEscrow, getEscrowStatus, listEscrows } from "../services/escrow.js";
import { createPaymentLink, getPaymentLink } from "../services/payment.js";
import { addActiveEscrow } from "../watcher/events.js";

const router = Router();

/**
 * POST /escrow/create
 * Create a new escrow contract with immutable payout and funder
 * Token must be USDC or USDT (allowlisted in factory)
 * 
 * Arbitrator count must be 0, 1, or 3 (never 2):
 * - 0: No arbitration
 * - 1: Only arbitrator1 (first vote resolves)
 * - 3: All three arbitrators (arb1+arb2 must agree, or arb3 breaks deadlock)
 */
router.post("/escrow/create", requireAuth, validateBody(CreateEscrowSchema), async (req, res, next) => {
  try {
    const result = await createEscrow({
      payout: req.body.payout as `0x${string}`,
      funder: req.body.funder as `0x${string}`,
      token: req.body.token as `0x${string}`,
      targetAmount: BigInt(req.body.targetAmount),
      deadline: req.body.deadline,
      arbitrator1: req.body.arbitrator1 as `0x${string}` | undefined,
      arbitrator2: req.body.arbitrator2 as `0x${string}` | undefined,
      arbitrator3: req.body.arbitrator3 as `0x${string}` | undefined,
    });

    res.json({
      escrow: result.escrow,
      code: result.code,
      txHash: result.txHash,
      token: result.token,
      phase: 0,
      confirmDeadline: result.confirmDeadline,
      arbWindowEnd: result.arbWindowEnd,
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
    const result = await registerEscrow(req.body.txHash);
    addActiveEscrow(result.escrow);
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
