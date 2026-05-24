# Crow Base Payment Flows Final Build Plan

**Goal:** optimize Crow's main payment path around Base USDC price tags, preserve the hosted QR payment page, and add Coinbase-hosted fiat onramping as the first debit card / Apple Pay / Google Pay fallback.

The main buyer path is:

```text
Seller creates Base USDC price tag
-> QR opens Crow hosted /pay/{code}
-> Buyer reviews locked amount, recipient, token, and network
-> Buyer chooses:
   1. Pay with Base
   2. Pay with debit card / Apple Pay / Google Pay
-> Crow records a payment attempt
-> Crow verifies provider/onchain completion server-side
-> Crow shows confirmed, pending, failed, or cancelled
```

The QR must continue to encode Crow's hosted URL:

```text
https://usecrow.com/pay/{code}
```

Do not move the QR to a raw wallet URI, Coinbase deep link, or Base Pay deep link. The hosted page is what lets Crow lock payment details, present multiple rails, recover from errors, verify completion, and add future methods without reprinting QR codes.

---

## 1. What Already Exists

The repo already has the core Base price-tag payment flow. Preserve these pieces and build on them.

| Area | Current implementation | Plan |
|------|------------------------|------|
| Price tag creation | `packages/ui/app/api/price-tags/route.ts` creates stored Base USDC tags. | Keep. |
| Price tag schema | `price_tags` table in `packages/ui/lib/base-price-tags/db.ts`. | Keep. |
| Payment URL | `buildPriceTagPaymentUrl()` returns `/pay/{code}`. | Keep. |
| Hosted payment page | `packages/ui/app/pay/[code]/page.tsx` loads the tag and renders `BasePayPaymentClient`. | Keep, expand UI. |
| Base Pay client | `BasePayPaymentClient.tsx` calls `pay()` from `@base-org/account`. | Keep direct SDK call for MVP. |
| Base Pay recording | `POST /api/payments` creates a pending payment with `txHash = result.id`. | Keep behavior, rename/extend semantics as needed. |
| Base Pay verification | `POST /api/payments/confirm` calls `verifyPayment()`. | Keep, route through method-aware verifier. |
| Verification fallback | `verify.ts` uses `getPaymentStatus()` then falls back to Base RPC receipt log verification. | Keep. |
| Seller transaction lookup | `GET /api/payments?recipient=...` lists confirmed payments by receiving wallet. | Keep. |
| Base network config | `config.ts` supports Base mainnet and Base Sepolia. | Keep. |

Current Base Pay call:

```ts
const { pay } = await import('@base-org/account');

const result = await pay({
  amount: priceTag.amountDisplay,
  to: priceTag.recipientAddress,
  testnet: priceTag.chainId === 84532,
});
```

This is the correct core pattern. Base's docs also require `getPaymentStatus({ id, testnet })` to use the same `testnet` value as the original `pay()` call. The repo already does that through `getBasePriceTagChain().testnet`.

---

## 2. Product Decisions

### Primary path: Pay with Base

Use Base Pay as the primary CTA because it is fastest for buyers who already have a Base Account, Coinbase Account, Coinbase Wallet/Base Wallet, or spendable USDC.

Primary button:

```text
Pay with Base
```

Subtext:

```text
Best if you already use Base or Coinbase.
```

### Fallback path: Coinbase-hosted Onramp

Use Coinbase-hosted Onramp as the first fiat path. The goal is to let non-crypto buyers use a debit card or eligible Apple Pay / Google Pay wallet to buy the exact USDC amount and send it to the seller's Base address.

Secondary button:

```text
Pay with debit card or Apple Pay
```

Subtext:

```text
For buyers who do not already have USDC.
```

Use conservative helper copy:

```text
No Crow account required.
```

Avoid unqualified "No signup required" because Coinbase eligibility, guest checkout, region, KYC, Apple Pay / Google Pay availability, and stored card availability are outside Crow's control.

---

## 3. Payment Page UX

Update `/pay/{code}` so it feels like a locked price tag, not a checkout form.

Show fixed details above payment methods:

