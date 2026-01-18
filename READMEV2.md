# Escrow Smart Contract V2 (Hybrid Confirmation Model)

A trustless, multi-token escrow system on Arbitrum. Supports USDC and USDT with flexible confirmation options — sellers can self-confirm or confirm via bond transfer.

## Overview

This system enables peer-to-peer escrow transactions where:
- A **seller** confirms participation (via self-confirm OR $1 bond transfer)
- A **buyer** funds the escrow before the deadline
- **Funding is derived** from on-chain balance (no oracle dependency for liveness)
- Optional **arbitrators** (0, 1, or 3) can resolve disputes during a bounded window
- All parties and amounts are **immutable** once the escrow is created 

### Key Changes in Hybrid Model

| Feature | V1 (Oracle-Dependent) | V2 (Hybrid/Permissionless) |
|---------|----------------------|---------------------------|
| **Confirmation** | Oracle records $1 transfer | Seller self-confirms OR oracle confirms with bond |
| **Funding Status** | Oracle calls `recordFunding()` | Derived from `isFunded()` (balance check) |
| **Arbitration** | Any time after funded | Only during [deadline, deadline+7d] window |
| **Arb Fallback** | None | Permissionless sweep to treasury after 7d |
| **Oracle Role** | Required for liveness | Convenience only (not required) |

### Supported Tokens

| Token | Arbitrum One Address | Decimals |
|-------|---------------------|----------|
| USDC  | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| USDT  | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |

### Validation Constraints

The factory enforces these limits at escrow creation:

| Parameter | Constraint | Error Message |
|-----------|------------|---------------|
| `deadline` | Must be in future AND ≤ 365 days from now | `Factory: deadline too far` |
| `bondCap` | Must be ≤ $3 (3e6) or 0 (use default $1) | `Factory: bondCap too high` |
| `payout` | Must not equal `funder` | `Factory: payout == funder` |
| `token` | Must be in allowlist (USDC/USDT) | `Factory: token not allowed` |
| `targetAmount` | Must be > 0 | `Factory: zero target` |
| `arbitrators` | Must be 0, 1, or 3 (never 2) | `Factory: must have 0, 1, or 3 arbitrators` |

### Key Features

- **Hybrid Confirmation**: Seller can self-confirm (no bond) or confirm via $1 bond transfer
- **Derived Funding**: Funding status is `balance >= targetAmount`, not oracle-recorded
- **Multi-Token Support**: Create escrows denominated in USDC or USDT
- **No Wallet Connect**: Users send tokens directly from any wallet app
- **Immutable Parties**: Buyer and seller addresses locked at creation
- **0/1/3 Arbitrator Rule**: Either no arbitration, single-arb (instant resolution), or 3-arb (with tiebreaker)
- **Bounded Arbitration**: Arbitrators can only act during [deadline, arbWindowEnd]
- **Permissionless Sweep**: After arb window, unresolved escrows swept to treasury (prevents gaming)
- **Capped Fee Structure**: 1% fee up to $100, then $1 flat fee for larger amounts

---

## Architecture

```
┌─────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│       UI        │─────▶│    Oracle API     │─────▶│  EscrowFactory   │
│    (Next.js)    │      │     (Node.js)     │      │    (Solidity)    │
│                 │      │                   │      │                  │
│  Token Selector │      │  - Create Escrow  │      │  - Allowlist     │
│  Rate Limiting  │      │  - Watch Transfers│      │  - Deploy Escrow │
│  (Upstash)      │      │  - TX Queue       │      │                  │
└─────────────────┘      └───────────────────┘      └──────────────────┘
        │                         │                         │
        ▼                         ▼                         ▼
┌─────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  Upstash Redis  │      │     Postgres      │      │      Escrow      │
│  (Serverless)   │      │     + Redis       │      │    (Solidity)    │
│                 │      │                   │      │                  │
│  - Rate limits  │      │  - Escrow state   │      │  - Hold funds    │
│  - Idempotency  │      │  - Pending TXs    │      │  - Derived state │
│                 │      │  - TX Queue       │      │                  │
└─────────────────┘      └───────────────────┘      └──────────────────┘
                                  │                         │
                                  └────────────┬────────────┘
                                               │
                                    USDC/USDT Transfers
                                     (balance-derived)
```

### Component Responsibilities

