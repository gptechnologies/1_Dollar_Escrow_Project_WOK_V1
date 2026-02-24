# AGENTS.md -- Crow Escrow Smart Contract Reference

> This document is a programmatic reference for AI agents and developers.
> It describes how to interact with the Crow escrow system on Arbitrum
> without the web UI -- purely through on-chain calls and API endpoints.

## Network & Addresses

| Item | Value |
|------|-------|
| **Network** | Arbitrum One |
| **Chain ID** | `42161` |
| **RPC (HTTP)** | `https://arb1.arbitrum.io/rpc` |
| **RPC (WSS)** | `wss://arb1.arbitrum.io/rpc` |
| **EscrowFactory** | `0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9` |
| **PaymentRouter** | `0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95` |
| **USDC** | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (6 decimals) |
| **USDT** | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` (6 decimals) |

All amounts are in raw token units (6 decimals). $100 = `100000000`. $1 = `1000000`.

## Escrow Lifecycle

```
Creation ──► Awaiting Confirmation ──► Confirmed, Awaiting Funding ──► Funded
                  │                          │                           │
                  │ (24h timeout)            │ (deadline reached,       │
                  ▼                          │  not funded)             │
            EXPIRED (no confirm)             ▼                         │
                                       EXPIRED (no fund)              │
                                                                      │
                  ┌───────────────────────────────────────────────────┘
                  │
                  ▼
           ┌─────────────┐
           │ No arbs?    │──YES──► finalizeAfterDeadline() ──► RESOLVED (seller paid)
           └─────────────┘
                  │ NO (has arbitrators)
                  ▼
           Arbitration Window [deadline, deadline + 7 days]
                  │
           ┌──────┴──────┐
           │             │
     arbitratorRelease  arbitratorRefund
     (seller paid)      (buyer refunded)
           │             │
           ▼             ▼
        RESOLVED      RESOLVED
                  │
                  │ (window expires, no vote)
                  ▼
           sweepToTreasuryAfterArbWindow() ──► funds go to treasury
```

**Mutual actions** (available before deadline, no-arb escrows only):
- Both parties approve `approveMutualRelease()` → seller paid early
- Both parties approve `approveMutualRefund()` → buyer refunded early

**Mutual actions** (available anytime before resolution):
- Both parties approve `approveDeadlineExtension(newDeadline)` → deadline extended (max +14 days from original)
- Both parties approve `approveArbitratorSwap(arb1, arb2, arb3)` → arbitrators replaced, deadline pushed +7 days

## Creating an Escrow

Call `createEscrowSimple` on the factory. This is **permissionless** -- any wallet can call it.

### Function Signature

```solidity
function createEscrowSimple(
    address _payout,        // seller - receives funds on success
    address _funder,        // buyer - must fund the escrow
    address _token,         // USDC or USDT address (must be allowlisted)
    uint256 _targetAmount,  // amount buyer must fund (raw, 6 decimals)
    uint64  _deadline,      // unix timestamp when seller gets paid
    address _arbitrator1,   // optional (use 0x0 for none)
    address _arbitrator2,   // optional (requires arb1 + arb3)
    address _arbitrator3    // deadlock arbitrator (requires arb1 + arb2)
) external returns (address escrow)
```

### Rules

- `_payout` and `_funder` must be different non-zero addresses
- `_token` must be USDC or USDT (allowlisted on factory)
- `_targetAmount` > 0
- `_deadline` must be in the future, within 365 days of now
- Arbitrators: must be 0, 1, or 3 (never 2). No arbitrator can be the buyer or seller. All must be unique.
- Uses the factory's `defaultBondCap` ($1 = 1000000)

### Emitted Event

```solidity
event EscrowCreated(
    address indexed escrow,
    address indexed funder,
    address indexed payout,
    address token,
    uint256 targetAmount,
    uint256 bondCap,
    uint64  deadline,
    uint64  createdAt,
    uint64  confirmDeadline,    // createdAt + 24 hours
    uint64  arbWindowEnd,       // deadline + 7 days
    address arbitrator1,
    address arbitrator2,
    address arbitrator3
)
```

### viem Example

```typescript
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseEventLogs } from 'viem';
import { arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const FACTORY = '0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ZERO = '0x0000000000000000000000000000000000000000';

const factoryABI = [{
  inputs: [
    { name: '_payout', type: 'address' },
    { name: '_funder', type: 'address' },
    { name: '_token', type: 'address' },
    { name: '_targetAmount', type: 'uint256' },
    { name: '_deadline', type: 'uint64' },
    { name: '_arbitrator1', type: 'address' },
    { name: '_arbitrator2', type: 'address' },
    { name: '_arbitrator3', type: 'address' },
  ],
  name: 'createEscrowSimple',
  outputs: [{ name: 'escrow', type: 'address' }],
  stateMutability: 'nonpayable',
  type: 'function',
}, {
  anonymous: false,
  inputs: [
    { indexed: true, name: 'escrow', type: 'address' },
    { indexed: true, name: 'funder', type: 'address' },
    { indexed: true, name: 'payout', type: 'address' },
    { indexed: false, name: 'token', type: 'address' },
    { indexed: false, name: 'targetAmount', type: 'uint256' },
    { indexed: false, name: 'bondCap', type: 'uint256' },
    { indexed: false, name: 'deadline', type: 'uint64' },
    { indexed: false, name: 'createdAt', type: 'uint64' },
    { indexed: false, name: 'confirmDeadline', type: 'uint64' },
    { indexed: false, name: 'arbWindowEnd', type: 'uint64' },
    { indexed: false, name: 'arbitrator1', type: 'address' },
    { indexed: false, name: 'arbitrator2', type: 'address' },
    { indexed: false, name: 'arbitrator3', type: 'address' },
  ],
  name: 'EscrowCreated',
  type: 'event',
}] as const;

const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY');
const publicClient = createPublicClient({ chain: arbitrum, transport: http() });
const walletClient = createWalletClient({ account, chain: arbitrum, transport: http() });

// Create a $500 USDC escrow, deadline 7 days from now, no arbitrators
const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);

