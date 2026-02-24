# Permissionless Escrow Creation -- Deployment Plan

## Overview

This deployment enables any wallet to create escrows directly on-chain, removing the requirement for the oracle backend to sign creation transactions. The backend is reduced to an indexing/labeling role.

**No smart contract changes are needed.** The existing factory at `0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9` already allows any caller to invoke `createEscrowSimple()` -- there is no `onlyOwner` or `onlyOracle` guard on the creation functions.

## What Changed

| Package | Change | Risk |
|---------|--------|------|
| `packages/ui/lib/chain.ts` | Added `EscrowFactoryABI` (create + event) | Low -- additive |
| `packages/ui/lib/wallet.ts` | Added `encodeCreateEscrowTx()` | Low -- additive |
| `packages/ui/components/CreateEscrowCard.tsx` | Wallet-direct create flow (replaces backend POST) | Medium -- core UX change |
| `packages/ui/app/api/escrow/register/route.ts` | New public proxy to oracle `/escrow/register` | Low -- new route |
| `packages/oracle/src/api/types.ts` | Added `RegisterEscrowSchema` | Low -- additive |
| `packages/oracle/src/api/routes.ts` | Added `POST /escrow/register` (no auth) | Medium -- new public endpoint |
| `packages/oracle/src/services/escrow.ts` | Added `upsertEscrowFromEvent()` and `registerEscrow()` | Medium -- new DB write path |
| `packages/oracle/src/watcher/events.ts` | `handleEscrowCreated` now persists missing escrows | Low -- safety net improvement |
| UI tx pages, EscrowCard, share page | Lookup code shown before escrow address | Low -- display only |

## Prerequisites

- [ ] Factory contract `0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9` is live on Arbitrum One
- [ ] Oracle env var `FACTORY_ADDRESS` matches the above address
- [ ] Oracle env var `CHAIN_ID` is set to `42161` (Arbitrum One)
- [ ] Database has the existing `escrows` table with `escrow BYTEA PRIMARY KEY` and `code TEXT NOT NULL UNIQUE` constraints (no schema migration needed)

## Deploy Order

### Step 1: Push to Git

```bash
git add -A
git commit -m "feat: permissionless escrow creation via wallet-direct tx + register endpoint"
git push origin main
```

### Step 2: Deploy Oracle (backend first)

Deploy the oracle service with the new `/escrow/register` endpoint. This must be live before the UI, since the UI calls it after the user's wallet transaction confirms.

**What to verify after deploy:**

```bash
# Health check
curl https://<ORACLE_URL>/health

# Register endpoint exists (should return 400 for missing body, not 404)
curl -X POST https://<ORACLE_URL>/escrow/register \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 400 {"error":"Validation failed",...}
```

- [ ] Oracle deployed successfully
- [ ] `/health` returns `200`
- [ ] `/escrow/register` returns `400` (not `404`) for empty body
- [ ] Existing routes (`/escrow/create`, `/escrow/status/:code`, `/escrow/list`) still work

### Step 3: Deploy UI (frontend second)

Deploy the Next.js UI with the new wallet-direct creation flow and register proxy.

**What to verify after deploy:**

- [ ] Homepage loads, create card shows "Connect Wallet to Create" button
- [ ] Wallet connects and switches to Arbitrum
- [ ] Old share links (`/s/<code>`) still resolve correctly
- [ ] Existing escrow status pages (`/tx/confirm`, `/tx/fund`, `/tx/finalize`) load and show lookup codes

### Step 4: End-to-End Smoke Test

Perform a real creation on mainnet with a small amount:

1. [ ] Open create form, fill in buyer/seller/amount/deadline
2. [ ] Click "Create Escrow" -- wallet prompts for `createEscrowSimple` transaction
3. [ ] Sign the transaction in wallet
4. [ ] UI shows "Confirming on chain..." then "Registering escrow..."
5. [ ] Success screen shows escrow address, lookup code, and share links
6. [ ] Copy the lookup code and verify `/s/<code>` share page loads correctly
7. [ ] Confirm link navigates to `/tx/confirm?escrow=...&code=...` with code displayed prominently
8. [ ] Fund link navigates to `/tx/fund?escrow=...&code=...` with code displayed

## Rollback Plan

The old creation path is fully preserved:

- `POST /api/escrow/create` (UI proxy) still exists and works
- `POST /escrow/create` (oracle, auth-protected) still exists and works
- To rollback: revert the UI deploy only; oracle changes are additive and harmless

## Backward Compatibility

| Concern | Status |
|---------|--------|
| Existing escrows in DB | Unaffected -- no schema changes |
| Existing share links (`/s/<code>`) | Work as before |
| Existing tx pages | Work as before, now also show lookup code |
| Old `/api/escrow/create` path | Still functional (kept for admin/rollback) |
| Watcher/backfill | Enhanced -- now indexes escrows it sees on-chain that are missing from DB |
| Oracle `/escrow/create` (auth) | Still functional |

## Rate Limiting

The new public endpoints have rate limiting:

- **UI proxy** (`/api/escrow/register`): Uses existing `checkRateLimit()` (same as create)
- **Oracle** (`/escrow/register`): No Express rate limiter currently; relies on UI proxy rate limiting. Consider adding `express-rate-limit` if the oracle is directly exposed.

## Monitoring

After deployment, watch for:

- Oracle logs: `📋 Escrow registered:` entries (normal -- register endpoint working)
- Oracle logs: `📋 Watcher indexed new escrow:` entries (escrows created outside UI being caught by watcher)
- Any `⚠️ Failed to upsert escrow` warnings in watcher (indicates DB issue)
- HTTP 502 errors on `/api/escrow/register` (oracle unreachable from UI)