| Component | Purpose |
|-----------|---------|
| **UI** | User interface for creating escrows with token selection |
| **UI Rate Limiter** | Redis-backed rate limiting + idempotency (Upstash) |
| **Oracle API** | REST API for escrow creation, status queries |
| **Oracle Watcher** | Monitors blockchain for EscrowCreated + bond transfers (64-block reorg buffer) |
| **Oracle TX Queue** | BullMQ queue for serialized transaction sending |
| **Oracle TX Sender** | Manages nonces, speed-up, replacement for stuck TXs |
| **Oracle Keeper** | Periodic convenience actions (not required for liveness) |
| **EscrowFactory** | Deploys individual Escrow contracts |
| **Escrow** | Holds funds, derives state from balance, executes payout |

---

## Oracle TX Queue

The oracle uses a **BullMQ-based transaction queue** to reliably manage blockchain transactions. This prevents:
- Nonce gaps from concurrent transactions
- Stuck transactions blocking all subsequent TXs
- Lost transactions on server restart

### How It Works

```
┌─────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│   API Request   │─────▶│   BullMQ Queue    │─────▶│    TX Sender     │
│  (enqueue TX)   │      │   (Redis-backed)  │      │   (Worker)       │
└─────────────────┘      └───────────────────┘      └──────────────────┘
                                  │                         │
                                  ▼                         ▼
                         ┌───────────────────┐      ┌──────────────────┐
                         │  Pending Tracker  │      │   Blockchain     │
                         │   (Redis state)   │◀────▶│                  │
                         └───────────────────┘      └──────────────────┘
```

### Features

| Feature | Description |
|---------|-------------|
| **Serial Processing** | One TX at a time per wallet (prevents nonce conflicts) |
| **Persistent Queue** | Jobs survive server restarts (Redis-backed) |
| **Automatic Retry** | Failed TXs retry with exponential backoff (5 attempts) |
| **Speed-Up Logic** | Stuck TXs get gas price bumped automatically |
| **Replacement Logic** | Very stuck TXs get replaced with higher gas |
| **Pending Recovery** | On restart, checks for pending TXs and resumes |

### Stuck Transaction Handling

| Time Stuck | Action | Gas Multiplier |
|------------|--------|----------------|
| 2 minutes | Speed-up | 1.1x |
| 5 minutes | Aggressive replacement | 1.25x |
| 10 minutes | Alert + continue replacement | 1.5x |

### Monitoring

The TX sender exposes status via the `/status` endpoint:

```json
{
  "txSender": {
    "pendingTransactions": 2,
    "queueWaiting": 5,
    "queueActive": 1,
    "queueCompleted": 1234,
    "queueFailed": 3,
    "isRunning": true
  }
}
```

---

## Fee Structure

The protocol charges a percentage fee on the escrow amount, taken from the seller's payout.

| Escrow Amount | Fee |
|---------------|-----|
| $0.01 – $1.00 | $0.01 (minimum) |
| $1.01 – $100.00 | 1% of amount |
| $100.01+ | $1.00 (capped) |

### Examples

| Amount | Fee | Seller Receives (no bond) | Seller Receives (with bond) |
|--------|-----|--------------------------|----------------------------|
| $10.00 | $0.10 | $9.90 | $9.90 + $1 bond |
| $50.00 | $0.50 | $49.50 | $49.50 + $1 bond |
| $100.00 | $1.00 | $99.00 | $99.00 + $1 bond |
| $500.00 | $1.00 | $499.00 | $499.00 + $1 bond |

---