```text
{description}
${amountDisplay} USDC
Paying: 0x8f3c...a4b2
Network: Base
Token: USDC
```

Helper text:

```text
Seller receives USDC directly on Base.
```

Rules:

- Do not show editable amount or recipient fields on the buyer page.
- Keep copy focused on review and payment status.
- Disable both payment buttons while any payment attempt is being created, opened, or verified.
- If a tag is inactive, hide payment buttons and show the inactive state.
- If a payment is confirmed, show the confirmed state and BaseScan link.
- For onramp amounts below Coinbase's minimum, keep Base Pay available and disable/hide onramp with a short minimum message.

Coinbase's hosted onramp overview currently states a minimum transaction amount of `$5` for the debit-card guest flow. Use `$5.00` as the default onramp minimum unless API options/quotes say otherwise.

---

## 4. Flow A: Pay with Base

### Buyer flow

```text
Open /pay/{code}
-> Tap Pay with Base
-> Crow opens Base Pay
-> Buyer confirms or cancels
-> Base Pay returns payment id / tx id
-> Crow stores pending payment
-> Crow verifies status server-side
-> Crow shows confirmed/pending/failed/cancelled
```

### Frontend implementation

Keep `BasePayPaymentClient.tsx`, but split it into method-specific handlers:

```tsx
<PaymentMethodsCard>
  <BasePayMethod />
  <CoinbaseHostedOnrampMethod />
</PaymentMethodsCard>
```

For Base Pay:

1. Set UI state to `base_paying`.
2. Call `pay()` with stored tag values:
   - `amount = priceTag.amountDisplay`
   - `to = priceTag.recipientAddress`
   - `testnet = priceTag.chainId === 84532`
3. On success, record through the Base payment endpoint.
4. Poll payment status.
5. Show final status only after server verification.

Recommended route naming:

```text
POST /api/payments/base
POST /api/payments/{id}/status
```

Acceptable MVP compatibility:

```text
POST /api/payments
POST /api/payments/confirm
```

Do not block on switching to `@base-org/account-ui` or the prebuilt Base Pay button. The direct `pay()` call is already working and is acceptable for MVP. Consider the official UI component later if brand compliance or conversion becomes a priority.

### Backend verification

Keep the current method:

1. Load payment by id.
2. Use `getPaymentStatus({ id: payment.txHash, testnet })`.
3. Confirm provider status is `completed`.
4. Confirm recipient equals the tag recipient.
5. Confirm amount equals the tag amount.
6. If Base Pay status is unavailable, fall back to RPC receipt verification of the USDC `Transfer` event.
7. Enforce tx hash uniqueness.

Current code already does most of this in `verify.ts`.

### Base Pay status states

Use a UI state union like:

```ts
type BuyerPaymentStep =
  | "idle"
  | "base_paying"
  | "recording"
  | "confirming"
  | "confirmed"
  | "pending"
  | "failed"
  | "cancelled";
```

The current `PaymentStep` is close but should distinguish cancellation from failure where possible.

---

## 5. Flow B: Coinbase-Hosted Onramp

### Buyer flow

```text
Open /pay/{code}
-> Tap Pay with debit card or Apple Pay
-> Crow creates pending onramp payment attempt
-> Crow calls Coinbase Create Onramp Session API
-> Crow redirects buyer to Coinbase-hosted URL
-> Buyer pays with Coinbase balance, linked payment method, debit card, Apple Pay, or Google Pay if eligible
-> Coinbase sends USDC on Base to seller wallet
-> Buyer returns to /pay/{code}?onramp=return&attempt={id}
-> Crow polls Coinbase transaction status by partnerUserRef
-> Crow verifies amount/asset/network/recipient/tx hash
-> Crow shows confirmed/pending/failed/cancelled
```

### Amount rule

Use `purchaseAmount`, not `paymentAmount`.

Reason:

- `purchaseAmount` means the buyer receives/sends the exact crypto amount.
- `paymentAmount` means the buyer pays an exact fiat amount and fees can reduce the crypto delivered.

For Crow, the seller must receive the exact tag amount.

Example for a `$5.00` tag:

