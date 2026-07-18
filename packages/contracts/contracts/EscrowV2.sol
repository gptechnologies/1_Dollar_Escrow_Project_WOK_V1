// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/IERC20.sol";
import "./utils/SafeERC20.sol";
import "./utils/ReentrancyGuard.sol";

/**
 * @title EscrowV2
 * @notice Non-custodial, push-funded P2P escrow between two immutable parties
 *         (seller / buyer-refund wallet) on Arbitrum, with optional 0/1/3
 *         arbitration and a mutual-resolution path that arbitrators may override
 *         within a bounded window.
 *
 * Design principles:
 *   - Push funding: anyone may send the escrow token to this address. Funding
 *     status is derived from the on-chain balance (balance >= targetAmount).
 *   - Funds only ever move to three destinations:
 *       settle  -> sellerWallet (minus platform fee)
 *       refund  -> buyerRefundWallet
 *       sweep   -> treasury (fee + invalid funds)
 *   - No oracle dependency. All transitions are party-initiated or permissionless.
 *   - Terms are immutable after creation (no deadline extension, no arbitrator swap).
 *   - First valid resolution wins; terminal states are final.
 *
 * Lifecycle:
 *   CREATED ──sellerConfirm()──► ACTIVE
 *      │                         │
 *      ├──── settle/arb/mutual ──┴──► SETTLED | REFUNDED
 *      └──── refundUnderfunded() ───► REFUNDED
 */
