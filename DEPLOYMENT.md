# Deployment Plan

Covers three features shipped incrementally:

1. **Permissionless Escrow Creation** -- wallet-direct `createEscrowSimple` + register endpoint
2. **Accept Stablecoins (QR Payment Links)** -- payment link creation, `/p/<code>` page
3. **PaymentRouter (On-Chain Enforced Payments)** -- new smart contract that locks recipient + amount

---

## Contracts

| Contract | Address | Network |
|----------|---------|---------|
| EscrowFactory | `0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9` | Arbitrum One |
| PaymentRouter | `0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95` | Arbitrum One |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | Arbitrum One |
| USDT | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | Arbitrum One |

**PaymentRouter owner**: `0xEb4F229A689948d96A1704e9e24cb3CAC53F8177` (oracle wallet)

---

## What Changed (Feature 3: PaymentRouter)

| Package | Change | Risk |
|---------|--------|------|
| `packages/contracts/contracts/PaymentRouter.sol` | New contract: `createLink`, `pay`, token allowlist | **Deployed** |
| `packages/contracts/scripts/deploy-payment-router.ts` | Deployment script | Low |
| `packages/oracle/src/contracts/abis.ts` | Added `PaymentRouterABI` | Low |
| `packages/oracle/src/config/networks.ts` | Added `PAYMENT_ROUTER` address | Low |
| `packages/oracle/src/blockchain/tx-queue.ts` | Added `createPaymentLink` method type | Low |
| `packages/oracle/src/blockchain/tx-sender.ts` | Added `createPaymentLink` case in tx builder | Medium |
| `packages/oracle/src/services/payment.ts` | On-chain registration after DB insert (fire-and-forget) | Medium |
| `packages/oracle/src/db/schema.sql` | Added `on_chain` and `link_id` columns to `payment_links` | Low |
| `packages/ui/lib/chain.ts` | Added `PAYMENT_ROUTER_ADDRESS`, `PaymentRouterABI`, `approve`/`allowance` to `ERC20ABI` | Low |
| `packages/ui/components/AcceptPaymentCard.tsx` | QR now encodes payment page URL (not EIP-681) | Low |
| `packages/ui/app/p/[code]/client.tsx` | Two-step approve+pay flow via router (fallback to direct transfer) | Medium |
| `packages/ui/app/p/[code]/page.tsx` | Passes `onChain` and `linkId` fields | Low |
| `AGENTS.md` | Added PaymentRouter section with ABI and examples | Low |

---

## Prerequisites

- [x] PaymentRouter deployed at `0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95`
- [ ] Add env var to Render (oracle): `PAYMENT_ROUTER_ADDRESS=0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95`
- [ ] Add env var to Vercel (UI): `NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95`

---

## Deploy Order

### Step 1: Set Environment Variables

**Render (oracle):**
```
PAYMENT_ROUTER_ADDRESS=0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95
```

**Vercel (UI):**
```
NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95
```

### Step 2: Push to Git

```bash
git add -A
git commit -m "feat: PaymentRouter — on-chain enforced payment links"
git push wok_v1 v2
```

This triggers both Render and Vercel auto-deploys. **Cancel the Vercel deploy** -- deploy oracle first.

### Step 3: Deploy Oracle on Render (backend first)

Wait for Render to finish. The oracle must be live first because:
- The payment service now calls `router.createLink()` on-chain via the tx queue
- The `GET /payment/:code` response now includes `onChain` and `linkId` fields
- DB migration adds `on_chain` and `link_id` columns automatically on startup

**Verify after deploy:**

```bash
# Health check
curl https://<ORACLE_URL>/health

# Create a test payment link
curl -X POST https://<ORACLE_URL>/payment/create \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0xEb4F229A689948d96A1704e9e24cb3CAC53F8177","token":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","amount":"1000000","description":"test"}'
# Expected: {"code":"...","linkId":"0x..."}

# Fetch it back and check onChain field
curl https://<ORACLE_URL>/payment/<CODE>
# Expected: {...,"onChain":true,"linkId":"0x..."}
```

- [ ] Oracle deployed successfully on Render
- [ ] `/health` returns `200`
- [ ] Payment create returns `code` + `linkId`
- [ ] Payment fetch returns `onChain: true` (may take a few seconds for tx confirmation)
- [ ] `payment_links` table has `on_chain` and `link_id` columns
- [ ] Existing escrow routes still work

### Step 4: Redeploy UI on Vercel (frontend second)

Once Render is confirmed healthy, redeploy on Vercel.

- [ ] Homepage loads
- [ ] "Accept Stablecoins" card shows QR codes that link to `/p/<code>` URLs (not EIP-681)
- [ ] `/p/<code>` page shows "On-chain enforced" badge when link is registered
- [ ] Payment page shows two-step flow: "Step 1: Approve" then "Step 2: Pay"
- [ ] Existing share links and escrow pages still work

### Step 5: Smoke Test -- PaymentRouter Flow

1. [ ] Create a payment link via the "Accept Stablecoins" card
2. [ ] Open the `/p/<code>` page
3. [ ] Verify the green "On-chain enforced" badge appears
4. [ ] Connect wallet, verify "Step 1: Approve $X" button shows
5. [ ] Click approve -- wallet prompts for ERC-20 approve to router address
6. [ ] After approval, button changes to "Step 2: Pay $X"
7. [ ] Click pay -- wallet prompts for `pay(linkId)` call to router
8. [ ] Success screen shows "Payment Sent" with Arbiscan link

---

## Rollback Plan

**PaymentRouter rollback:**
- Revert the UI deploy -- QR codes go back to EIP-681, payment page goes back to direct transfer
- Oracle changes are backward-compatible: the `on_chain` / `link_id` columns and fire-and-forget registration are harmless
- PaymentRouter contract stays deployed but unused

**Key safety:** The payment page falls back to a direct ERC-20 transfer if `onChain` is `false`. So even if the router tx queue is down, payments still work.

---

## Backward Compatibility

| Concern | Status |
|---------|--------|
| Existing payment links (pre-router) | Work via direct-transfer fallback (`onChain: false`) |
| Existing escrows in DB | Unaffected |
| Existing share links (`/s/<code>`) | Work as before |
| Old QR codes (EIP-681) | Still work in wallets that saved them |
| Oracle `/payment/create` response | Now includes `linkId` (additive) |
| Oracle `/payment/:code` response | Now includes `onChain`, `linkId` (additive) |

---

## Monitoring

After deployment, watch for:

**PaymentRouter on-chain registration:**
- Oracle logs: `✅ Payment link <code> registered on-chain` (successful registration)
- Oracle logs: `❌ On-chain registration failed for <code>` (tx failed, link still works off-chain)
- Oracle logs: `❌ Failed to submit on-chain registration job` (queue issue)

**Payment flow:**
- Payer-side: approve tx succeeds, pay tx succeeds
- If approve fails or times out, the "Step 1: Approve" button remains
- If on-chain registration is slow, the page falls back to direct transfer

---

## Contract Verification

Arbiscan verification pending (Etherscan API V1 deprecated). Verify manually:

1. Go to https://arbiscan.io/address/0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95#code
2. Click "Verify & Publish"
3. Compiler: Solidity 0.8.20, Optimization: 200 runs, via-IR: yes
4. Source: `PaymentRouter.sol` + `utils/IERC20.sol` + `utils/SafeERC20.sol`
5. Constructor args: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`
