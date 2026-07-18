/**
 * Contract ABIs for EscrowFactoryV2 and EscrowV2 (P2P Escrow Model)
 *
 * Design:
 * - Push funding; isFunded() derived from on-chain balance
 * - sellerConfirm() is optional and requires live full funding
 * - One settlement date + immutable termsHash
 * - 0/1/3 arbitration with 2-of-3 voting + 30-day mutual-resolution override
 * - No oracle, no bond. Status enum: CREATED/ACTIVE/PENDING_MUTUAL_RESOLUTION/
 *   SETTLED/REFUNDED (0..4)
 */

// EscrowCreated must remain the first entry (watcher reads EscrowFactoryABI[0].inputs)
export const EscrowFactoryABI = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "escrow", "type": "address" },
      { "indexed": true, "name": "funder", "type": "address" },
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "token", "type": "address" },
      { "indexed": false, "name": "targetAmount", "type": "uint256" },
      { "indexed": false, "name": "settlementDate", "type": "uint64" },
      { "indexed": false, "name": "createdAt", "type": "uint64" },
      { "indexed": false, "name": "termsHash", "type": "bytes32" },
      { "indexed": false, "name": "arbitrationMode", "type": "uint8" },
      { "indexed": false, "name": "arbitrator1", "type": "address" },
      { "indexed": false, "name": "arbitrator2", "type": "address" },
      { "indexed": false, "name": "arbitrator3", "type": "address" }
    ],
    "name": "EscrowCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "oldTreasury", "type": "address" },
      { "indexed": true, "name": "newTreasury", "type": "address" }
    ],
    "name": "TreasuryUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "token", "type": "address" },
      { "indexed": false, "name": "allowed", "type": "bool" }
    ],
    "name": "TokenAllowlistUpdated",
    "type": "event"
  },
  // Functions
  {
    "inputs": [
      {
        "components": [
          { "name": "payout", "type": "address" },
          { "name": "funder", "type": "address" },
          { "name": "token", "type": "address" },
          { "name": "targetAmount", "type": "uint256" },
          { "name": "settlementDate", "type": "uint64" },
          { "name": "termsHash", "type": "bytes32" },
          { "name": "arbitrator1", "type": "address" },
          { "name": "arbitrator2", "type": "address" },
          { "name": "arbitrator3", "type": "address" }
        ],
        "name": "p",
        "type": "tuple"
      }
    ],
    "name": "createEscrow",
    "outputs": [{ "name": "escrow", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "_payout", "type": "address" },
      { "name": "_funder", "type": "address" },
      { "name": "_token", "type": "address" },
      { "name": "_targetAmount", "type": "uint256" },
      { "name": "_settlementDate", "type": "uint64" },
      { "name": "_termsHash", "type": "bytes32" },
      { "name": "_arbitrator1", "type": "address" },
      { "name": "_arbitrator2", "type": "address" },
      { "name": "_arbitrator3", "type": "address" }
    ],
    "name": "createEscrowSimple",
    "outputs": [{ "name": "escrow", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // View functions
  {
    "inputs": [],
    "name": "treasury",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "name": "", "type": "address" }],
    "name": "isAllowedToken",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const EscrowABI = [
  // ───────── Events ─────────
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "seller", "type": "address" },
      { "indexed": false, "name": "balance", "type": "uint256" },
      { "indexed": false, "name": "at", "type": "uint64" }
    ],
    "name": "SellerConfirmed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "seller", "type": "address" },
      { "indexed": false, "name": "principal", "type": "uint256" },
      { "indexed": false, "name": "fee", "type": "uint256" },
      { "indexed": false, "name": "excessSwept", "type": "uint256" },
      { "indexed": true, "name": "treasury", "type": "address" }
    ],
    "name": "Settled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "buyerRefundWallet", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" },
      { "indexed": false, "name": "at", "type": "uint64" }
    ],
    "name": "Refunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "buyerRefundWallet", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ],
    "name": "UnderfundedRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "buyerRefundWallet", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" },
      { "indexed": false, "name": "at", "type": "uint64" }
    ],
    "name": "LatePaymentTokenRecovered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "name": "approver", "type": "address" }],
    "name": "MutualSettleApproved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "name": "approver", "type": "address" }],
    "name": "MutualRefundApproved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "outcome", "type": "uint8" },
      { "indexed": false, "name": "overrideWindowEnd", "type": "uint64" }
    ],
    "name": "MutualResolutionPending",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": false, "name": "outcome", "type": "uint8" }],
    "name": "MutualResolutionFinalized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "arbitrator", "type": "address" },
      { "indexed": false, "name": "outcome", "type": "uint8" }
    ],
    "name": "ArbitratorVoted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "treasury", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ],
    "name": "SweptExcess",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "erc20", "type": "address" },
      { "indexed": true, "name": "treasury", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ],
    "name": "SweptStrayToken",
    "type": "event"
  },

  // ───────── Write functions ─────────
  { "inputs": [], "name": "sellerConfirm", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "refundUnderfunded", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "settle", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "approveMutualSettle", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "approveMutualRefund", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "finalizeMutualResolution", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "arbSettle", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "arbRefund", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "arbVoteSettle", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "arbVoteRefund", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "sweepExcess", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "recoverLatePaymentToken", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  {
    "inputs": [
      { "name": "erc20", "type": "address" },
      { "name": "amt", "type": "uint256" }
    ],
    "name": "sweepStrayToken",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // ───────── View functions: immutable config ─────────
  { "inputs": [], "name": "factory", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "treasury", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "token", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "sellerWallet", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "buyerRefundWallet", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "targetAmount", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "settlementDate", "outputs": [{ "name": "", "type": "uint64" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "createdAt", "outputs": [{ "name": "", "type": "uint64" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "termsHash", "outputs": [{ "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "arbitrator1", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "arbitrator2", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "arbitrator3", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "arbitrationMode", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },

  // ───────── View functions: mutable state ─────────
  { "inputs": [], "name": "status", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "statusCode", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "pendingOutcome", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "overrideWindowEnd", "outputs": [{ "name": "", "type": "uint64" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "settleVotes", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "refundVotes", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "mutualSettleApprovedByBuyer", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "mutualSettleApprovedBySeller", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "mutualRefundApprovedByBuyer", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "mutualRefundApprovedBySeller", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "name": "", "type": "address" }], "name": "arbitratorVote", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },

  // ───────── Derived / helper views ─────────
  { "inputs": [], "name": "isFunded", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "balance", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "name": "amount", "type": "uint256" }], "name": "calculateFee", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "pure", "type": "function" },
  { "inputs": [], "name": "isTerminal", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "isActivatable", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "isRefundableUnderfunded", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "isSettleable", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "isVotable", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "isInOverrideWindow", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "isFinalizable", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" }
] as const;

export const ERC20ABI = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "from", "type": "address" },
      { "indexed": true, "name": "to", "type": "address" },
      { "indexed": false, "name": "value", "type": "uint256" }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "inputs": [{ "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// PaymentRouter ABI (legacy "Accept Stablecoins" feature; unchanged)
export const PaymentRouterABI = [
  {
    "inputs": [
      { "name": "id", "type": "bytes32" },
      { "name": "token", "type": "address" },
      { "name": "recipient", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "createLink",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "name": "id", "type": "bytes32" }],
    "name": "pay",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "name": "id", "type": "bytes32" }],
    "name": "linkExists",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "name": "", "type": "bytes32" }],
    "name": "links",
    "outputs": [
      { "name": "token", "type": "address" },
      { "name": "recipient", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "bytes32" },
      { "indexed": true, "name": "token", "type": "address" },
      { "indexed": true, "name": "recipient", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ],
    "name": "LinkCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "id", "type": "bytes32" },
      { "indexed": true, "name": "payer", "type": "address" },
      { "indexed": true, "name": "recipient", "type": "address" },
      { "indexed": false, "name": "token", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ],
    "name": "PaymentCompleted",
    "type": "event"
  }
] as const;

// Aliases (P2P V2 contracts)
export const EscrowV2ABI = EscrowABI;
export const EscrowFactoryV2ABI = EscrowFactoryABI;
