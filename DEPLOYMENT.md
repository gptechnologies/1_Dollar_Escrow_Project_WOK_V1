# Deployment Plan

Covers two features shipping together in one push:

1. **Permissionless Escrow Creation** -- wallet-direct `createEscrowSimple` + register endpoint
2. **Accept Stablecoins (QR Payment Links)** -- payment link creation, `/p/<code>` page, EIP-681 QR codes

**No smart contract changes are needed.** The existing factory at `0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9` already allows any caller to invoke `createEscrowSimple()`. Payment links are purely off-chain (database + UI).

---

## What Changed

### Feature 1: Permissionless Escrow Creation

| Package | Change | Risk |
|---------|--------|------|
| `packages/ui/lib/chain.ts` | Added `EscrowFactoryABI` (create + event) | Low |
| `packages/ui/lib/wallet.ts` | Added `encodeCreateEscrowTx()` | Low |
| `packages/ui/components/CreateEscrowCard.tsx` | Wallet-direct create flow (replaces backend POST) | Medium |
| `packages/ui/app/api/escrow/register/route.ts` | New public proxy to oracle `/escrow/register` | Low |
| `packages/oracle/src/api/types.ts` | Added `RegisterEscrowSchema` | Low |
| `packages/oracle/src/api/routes.ts` | Added `POST /escrow/register` (no auth) | Medium |
| `packages/oracle/src/services/escrow.ts` | Added `upsertEscrowFromEvent()` and `registerEscrow()` | Medium |
| `packages/oracle/src/watcher/events.ts` | `handleEscrowCreated` now persists missing escrows | Low |
| UI tx pages, EscrowCard, share page | Lookup code shown before escrow address | Low |

### Feature 2: Accept Stablecoins (QR Payment Links)

| Package | Change | Risk |
|---------|--------|------|
| `packages/oracle/src/db/schema.sql` | New `payment_links` table | Low -- additive DDL |
| `packages/oracle/src/services/payment.ts` | New `createPaymentLink()` and `getPaymentLink()` | Low |
| `packages/oracle/src/api/types.ts` | Added `CreatePaymentLinkSchema` | Low |
| `packages/oracle/src/api/routes.ts` | Added `POST /payment/create` and `GET /payment/:code` | Low |
| `packages/ui/app/api/payment/create/route.ts` | New public proxy to oracle `/payment/create` | Low |
| `packages/ui/lib/payment.ts` | `buildEIP681Uri()` and `buildPaymentUrl()` helpers | Low |
| `packages/ui/components/AcceptPaymentCard.tsx` | New card: form + QR success state | Low |
| `packages/ui/app/p/[code]/page.tsx` + `client.tsx` | New payment link page with QR + Pay button | Low |
| `packages/ui/app/page.tsx` | AcceptPaymentCard added to homepage layout | Low |

---

## Prerequisites

- [ ] Factory contract `0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9` is live on Arbitrum One
- [ ] Oracle env var `FACTORY_ADDRESS` matches the above address
- [ ] Oracle env var `CHAIN_ID` is set to `42161` (Arbitrum One)
- [ ] Oracle has `POSTGRES_URL` configured and database is accessible

---

## Deploy Order

### Step 1: Push to Git

```bash
git add -A
git commit -m "feat: permissionless escrow creation + accept stablecoins QR payment links"
git push wok_v1 v2
```

This triggers both Render (oracle) and Vercel (UI) auto-deploys. **Cancel the Vercel deploy** immediately -- deploy the oracle first.

### Step 2: Deploy Oracle on Render (backend first)

Wait for Render to finish building and deploying the oracle. The oracle must be live before the UI because:
- The UI calls `/escrow/register` after wallet-created escrows
- The UI calls `/payment/create` when generating payment links
- The `/p/<code>` page fetches from `/payment/:code`

**Database migration:** The new `payment_links` table is created via `CREATE TABLE IF NOT EXISTS` in `schema.sql`, which runs on oracle startup. No manual migration needed.

**Verify after deploy:**

```bash
# Health check
curl https://<ORACLE_URL>/health
# Expected: 200 {"status":"ok",...}

# Escrow register endpoint exists (400 for missing body, not 404)
curl -X POST https://<ORACLE_URL>/escrow/register \
  -H "Content-Type: application/json" -d '{}'
# Expected: 400

# Payment create endpoint exists (400 for missing body, not 404)
curl -X POST https://<ORACLE_URL>/payment/create \
  -H "Content-Type: application/json" -d '{}'
# Expected: 400

# Payment lookup returns 500/error for missing code (not 404 = route not found)
curl https://<ORACLE_URL>/payment/nonexistent
# Expected: 500 {"error":"Payment link not found: nonexistent"}
```