```ts
{
  purchaseCurrency: "USDC",
  destinationNetwork: "base",
  destinationAddress: priceTag.recipientAddress,
  purchaseAmount: "5.000000",
  paymentCurrency: "USD"
}
```

The buyer may pay more than `$5.00` total because Coinbase/card/network fees may be added.

Add a helper in `amount.ts`:

```ts
export function displayAmountToSixDecimalAmount(displayAmount: string): string {
  const raw = displayAmountToRaw(displayAmount);
  const units = 1_000_000n;
  const value = BigInt(raw);
  return `${value / units}.${(value % units).toString().padStart(6, "0")}`;
}
```

---

## 6. Coinbase Session Creation

Create:

```text
POST /api/payments/onramp-session
```

Request:

```ts
{
  code: string;
}
```

Optional later:

```ts
{
  code: string;
  buyerCountry?: string;
  buyerSubdivision?: string;
  paymentMethod?: "CARD" | "APPLE_PAY" | "GOOGLE_PAY";
}
```

Backend steps:

1. Load the price tag from `code`.
2. Validate tag is active.
3. Validate chain is Base mainnet for production onramp. Treat Base Sepolia as sandbox/dev only.
4. Validate amount is at or above onramp minimum.
5. Create a pending payment attempt with method `COINBASE_ONRAMP_HOSTED`.
6. Generate and store a unique `partnerUserRef`.
7. Prefix `partnerUserRef` with `sandbox-` when using Coinbase sandbox.
8. Build `redirectUrl` back to Crow:

```text
{APP_URL}/pay/{code}?onramp=return&attempt={paymentAttemptId}
```

9. Call Coinbase Create Onramp Session API:

```text
POST https://api.cdp.coinbase.com/platform/v2/onramp/sessions
Authorization: Bearer <CDP JWT>
```

10. Store returned `onrampUrl` and optional quote values.
11. Return `{ paymentAttemptId, onrampUrl }`.

Coinbase's current Create Onramp Session API returns a single-use URL. Once visited, the same URL cannot be reused. Their hosted onramp overview also says session tokens are single-use and expire after 5 minutes. If a buyer retries, create a new onramp session for the same tag rather than reusing an old URL.

### Coinbase request payload

Use this as the MVP payload:

```ts
{
  purchaseCurrency: "USDC",
  destinationNetwork: "base",
  destinationAddress: priceTag.recipientAddress,
  purchaseAmount: displayAmountToSixDecimalAmount(priceTag.amountDisplay),
  paymentCurrency: "USD",
  redirectUrl: `${APP_URL}/pay/${priceTag.code}?onramp=return&attempt=${paymentAttemptId}`,
  clientIp: requestIp,
  partnerUserRef
}
```

For a quote, add:

```ts
{
  paymentMethod: "CARD",
  country: "US",
  subdivision: "NY"
}
```

Do not send both `paymentAmount` and `purchaseAmount`; Coinbase documents that only one should be provided.

### Frontend behavior

1. Set UI state to `onramp_creating_session`.
2. Call `POST /api/payments/onramp-session`.
3. Receive `onrampUrl`.
4. Set UI state to `onramp_redirecting`.
5. Redirect with `window.location.assign(onrampUrl)`.
6. On return, detect `?onramp=return&attempt=...`.
7. Poll `POST /api/payments/{id}/status` or existing confirm endpoint.

---

## 7. Onramp Status Verification

Add method-aware status:

```text
POST /api/payments/{id}/status
```

Compatibility option:

```text
POST /api/payments/confirm
```

For `BASE_PAY`, keep current verification.

For `COINBASE_ONRAMP_HOSTED`:

1. Load payment attempt by id.
2. Read stored `partnerUserRef`.
3. Call Coinbase transaction status/history by partner user ref:

```text
GET https://api.developer.coinbase.com/onramp/v1/buy/user/{partnerUserRef}/transactions?pageSize=5
Authorization: Bearer <CDP JWT>
```

