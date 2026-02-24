/**
 * Contract ABIs for EscrowFactory and Escrow (Hybrid Confirmation Model)
 * 
 * Key changes from V1:
 * - Seller can self-confirm via confirm() (no bond required)
 * - Oracle can confirm via confirmByOracle(txHash) when $1 bond is present
 * - Funding is derived from on-chain balance (isFunded()) not recorded
 * - Arbitrators can only act during [deadline, arbWindowEnd]
 * - sweepToTreasuryAfterArbWindow() for unresolved arb escrows
 */

// Factory ABI - supports USDC/USDT, now includes arbWindowEnd in event
export const EscrowFactoryABI = [
  // Events
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "escrow", "type": "address" },
      { "indexed": true, "name": "funder", "type": "address" },
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "token", "type": "address" },
      { "indexed": false, "name": "targetAmount", "type": "uint256" },
      { "indexed": false, "name": "bondCap", "type": "uint256" },
      { "indexed": false, "name": "deadline", "type": "uint64" },
      { "indexed": false, "name": "createdAt", "type": "uint64" },
      { "indexed": false, "name": "confirmDeadline", "type": "uint64" },
      { "indexed": false, "name": "arbWindowEnd", "type": "uint64" },
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
      { "indexed": true, "name": "oldOracle", "type": "address" },
      { "indexed": true, "name": "newOracle", "type": "address" }
    ],
    "name": "OracleUpdated",
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
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "oldAmount", "type": "uint256" },
      { "indexed": false, "name": "newAmount", "type": "uint256" }
    ],
    "name": "DefaultBondCapUpdated",
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
          { "name": "deadline", "type": "uint64" },
          { "name": "bondCap", "type": "uint256" },
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
      { "name": "_deadline", "type": "uint64" },
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
    "name": "oracle",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "treasury",
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
  },
  {
    "inputs": [],
    "name": "defaultBondCap",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  // Legacy compatibility
  {
    "inputs": [],
    "name": "defaultConfirmationAmount",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// Escrow ABI - Hybrid Confirmation + Derived Funding + Arb Window
export const EscrowABI = [
  // Events - New hybrid confirmation events
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "seller", "type": "address" }
    ],
    "name": "ConfirmedBySeller",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "txHash", "type": "bytes32" },
      { "indexed": false, "name": "bondRecognized", "type": "uint256" }
    ],
    "name": "ConfirmedByOracle",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "principal", "type": "uint256" },
      { "indexed": false, "name": "fee", "type": "uint256" },
      { "indexed": false, "name": "bondReturned", "type": "uint256" },
      { "indexed": false, "name": "excessSwept", "type": "uint256" },
      { "indexed": true, "name": "treasury", "type": "address" }
    ],
    "name": "FinalizedPaid",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "arbitrator", "type": "address" },
      { "indexed": false, "name": "decision", "type": "uint8" }
    ],
    "name": "ArbitratorVoted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "principal", "type": "uint256" },
      { "indexed": false, "name": "fee", "type": "uint256" },
      { "indexed": false, "name": "bondReturned", "type": "uint256" },
      { "indexed": false, "name": "excessSwept", "type": "uint256" },
      { "indexed": true, "name": "treasury", "type": "address" }
    ],
    "name": "ResolvedReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "funder", "type": "address" },
      { "indexed": false, "name": "amountRefunded", "type": "uint256" },
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "bondReturned", "type": "uint256" }
    ],
    "name": "ResolvedRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "expiredAt", "type": "uint64" }
    ],
    "name": "ExpiredNotConfirmed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "expiredAt", "type": "uint64" },
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "bondReturned", "type": "uint256" }
    ],
    "name": "ExpiredNotFunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "treasury", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ],
    "name": "SweptLateFunds",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "treasury", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ],
    "name": "SweptAfterArbWindow",
    "type": "event"
  },
  
  // Mutual action events
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "approver", "type": "address" }
    ],
    "name": "MutualReleaseApproved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "principal", "type": "uint256" },
      { "indexed": false, "name": "fee", "type": "uint256" },
      { "indexed": false, "name": "bondReturned", "type": "uint256" }
    ],
    "name": "MutualReleaseExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "approver", "type": "address" }
    ],
    "name": "MutualRefundApproved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "funder", "type": "address" },
      { "indexed": false, "name": "amountRefunded", "type": "uint256" },
      { "indexed": true, "name": "payout", "type": "address" },
      { "indexed": false, "name": "bondReturned", "type": "uint256" }
    ],
    "name": "MutualRefundExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "approver", "type": "address" },
      { "indexed": false, "name": "newDeadline", "type": "uint64" }
    ],
    "name": "DeadlineExtensionApproved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "oldDeadline", "type": "uint64" },
      { "indexed": false, "name": "newDeadline", "type": "uint64" },
      { "indexed": false, "name": "newArbWindowEnd", "type": "uint64" }
    ],
    "name": "DeadlineExtended",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "approver", "type": "address" },
      { "indexed": false, "name": "arb1", "type": "address" },
      { "indexed": false, "name": "arb2", "type": "address" },
      { "indexed": false, "name": "arb3", "type": "address" }
    ],
    "name": "ArbitratorSwapApproved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "oldArb1", "type": "address" },
      { "indexed": false, "name": "oldArb2", "type": "address" },
      { "indexed": false, "name": "oldArb3", "type": "address" },
      { "indexed": false, "name": "newArb1", "type": "address" },
      { "indexed": false, "name": "newArb2", "type": "address" },
      { "indexed": false, "name": "newArb3", "type": "address" },
      { "indexed": false, "name": "newDeadline", "type": "uint64" },
      { "indexed": false, "name": "newArbWindowEnd", "type": "uint64" }
    ],
    "name": "ArbitratorSwapExecuted",
    "type": "event"
  },
  
  // Seller self-confirm (no bond required)
  {
    "inputs": [],
    "name": "confirm",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Oracle bond-based confirm (requires $1 bond present)
  {
    "inputs": [
      { "name": "txHash", "type": "bytes32" }
    ],
    "name": "confirmByOracle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Arbitrator functions
  {
    "inputs": [],
    "name": "arbitratorRelease",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "arbitratorRefund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Permissionless functions
  {
    "inputs": [],
    "name": "finalizeAfterDeadline",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "expireIfNotConfirmed",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "expireIfNotFunded",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "sweepToTreasury",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "sweepToTreasuryAfterArbWindow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Mutual action functions (buyer + seller)
  {
    "inputs": [],
    "name": "approveMutualRelease",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "approveMutualRefund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "newDeadline", "type": "uint64" }
    ],
    "name": "approveDeadlineExtension",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "newArb1", "type": "address" },
      { "name": "newArb2", "type": "address" },
      { "name": "newArb3", "type": "address" }
    ],
    "name": "approveArbitratorSwap",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // View functions - immutable
  {
    "inputs": [],
    "name": "payout",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "funder",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "targetAmount",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "bondCap",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "deadline",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "createdAt",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confirmDeadline",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "arbWindowEnd",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "treasury",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "token",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "arbitrator1",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "arbitrator2",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "arbitrator3",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "arbitratorCount",
    "outputs": [{ "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // View functions - dynamic state
  {
    "inputs": [],
    "name": "confirmed",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "resolved",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "expired",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "bondPresent",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "deadlocked",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "originalDeadline",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Mutual action state view functions
  {
    "inputs": [],
    "name": "mutualReleaseApprovedByFunder",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "mutualReleaseApprovedByPayout",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "mutualRefundApprovedByFunder",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "mutualRefundApprovedByPayout",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingExtensionDeadline",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "extensionApprovedByFunder",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "extensionApprovedByPayout",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingSwapArb1",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingSwapArb2",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingSwapArb3",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "swapApprovedByFunder",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "swapApprovedByPayout",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalExtensionUsed",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "extensionRemaining",
    "outputs": [{ "name": "", "type": "uint64" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Derived funding view functions
  {
    "inputs": [],
    "name": "isFunded",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "fundedAmount",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "bondAvailable",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "name": "amount", "type": "uint256" }],
    "name": "calculateFee",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "pure",
    "type": "function"
  },
  
  // Helper view functions
  {
    "inputs": [],
    "name": "isPayable",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isExpirableNoConfirm",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isExpirableNoFund",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isTerminal",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isInArbWindow",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isSweepableAfterArbWindow",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Legacy compatibility
  {
    "inputs": [],
    "name": "phase",
    "outputs": [{ "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confirmationRecorded",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "fundingRecorded",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "fundedRecorded",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confirmationAmount",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
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

// PaymentRouter ABI
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

// Legacy V2 ABIs (for backward compatibility with existing escrows)
export const EscrowV2ABI = EscrowABI;
export const EscrowFactoryV2ABI = EscrowFactoryABI;