## Escrow Lifecycle (Hybrid Model)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   1. CREATE                                                             │
│   └─▶ UI submits escrow parameters (token, amount, parties)             │
│       └─▶ Oracle calls Factory.createEscrow()                           │
│           └─▶ New Escrow contract deployed                              │
│                                                                         │
│   2. CONFIRM (within 24 hours)                                          │
│   ┌─▶ OPTION A: Seller calls confirm() directly (no bond)               │
│   │   └─▶ Sets confirmed=true, bondPresent=false                        │
│   │                                                                     │
│   └─▶ OPTION B: Seller sends $1 bond to escrow                          │
│       └─▶ Oracle detects Transfer, calls confirmByOracle()              │
│           └─▶ Sets confirmed=true, bondPresent=true                     │
│                                                                         │
│   3. FUND (before deadline)                                             │
│   └─▶ Buyer sends targetAmount in selected token (1+ transfers)         │
│       └─▶ NO oracle call needed! isFunded() = balance >= target         │
│                                                                         │
│   4. SETTLEMENT                                                         │
│   ┌─▶ NO ARBITRATORS (0): After deadline, anyone calls finalizeAfterDeadline│
│   │   └─▶ Seller receives: (amount - fee) + bond (if present)           │
│   │       └─▶ Treasury receives: fee + any excess                       │
│   │                                                                     │
│   └─▶ WITH ARBITRATORS (1 or 3): Settlement disabled. During [deadline, +7d]:│
│       ├─▶ 1 ARB: First vote resolves (release or refund)                │
│       ├─▶ 3 ARB: Arb1 + Arb2 must agree; if disagree, Arb3 decides      │
│       ├─▶ Arb release: seller gets (amount - fee) + bond                │
│       ├─▶ Arb refund: buyer gets amount, seller gets bond               │
│       └─▶ After 7d without resolution: sweepToTreasuryAfterArbWindow()  │
│           └─▶ All funds go to treasury (prevents gaming)                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### State Diagram

```
                         ┌─────────────────────┐
                         │  Not Confirmed      │
                         │  (confirmed=false)  │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
        Seller self-confirms          24h expires without
        OR oracle confirms               confirmation
        with bond present                     │
                    │                         ▼
                    ▼                 ┌─────────────────┐
        ┌───────────────────────┐    │     Expired     │
        │  Confirmed            │    │ (expired=true)  │
        │  (confirmed=true)     │    └─────────────────┘
        │                       │
        │  isFunded() derived   │
        │  from balance         │
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
   Balance reaches        Deadline passes
   targetAmount           before funded
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│     Funded      │     │     Expired     │
│ isFunded()=true │     │ (bond returned) │
└────────┬────────┘     └─────────────────┘
         │
         │
    ┌────┴────────────────────────┐
    │                             │
  No arbs                  Has arbs (1 or 3)
    │                             │
    ▼                             ▼
Deadline                  Arb window opens
reached                  [deadline, +7d]
    │                             │
    ▼                     ┌───────┴───────┐
┌──────────┐              │               │
│ Resolved │        Arbs resolve    No resolution
│(seller   │        (see rules)      by +7d
│ paid)    │              │               │
└──────────┘              ▼               ▼
                    ┌──────────┐    ┌──────────────┐
                    │ Resolved │    │ Swept to     │
                    └──────────┘    │ Treasury     │
                                    └──────────────┘

Arb Resolution Rules:
- 1 arb: first vote resolves
- 3 arbs: arb1+arb2 agree OR arb3 breaks tie
```

---

## Confirmation Methods

### Option A: Seller Self-Confirm (Recommended)

The seller calls `confirm()` directly on the escrow contract. No bond required.

```solidity
// Seller calls this within 24h of creation
escrow.confirm();
```

**Advantages:**
- No token transfer required
- Immediate confirmation
- Gas-efficient

### Option B: Bond-Based Confirmation (Oracle)

The seller sends $1 (bondCap) in the escrow token to the escrow address. The oracle detects this and calls `confirmByOracle()`.

```solidity
// Oracle calls after detecting bond transfer
escrow.confirmByOracle(txHash);
```

**Advantages:**
- Seller doesn't need to interact with contract
- Bond is returned to seller at settlement

---

## Arbitration Window

If arbitrators are set, the normal `finalizeAfterDeadline()` is disabled. Instead:

| Time Period | Actions Allowed |
|-------------|-----------------|
| Before deadline | None (waiting for funding) |
| [deadline, deadline+7d] | Arbitrators can release or refund |
| After deadline+7d | Anyone can call `sweepToTreasuryAfterArbWindow()` |

### Arbitrator Rules (0/1/3 Only)

Escrows must have **0, 1, or 3 arbitrators** — never 2. This prevents deadlock scenarios where two arbitrators could permanently disagree.

| Configuration | Voting Rules |
|---------------|--------------|
| **0 arbitrators** | No arbitration. Auto-finalize at deadline. |
| **1 arbitrator** | First vote resolves immediately. |
| **3 arbitrators** | Arb1 + Arb2 must agree. If they disagree, Arb3 (tiebreaker) casts deciding vote. |

### Arbitrator Decisions