4. Find the transaction matching the attempt.
5. Treat `ONRAMP_TRANSACTION_STATUS_SUCCESS` as confirmable.
6. Treat `ONRAMP_TRANSACTION_STATUS_IN_PROGRESS` or created/processing statuses as pending.
7. Treat failed/cancelled statuses as failed/cancelled.
8. Verify:
   - `purchase_currency === "USDC"`
   - `purchase_network === "base"`
   - `wallet_address` equals tag recipient
   - `purchase_amount.value` equals expected amount
   - `tx_hash` exists before marking confirmed
   - `tx_hash` is not already confirmed on another payment
9. Store:
   - Coinbase `transaction_id`
   - `tx_hash`
   - `payment_method`
   - `payment_total`
   - `payment_subtotal`
   - `coinbase_fee`
   - `network_fee`
   - `exchange_rate`
   - raw provider response JSON if useful for debugging
10. Mark payment confirmed only after all checks pass.

If Coinbase reports success but `tx_hash` is not available yet, keep the attempt pending and continue polling.

---

## 8. Data Model Changes

Do not replace the existing `payments` table. Extend it so current Base Pay records continue to work.

Current columns:

```text
id
price_tag_code
tx_hash
expected_amount_raw
expected_amount_display
recipient_address
chain_id
token_address
payer_address
status
failure_reason
created_at
confirmed_at
```

Add columns:

```sql
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'BASE_PAY';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'base';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS partner_user_ref TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS onramp_url TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_currency TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_total TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_subtotal TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_status TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_response_json JSONB;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
```