const hash = await walletClient.writeContract({
  address: FACTORY,
  abi: factoryABI,
  functionName: 'createEscrowSimple',
  args: [
    '0xSELLER_ADDRESS',  // payout
    '0xBUYER_ADDRESS',   // funder
    USDC,                // token
    500_000_000n,        // $500 (6 decimals)
    deadline,
    ZERO, ZERO, ZERO,   // no arbitrators
  ],
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
const logs = parseEventLogs({ abi: factoryABI, logs: receipt.logs, eventName: 'EscrowCreated' });
const escrowAddress = logs[0].args.escrow;
console.log('Escrow deployed at:', escrowAddress);
```

## Confirmation (within 24h of creation)

Two paths -- only one is needed:

### Path A: Seller self-confirms (no bond)

```solidity
function confirm() external  // only callable by payout (seller)
```

The seller calls `confirm()` on the escrow contract. No token transfer needed.

```typescript
await walletClient.writeContract({
  address: escrowAddress,
  abi: [{ inputs: [], name: 'confirm', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
  functionName: 'confirm',
});
```

### Path B: Oracle confirms after bond (requires $1 bond)

The seller transfers `bondCap` ($1 = 1000000 raw) of the escrow token directly to the escrow address. The oracle detects this and calls `confirmByOracle(txHash)`.

This path is oracle-only and not available to external callers.

## Funding

Funding is **not** a contract call. The buyer (funder) sends an ERC-20 `transfer()` of `targetAmount` tokens directly to the escrow contract address.

```typescript
const erc20ABI = [{
  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  name: 'transfer',
  outputs: [{ type: 'bool' }],
  stateMutability: 'nonpayable',
  type: 'function',
}] as const;

// Fund escrow with $500 USDC
await walletClient.writeContract({
  address: USDC,
  abi: erc20ABI,
  functionName: 'transfer',
  args: [escrowAddress, 500_000_000n],
});
```

Check if funded:

```typescript
const funded = await publicClient.readContract({
  address: escrowAddress,
  abi: [{ inputs: [], name: 'isFunded', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' }],
  functionName: 'isFunded',
});
```

If `bondPresent` is true (oracle confirmed with bond), `isFunded()` checks `balance >= bondCap + targetAmount`. Otherwise it checks `balance >= targetAmount`.

## Resolution

### No Arbitrators: `finalizeAfterDeadline()`

```solidity
function finalizeAfterDeadline() external  // permissionless
```

Callable by anyone after the deadline if the escrow is confirmed, funded, and has no arbitrators. Pays the seller (minus fee), returns bond if present, sweeps excess to treasury.

```typescript
await walletClient.writeContract({
  address: escrowAddress,
  abi: [{ inputs: [], name: 'finalizeAfterDeadline', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
  functionName: 'finalizeAfterDeadline',
});
```

### With Arbitrators: Arbitrator votes

During the arbitration window (`deadline` to `arbWindowEnd`), arbitrators call:

```solidity
function arbitratorRelease() external  // only callable by arbitrator -- pays seller
function arbitratorRefund() external   // only callable by arbitrator -- refunds buyer
```

- **1 arbitrator**: first vote resolves immediately
- **3 arbitrators**: arb1 and arb2 must agree. If they disagree (deadlock), arb3 breaks the tie.

## Expiry

Both are permissionless -- anyone can call them when conditions are met:

```solidity
function expireIfNotConfirmed() external  // callable after confirmDeadline (24h) if not confirmed
function expireIfNotFunded() external     // callable after deadline if confirmed but not funded
```

## Mutual Actions (Both Parties Must Approve)

Each action requires both the funder and payout to call the same function:

| Function | When | Effect |
|----------|------|--------|
| `approveMutualRelease()` | Before deadline, no arbs | Pays seller early |
| `approveMutualRefund()` | Before deadline, no arbs | Refunds buyer early |
| `approveDeadlineExtension(uint64 newDeadline)` | Before resolution | Extends deadline (max +14 days from original) |
| `approveArbitratorSwap(address a1, address a2, address a3)` | Before resolution | Replaces arbitrators, pushes deadline +7 days |

For extensions, both parties must pass the exact same `newDeadline` value. For swaps, both must pass the same arbitrator set.

## Sweeps

```solidity
function sweepToTreasury() external            // permissionless -- only in terminal states (resolved/expired)
function sweepToTreasuryAfterArbWindow() external  // permissionless -- after arb window with no resolution
function sweepStrayToken(IERC20 erc20, uint256 amt) external  // oracle only -- non-escrow tokens
```

## Reading Escrow State

All state is readable via public view functions on the escrow contract:

```typescript
const escrowABI = [
  { inputs: [], name: 'payout', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'funder', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'targetAmount', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'bondCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'deadline', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'confirmDeadline', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbWindowEnd', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'createdAt', outputs: [{ type: 'uint64' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'confirmed', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'resolved', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'expired', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'bondPresent', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isFunded', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'fundedAmount', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator1', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator2', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitrator3', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'arbitratorCount', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'deadlocked', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isPayable', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isTerminal', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isExpirableNoConfirm', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isExpirableNoFund', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isInArbWindow', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isSweepableAfterArbWindow', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
] as const;

// Read all state in one multicall
const results = await publicClient.multicall({
  contracts: escrowABI.map(fn => ({
    address: escrowAddress,
    abi: [fn],
    functionName: fn.name,
  })),
  allowFailure: false,
});
```

### Actionable State Helpers

| View Function | Returns `true` when |
|--------------|---------------------|
| `isPayable()` | No arbs, confirmed, funded, deadline reached, not terminal |
| `isExpirableNoConfirm()` | Not confirmed, past `confirmDeadline` (24h), not terminal |
| `isExpirableNoFund()` | Confirmed, not funded, past `deadline`, not terminal |
| `isInArbWindow()` | Has arbs, confirmed, funded, within [deadline, arbWindowEnd] |
| `isSweepableAfterArbWindow()` | Has arbs, past `arbWindowEnd`, not resolved |
| `isTerminal()` | Resolved or expired |

## Fee Structure

```solidity
function calculateFee(uint256 amount) public pure returns (uint256 fee)
```

- If `amount` > $100 (100000000): fee = $1 (1000000) -- capped
- If `amount` <= $100: fee = 1% of amount
- Minimum fee: $0.01 (10000)

Examples: $500 escrow → $1 fee. $50 escrow → $0.50 fee. $0.50 escrow → $0.01 fee.

Fees are deducted from the seller's payout at resolution time. The buyer always funds exactly `targetAmount`.

## Permission Map

| Function | Who Can Call |
|----------|-------------|
| `createEscrowSimple()` | Anyone (on factory) |
| `confirm()` | Seller (payout) only |
| `confirmByOracle()` | Oracle only |
| `finalizeAfterDeadline()` | Anyone |
| `expireIfNotConfirmed()` | Anyone |
| `expireIfNotFunded()` | Anyone |
| `arbitratorRelease()` | Arbitrator only |
| `arbitratorRefund()` | Arbitrator only |
| `approveMutualRelease()` | Buyer or seller |
| `approveMutualRefund()` | Buyer or seller |
| `approveDeadlineExtension()` | Buyer or seller |
| `approveArbitratorSwap()` | Buyer or seller |
| `sweepToTreasury()` | Anyone (terminal states only) |
| `sweepToTreasuryAfterArbWindow()` | Anyone |
| `sweepStrayToken()` | Oracle only |

## PaymentRouter (On-Chain Enforced Payments)

| Item | Value |
|------|-------|
| **PaymentRouter** | `0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95` |

The PaymentRouter stores payment link parameters on-chain. When a payer calls `pay(linkId)`, the contract reads the stored token, recipient, and amount -- the payer cannot alter them. This is used for the "Accept Stablecoins" QR code feature.

### How It Works

1. Merchant creates a payment link via the API (see below)
2. The oracle registers the link on-chain via `createLink(id, token, recipient, amount)`
3. Payer visits the payment page, approves the exact token amount to the router, then calls `pay(id)`
4. The router executes `transferFrom(payer, recipient, amount)` -- enforced on-chain

### Contract ABI

```solidity
function createLink(bytes32 id, address token, address recipient, uint256 amount) external  // owner only
function pay(bytes32 id) external  // anyone, requires prior ERC-20 approve
function linkExists(bytes32 id) external view returns (bool)
function links(bytes32 id) external view returns (address token, address recipient, uint256 amount)
```

### Link ID Derivation

The `bytes32 id` is derived deterministically from the off-chain code:

```typescript
import { keccak256, toHex, toBytes } from 'viem';
const linkId = keccak256(toHex(toBytes(code)));  // code = nanoid(10) from the API
```

### viem Example: Pay a Link

```typescript
import { createPublicClient, createWalletClient, http, keccak256, toHex, toBytes } from 'viem';
import { arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ROUTER = '0xe65CBf11e2F997e3a5Fa2E8c12596C1992d51c95';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const erc20ABI = [{
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function',
}] as const;

const routerABI = [{
  inputs: [{ name: 'id', type: 'bytes32' }],
  name: 'pay', outputs: [], stateMutability: 'nonpayable', type: 'function',
}] as const;

const account = privateKeyToAccount('0xPAYER_KEY');
const publicClient = createPublicClient({ chain: arbitrum, transport: http() });
const walletClient = createWalletClient({ account, chain: arbitrum, transport: http() });

const code = 'a8Kx3mQ7pR';
const linkId = keccak256(toHex(toBytes(code)));
const amount = 100_000_000n; // $100 USDC

// Step 1: Approve router for exact amount
await walletClient.writeContract({
  address: USDC, abi: erc20ABI, functionName: 'approve',
  args: [ROUTER, amount],
});

// Step 2: Pay via router
await walletClient.writeContract({
  address: ROUTER, abi: routerABI, functionName: 'pay',
  args: [linkId],
});
```

## Payment Links API

Payment links are created via the Crow backend API. The oracle automatically registers each link on the PaymentRouter contract.

### Create a Payment Link

```
POST /payment/create
Content-Type: application/json

{
  "wallet": "0xRECIPIENT_ADDRESS",
  "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "amount": "100000000",
  "description": "Invoice #42"
}

Response: { "code": "a8Kx3mQ7pR", "linkId": "0x..." }
```

### Fetch a Payment Link

```
GET /payment/:code

Response: {
  "code": "a8Kx3mQ7pR",
  "wallet": "0x...",
  "token": "0x...",
  "amount": "100000000",
  "description": "Invoice #42",
  "onChain": true,
  "linkId": "0x...",
  "createdAt": "2026-02-23T..."
}
```

The `onChain` field indicates whether the link is registered on the PaymentRouter contract. If `true`, the payer must approve + pay via the router. If `false` (rare, transient), the payer falls back to a direct ERC-20 transfer.

Payment page URL: `https://usecrow.com/p/<code>`

## Escrow Registration API

After creating an escrow on-chain, register it with the backend to get a human-readable lookup code:

```
POST /escrow/register
Content-Type: application/json

{ "txHash": "0x..." }

Response: {
  "escrow": "0x...",
  "code": "xK9mT2qPnR",
  "txHash": "0x...",
  "token": "0x...",
  "phase": 0,
  "confirmDeadline": 1740000000,
  "arbWindowEnd": 1740600000
}
```

### Look Up Escrow by Code

```
GET /escrow/status/:code

Response: {
  "escrow": "0x...",
  "code": "xK9mT2qPnR",
  "phase": 0,
  "phaseName": "AwaitingConfirmation",
  "payout": "0x...",
  "funder": "0x...",
  "token": "0x...",
  "targetAmount": "500000000",
  "deadline": 1740000000,
  "confirmed": false,
  "resolved": false,
  "expired": false,
  "isFunded": false,
  ...
}
```

## Complete Example: Create, Confirm, Fund, Finalize

```typescript
import { createPublicClient, createWalletClient, http, parseEventLogs } from 'viem';
import { arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const FACTORY = '0xd8dCaa9704a74FD23bFE675477fC9f9E7deD8cb9';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ZERO = '0x0000000000000000000000000000000000000000';

const sellerAccount = privateKeyToAccount('0xSELLER_KEY');
const buyerAccount = privateKeyToAccount('0xBUYER_KEY');

const publicClient = createPublicClient({ chain: arbitrum, transport: http() });

const factoryABI = [{
  inputs: [
    { name: '_payout', type: 'address' },
    { name: '_funder', type: 'address' },
    { name: '_token', type: 'address' },
    { name: '_targetAmount', type: 'uint256' },
    { name: '_deadline', type: 'uint64' },
    { name: '_arbitrator1', type: 'address' },
    { name: '_arbitrator2', type: 'address' },
    { name: '_arbitrator3', type: 'address' },
  ],
  name: 'createEscrowSimple',
  outputs: [{ name: 'escrow', type: 'address' }],
  stateMutability: 'nonpayable',
  type: 'function',
}, {
  anonymous: false,
  inputs: [
    { indexed: true, name: 'escrow', type: 'address' },
    { indexed: true, name: 'funder', type: 'address' },
    { indexed: true, name: 'payout', type: 'address' },
    { indexed: false, name: 'token', type: 'address' },
    { indexed: false, name: 'targetAmount', type: 'uint256' },
    { indexed: false, name: 'bondCap', type: 'uint256' },
    { indexed: false, name: 'deadline', type: 'uint64' },
    { indexed: false, name: 'createdAt', type: 'uint64' },
    { indexed: false, name: 'confirmDeadline', type: 'uint64' },
    { indexed: false, name: 'arbWindowEnd', type: 'uint64' },
    { indexed: false, name: 'arbitrator1', type: 'address' },
    { indexed: false, name: 'arbitrator2', type: 'address' },
    { indexed: false, name: 'arbitrator3', type: 'address' },
  ],
  name: 'EscrowCreated',
  type: 'event',
}] as const;

const erc20ABI = [{
  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  name: 'transfer', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function',
}] as const;

const escrowWriteABI = [
  { inputs: [], name: 'confirm', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'finalizeAfterDeadline', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

// --- Step 1: Create escrow (anyone can call) ---
const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
const sellerWallet = createWalletClient({ account: sellerAccount, chain: arbitrum, transport: http() });

const createHash = await sellerWallet.writeContract({
  address: FACTORY, abi: factoryABI, functionName: 'createEscrowSimple',
  args: [sellerAccount.address, buyerAccount.address, USDC, 100_000_000n, deadline, ZERO, ZERO, ZERO],
});
const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
const escrowAddress = parseEventLogs({
  abi: factoryABI, logs: createReceipt.logs, eventName: 'EscrowCreated',
})[0].args.escrow;

// --- Step 2: Seller confirms (within 24h) ---
await sellerWallet.writeContract({
  address: escrowAddress, abi: escrowWriteABI, functionName: 'confirm',
});

// --- Step 3: Buyer funds (direct ERC-20 transfer to escrow) ---
const buyerWallet = createWalletClient({ account: buyerAccount, chain: arbitrum, transport: http() });
await buyerWallet.writeContract({
  address: USDC, abi: erc20ABI, functionName: 'transfer',
  args: [escrowAddress, 100_000_000n],
});

// --- Step 4: After deadline, anyone finalizes ---
// (wait until block.timestamp > deadline)
await sellerWallet.writeContract({
  address: escrowAddress, abi: escrowWriteABI, functionName: 'finalizeAfterDeadline',
});
// Seller receives $99 (targetAmount - fee), treasury receives $1 fee
```
