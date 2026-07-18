# AGENTS.md -- Crow P2P Escrow Reference

> Programmatic reference for agents and developers working with Crow P2P escrow.
> Crow uses `EscrowV2` on Arbitrum One and Ethereum, with manual wallet transactions and a
> backend indexer/API for lookup codes, metadata, webhooks, and dashboard history.

## Network & Addresses

| Item | Value |
|------|-------|
| Network | Arbitrum One |
| Chain ID | `42161` |
| RPC HTTP | `https://arb1.arbitrum.io/rpc` |
| RPC WSS | `wss://arb1.arbitrum.io/rpc` |
| EscrowFactoryV2 | deploy pending; set `FACTORY_ADDRESS` and `NEXT_PUBLIC_FACTORY_ADDRESS` after `packages/contracts/scripts/deploy-prod-v2.ts` |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| USDT | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` |
| Ethereum Chain ID | `1` |
| Ethereum EscrowFactoryV2 | deploy pending; set `ETHEREUM_FACTORY_ADDRESS` and `NEXT_PUBLIC_ETHEREUM_FACTORY_ADDRESS` |
| Ethereum USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Ethereum USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |

Amounts are raw 6-decimal token units. `$100 = 100000000`, `$1 = 1000000`.

## Architecture

There is no on-chain oracle.

The service in `packages/oracle` is an indexer/API despite the legacy folder name.
It watches WSS/webhook logs, stores lookup codes and off-chain terms text, and
combines database metadata with live on-chain reads for dashboard responses.

Money moves only through user/manual contract transactions.

## Escrow Model

An escrow has two immutable parties:

- seller: `sellerWallet` / factory `_payout`; receives settlement payout
- buyer: `buyerRefundWallet` / factory `_funder`; receives refunds

Allowed value destinations:

- settle: seller receives `targetAmount - fee`; treasury receives fee and excess
- refund: buyer receives refundable balance
- sweep/recover: late, excess, or stray funds go to the contract-defined destination

Funding is push-based. The buyer transfers USDC/USDT directly to the escrow
contract address. Funded status is derived from live balance:

```text
balance >= targetAmount
```

## One-Date Lifecycle

There is one date:

```text
settlementDate
```

There is no funding date, funding deadline, confirmation deadline, or legacy
unconfirmed-refund path.

Status enum:

```solidity
0 CREATED
1 ACTIVE
2 PENDING_MUTUAL_RESOLUTION
3 SETTLED
4 REFUNDED
```

Removed legacy names/functions:

```text
RELEASED
INACTIVE
fundingDeadline
settlementDeadline
refundInactive()
refundUnconfirmed()
```

Lifecycle summary:

```text
CREATED
  ├─ buyer funds by ERC-20 transfer
  ├─ sellerConfirm() after full funding                     -> ACTIVE
  ├─ approveMutualSettle/Refund by buyer + seller
  │    ├─ no arbitrators                                    -> SETTLED | REFUNDED
  │    └─ arbitrated                                        -> PENDING_MUTUAL_RESOLUTION
  ├─ settle() after settlementDate if fully funded, no-arb   -> SETTLED
  └─ refundUnderfunded() after settlementDate if underfunded -> REFUNDED

ACTIVE
  ├─ settle() after settlementDate if no-arb                 -> SETTLED
  ├─ approveMutualSettle/Refund by buyer + seller
  │    ├─ no arbitrators                                    -> SETTLED | REFUNDED
  │    └─ arbitrated                                        -> PENDING_MUTUAL_RESOLUTION
  └─ arbitrator vote path                                   -> SETTLED | REFUNDED

PENDING_MUTUAL_RESOLUTION
  ├─ arbitrator override inside 30-day window                -> SETTLED | REFUNDED
  └─ finalizeMutualResolution() after window                 -> SETTLED | REFUNDED
