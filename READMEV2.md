# Crow EscrowV2

Crow EscrowV2 is the current peer-to-peer escrow flow for Arbitrum One.

## Current Model

- One date: `settlementDate`.
- No funding date, funding deadline, or confirmation deadline.
- No on-chain oracle.
- No seller bond.
- Funding is an ERC-20 transfer directly to the escrow address.
- Seller confirmation is optional.
- A fully funded `CREATED` escrow can settle after `settlementDate`.
- An underfunded `CREATED` escrow can refund after `settlementDate`.

Status enum:

```text
0 CREATED
1 ACTIVE
2 PENDING_MUTUAL_RESOLUTION
3 SETTLED
4 REFUNDED
```

## Packages

```text
packages/contracts  EscrowV2 and EscrowFactoryV2
packages/oracle     Legacy folder name; currently the indexer/API backend
packages/ui         Next.js app
```

The backend is an indexer/API. It stores lookup codes, off-chain terms text, and
event history, then combines that data with live on-chain reads for dashboard
responses. It does not move funds or decide escrow outcomes.

## Main Contract Calls

Factory:

```solidity
createEscrowSimple(
  address payout,
  address funder,
  address token,
  uint256 targetAmount,
  uint64 settlementDate,
  bytes32 termsHash,
  address arbitrator1,
  address arbitrator2,
  address arbitrator3
)
```

Escrow:

```solidity
sellerConfirm()
settle()
refundUnderfunded()
approveMutualSettle()
approveMutualRefund()
finalizeMutualResolution()
arbSettle()
arbRefund()
arbVoteSettle()
arbVoteRefund()
sweepExcess()
recoverLatePaymentToken()
sweepStrayToken(IERC20 erc20, uint256 amt)
```

## Launch Docs

Use these files for current handoff and deployment:

- `FINAL_ESCROW_LAUNCH_PLAN.md`
- `DEPLOYMENT.md`
- `AGENTS.md`

## Verification

```bash
npm --prefix packages/contracts test
npm --prefix packages/oracle run build
npm --prefix packages/ui run build
```