Recommended indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
CREATE INDEX IF NOT EXISTS idx_payments_provider_status ON payments(provider, provider_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id_unique
  ON payments(provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_partner_user_ref_unique
  ON payments(partner_user_ref)
  WHERE partner_user_ref IS NOT NULL;
```

Keep the existing unique `tx_hash`.

Use lowercase statuses in TypeScript to match current code:

```ts
type PaymentMethod = "BASE_PAY" | "COINBASE_ONRAMP_HOSTED";
type PaymentProvider = "base" | "coinbase_onramp";
type PaymentStatus = "created" | "pending" | "redirected" | "confirmed" | "failed" | "cancelled" | "expired";
```

For existing Base Pay records:

```text
method = BASE_PAY
provider = base
provider_payment_id = tx_hash/result.id
```

For Coinbase-hosted onramp records:

```text
method = COINBASE_ONRAMP_HOSTED
provider = coinbase_onramp
provider_payment_id = Coinbase transaction_id once known
partner_user_ref = generated attempt ref
tx_hash = onchain send hash once known
```

---

## 9. API Route Plan

Recommended final routes:

```text
POST /api/payments/base
POST /api/payments/onramp-session
POST /api/payments/{id}/status
GET  /api/payments/{id}
GET  /api/payments?recipient=0x...
```

Low-risk migration option:

- Keep `POST /api/payments` as an alias for Base Pay.
- Keep `POST /api/payments/confirm` as an alias for status.
- Add the new route names without breaking current clients.

Route responsibilities:

| Route | Responsibility |
|------|----------------|
| `POST /api/payments/base` | Record Base Pay result id / tx hash for a tag. |
| `POST /api/payments/onramp-session` | Create pending onramp attempt and Coinbase hosted URL. |
| `POST /api/payments/{id}/status` | Verify either Base Pay or Coinbase Onramp by method. |
| `GET /api/payments/{id}` | Return one payment attempt. |
| `GET /api/payments?recipient=...` | Existing seller transaction history. |

---

## 10. Environment Variables

Current Base config already uses:

```env
NEXT_PUBLIC_BASE_TESTNET=
NEXT_PUBLIC_BASE_USDC_ADDRESS=
NEXT_PUBLIC_BASE_SEPOLIA_USDC_ADDRESS=
BASE_RPC_URL=
BASE_SEPOLIA_RPC_URL=
```

Add Coinbase onramp config:

```env
COINBASE_ONRAMP_ENV=sandbox
COINBASE_ONRAMP_API_BASE_URL=https://api.cdp.coinbase.com
COINBASE_ONRAMP_STATUS_API_BASE_URL=https://api.developer.coinbase.com
COINBASE_ONRAMP_REDIRECT_BASE_URL=http://localhost:3000
COINBASE_ONRAMP_DEFAULT_COUNTRY=US
COINBASE_ONRAMP_DEFAULT_SUBDIVISION=NY
COINBASE_ONRAMP_MIN_USD=5.00

# CDP JWT auth. Confirm exact key format from the created CDP key.
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_PROJECT_ID=
```

Keep all CDP secrets server-side only. Never expose them through `NEXT_PUBLIC_`.

Implementation note: Coinbase's current v2 Create Onramp Session docs require an `Authorization: Bearer <token>` JWT signed with the CDP API key secret. Implement a small server-only CDP token helper and keep it isolated from client bundles.

---

## 11. Testing Plan

### Unit tests

- `normalizeDisplayAmount()`
- `displayAmountToRaw()`
- new `displayAmountToSixDecimalAmount()`
- onramp minimum detection
- chain mapping:
  - `8453` -> `base`
  - `84532` -> sandbox/test only
- `partnerUserRef` generation
- method-aware payment mapping
- Coinbase transaction verification:
  - success
  - in progress
  - failed
  - wrong recipient
  - wrong network
  - wrong amount
  - missing tx hash

### Integration tests

Base Pay happy path:

```text
Open /pay/{code}
Tap Pay with Base
Mock pay() success
Record payment
Verify status
Show Confirmed
```

Base Pay cancellation:

```text
Open /pay/{code}
Tap Pay with Base
Mock user cancellation
Show Cancelled / Try again
Do not create confirmed payment
```

Onramp session creation:

```text
Open /pay/{code}
Tap Pay with debit card or Apple Pay
POST /api/payments/onramp-session
Mock Coinbase session response
Redirect to onrampUrl
```

Onramp return:

```text
Return to /pay/{code}?onramp=return&attempt={id}
Poll payment status
Mock Coinbase success with tx_hash
Show Confirmed
```

Onramp pending:

```text
Coinbase status in progress
Show Payment pending
Continue polling
Allow refresh
```

Onramp failure:

```text
Coinbase status failed
Show Payment failed
Allow retry, creating a new single-use URL
```

Manual tests:

- iPhone Safari QR scan.
- Android Chrome QR scan.
- Desktop browser.
- Base Pay with Base mainnet.
- Base Pay with Base Sepolia test mode.
- Coinbase hosted sandbox card flow.
- Apple Pay availability on Safari/iOS.
- Google Pay availability on Android/Chrome.
- User closes Coinbase midway.
- User returns after Coinbase URL expires.
- Duplicate tx hash rejection.
- Seller `/my-tags` transaction history still loads.

---

## 12. Error Handling

Base Pay:

- User cancelled.
- Base Pay unavailable.
- Insufficient funds.
- Wallet/app handoff failed.
- Provider status pending.
- Provider status failed.
- RPC receipt unavailable.
- Amount/recipient mismatch.

Coinbase-hosted Onramp:

- CDP auth failure.
- Session creation failure.
- Single-use URL already visited.
- Session expired.
- Unsupported country/state.
- Amount below minimum.
- Card declined.
- Apple Pay / Google Pay unavailable.
- User abandoned checkout.
- Coinbase status in progress.
- Coinbase success but tx hash missing.
- Amount/network/recipient mismatch.

Idempotency:

- Do not mark more than one payment confirmed for a tx hash.
- Do not trust frontend success states.
- Reuse or expire pending attempts intentionally.
- For onramp retries, create a new Coinbase session URL because URLs are single-use.

---

## 13. Security Requirements

- Amount and recipient must always come from the stored price tag.
- Do not accept amount, recipient, token, or chain from buyer-controlled URL params.
- Verify every successful payment server-side.
- Verify asset, network, amount, recipient, and tx hash uniqueness.
- Keep CDP credentials server-side.
- Log provider failures without logging secrets or full JWTs.
- Treat Coinbase redirect params as hints only; verify through Coinbase APIs before confirming.

---

## 14. Implementation Sequence

### Phase 1: Clean up existing Base path

1. Keep `/pay/{code}` hosted page and QR behavior.
2. Refactor `BasePayPaymentClient` into a payment methods layout.
3. Keep direct Base Pay `pay()` call.
4. Add explicit `cancelled` handling where possible.
5. Add route aliases for `POST /api/payments/base` and `POST /api/payments/{id}/status`, or defer aliases if speed matters.
6. Confirm current verification still works.

### Phase 2: Extend payments table

1. Add method/provider/onramp metadata columns.
2. Backfill defaults through `ALTER TABLE ... DEFAULT`.
3. Update `PriceTagPayment` type and mapper.
4. Keep old Base Pay records compatible.
5. Add uniqueness indexes for `provider_payment_id` and `partner_user_ref`.

### Phase 3: Add Coinbase session creation

1. Add Coinbase env vars.
2. Add server-only CDP JWT helper.
3. Add `POST /api/payments/onramp-session`.
4. Create pending onramp attempt before calling Coinbase.
5. Call `POST /platform/v2/onramp/sessions`.
6. Store returned URL/quote.
7. Redirect buyer to Coinbase-hosted Onramp.

### Phase 4: Add onramp status verification

1. Detect `/pay/{code}?onramp=return&attempt={id}`.
2. Poll status endpoint.
3. Query Coinbase by `partnerUserRef`.
4. Verify amount, asset, network, recipient, tx hash.
5. Store Coinbase transaction metadata.
6. Mark confirmed only when complete.

### Phase 5: Hardening and polish

1. Add onramp minimum UI.
2. Add retry behavior that creates a new single-use session.
3. Add tests for method-aware verification.
4. Add logs around provider state transitions.
5. Confirm production redirect URL/domain setup in Coinbase.
6. Add webhooks later if Coinbase-hosted flow support and product needs justify it.

---

## 15. Acceptance Criteria

Payment page:

- QR opens `/pay/{code}`.
- Buyer sees locked description, amount, token, network, and recipient.
- Buyer cannot edit amount or recipient.
- Buyer sees **Pay with Base** as the primary method.
- Buyer sees **Pay with debit card or Apple Pay** as fallback when eligible.

Pay with Base:

- Button opens Base Pay.
- Amount and recipient are prefilled from the stored tag.
- Backend verifies completion.
- UI shows confirmed only after backend verification.
- Existing seller transaction history still shows confirmed payments.

Coinbase-hosted Onramp:

- Button creates a Coinbase-hosted session.
- Request uses `purchaseAmount`, USDC, Base, and seller wallet destination.
- Buyer is redirected to Coinbase-hosted Onramp.
- Return URL brings buyer back to Crow.
- Crow verifies Coinbase status by `partnerUserRef`.
- Crow verifies amount, recipient, network, asset, and tx hash.
- Confirmed state appears only after verification.
- Retry creates a new single-use URL.

Data/admin:

- All payment attempts are stored.
- Payment method is visible in data.
- Base Pay and Coinbase Onramp payments share one payment model.
- Duplicate successful tx hashes are rejected.

---

## 16. Future Improvements

Do not include these in the first implementation unless the MVP exposes a real product gap.

- Coinbase Headless Onramp for a more native Apple Pay / Google Pay experience.
- Raw wallet URI fallback under "More options."
- Manual transfer instructions under "More options."
- Coinbase onramp webhooks for lower-latency confirmation.
- Provider options/quote preflight for dynamic country/payment-method availability.

---

## 17. Source Docs

- Base Pay accept payments guide: https://docs.base.org/base-account/guides/accept-payments
- Base Pay `getPaymentStatus`: https://docs.base.org/base-account/reference/base-pay/getPaymentStatus
- Coinbase-hosted Onramp overview: https://docs.cdp.coinbase.com/onramp/coinbase-hosted-onramp/overview
- Coinbase Create Onramp Session API: https://docs.cdp.coinbase.com/api-reference/v2/rest-api/onramp/create-an-onramp-session
- Coinbase Onramp transaction status/history: https://docs.cdp.coinbase.com/onramp/core-features/transaction-status
- Coinbase Get Onramp Transactions by ID: https://docs.cdp.coinbase.com/api-reference/rest-api/onramp-offramp/get-onramp-transactions-by-id