- [ ] Oracle deployed successfully on Render
- [ ] `/health` returns `200`
- [ ] `/escrow/register` returns `400` (not `404`) for empty body
- [ ] `/payment/create` returns `400` (not `404`) for empty body
- [ ] `/payment/:code` route responds (returns error for bad code, not `404`)
- [ ] `payment_links` table exists in database
- [ ] Existing routes (`/escrow/create`, `/escrow/status/:code`, `/escrow/list`) still work

### Step 3: Redeploy UI on Vercel (frontend second)

Once Render is confirmed healthy, redeploy the cancelled Vercel deployment (or trigger a new one).

**Verify after deploy:**

- [ ] Homepage loads with both "Create Instant Escrow" and "Accept Stablecoins" cards
- [ ] On desktop: "Accept Stablecoins" card appears below "How it works" in the right column
- [ ] On mobile: "Accept Stablecoins" card appears below the Escrow Lookup section
- [ ] Create escrow card shows "Connect Wallet to Create" button
- [ ] Old share links (`/s/<code>`) still resolve correctly
- [ ] Existing tx pages (`/tx/confirm`, `/tx/fund`, `/tx/finalize`) load and show lookup codes

### Step 4: Smoke Test -- Escrow Creation

1. [ ] Open create form, fill in buyer/seller/amount/deadline
2. [ ] Click "Create Escrow" -- wallet prompts for `createEscrowSimple` transaction
3. [ ] Sign the transaction in wallet
4. [ ] UI shows "Confirming on chain..." then "Registering escrow..."
5. [ ] Success screen shows escrow address, lookup code, and share links
6. [ ] Copy the lookup code and verify `/s/<code>` share page loads correctly
7. [ ] Confirm link navigates to `/tx/confirm?escrow=...&code=...` with code displayed

### Step 5: Smoke Test -- Payment Links

1. [ ] Open "Accept Stablecoins" card on homepage
2. [ ] Enter a wallet address, amount ($1 USDC), and a description
3. [ ] Click "Create Payment Link"
4. [ ] QR code appears with lookup code and shareable URL
5. [ ] Copy the shareable URL and open `/p/<code>` in a new tab
6. [ ] Payment page loads with amount, QR code, recipient address, and "Pay Now" button
7. [ ] Connect wallet on the payment page and click "Pay Now" -- wallet prompts for ERC-20 transfer
8. [ ] (Optional) Scan the QR code with a mobile wallet -- should open prefilled transfer

---

## Rollback Plan

Both features have independent rollback paths:

**Escrow creation rollback:**
- Revert the UI deploy only; oracle changes are additive and harmless
- Old `POST /api/escrow/create` and `POST /escrow/create` (auth) paths are preserved

**Payment links rollback:**
- Revert the UI deploy to remove the card and `/p/<code>` page
- Oracle payment endpoints are harmless if no UI calls them
- `payment_links` table can remain in the database (empty)

---

## Backward Compatibility

| Concern | Status |
|---------|--------|
| Existing escrows in DB | Unaffected |
| Existing share links (`/s/<code>`) | Work as before |
| Existing tx pages | Work as before, now also show lookup code |
| Old `/api/escrow/create` path | Still functional (kept for admin/rollback) |
| Watcher/backfill | Enhanced -- indexes on-chain escrows missing from DB |
| Oracle `/escrow/create` (auth) | Still functional |

---

## Rate Limiting

| Endpoint | Rate Limiting |
|----------|--------------|
| `/api/escrow/register` (UI proxy) | `checkRateLimit()` -- 3 req / 60s per IP |
| `/api/payment/create` (UI proxy) | `checkRateLimit()` -- 3 req / 60s per IP |
| `/escrow/register` (oracle) | Relies on UI proxy; add `express-rate-limit` if directly exposed |
| `/payment/create` (oracle) | Relies on UI proxy; add `express-rate-limit` if directly exposed |
| `/payment/:code` (oracle) | No rate limit (read-only, low risk) |

---

## Monitoring

After deployment, watch for:

**Escrow creation:**
- Oracle logs: `📋 Escrow registered:` entries (register endpoint working)
- Oracle logs: `📋 Watcher indexed new escrow:` entries (external escrows caught by watcher)
- `⚠️ Failed to upsert escrow` warnings (DB issue)
- HTTP 502 on `/api/escrow/register` (oracle unreachable)

**Payment links:**
- Oracle logs: `🔗 Payment link created:` entries (payment create working)
- HTTP 502 on `/api/payment/create` (oracle unreachable)
- Verify `/p/<code>` pages render correctly after creation