| Decision | Result |
|----------|--------|
| **Release** | Seller gets (targetAmount - fee) + bond, Treasury gets fee |
| **Refund** | Buyer gets targetAmount, Seller gets bond |
| **No resolution by +7d** | All funds swept to treasury |

### 3-Arbitrator Voting Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Arb1 votes                                                     │
│     │                                                           │
│     ▼                                                           │
│  Arb2 votes                                                     │
│     │                                                           │
│     ├─── If Arb1 == Arb2 ──▶ RESOLVED (their decision)         │
│     │                                                           │
│     └─── If Arb1 != Arb2 ──▶ DEADLOCKED                        │
│                 │                                               │
│                 ▼                                               │
│            Arb3 can now vote                                    │
│                 │                                               │
│                 └──▶ RESOLVED (Arb3's decision)                │
│                                                                 │
│  If arb window expires without resolution:                      │
│     └──▶ All funds swept to treasury                           │
└─────────────────────────────────────────────────────────────────┘
```

**Important:** If arbitrators don't resolve within the 7-day window (1-arb with no vote, 3-arb with only 1 vote, or 3-arb deadlocked without Arb3 voting), all funds are swept to treasury to prevent gaming.

---

## Mutual Actions (Buyer + Seller Agreement)

Escrows support three types of mutual actions that require both buyer and seller to approve:

### Mutual Release / Refund

Before the deadline and only when **arbitratorCount == 0**, buyer and seller can mutually agree to release or refund without waiting for the deadline.

| Action | Constraints | Result |
|--------|-------------|--------|
| `approveMutualRelease()` | Before deadline, no arbitrators, confirmed, funded | Both approve → seller gets paid (with fee) |
| `approveMutualRefund()` | Before deadline, no arbitrators, confirmed, funded | Both approve → buyer gets refund, seller gets bond |

**Flow:**
1. Either party calls `approveMutualRelease()` or `approveMutualRefund()`
2. The other party calls the same function
3. On second approval, the action executes automatically

### Mutual Deadline Extension

Both parties can agree to extend the deadline up to **14 days** from the original deadline.

| Function | Constraints |
|----------|-------------|
| `approveDeadlineExtension(uint64 newDeadline)` | Before current deadline, newDeadline > deadline, total extension ≤ 14 days |

**Rules:**
- Both parties must approve the **same** newDeadline
- If a party proposes a different deadline, approvals reset
- `arbWindowEnd` is automatically updated to `newDeadline + 7 days`
- Total extensions capped at 14 days from `originalDeadline`

**Example:**
```
Original deadline: Jan 1
First extension to: Jan 5  ✓ (4 days)
Second extension to: Jan 12 ✓ (11 days total)
Third extension to: Jan 20 ✗ (would exceed 14 days from original)
```

### Mutual Arbitrator Swap

Both parties can agree to swap the arbitrator set. This is useful when arbitrators become unavailable or untrusted.

| Function | Constraints |
|----------|-------------|
| `approveArbitratorSwap(address arb1, address arb2, address arb3)` | Before arbWindowEnd, valid 0/1/3 set |

**Rules:**
- Both parties must approve the **same** new arbitrator set
- Must follow 0/1/3 rule (no 2-arb configurations)
- On execution:
  - All existing votes are reset
  - `deadlocked` is reset to false
  - **Deadline is pushed +7 days from current time**
  - `arbWindowEnd` is updated accordingly

**Use Cases:**
- Swap from 1-arb to 3-arb for more robust dispute resolution
- Swap from arbitrated (1 or 3 arb) to non-arbitrated (0 arb) if both parties agree
- Replace an unresponsive or compromised arbitrator

### Mutual Action State

You can check the current state of pending mutual actions:

| State Variable | Description |
|----------------|-------------|
| `mutualReleaseApprovedByFunder` | True if buyer approved mutual release |
| `mutualReleaseApprovedByPayout` | True if seller approved mutual release |
| `mutualRefundApprovedByFunder` | True if buyer approved mutual refund |
| `mutualRefundApprovedByPayout` | True if seller approved mutual refund |
| `pendingExtensionDeadline` | Proposed new deadline (0 if none) |
| `extensionApprovedByFunder` | True if buyer approved pending extension |
| `extensionApprovedByPayout` | True if seller approved pending extension |
| `pendingSwapArb1/2/3` | Proposed new arbitrator set |
| `swapApprovedByFunder` | True if buyer approved pending swap |
| `swapApprovedByPayout` | True if seller approved pending swap |
| `totalExtensionUsed()` | Seconds of deadline extension used |
| `extensionRemaining()` | Seconds of deadline extension remaining (max 14 days) |

---

## API Reference

### Rate Limiting

The API enforces **Redis-backed rate limits** (via Upstash) to prevent abuse. This works correctly across:
- Multiple Vercel serverless instances
- Horizontal scaling
- Server restarts

| Limit | Value |
|-------|-------|
| Requests per minute per IP | 3 |
| Idempotency window | 5 minutes |
| Algorithm | Sliding window |

**Rate Limit Responses:**

| Status | Meaning |
|--------|---------|
| `429 Too Many Requests` | Rate limit exceeded. Check `Retry-After` header. |
| `409 Conflict` | Duplicate request within idempotency window. |

Response headers include `X-RateLimit-Remaining` and `X-RateLimit-Reset`.

**Idempotency Key:** Generated from `payout + funder + deadline`. Duplicate requests within the window return the cached response.

### Create Escrow

**POST** `/escrow/create`

Creates a new escrow contract with immutable parties and specified token.

**Request Body:**
```json
{
  "payout": "0x...",
  "funder": "0x...",
  "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "targetAmount": "100000000",
  "deadline": 1735689600,
  "arbitrator1": "0x0000000000000000000000000000000000000000",
  "arbitrator2": "0x0000000000000000000000000000000000000000",
  "arbitrator3": "0x0000000000000000000000000000000000000000"
}
```

**Arbitrator Rules:**
- **0 arbitrators**: All three set to zero address (no arbitration)
- **1 arbitrator**: Only `arbitrator1` set (first vote resolves)
- **3 arbitrators**: All three set (arb1+arb2 must agree, or arb3 breaks tie)
- **2 arbitrators**: NOT ALLOWED — will be rejected

**Server-Side Validation:**

The API validates all requests before forwarding to the oracle:

| Field | Validation |
|-------|------------|
| `payout`, `funder`, `token` | Must be valid Ethereum address (`0x` + 40 hex chars) |
| `payout` | Must not equal `funder` |
| `targetAmount` | Must be a positive numeric string |
| `deadline` | Must be in future AND ≤ 365 days from now |
| Arbitrators | Must be 0, 1, or 3 (if arb2 or arb3 set, all three required) |

Invalid requests return `400 Bad Request` with an error message.

**Response:**
```json
{
  "escrow": "0x...",
  "code": "abc123xyz",
  "txHash": "0x...",
  "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "confirmDeadline": 1735603200,
  "arbWindowEnd": 1736294400
}
```

### Get Escrow Status

**GET** `/escrow/status/:code`

Retrieves current escrow state by lookup code.

**Response:**
```json
{
  "escrow": "0x...",
  "code": "abc123xyz",
  "phase": 1,
  "phaseName": "ConfirmedAwaitingFunding",
  "payout": "0x...",
  "funder": "0x...",
  "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "targetAmount": "100000000",
  "fundedAmount": "50000000",
  "bondCap": "1000000",
  "deadline": 1735689600,
  "confirmDeadline": 1735603200,
  "arbWindowEnd": 1736294400,
  "confirmed": true,
  "resolved": false,
  "expired": false,
  "bondPresent": false,
  "isFunded": false,
  "arbitrator1": "0x0000000000000000000000000000000000000000",
  "arbitrator2": "0x0000000000000000000000000000000000000000",
  "arbitrator3": "0x0000000000000000000000000000000000000000",
  "arbitratorCount": 0,
  "deadlocked": false,
  "isPayable": false,
  "isExpirableNoConfirm": false,
  "isExpirableNoFund": false,
  "isTerminal": false,
  "isInArbWindow": false,
  "isSweepableAfterArbWindow": false
}
```

**Arbitration Fields:**
- `arbitratorCount`: 0, 1, or 3 (never 2)
- `arbitrator3`: The deadlock/tiebreaker arbitrator (zero address if not set)
- `deadlocked`: True if arb1 and arb2 voted differently (only relevant for 3-arb)

---

## Contract Functions

### Seller Functions

| Function | Description |
|----------|-------------|
| `confirm()` | Self-confirm within 24h (no bond required) |

### Oracle Functions

| Function | Description |
|----------|-------------|
| `confirmByOracle(txHash)` | Confirm after detecting $1 bond transfer |

### Arbitrator Functions (during arb window only)

| Function | Description |
|----------|-------------|
| `arbitratorRelease()` | Release funds to seller |
| `arbitratorRefund()` | Refund buyer, return bond to seller |

### Permissionless Functions

| Function | Description |
|----------|-------------|
| `finalizeAfterDeadline()` | Pay seller after deadline (no arbs only) |
| `expireIfNotConfirmed()` | Expire if not confirmed in 24h |
| `expireIfNotFunded()` | Expire if not funded by deadline |
| `sweepToTreasury()` | Sweep late funds after terminal state |
| `sweepToTreasuryAfterArbWindow()` | Sweep all after arb window (arbs only) |

### Mutual Action Functions (buyer or seller)

| Function | Description |
|----------|-------------|
| `approveMutualRelease()` | Approve mutual release (both parties required, no arbs, before deadline) |
| `approveMutualRefund()` | Approve mutual refund (both parties required, no arbs, before deadline) |
| `approveDeadlineExtension(newDeadline)` | Approve deadline extension (both parties must approve same deadline, max +14 days) |
| `approveArbitratorSwap(arb1, arb2, arb3)` | Approve arbitrator swap (both parties must approve same set, resets votes, pushes deadline +7 days) |

### View Functions

| Function | Description |
|----------|-------------|
| `isFunded()` | True if balance >= targetAmount |
| `fundedAmount()` | Amount funded toward target |
| `bondAvailable()` | Bond amount available for return |
| `isPayable()` | Can finalize (no arbs, confirmed, funded, past deadline) |
| `isInArbWindow()` | Currently in arbitration window |
| `isSweepableAfterArbWindow()` | Arb window ended, can sweep |
| `deadlocked()` | True if arb1 and arb2 voted differently (3-arb mode) |
| `arbitratorCount()` | Number of arbitrators (0, 1, or 3) |
| `originalDeadline()` | Original deadline (for extension cap calculation) |
| `totalExtensionUsed()` | Seconds of deadline extension used |
| `extensionRemaining()` | Seconds of deadline extension remaining |

---

## Production Deployment

### Prerequisites

- [ ] Node.js 18+
- [ ] Access to Arbitrum One RPC (Alchemy, Infura, or similar)
- [ ] Funded deployer wallet with ETH for gas
- [ ] Production Postgres database (Neon, Supabase, or Railway)
- [ ] Production Redis instance for Oracle (Upstash or Redis Cloud)
- [ ] **Upstash Redis REST** for UI rate limiting (separate from Oracle Redis)
- [ ] Treasury wallet (recommended: Safe multi-sig)

### Step 1: Configure Environment

Create `.env.prod` from the template:

```bash
cp env.prod.template .env.prod
```

Update with production values (see Configuration Reference below).

### Step 2: Set Up External Services

**2a. Upstash Redis for UI (Rate Limiting)**

1. Create account at [console.upstash.com](https://console.upstash.com)
2. Create a new Redis database
3. Copy the REST URL and token to your `.env.prod`:

```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_rest_token
```

**2b. Redis for Oracle (TX Queue)**

Use a standard Redis instance (Upstash, Redis Cloud, or self-hosted):

```bash
REDIS_URL=rediss://default:password@your-redis-host:6379
```

### Step 3: Deploy Contracts

```bash
cd packages/contracts

export ORACLE_ADDRESS=0xYourOracleWalletAddress
export TREASURY_ADDRESS=0xYourTreasuryMultisig

npx hardhat run scripts/deploy-prod.ts --network arbitrumOne
```

### Step 4: Run Database Migration

```bash
cd packages/oracle
psql $POSTGRES_URL < src/db/schema.sql
```

**Note:** The schema includes a migration for existing databases to update the `processed_tx` primary key to `(tx_hash, escrow)` for multi-log transaction support.

### Step 5: Deploy Oracle Service

```bash
cd packages/oracle
npm run build
npm start
```

The oracle will automatically:
- Start the TX sender worker (manages nonces, speed-up logic)
- Start the event watcher (monitors blockchain)
- Start the keeper loop (periodic maintenance)
- Recover any pending transactions from Redis

### Step 6: Deploy UI

```bash
cd packages/ui
npm run build
npm start
```

Ensure the UI environment variables are set:
- `ORACLE_API_URL` - Points to your oracle API
- `ORACLE_API_KEY` - Same as `WEBHOOK_SHARED_SECRET`
- `UPSTASH_REDIS_REST_URL` - For rate limiting
- `UPSTASH_REDIS_REST_TOKEN` - For rate limiting

---

## Configuration Reference

### Oracle Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CHAIN_ID` | Network ID (42161 for Arbitrum One) | Yes |
| `RPC_HTTP` | HTTP RPC endpoint | Yes |
| `RPC_WSS` | WebSocket RPC endpoint | Yes |
| `ORACLE_PRIVATE_KEY` | Oracle wallet private key | Yes |
| `FACTORY_ADDRESS` | Deployed EscrowFactory address | Yes |
| `USDC_ADDRESS` | USDC token contract address | Yes |
| `USDT_ADDRESS` | USDT token contract address | Yes |
| `TREASURY_ADDRESS` | Treasury wallet for fees | Yes |
| `POSTGRES_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string (for TX queue) | Yes |
| `WEBHOOK_SHARED_SECRET` | API authentication secret | Yes |
| `PORT` | Oracle API port (default: 3000) | No |

#### TX Sender Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `TX_SPEEDUP_THRESHOLD_MS` | Time before first speed-up attempt | 120000 (2 min) |
| `TX_REPLACE_THRESHOLD_MS` | Time before aggressive replacement | 300000 (5 min) |
| `TX_ALERT_THRESHOLD_MS` | Time before alerting | 600000 (10 min) |
| `TX_BACKLOG_ALERT` | Alert when pending TXs exceed this | 10 |
| `ALERT_WEBHOOK_URL` | Slack/Discord webhook for TX alerts | Optional |

### UI Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ORACLE_API_URL` | URL to Oracle API | Yes |
| `ORACLE_API_KEY` | Same as `WEBHOOK_SHARED_SECRET` | Yes |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | Yes |

---

## Development

### Running Tests

```bash
cd packages/contracts
npm test
```

Contract tests cover:
- Seller self-confirm and oracle bond-based confirm
- Derived funding status (isFunded)
- Fee calculation (boundary cases)
- **0/1/3 arbitrator rule validation** (rejects 2-arb configurations)
- **1-arb mode**: first vote resolves immediately
- **3-arb mode**: arb1+arb2 agreement, deadlock state, arb3 tiebreaker
- **Unresolved arb expiry**: sweep to treasury after arb window
- Arbitration window restrictions
- Sweep after arb window
- All lifecycle phases and expiry conditions
- Creation validation (deadline bounds, bondCap limits)
- Reentrancy protection on all transfer paths
- **Mutual release/refund**: both parties approve, only before deadline, only with 0 arbitrators
- **Mutual deadline extension**: both approve same deadline, max 14 days, arbWindowEnd updates
- **Mutual arbitrator swap**: both approve same set, votes reset, deadline pushed +7 days

### Local Development

```bash
# Terminal 1: Start local Hardhat node
cd packages/contracts
npx hardhat node

# Terminal 2: Deploy to local network
npx hardhat run scripts/deploy-sepolia.ts --network localhost

# Terminal 3: Start oracle
cd packages/oracle
npm run dev

# Terminal 4: Start UI
cd packages/ui
npm run dev
```

---

## Troubleshooting

### TX Queue Issues

**Symptom:** Transactions not being sent

```bash
# Check TX sender status
curl http://localhost:3000/status | jq '.txSender'
```

Look for:
- `isRunning: false` → TX sender crashed, restart oracle
- `queueWaiting` growing → TX sender stuck, check Redis connection
- `pendingTransactions` high → Transactions stuck on-chain, check gas prices

**Symptom:** Nonce too low errors

This usually means a pending TX was mined but tracker wasn't updated. The TX sender will auto-recover on the next attempt.

**Symptom:** Rate limit not working across instances

Ensure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. Without these, rate limiting falls back to in-memory (per-instance).

### Database Migration

If you see primary key conflicts on `processed_tx`:

```sql
-- The schema.sql includes a migration, but if needed manually:
ALTER TABLE processed_tx DROP CONSTRAINT processed_tx_pkey;
ALTER TABLE processed_tx ADD PRIMARY KEY (tx_hash, escrow);
```

---

## License

MIT