```

Important rule: seller confirmation is optional. A fully funded `CREATED` escrow
can still be settled after `settlementDate`; it must not be refunded only because
the seller did not confirm.

## Creating an Escrow

Call `createEscrowSimple` on `EscrowFactoryV2`.

```solidity
function createEscrowSimple(
    address _payout,
    address _funder,
    address _token,
    uint256 _targetAmount,
    uint64  _settlementDate,
    bytes32 _termsHash,
    address _arbitrator1,
    address _arbitrator2,
    address _arbitrator3
) external returns (address escrow)
```

Rules:

- `_payout` and `_funder` must be different non-zero addresses.
- `_token` must be allowlisted USDC or USDT.
- `_targetAmount >= 1000000`.
- `_settlementDate > now` and `<= now + 365 days`.
- Arbitrators must be 0, 1, or 3 addresses; never 2.
- Arbitrators cannot be buyer or seller and must be unique.

`EscrowCreated`:

```solidity
event EscrowCreated(
    address indexed escrow,
    address indexed funder,
    address indexed payout,
    address token,
    uint256 targetAmount,
    uint64 settlementDate,
    uint64 createdAt,
    bytes32 termsHash,
    uint8 arbitrationMode,
    address arbitrator1,
    address arbitrator2,
    address arbitrator3
)
```

## Manual Actions

Funding is not an escrow function call. It is an ERC-20 transfer:

```solidity
IERC20(token).transfer(escrowAddress, targetAmount)
```

Escrow functions:

```solidity
function sellerConfirm() external
function settle() external
function refundUnderfunded() external
function approveMutualSettle() external
function approveMutualRefund() external
function finalizeMutualResolution() external
function arbSettle() external
function arbRefund() external
function arbVoteSettle() external
function arbVoteRefund() external
function sweepExcess() external
function recoverLatePaymentToken() external
function sweepStrayToken(IERC20 erc20, uint256 amt) external
```

Permission map:

| Function | Who Can Call |
|----------|-------------|
| `createEscrowSimple()` | anyone |
| `sellerConfirm()` | seller only |
| `settle()` | anyone when conditions pass |
| `refundUnderfunded()` | anyone when conditions pass |
| `approveMutualSettle()` / `approveMutualRefund()` | buyer or seller |
| `finalizeMutualResolution()` | anyone after override window |
| `arbSettle()` / `arbRefund()` / `arbVoteSettle()` / `arbVoteRefund()` | arbitrator |
| `sweepExcess()` / `recoverLatePaymentToken()` / `sweepStrayToken()` | anyone when conditions pass |

## View Functions

Important reads:

```solidity
sellerWallet()
buyerRefundWallet()
token()
targetAmount()
settlementDate()
createdAt()
termsHash()
arbitrationMode()
arbitrator1()
arbitrator2()
arbitrator3()
status()
statusCode()
pendingOutcome()
overrideWindowEnd()
settleVotes()
refundVotes()
balance()
isFunded()
isTerminal()
isActivatable()
isRefundableUnderfunded()
isSettleable()
isVotable()
isInOverrideWindow()
isFinalizable()
calculateFee(uint256 amount)
```

Actionable helper meanings:

| Helper | True When |
|--------|-----------|
| `isActivatable()` | `CREATED` and fully funded |
| `isRefundableUnderfunded()` | `CREATED`, after `settlementDate`, underfunded |
| `isSettleable()` | no-arb, fully funded, after `settlementDate`, non-terminal |
| `isVotable()` | arbitrated and active or in override window |
| `isInOverrideWindow()` | pending mutual resolution and before `overrideWindowEnd` |
| `isFinalizable()` | pending mutual resolution and after `overrideWindowEnd` |
| `isTerminal()` | `SETTLED` or `REFUNDED` |

## Backend / Indexer API

The backend stores lookup codes and terms text, indexes events, and serves
dashboard data. It is not trusted by the contracts.

Minimum backend env:

```text
NODE_ENV=production
CHAIN_ID=42161
RPC_HTTP=<Arbitrum One HTTP RPC>
RPC_WSS=<Arbitrum One WSS RPC>
FACTORY_ADDRESS=<EscrowFactoryV2>
INDEXER_START_BLOCK=<factory deployment block or current block before first escrow>
USDC_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
USDT_ADDRESS=0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9
POSTGRES_URL=<database URL>
WEBHOOK_SHARED_SECRET=<shared secret>
PORT=<backend port>
ENABLE_SERVER_TXS=false
```

Only set these if enabling optional server-signed/internal transactions:

```text
ENABLE_SERVER_TXS=true
ORACLE_PRIVATE_KEY=<backend wallet private key>
REDIS_URL=<redis URL>
```

Register wallet-created escrow:

```http
POST /escrow/register
Content-Type: application/json

{ "txHash": "0x...", "termsText": "optional deliverables text" }
```

Status lookup:

```http
GET /escrow/status/:code
```

Webhook:

```http
POST /webhooks/chain
x-webhook-secret: <WEBHOOK_SHARED_SECRET>
```

The webhook/indexer should ingest:

- `EscrowCreated`
- escrow action events
- USDC/USDT `Transfer` logs to known escrow addresses

## UI Env

```text
NEXT_PUBLIC_APP_URL=<app URL>
NEXT_PUBLIC_FACTORY_ADDRESS=<EscrowFactoryV2>
NEXT_PUBLIC_RPC_HTTP=<Arbitrum One HTTP RPC>
INDEXER_API_URL=<backend/indexer URL>
INDEXER_API_KEY=<WEBHOOK_SHARED_SECRET if using authenticated optional endpoints>
```

Legacy `ORACLE_API_URL` and `ORACLE_API_KEY` are accepted as fallback aliases
until the folder/env rename is completed.