contract EscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---- Enums ---------------------------------------------------------------------------------
    enum Status {
        CREATED,                    // 0 - awaiting optional seller confirmation
        ACTIVE,                     // 1 - seller confirmed full funding on-chain
        PENDING_MUTUAL_RESOLUTION,  // 2 - buyer+seller agreed, arb override window open
        SETTLED,                    // 3 - terminal: seller paid
        REFUNDED                    // 4 - terminal: buyer refunded
    }

    enum Outcome {
        None,
        Settle,
        Refund
    }

    // ---- Constants -----------------------------------------------------------------------------
    uint256 private constant ONE_DOLLAR = 1e6;      // $1 in 6 decimals
    uint256 private constant MIN_TARGET_AMOUNT = 1e6; // $1 in 6 decimals
    uint256 private constant MIN_FEE = 1e4;         // $0.01 in 6 decimals
    uint256 private constant FEE_THRESHOLD = 100e6; // $100 in 6 decimals
    uint64  private constant OVERRIDE_WINDOW = 30 days;

    // ---- Immutable configuration ---------------------------------------------------------------
    address public immutable factory;
    address public immutable treasury;          // receives platform fees and stray-token recovery
    IERC20  public immutable token;             // USDC or USDT (6 decimals)

    address public immutable sellerWallet;      // receives funds on settle (IMMUTABLE)
    address public immutable buyerRefundWallet; // receives funds on refund (IMMUTABLE)

    uint256 public immutable targetAmount;      // amount that must be funded for settlement
    uint64  public immutable settlementDate;    // resolution / underfunded-refund time
    uint64  public immutable createdAt;
    bytes32 public immutable termsHash;         // hash/reference of off-chain terms

    address public immutable arbitrator1;
    address public immutable arbitrator2;
    address public immutable arbitrator3;
    uint8   public immutable arbitrationMode;   // 0, 1, or 3 (never 2)

    // ---- Mutable state -------------------------------------------------------------------------
    Status public status;

    // Mutual resolution approvals (action-specific; a generic approval is never reusable)
    bool public mutualSettleApprovedByBuyer;
    bool public mutualSettleApprovedBySeller;
    bool public mutualRefundApprovedByBuyer;
    bool public mutualRefundApprovedBySeller;

    Outcome public pendingOutcome;              // outcome agreed by buyer+seller (arb escrows)
    uint64  public overrideWindowEnd;           // arb override deadline for pending resolution

    // Arbitrator voting
    mapping(address => Outcome) public arbitratorVote;
    uint8 public settleVotes;
    uint8 public refundVotes;

    // ---- Events --------------------------------------------------------------------------------
    event SellerConfirmed(address indexed seller, uint256 balance, uint64 at);
    event Settled(address indexed seller, uint256 principal, uint256 fee, uint256 excessSwept, address indexed treasury);
    event Refunded(address indexed buyerRefundWallet, uint256 amount);
    event UnderfundedRefunded(address indexed buyerRefundWallet, uint256 amount, uint64 at);

    event MutualSettleApproved(address indexed approver);
    event MutualRefundApproved(address indexed approver);
    event MutualResolutionPending(Outcome outcome, uint64 overrideWindowEnd);
    event MutualResolutionFinalized(Outcome outcome);

    event ArbitratorVoted(address indexed arbitrator, Outcome outcome);

    event SweptExcess(address indexed treasury, uint256 amount);
    event SweptStrayToken(address indexed erc20, address indexed treasury, uint256 amount);
    event LatePaymentTokenRecovered(address indexed buyerRefundWallet, uint256 amount, uint64 at);

    // ---- Modifiers -----------------------------------------------------------------------------
    modifier onlySeller() {
        require(msg.sender == sellerWallet, "Escrow: not seller");
        _;
    }

    modifier onlyParty() {
        require(msg.sender == buyerRefundWallet || msg.sender == sellerWallet, "Escrow: not a party");
        _;
    }

    modifier onlyArbitrator() {
        require(
            arbitrationMode > 0 &&
            (msg.sender == arbitrator1 || msg.sender == arbitrator2 || msg.sender == arbitrator3),
            "Escrow: not arbitrator"
        );
        _;
    }

    // ---- Constructor ---------------------------------------------------------------------------
    constructor(
        address _factory,
        address _treasury,
        address _token,
        address _sellerWallet,
        address _buyerRefundWallet,
        uint256 _targetAmount,
        uint64  _settlementDate,
        bytes32 _termsHash,
        address _arbitrator1,
        address _arbitrator2,
        address _arbitrator3
    ) {
        require(_treasury != address(0), "Escrow: zero treasury");
        require(_token != address(0), "Escrow: zero token");
        require(_sellerWallet != address(0), "Escrow: zero seller");
        require(_buyerRefundWallet != address(0), "Escrow: zero buyer");
        require(_sellerWallet != _buyerRefundWallet, "Escrow: seller == buyer");
        require(_targetAmount >= MIN_TARGET_AMOUNT, "Escrow: target below minimum");
        require(_settlementDate > block.timestamp, "Escrow: settlement in past");

        // Enforce 0/1/3 arbitrator rule
        bool hasArb1 = _arbitrator1 != address(0);
        bool hasArb2 = _arbitrator2 != address(0);
        bool hasArb3 = _arbitrator3 != address(0);

        if (hasArb2 || hasArb3) {
            require(hasArb1 && hasArb2 && hasArb3, "Escrow: must have 0, 1, or 3 arbitrators");
        }
        if (hasArb1) {
            require(_arbitrator1 != _sellerWallet && _arbitrator1 != _buyerRefundWallet, "Escrow: arb1 is party");
        }
        if (hasArb2) {
            require(_arbitrator2 != _sellerWallet && _arbitrator2 != _buyerRefundWallet, "Escrow: arb2 is party");
            require(_arbitrator2 != _arbitrator1, "Escrow: duplicate arbitrator");
        }
        if (hasArb3) {
            require(_arbitrator3 != _sellerWallet && _arbitrator3 != _buyerRefundWallet, "Escrow: arb3 is party");
            require(_arbitrator3 != _arbitrator1 && _arbitrator3 != _arbitrator2, "Escrow: duplicate arbitrator");
        }

        factory = _factory;
        treasury = _treasury;
        token = IERC20(_token);
        sellerWallet = _sellerWallet;
        buyerRefundWallet = _buyerRefundWallet;
        targetAmount = _targetAmount;
        settlementDate = _settlementDate;
        termsHash = _termsHash;
        createdAt = uint64(block.timestamp);

        arbitrator1 = _arbitrator1;
        arbitrator2 = _arbitrator2;
        arbitrator3 = _arbitrator3;
        arbitrationMode = hasArb3 ? 3 : (hasArb1 ? 1 : 0);

        status = Status.CREATED;
    }

    // ---- Derived funding status ----------------------------------------------------------------

    /// @notice True when the escrow holds at least the target amount.
    function isFunded() public view returns (bool) {
        return token.balanceOf(address(this)) >= targetAmount;
    }

    /// @notice Current token balance held by the escrow.
    function balance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ---- Fee calculation -----------------------------------------------------------------------

    /**
     * @notice Platform fee with capped structure.
     *         amount > $100  -> $1 (capped); amount <= $100 -> 1%; minimum $0.01.
     */
    function calculateFee(uint256 amount) public pure returns (uint256) {
        uint256 fee = amount > FEE_THRESHOLD ? ONE_DOLLAR : amount / 100;
        return fee < MIN_FEE ? MIN_FEE : fee;
    }

    // ---- Seller confirmation / activation ------------------------------------------------------

    /**
     * @notice Seller confirms acceptance. Only succeeds if the escrow is already
     *         fully funded and still in CREATED state. Confirmation is optional:
     *         fully funded CREATED escrows can still resolve after settlementDate.
     */
    function sellerConfirm() external nonReentrant onlySeller {
        require(status == Status.CREATED, "Escrow: not in created state");
        require(isFunded(), "Escrow: not funded");

        status = Status.ACTIVE;
        emit SellerConfirmed(msg.sender, token.balanceOf(address(this)), uint64(block.timestamp));
    }

    // ---- Underfunded refund --------------------------------------------------------------------

    /**
     * @notice Refund an underfunded, unconfirmed escrow after settlementDate.
     *         Only CREATED escrows can use this path. ACTIVE underfunding is exceptional.
     */
    function refundUnderfunded() external nonReentrant {
        require(status == Status.CREATED, "Escrow: not in created state");
        require(block.timestamp >= settlementDate, "Escrow: settlement date not reached");
        require(!isFunded(), "Escrow: funded");

        status = Status.REFUNDED;

        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) {
            token.safeTransfer(buyerRefundWallet, bal);
        }
        emit UnderfundedRefunded(buyerRefundWallet, bal, uint64(block.timestamp));
    }

    // ---- 0-arbitrator settlement ---------------------------------------------------------------

    /**
     * @notice Permissionless settle to seller after settlementDate (0-arb escrows only).
     */
    function settle() external nonReentrant {
        require(_isOpenResolutionStatus(), "Escrow: not resolvable");
        require(arbitrationMode == 0, "Escrow: has arbitrators");
        require(block.timestamp >= settlementDate, "Escrow: settlement date not reached");
        require(isFunded(), "Escrow: not funded");

        status = Status.SETTLED;
        _paySettle();
    }

    // ---- Mutual resolution (buyer + seller) ----------------------------------------------------

    /**
     * @notice Approve a mutual settle. When both parties approve: 0-arb executes
     *         immediately; arbitrated escrows enter PENDING_MUTUAL_RESOLUTION with a
     *         30-day arbitrator override window.
     */
    function approveMutualSettle() external nonReentrant onlyParty {
        require(_isOpenResolutionStatus(), "Escrow: not resolvable");

        if (msg.sender == buyerRefundWallet) {
            require(!mutualSettleApprovedByBuyer, "Escrow: already approved");
            mutualSettleApprovedByBuyer = true;
        } else {
            require(!mutualSettleApprovedBySeller, "Escrow: already approved");
            mutualSettleApprovedBySeller = true;
        }
        emit MutualSettleApproved(msg.sender);

        if (mutualSettleApprovedByBuyer && mutualSettleApprovedBySeller) {
            _onMutualAgreement(Outcome.Settle);
        }
    }

    /**
     * @notice Approve a mutual refund. When both parties approve: 0-arb executes
     *         immediately; arbitrated escrows enter PENDING_MUTUAL_RESOLUTION.
     */
    function approveMutualRefund() external nonReentrant onlyParty {
        require(_isOpenResolutionStatus(), "Escrow: not resolvable");

        if (msg.sender == buyerRefundWallet) {
            require(!mutualRefundApprovedByBuyer, "Escrow: already approved");
            mutualRefundApprovedByBuyer = true;
        } else {
            require(!mutualRefundApprovedBySeller, "Escrow: already approved");
            mutualRefundApprovedBySeller = true;
        }
        emit MutualRefundApproved(msg.sender);

        if (mutualRefundApprovedByBuyer && mutualRefundApprovedBySeller) {
            _onMutualAgreement(Outcome.Refund);
        }
    }

    function _onMutualAgreement(Outcome outcome) internal {
        if (outcome == Outcome.Settle) {
            require(isFunded(), "Escrow: not funded");
        }

        if (arbitrationMode == 0) {
            if (outcome == Outcome.Settle) {
                status = Status.SETTLED;
                _paySettle();
            } else {
                status = Status.REFUNDED;
                _payRefund();
            }
        } else {
            status = Status.PENDING_MUTUAL_RESOLUTION;
            pendingOutcome = outcome;
            overrideWindowEnd = uint64(block.timestamp) + OVERRIDE_WINDOW;
            emit MutualResolutionPending(outcome, overrideWindowEnd);
        }
    }

    /**
     * @notice Finalize a pending mutual resolution after the override window expires.
     *         Permissionless.
     */
    function finalizeMutualResolution() external nonReentrant {
        require(status == Status.PENDING_MUTUAL_RESOLUTION, "Escrow: no pending resolution");
        require(block.timestamp > overrideWindowEnd, "Escrow: override window open");

        Outcome outcome = pendingOutcome;
        emit MutualResolutionFinalized(outcome);

        if (outcome == Outcome.Settle) {
            require(isFunded(), "Escrow: not funded");
            status = Status.SETTLED;
            _paySettle();
        } else {
            status = Status.REFUNDED;
            _payRefund();
        }
    }

    // ---- Arbitrator resolution -----------------------------------------------------------------

    /// @notice Arbitrator votes to settle (1-arb naming).
    function arbSettle() external nonReentrant onlyArbitrator {
        _castArbVote(Outcome.Settle);
    }

    /// @notice Arbitrator votes to refund (1-arb naming).
    function arbRefund() external nonReentrant onlyArbitrator {
        _castArbVote(Outcome.Refund);
    }

    /// @notice Arbitrator votes to settle (3-arb naming).
    function arbVoteSettle() external nonReentrant onlyArbitrator {
        _castArbVote(Outcome.Settle);
    }

    /// @notice Arbitrator votes to refund (3-arb naming).
    function arbVoteRefund() external nonReentrant onlyArbitrator {
        _castArbVote(Outcome.Refund);
    }

    /**
     * @dev Records an arbitrator vote. Valid while CREATED/ACTIVE after settlementDate or while
     *      PENDING_MUTUAL_RESOLUTION within the override window (override). Reaching the
     *      threshold (1 for single-arb, 2 for three-arb) executes that outcome.
     */
    function _castArbVote(Outcome outcome) internal {
        require(
            (_isOpenResolutionStatus() && block.timestamp >= settlementDate && isFunded()) ||
            (status == Status.PENDING_MUTUAL_RESOLUTION && block.timestamp <= overrideWindowEnd),
            "Escrow: not votable"
        );
        require(arbitratorVote[msg.sender] == Outcome.None, "Escrow: already voted");

        arbitratorVote[msg.sender] = outcome;
        if (outcome == Outcome.Settle) {
            settleVotes += 1;
        } else {
            refundVotes += 1;
        }
        emit ArbitratorVoted(msg.sender, outcome);

        uint8 threshold = arbitrationMode == 1 ? 1 : 2;

        if (settleVotes >= threshold) {
            status = Status.SETTLED;
            _paySettle();
        } else if (refundVotes >= threshold) {
            status = Status.REFUNDED;
            _payRefund();
        }
    }

    // ---- Payout helpers ------------------------------------------------------------------------

    function _paySettle() internal {
        uint256 bal = token.balanceOf(address(this));
        require(bal >= targetAmount, "Escrow: not funded");
        uint256 fee = calculateFee(targetAmount);
        uint256 sellerPrincipal = targetAmount - fee;
        uint256 excess = bal > targetAmount ? bal - targetAmount : 0;

        token.safeTransfer(sellerWallet, sellerPrincipal);
        uint256 toTreasury = fee + excess;
        if (toTreasury > 0) {
            token.safeTransfer(treasury, toTreasury);
        }
        emit Settled(sellerWallet, sellerPrincipal, fee, excess, treasury);
    }

    function _payRefund() internal {
        uint256 bal = token.balanceOf(address(this));

        if (bal > 0) {
            token.safeTransfer(buyerRefundWallet, bal);
        }
        emit Refunded(buyerRefundWallet, bal);
    }

    // ---- Sweeps --------------------------------------------------------------------------------

    /**
     * @notice Sweep excess escrow-token funds to treasury before terminal resolution.
     *         Terminal accepted-token recovery goes to buyerRefundWallet via
     *         recoverLatePaymentToken().
     */
    function sweepExcess() external nonReentrant {
        require(!_isTerminal(), "Escrow: terminal");
        uint256 bal = token.balanceOf(address(this));
        require(bal > targetAmount, "Escrow: no excess");
        uint256 amount = bal - targetAmount;

        token.safeTransfer(treasury, amount);
        emit SweptExcess(treasury, amount);
    }

    /**
     * @notice Recover accepted payment tokens accidentally sent after terminal resolution.
     */
    function recoverLatePaymentToken() external nonReentrant {
        require(_isTerminal(), "Escrow: not terminal");

        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "Escrow: no payment token balance");

        token.safeTransfer(buyerRefundWallet, bal);
        emit LatePaymentTokenRecovered(buyerRefundWallet, bal, uint64(block.timestamp));
    }

    /**
     * @notice Sweep a non-escrow (invalid) token to treasury. Permissionless and safe:
     *         funds can only ever go to the treasury.
     */
    function sweepStrayToken(IERC20 erc20, uint256 amt) external nonReentrant {
        require(address(erc20) != address(token), "Escrow: use sweepExcess");
        require(amt > 0, "Escrow: zero amount");
        erc20.safeTransfer(treasury, amt);
        emit SweptStrayToken(address(erc20), treasury, amt);
    }

    // ---- View helpers --------------------------------------------------------------------------

    function _isTerminal() internal view returns (bool) {
        return status == Status.SETTLED || status == Status.REFUNDED;
    }

    function _isOpenResolutionStatus() internal view returns (bool) {
        return status == Status.CREATED || status == Status.ACTIVE;
    }

    /// @notice Numeric status code (mirrors the Status enum) for off-chain consumers.
    function statusCode() external view returns (uint8) {
        return uint8(status);
    }

    function isTerminal() external view returns (bool) {
        return _isTerminal();
    }

    /// @notice Seller can confirm now (funded and still created).
    function isActivatable() external view returns (bool) {
        return status == Status.CREATED && isFunded();
    }

    /// @notice refundUnderfunded() can be called now.
    function isRefundableUnderfunded() external view returns (bool) {
        return status == Status.CREATED && block.timestamp >= settlementDate && !isFunded();
    }

    /// @notice settle() can be called now (0-arb only).
    function isSettleable() external view returns (bool) {
        return _isOpenResolutionStatus() && arbitrationMode == 0 && block.timestamp >= settlementDate && isFunded();
    }

    /// @notice An arbitrator may currently cast a vote.
    function isVotable() external view returns (bool) {
        return arbitrationMode > 0 && (
            (_isOpenResolutionStatus() && block.timestamp >= settlementDate && isFunded()) ||
            (status == Status.PENDING_MUTUAL_RESOLUTION && block.timestamp <= overrideWindowEnd)
        );
    }

    /// @notice Arbitrator override window for a pending mutual resolution is open.
    function isInOverrideWindow() external view returns (bool) {
        return status == Status.PENDING_MUTUAL_RESOLUTION && block.timestamp <= overrideWindowEnd;
    }

    /// @notice A pending mutual resolution can be finalized now.
    function isFinalizable() external view returns (bool) {
        return status == Status.PENDING_MUTUAL_RESOLUTION && block.timestamp > overrideWindowEnd;
    }
}
