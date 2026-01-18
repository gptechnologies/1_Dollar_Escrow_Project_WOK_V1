// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/IERC20.sol";
import "./utils/SafeERC20.sol";
import "./utils/ReentrancyGuard.sol";

/**
 * @title Escrow
 * @notice Deterministic USDC/USDT escrow with immutable parties, hybrid confirmation,
 *         derived funding status, and optional arbitration with a bounded window.
 *
 * Lifecycle (hybrid model):
 *   - Seller confirms via confirm() (no bond required) OR oracle confirms via confirmByOracle()
 *     (requires $1 bond already present in escrow). Both must happen within 24h of creation.
 *   - Funding status is derived from on-chain balance: isFunded() = balance >= targetAmount
 *   - If no arbitrators: seller gets paid at deadline via finalizeAfterDeadline()
 *   - If arbitrators: normal settlement disabled; arbs can release/refund only during
 *     [deadline, arbWindowEnd]. After arbWindowEnd, anyone can sweep to treasury.
 *
 * Key guarantees:
 *   - Funder (buyer) and payout (seller) are immutable (bound at creation)
 *   - No oracle dependency for liveness: all state transitions are permissionless or party-initiated
 *   - Late/stray funds get swept to treasury
 */
contract Escrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---- Enums ---------------------------------------------------------------------------------
    enum Decision {
        None,
        Release,
        Refund
    }

    // ---- Constants -----------------------------------------------------------------------------
    uint256 private constant ONE_DOLLAR = 1e6;      // $1 in 6 decimals
    uint256 private constant MIN_FEE = 1e4;         // $0.01 in 6 decimals
    uint256 private constant FEE_THRESHOLD = 100e6; // $100 in 6 decimals
    uint64  private constant ARB_WINDOW_DURATION = 7 days;
    uint64  private constant MAX_EXTENSION = 14 days; // max total deadline extension

    // ---- Immutable configuration ---------------------------------------------------------------
    address public immutable factory;
    address public immutable oracle;                // trusted oracle for bond-based confirmation
    address public immutable treasury;              // receives platform fees and stray funds
    IERC20  public immutable token;                 // USDC or USDT (6 decimals)
    
    address public immutable payout;                // seller - receives funds on success (IMMUTABLE)
    address public immutable funder;                // buyer - must fund the escrow (IMMUTABLE)
    
    uint256 public immutable bondCap;               // max bond amount ($1 = 1e6), used for oracle confirm
    uint256 public immutable targetAmount;          // amount buyer must fund
    uint64  public immutable createdAt;             // escrow creation time
    uint64  public immutable confirmDeadline;       // must confirm within 24h of creation
    uint64  public immutable originalDeadline;      // original deadline (for extension cap calculation)
    
    // ---- Mutable configuration (for mutual actions) ---------------------------------------------
    uint64  public deadline;                        // payout time (unix timestamp) - mutable via extension
    uint64  public arbWindowEnd;                    // arbitration window ends: deadline + 7 days
    address public arbitrator1;                     // optional arbitrator - mutable via swap
    address public arbitrator2;                     // optional arbitrator - mutable via swap
    address public arbitrator3;                     // deadlock arbitrator (only for 3-arb setup)
    uint8   public arbitratorCount;                 // 0, 1, or 3 (never 2)

    // ---- Dynamic state -------------------------------------------------------------------------
    bool public confirmed;                          // seller confirmed (via self-confirm or oracle)
    bool public resolved;                           // escrow has been resolved (paid/refunded/swept)
    bool public expired;                            // escrow expired without resolution
    bool public bondPresent;                        // true if oracle confirmed with bond
    
    mapping(address => Decision) public arbitratorVote;
    bool public deadlocked;                         // true if arb1 and arb2 voted differently (3-arb mode)
    
    // ---- Mutual action approvals ---------------------------------------------------------------
    bool public mutualReleaseApprovedByFunder;
    bool public mutualReleaseApprovedByPayout;
    bool public mutualRefundApprovedByFunder;
    bool public mutualRefundApprovedByPayout;
    
    // Deadline extension: both must approve the same newDeadline
    uint64 public pendingExtensionDeadline;         // proposed new deadline
    bool public extensionApprovedByFunder;
    bool public extensionApprovedByPayout;
    
    // Arbitrator swap: both must approve the same new set
    address public pendingSwapArb1;
    address public pendingSwapArb2;
    address public pendingSwapArb3;
    bool public swapApprovedByFunder;
    bool public swapApprovedByPayout;

    // ---- Events --------------------------------------------------------------------------------
    event ConfirmedBySeller(address indexed seller);
    event ConfirmedByOracle(bytes32 indexed txHash, uint256 bondRecognized);
    
    event FinalizedPaid(
        address indexed payout, 
        uint256 principal,           // what seller receives from buyer's funds
        uint256 fee,                 // fee to treasury
        uint256 bondReturned,        // bond returned to seller (0 if self-confirmed)
        uint256 excessSwept,         // any excess beyond target+bond swept to treasury
        address indexed treasury
    );
    
    event ArbitratorVoted(address indexed arbitrator, Decision decision);
    
    event ResolvedReleased(
        address indexed payout,
        uint256 principal,
        uint256 fee,
        uint256 bondReturned,
        uint256 excessSwept,
        address indexed treasury
    );
    
    event ResolvedRefunded(
        address indexed funder,
        uint256 amountRefunded,
        address indexed payout,
        uint256 bondReturned
    );
    
    event ExpiredNotConfirmed(uint64 expiredAt);
    event ExpiredNotFunded(uint64 expiredAt, address indexed payout, uint256 bondReturned);
    event SweptLateFunds(address indexed treasury, uint256 amount);
    event SweptAfterArbWindow(address indexed treasury, uint256 amount);
    
    // Mutual action events
    event MutualReleaseApproved(address indexed approver);
    event MutualReleaseExecuted(address indexed payout, uint256 principal, uint256 fee, uint256 bondReturned);
    event MutualRefundApproved(address indexed approver);
    event MutualRefundExecuted(address indexed funder, uint256 amountRefunded, address indexed payout, uint256 bondReturned);
    event DeadlineExtensionApproved(address indexed approver, uint64 newDeadline);
    event DeadlineExtended(uint64 oldDeadline, uint64 newDeadline, uint64 newArbWindowEnd);
    event ArbitratorSwapApproved(address indexed approver, address arb1, address arb2, address arb3);
    event ArbitratorSwapExecuted(
        address oldArb1, address oldArb2, address oldArb3,
        address newArb1, address newArb2, address newArb3,
        uint64 newDeadline, uint64 newArbWindowEnd
    );

    // ---- Modifiers -----------------------------------------------------------------------------
    modifier onlyOracle() {
        require(msg.sender == oracle, "Escrow: not oracle");
        _;
    }

    modifier onlySeller() {
        require(msg.sender == payout, "Escrow: not seller");
        _;
    }

    modifier onlyFunder() {
        require(msg.sender == funder, "Escrow: not funder");
        _;
    }

    modifier onlyParty() {
        require(msg.sender == funder || msg.sender == payout, "Escrow: not a party");
        _;
    }

    modifier onlyArbitrator() {
        require(
            msg.sender == arbitrator1 || msg.sender == arbitrator2 || msg.sender == arbitrator3,
            "Escrow: not arbitrator"
        );
        _;
    }

    modifier notResolved() {
        require(!resolved && !expired, "Escrow: already terminal");
        _;
    }

    // ---- Constructor ---------------------------------------------------------------------------
    /**
     * @param _factory          EscrowFactory address
     * @param _oracle           trusted oracle for bond-based confirmation
     * @param _treasury         receives platform fees and stray funds
     * @param _token            ERC-20 token address (USDC or USDT)
     * @param _payout           seller address - receives funds on success (immutable)
     * @param _funder           buyer address - must fund the escrow (immutable)
     * @param _targetAmount     amount the buyer must fund
     * @param _bondCap          max bond amount for oracle confirmation (typically $1 = 1e6)
     * @param _deadline         unix timestamp when seller gets paid
     * @param _arbitrator1      optional arbitrator (0x0 for none)
     * @param _arbitrator2      optional arbitrator (0x0 for none, requires arb1+arb3)
     * @param _arbitrator3      deadlock arbitrator (0x0 for none, requires arb1+arb2)
     */
    constructor(
        address _factory,
        address _oracle,
        address _treasury,
        address _token,
        address _payout,
        address _funder,
        uint256 _targetAmount,
        uint256 _bondCap,
        uint64  _deadline,
        address _arbitrator1,
        address _arbitrator2,
        address _arbitrator3
    ) {
        require(_oracle != address(0), "Escrow: zero oracle");
        require(_treasury != address(0), "Escrow: zero treasury");
        require(_token != address(0), "Escrow: zero token");
        require(_payout != address(0), "Escrow: zero payout");
        require(_funder != address(0), "Escrow: zero funder");
        require(_payout != _funder, "Escrow: payout == funder");
        require(_targetAmount > 0, "Escrow: zero target");
        require(_bondCap > 0, "Escrow: zero bond cap");
        require(_deadline > block.timestamp, "Escrow: deadline in past");
        
        // Enforce 0/1/3 arbitrator rule: either none, only arb1, or all three
        bool hasArb1 = _arbitrator1 != address(0);
        bool hasArb2 = _arbitrator2 != address(0);
        bool hasArb3 = _arbitrator3 != address(0);
        
        if (hasArb2 || hasArb3) {
            // If arb2 or arb3 is set, all three must be set
            require(hasArb1 && hasArb2 && hasArb3, "Escrow: must have 0, 1, or 3 arbitrators");
        }
        
        // Validate arbitrator1
        if (hasArb1) {
            require(_arbitrator1 != _payout, "Escrow: arbitrator1 == payout");
            require(_arbitrator1 != _funder, "Escrow: arbitrator1 == funder");
        }
        
        // Validate arbitrator2
        if (hasArb2) {
            require(_arbitrator2 != _payout, "Escrow: arbitrator2 == payout");
            require(_arbitrator2 != _funder, "Escrow: arbitrator2 == funder");
            require(_arbitrator2 != _arbitrator1, "Escrow: duplicate arbitrator");
        }
        
        // Validate arbitrator3
        if (hasArb3) {
            require(_arbitrator3 != _payout, "Escrow: arbitrator3 == payout");
            require(_arbitrator3 != _funder, "Escrow: arbitrator3 == funder");
            require(_arbitrator3 != _arbitrator1, "Escrow: duplicate arbitrator");
            require(_arbitrator3 != _arbitrator2, "Escrow: duplicate arbitrator");
        }

        factory = _factory;
        oracle = _oracle;
        treasury = _treasury;
        token = IERC20(_token);
        
        payout = _payout;
        funder = _funder;
        
        targetAmount = _targetAmount;
        bondCap = _bondCap;
        deadline = _deadline;
        originalDeadline = _deadline;
        
        createdAt = uint64(block.timestamp);
        confirmDeadline = uint64(block.timestamp) + 24 hours;
        arbWindowEnd = _deadline + ARB_WINDOW_DURATION;
        arbitrator1 = _arbitrator1;
        arbitrator2 = _arbitrator2;
        arbitrator3 = _arbitrator3;
        // arbitratorCount: 0, 1, or 3 (never 2)
        arbitratorCount = hasArb3 ? 3 : hasArb1 ? 1 : 0;
    }

    // ---- Confirmation functions ----------------------------------------------------------------

    /**
     * @notice Seller self-confirms the escrow. No bond required.
     *         Must be called within 24h of escrow creation.
     */
    function confirm() external onlySeller notResolved {
        require(!confirmed, "Escrow: already confirmed");
        require(block.timestamp <= confirmDeadline, "Escrow: confirm window closed");

        confirmed = true;
        // bondPresent remains false - seller self-confirmed without bond

        emit ConfirmedBySeller(msg.sender);
    }

    /**
     * @notice Oracle confirms the escrow after observing seller's bond transfer.
     *         Requires escrow balance has at least bondCap ($1) present.
     *         Must be called within 24h of escrow creation.
     * @param txHash Transaction hash of the bond transfer (for indexing/audit)
     */
    function confirmByOracle(bytes32 txHash) external onlyOracle notResolved {
        require(!confirmed, "Escrow: already confirmed");
        require(block.timestamp <= confirmDeadline, "Escrow: confirm window closed");
        
        // Verify bond is present
        uint256 balance = token.balanceOf(address(this));
        require(balance >= bondCap, "Escrow: bond not received");

        confirmed = true;
        bondPresent = true;

        emit ConfirmedByOracle(txHash, bondCap);
    }

    // ---- Derived funding status ----------------------------------------------------------------

    /**
     * @notice Check if escrow is funded based on current token balance.
     *         Funding is derived from balance, not recorded by oracle.
     * @return True if balance >= targetAmount (regardless of bond status)
     */
    function isFunded() public view returns (bool) {
        uint256 balance = token.balanceOf(address(this));
        // If bond is present, it's already in the balance, but we only care about targetAmount
        // for funding status. The bond is separate from buyer's funding.
        if (bondPresent) {
            // Balance must cover bond + targetAmount
            return balance >= bondCap + targetAmount;
        }
        // No bond: balance must cover targetAmount
        return balance >= targetAmount;
    }

    /**
     * @notice Get the current funding amount (what buyer has deposited toward target).
     * @return The amount funded toward targetAmount
     */
    function fundedAmount() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        if (bondPresent) {
            // Subtract bond from balance to get buyer's funding
            return balance > bondCap ? balance - bondCap : 0;
        }
        return balance;
    }

    // ---- Fee calculation -----------------------------------------------------------------------

    /**
     * @notice Calculate the platform fee with capped structure.
     *         - If amount > $100: fee = $1 (capped)
     *         - If amount <= $100: fee = 1% of amount
     *         - Minimum fee is $0.01 (10000 in 6 decimals)
     * @param amount The amount in token units (6 decimals for USDC/USDT)
     * @return fee The calculated fee amount
     */
    function calculateFee(uint256 amount) public pure returns (uint256) {
        uint256 fee;
        
        if (amount > FEE_THRESHOLD) {
            // Above $100: fee is capped at $1
            fee = ONE_DOLLAR;
        } else {
            // At or below $100: fee is 1%
            fee = amount / 100;
        }
        
        // Enforce minimum fee
        return fee < MIN_FEE ? MIN_FEE : fee;
    }

    /**
     * @notice Calculate the bond available for return (capped at bondCap).
     *         Only meaningful if bondPresent is true.
     * @return The bond amount that can be returned to seller
     */
    function bondAvailable() public view returns (uint256) {
        if (!bondPresent) return 0;
        
        uint256 balance = token.balanceOf(address(this));
        if (balance <= targetAmount) return 0;
        
        uint256 excess = balance - targetAmount;
        return excess > bondCap ? bondCap : excess;
    }

    // ---- Arbitrator functions ------------------------------------------------------------------

    /**
     * @notice Arbitrator releases funds to seller (fee applied).
     *         Only callable during arbitration window [deadline, arbWindowEnd].
     */
    function arbitratorRelease() external nonReentrant onlyArbitrator notResolved {
        _validateArbitrationWindow();
        _recordArbitratorDecision(Decision.Release);
    }

    /**
     * @notice Arbitrator refunds buyer (no fee) and returns bond to seller (if present).
     *         Only callable during arbitration window [deadline, arbWindowEnd].
     */
    function arbitratorRefund() external nonReentrant onlyArbitrator notResolved {
        _validateArbitrationWindow();
        _recordArbitratorDecision(Decision.Refund);
    }

    function _validateArbitrationWindow() internal view {
        require(arbitratorCount > 0, "Escrow: no arbitrators");
        require(confirmed, "Escrow: not confirmed");
        require(isFunded(), "Escrow: not funded");
        require(block.timestamp >= deadline, "Escrow: before deadline");
        require(block.timestamp <= arbWindowEnd, "Escrow: arb window closed");
    }

    function _recordArbitratorDecision(Decision decision) internal {
        require(arbitratorVote[msg.sender] == Decision.None, "Escrow: already voted");

        // In 3-arb mode, arbitrator3 can only vote if deadlocked
        if (arbitratorCount == 3 && msg.sender == arbitrator3) {
            require(deadlocked, "Escrow: arb3 can only vote in deadlock");
        }

        arbitratorVote[msg.sender] = decision;
        emit ArbitratorVoted(msg.sender, decision);

        // 1-arb mode: first vote resolves immediately
        if (arbitratorCount == 1) {
            _executeDecision(decision);
            return;
        }

        // 3-arb mode
        Decision arb1Vote = arbitratorVote[arbitrator1];
        Decision arb2Vote = arbitratorVote[arbitrator2];
        
        // If arb1 and arb2 have both voted
        if (arb1Vote != Decision.None && arb2Vote != Decision.None) {
            if (arb1Vote == arb2Vote) {
                // arb1 + arb2 agree: resolve immediately
                _executeDecision(arb1Vote);
            } else {
                // arb1 + arb2 disagree: enter deadlock state
                if (!deadlocked) {
                    deadlocked = true;
                }
                
                // If arb3 has voted (this vote), use arb3's decision to resolve
                Decision arb3Vote = arbitratorVote[arbitrator3];
                if (arb3Vote != Decision.None) {
                    _executeDecision(arb3Vote);
                }
                // Otherwise, wait for arb3 to vote or arb window to expire
            }
        }
        // If only one of arb1/arb2 has voted, wait for the other
    }

    function _executeDecision(Decision decision) internal {
        resolved = true;

        uint256 balance = token.balanceOf(address(this));
        uint256 fee = calculateFee(targetAmount);
        uint256 sellerPrincipal = targetAmount - fee;
        uint256 bond = bondAvailable();
        
        if (decision == Decision.Release) {
            // Calculate excess (anything beyond targetAmount + bond)
            uint256 expectedTotal = targetAmount + bond;
            uint256 excessToTreasury = balance > expectedTotal ? balance - expectedTotal : 0;
            
            // Pay seller: principal + bond
            token.safeTransfer(payout, sellerPrincipal + bond);
            // Pay treasury: fee + excess
            if (fee + excessToTreasury > 0) {
                token.safeTransfer(treasury, fee + excessToTreasury);
            }

            emit ResolvedReleased(payout, sellerPrincipal, fee, bond, excessToTreasury, treasury);
        } else if (decision == Decision.Refund) {
            // Refund buyer the targetAmount
            token.safeTransfer(funder, targetAmount);
            // Return bond to seller (if present)
            if (bond > 0) {
                token.safeTransfer(payout, bond);
            }
            // Any excess goes to treasury
            uint256 remaining = token.balanceOf(address(this));
            if (remaining > 0) {
                token.safeTransfer(treasury, remaining);
            }

            emit ResolvedRefunded(funder, targetAmount, payout, bond);
        }
    }

    // ---- Permissionless functions (anyone can call) --------------------------------------------

    /**
     * @notice Finalize and pay seller after deadline. Anyone can call.
     *         Only works if NO arbitrators are set.
     *         Requires escrow to be confirmed and funded.
     */
    function finalizeAfterDeadline() external nonReentrant notResolved {
        require(arbitratorCount == 0, "Escrow: has arbitrators");
        require(confirmed, "Escrow: not confirmed");
        require(isFunded(), "Escrow: not funded");
        require(block.timestamp >= deadline, "Escrow: deadline not reached");

        resolved = true;

        uint256 balance = token.balanceOf(address(this));
        uint256 fee = calculateFee(targetAmount);
        uint256 sellerPrincipal = targetAmount - fee;
        uint256 bond = bondAvailable();
        
        // Calculate excess
        uint256 expectedTotal = targetAmount + bond;
        uint256 excessToTreasury = balance > expectedTotal ? balance - expectedTotal : 0;

        // Pay seller: principal + bond
        token.safeTransfer(payout, sellerPrincipal + bond);
        // Pay treasury: fee + excess
        if (fee + excessToTreasury > 0) {
            token.safeTransfer(treasury, fee + excessToTreasury);
        }

        emit FinalizedPaid(payout, sellerPrincipal, fee, bond, excessToTreasury, treasury);
    }

    /**
     * @notice Expire escrow if seller didn't confirm within 24h. Anyone can call.
     *         Any funds in the contract become sweepable.
     */
    function expireIfNotConfirmed() external nonReentrant notResolved {
        require(!confirmed, "Escrow: already confirmed");
        require(block.timestamp > confirmDeadline, "Escrow: confirm window still open");

        expired = true;

        emit ExpiredNotConfirmed(uint64(block.timestamp));
    }

    /**
     * @notice Expire escrow if buyer didn't fund by deadline. Anyone can call.
     *         Returns bond to seller (if present).
     */
    function expireIfNotFunded() external nonReentrant notResolved {
        require(confirmed, "Escrow: not confirmed");
        require(!isFunded(), "Escrow: already funded");
        require(block.timestamp >= deadline, "Escrow: deadline not reached");

        expired = true;

        // Return bond to seller if present
        uint256 bond = 0;
        if (bondPresent) {
            uint256 balance = token.balanceOf(address(this));
            bond = balance > bondCap ? bondCap : balance;
            if (bond > 0) {
                token.safeTransfer(payout, bond);
            }
        }

        emit ExpiredNotFunded(uint64(block.timestamp), payout, bond);
    }

    /**
     * @notice Sweep funds to treasury after arbitration window expires without resolution.
     *         Anyone can call. Only works when arbitrators exist and didn't resolve.
     */
    function sweepToTreasuryAfterArbWindow() external nonReentrant notResolved {
        require(arbitratorCount > 0, "Escrow: no arbitrators");
        require(block.timestamp > arbWindowEnd, "Escrow: arb window not ended");

        resolved = true;

        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "Escrow: nothing to sweep");

        token.safeTransfer(treasury, balance);

        emit SweptAfterArbWindow(treasury, balance);
    }

    /**
     * @notice Sweep escrow token to treasury. Only allowed in terminal states.
     *         Used for late/stray transfers after expiry or resolution.
     */
    function sweepToTreasury() external nonReentrant {
        require(resolved || expired, "Escrow: not in terminal state");

        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "Escrow: nothing to sweep");

        token.safeTransfer(treasury, balance);

        emit SweptLateFunds(treasury, balance);
    }

    /**
     * @notice Sweep any non-escrow token to treasury. Oracle only for safety.
     */
    function sweepStrayToken(IERC20 erc20, uint256 amt) external nonReentrant onlyOracle {
        require(address(erc20) != address(token), "Escrow: use sweepToTreasury");
        require(amt > 0, "Escrow: zero amount");
        
        erc20.safeTransfer(treasury, amt);
    }

    // ---- Mutual release/refund (buyer + seller only, no arbitrators) ---------------------------

    /**
     * @notice Approve mutual release. Only before deadline and when arbitratorCount == 0.
     *         When both funder and payout approve, funds are released to seller.
     */
    function approveMutualRelease() external nonReentrant onlyParty notResolved {
        require(arbitratorCount == 0, "Escrow: has arbitrators");
        require(block.timestamp < deadline, "Escrow: deadline passed");
        require(confirmed, "Escrow: not confirmed");
        require(isFunded(), "Escrow: not funded");

        if (msg.sender == funder) {
            require(!mutualReleaseApprovedByFunder, "Escrow: already approved");
            mutualReleaseApprovedByFunder = true;
        } else {
            require(!mutualReleaseApprovedByPayout, "Escrow: already approved");
            mutualReleaseApprovedByPayout = true;
        }

        emit MutualReleaseApproved(msg.sender);

        // If both approved, execute release
        if (mutualReleaseApprovedByFunder && mutualReleaseApprovedByPayout) {
            _executeMutualRelease();
        }
    }

    /**
     * @notice Approve mutual refund. Only before deadline and when arbitratorCount == 0.
     *         When both funder and payout approve, funds are refunded to buyer.
     */
    function approveMutualRefund() external nonReentrant onlyParty notResolved {
        require(arbitratorCount == 0, "Escrow: has arbitrators");
        require(block.timestamp < deadline, "Escrow: deadline passed");
        require(confirmed, "Escrow: not confirmed");
        require(isFunded(), "Escrow: not funded");

        if (msg.sender == funder) {
            require(!mutualRefundApprovedByFunder, "Escrow: already approved");
            mutualRefundApprovedByFunder = true;
        } else {
            require(!mutualRefundApprovedByPayout, "Escrow: already approved");
            mutualRefundApprovedByPayout = true;
        }

        emit MutualRefundApproved(msg.sender);

        // If both approved, execute refund
        if (mutualRefundApprovedByFunder && mutualRefundApprovedByPayout) {
            _executeMutualRefund();
        }
    }

    function _executeMutualRelease() internal {
        resolved = true;

        uint256 balance = token.balanceOf(address(this));
        uint256 fee = calculateFee(targetAmount);
        uint256 sellerPrincipal = targetAmount - fee;
        uint256 bond = bondAvailable();
        
        // Calculate excess
        uint256 expectedTotal = targetAmount + bond;
        uint256 excessToTreasury = balance > expectedTotal ? balance - expectedTotal : 0;

        // Pay seller: principal + bond
        token.safeTransfer(payout, sellerPrincipal + bond);
        // Pay treasury: fee + excess
        if (fee + excessToTreasury > 0) {
            token.safeTransfer(treasury, fee + excessToTreasury);
        }

        emit MutualReleaseExecuted(payout, sellerPrincipal, fee, bond);
    }

    function _executeMutualRefund() internal {
        resolved = true;

        uint256 bond = bondAvailable();
        
        // Refund buyer the targetAmount
        token.safeTransfer(funder, targetAmount);
        // Return bond to seller (if present)
        if (bond > 0) {
            token.safeTransfer(payout, bond);
        }
        // Any excess goes to treasury
        uint256 remaining = token.balanceOf(address(this));
        if (remaining > 0) {
            token.safeTransfer(treasury, remaining);
        }

        emit MutualRefundExecuted(funder, targetAmount, payout, bond);
    }

    // ---- Mutual deadline extension -------------------------------------------------------------

    /**
     * @notice Approve deadline extension. Only before current deadline.
     *         Both parties must approve the same newDeadline.
     *         Total extensions are capped at MAX_EXTENSION (14 days) from original deadline.
     * @param newDeadline The proposed new deadline (must be > current deadline)
     */
    function approveDeadlineExtension(uint64 newDeadline) external nonReentrant onlyParty notResolved {
        require(block.timestamp < deadline, "Escrow: deadline passed");
        require(newDeadline > deadline, "Escrow: new deadline must be later");
        
        // Enforce max extension cap from original deadline
        uint64 maxAllowedDeadline = originalDeadline + MAX_EXTENSION;
        require(newDeadline <= maxAllowedDeadline, "Escrow: exceeds max extension");

        // If this is a new proposal or different from pending, reset approvals
        if (pendingExtensionDeadline != newDeadline) {
            pendingExtensionDeadline = newDeadline;
            extensionApprovedByFunder = false;
            extensionApprovedByPayout = false;
        }

        if (msg.sender == funder) {
            require(!extensionApprovedByFunder, "Escrow: already approved");
            extensionApprovedByFunder = true;
        } else {
            require(!extensionApprovedByPayout, "Escrow: already approved");
            extensionApprovedByPayout = true;
        }

        emit DeadlineExtensionApproved(msg.sender, newDeadline);

        // If both approved the same deadline, execute extension
        if (extensionApprovedByFunder && extensionApprovedByPayout) {
            _executeDeadlineExtension(newDeadline);
        }
    }

    function _executeDeadlineExtension(uint64 newDeadline) internal {
        uint64 oldDeadline = deadline;
        deadline = newDeadline;
        arbWindowEnd = newDeadline + ARB_WINDOW_DURATION;

        // Clear pending state
        pendingExtensionDeadline = 0;
        extensionApprovedByFunder = false;
        extensionApprovedByPayout = false;

        emit DeadlineExtended(oldDeadline, newDeadline, arbWindowEnd);
    }

    // ---- Mutual arbitrator swap ----------------------------------------------------------------

    /**
     * @notice Approve arbitrator swap. Only before arbWindowEnd.
     *         Both parties must approve the same new arbitrator set.
     *         Must be a valid 0/1/3 set. Resets votes and deadlocked state.
     *         Pushes deadline +7 days and updates arbWindowEnd.
     * @param newArb1 New arbitrator1 (or 0x0 for none)
     * @param newArb2 New arbitrator2 (or 0x0, requires newArb1 and newArb3 if set)
     * @param newArb3 New arbitrator3 (or 0x0, requires newArb1 and newArb2 if set)
     */
    function approveArbitratorSwap(
        address newArb1,
        address newArb2,
        address newArb3
    ) external nonReentrant onlyParty notResolved {
        require(block.timestamp < arbWindowEnd, "Escrow: arb window ended");

        // Validate 0/1/3 rule
        bool hasArb1 = newArb1 != address(0);
        bool hasArb2 = newArb2 != address(0);
        bool hasArb3 = newArb3 != address(0);
        
        if (hasArb2 || hasArb3) {
            require(hasArb1 && hasArb2 && hasArb3, "Escrow: must have 0, 1, or 3 arbitrators");
        }

        // Validate arbitrators are not parties
        if (hasArb1) {
            require(newArb1 != payout, "Escrow: arbitrator1 == payout");
            require(newArb1 != funder, "Escrow: arbitrator1 == funder");
        }
        if (hasArb2) {
            require(newArb2 != payout, "Escrow: arbitrator2 == payout");
            require(newArb2 != funder, "Escrow: arbitrator2 == funder");
            require(newArb2 != newArb1, "Escrow: duplicate arbitrator");
        }
        if (hasArb3) {
            require(newArb3 != payout, "Escrow: arbitrator3 == payout");
            require(newArb3 != funder, "Escrow: arbitrator3 == funder");
            require(newArb3 != newArb1, "Escrow: duplicate arbitrator");
            require(newArb3 != newArb2, "Escrow: duplicate arbitrator");
        }

        // If this is a new proposal or different from pending, reset approvals
        if (pendingSwapArb1 != newArb1 || pendingSwapArb2 != newArb2 || pendingSwapArb3 != newArb3) {
            pendingSwapArb1 = newArb1;
            pendingSwapArb2 = newArb2;
            pendingSwapArb3 = newArb3;
            swapApprovedByFunder = false;
            swapApprovedByPayout = false;
        }

        if (msg.sender == funder) {
            require(!swapApprovedByFunder, "Escrow: already approved");
            swapApprovedByFunder = true;
        } else {
            require(!swapApprovedByPayout, "Escrow: already approved");
            swapApprovedByPayout = true;
        }

        emit ArbitratorSwapApproved(msg.sender, newArb1, newArb2, newArb3);

        // If both approved the same set, execute swap
        if (swapApprovedByFunder && swapApprovedByPayout) {
            _executeArbitratorSwap(newArb1, newArb2, newArb3);
        }
    }

    function _executeArbitratorSwap(address newArb1, address newArb2, address newArb3) internal {
        address oldArb1 = arbitrator1;
        address oldArb2 = arbitrator2;
        address oldArb3 = arbitrator3;

        // Reset votes for old arbitrators
        if (arbitrator1 != address(0)) arbitratorVote[arbitrator1] = Decision.None;
        if (arbitrator2 != address(0)) arbitratorVote[arbitrator2] = Decision.None;
        if (arbitrator3 != address(0)) arbitratorVote[arbitrator3] = Decision.None;

        // Reset deadlocked state
        deadlocked = false;

        // Update arbitrators
        arbitrator1 = newArb1;
        arbitrator2 = newArb2;
        arbitrator3 = newArb3;
        
        // Update count
        bool hasArb3 = newArb3 != address(0);
        bool hasArb1 = newArb1 != address(0);
        arbitratorCount = hasArb3 ? 3 : hasArb1 ? 1 : 0;

        // Push deadline +7 days and update arbWindowEnd
        uint64 newDeadline = uint64(block.timestamp) + ARB_WINDOW_DURATION;
        uint64 oldDeadline = deadline;
        deadline = newDeadline;
        arbWindowEnd = newDeadline + ARB_WINDOW_DURATION;

        // Clear pending state
        pendingSwapArb1 = address(0);
        pendingSwapArb2 = address(0);
        pendingSwapArb3 = address(0);
        swapApprovedByFunder = false;
        swapApprovedByPayout = false;

        emit ArbitratorSwapExecuted(
            oldArb1, oldArb2, oldArb3,
            newArb1, newArb2, newArb3,
            newDeadline, arbWindowEnd
        );
    }

    // ---- View functions ------------------------------------------------------------------------

    /**
     * @notice Check if escrow can be finalized (paid out).
     *         Only applicable when no arbitrators.
     */
    function isPayable() external view returns (bool) {
        return !resolved && !expired 
            && arbitratorCount == 0 
            && confirmed 
            && isFunded() 
            && block.timestamp >= deadline;
    }

    /**
     * @notice Check if escrow can expire due to no confirmation.
     */
    function isExpirableNoConfirm() external view returns (bool) {
        return !resolved && !expired && !confirmed && block.timestamp > confirmDeadline;
    }

    /**
     * @notice Check if escrow can expire due to no funding.
     */
    function isExpirableNoFund() external view returns (bool) {
        return !resolved && !expired && confirmed && !isFunded() && block.timestamp >= deadline;
    }

    /**
     * @notice Check if escrow is in a terminal state (sweepable).
     */
    function isTerminal() external view returns (bool) {
        return resolved || expired;
    }

    /**
     * @notice Check if arbitration window is currently open.
     */
    function isInArbWindow() external view returns (bool) {
        return arbitratorCount > 0 
            && !resolved 
            && !expired 
            && confirmed 
            && isFunded() 
            && block.timestamp >= deadline 
            && block.timestamp <= arbWindowEnd;
    }

    /**
     * @notice Check if the arb window has ended and sweep is available.
     */
    function isSweepableAfterArbWindow() external view returns (bool) {
        return arbitratorCount > 0 
            && !resolved 
            && !expired 
            && block.timestamp > arbWindowEnd;
    }

    /**
     * @notice Check total extension used from original deadline.
     */
    function totalExtensionUsed() external view returns (uint64) {
        if (deadline > originalDeadline) {
            return deadline - originalDeadline;
        }
        return 0;
    }

    /**
     * @notice Check remaining extension available.
     */
    function extensionRemaining() external view returns (uint64) {
        uint64 used = deadline > originalDeadline ? deadline - originalDeadline : 0;
        return MAX_EXTENSION > used ? MAX_EXTENSION - used : 0;
    }

    // ---- Legacy compatibility (deprecated, kept for indexing) ----------------------------------
    
    /**
     * @notice Legacy: Returns confirmation status for backward compatibility.
     * @dev Deprecated. Use `confirmed` directly.
     */
    function confirmationRecorded() external view returns (bool) {
        return confirmed;
    }

    /**
     * @notice Legacy: Returns funding status for backward compatibility.
     * @dev Deprecated. Use `isFunded()` instead.
     */
    function fundingRecorded() external view returns (bool) {
        return isFunded();
    }

    /**
     * @notice Legacy: Returns funded amount for backward compatibility.
     * @dev Deprecated. Use `fundedAmount()` instead.
     */
    function fundedRecorded() external view returns (uint256) {
        return fundedAmount();
    }

    /**
     * @notice Legacy: Returns confirmationAmount as bondCap for backward compatibility.
     * @dev Deprecated. Use `bondCap` directly.
     */
    function confirmationAmount() external view returns (uint256) {
        return bondCap;
    }

    /**
     * @notice Legacy: Synthetic phase for backward compatibility.
     * @dev Deprecated. Use individual state checks instead.
     * @return 0=AwaitingConfirmation, 1=ConfirmedAwaitingFunding, 2=Funded, 3=Resolved, 4=Expired
     */
    function phase() external view returns (uint8) {
        if (expired) return 4; // Expired
        if (resolved) return 3; // Resolved
        if (!confirmed) return 0; // AwaitingConfirmation
        if (!isFunded()) return 1; // ConfirmedAwaitingFunding
        return 2; // Funded
    }
}
