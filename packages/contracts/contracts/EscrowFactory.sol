// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/Ownable.sol";
import "./Escrow.sol";

/**
 * @title EscrowFactory
 * @notice Factory for deploying deterministic Escrow contracts.
 *         Binds funder (buyer) and payout (seller) immutably at creation.
 *         Supports escrows denominated in USDC or USDT (allowlist enforced).
 *
 * Hybrid confirmation model:
 *   - Seller can self-confirm without bond via confirm()
 *   - Or oracle can confirm when $1 bond is present via confirmByOracle()
 *   - Both methods must occur within 24h of creation
 *
 * Funding is derived from on-chain balance (not recorded by oracle).
 */
contract EscrowFactory is Ownable {
    address public oracle;      // trusted oracle EOA for bond-based confirmation
    address public treasury;    // receives platform fees and stray funds
    
    // Token allowlist: USDC and USDT addresses that can be used for escrows
    mapping(address => bool) public isAllowedToken;
    
    uint256 public defaultBondCap;  // default bond cap = $1 = 1e6

    // Arbitration window duration (7 days)
    uint64 private constant ARB_WINDOW_DURATION = 7 days;
    
    // Maximum deadline window (365 days from creation)
    uint64 private constant MAX_DEADLINE_WINDOW = 365 days;
    
    // Maximum bond cap override ($3 = 3e6 in 6 decimals)
    uint256 private constant MAX_BOND_CAP = 3e6;

    event EscrowCreated(
        address indexed escrow,
        address indexed funder,
        address indexed payout,
        address token,              // USDC or USDT address for this escrow
        uint256 targetAmount,
        uint256 bondCap,            // max bond for oracle confirmation
        uint64  deadline,
        uint64  createdAt,
        uint64  confirmDeadline,
        uint64  arbWindowEnd,       // deadline + 7 days (when arbs can sweep)
        address arbitrator1,
        address arbitrator2,
        address arbitrator3         // deadlock arbitrator (0x0 if 0/1 arb setup)
    );
    
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TokenAllowlistUpdated(address indexed token, bool allowed);
    event DefaultBondCapUpdated(uint256 oldAmount, uint256 newAmount);

    constructor(
        address _oracle,
        address _treasury,
        address _usdc,
        address _usdt,
        uint256 _defaultBondCap
    ) {
        require(_oracle != address(0), "Factory: zero oracle");
        require(_treasury != address(0), "Factory: zero treasury");
        require(_usdc != address(0), "Factory: zero USDC");
        require(_usdt != address(0), "Factory: zero USDT");
        require(_defaultBondCap > 0, "Factory: zero bond cap");
        
        oracle = _oracle;
        treasury = _treasury;
        defaultBondCap = _defaultBondCap;
        
        // Enable USDC and USDT by default
        isAllowedToken[_usdc] = true;
        isAllowedToken[_usdt] = true;
        
        emit OracleUpdated(address(0), _oracle);
        emit TreasuryUpdated(address(0), _treasury);
        emit TokenAllowlistUpdated(_usdc, true);
        emit TokenAllowlistUpdated(_usdt, true);
        emit DefaultBondCapUpdated(0, _defaultBondCap);
    }

    // ---- Admin functions -----------------------------------------------------------------------

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Factory: zero oracle");
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Factory: zero treasury");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    /**
     * @notice Enable or disable a token for escrow creation.
     * @param _token Token address to update
     * @param _allowed Whether the token should be allowed
     */
    function setTokenAllowed(address _token, bool _allowed) external onlyOwner {
        require(_token != address(0), "Factory: zero token");
        isAllowedToken[_token] = _allowed;
        emit TokenAllowlistUpdated(_token, _allowed);
    }

    function setDefaultBondCap(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Factory: zero bond cap");
        emit DefaultBondCapUpdated(defaultBondCap, _amount);
        defaultBondCap = _amount;
    }

    // ---- Legacy compatibility ------------------------------------------------------------------
    
    /**
     * @notice Legacy: Returns defaultBondCap for backward compatibility.
     * @dev Deprecated. Use `defaultBondCap` directly.
     */
    function defaultConfirmationAmount() external view returns (uint256) {
        return defaultBondCap;
    }

    /**
     * @notice Legacy: Set defaultBondCap for backward compatibility.
     * @dev Deprecated. Use `setDefaultBondCap()` instead.
     */
    function setDefaultConfirmationAmount(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Factory: zero bond cap");
        emit DefaultBondCapUpdated(defaultBondCap, _amount);
        defaultBondCap = _amount;
    }

    // ---- Escrow creation -----------------------------------------------------------------------

    struct CreateParams {
        address payout;             // seller - receives funds on success (immutable)
        address funder;             // buyer - must fund the escrow (immutable)
        address token;              // USDC or USDT address (must be in allowlist)
        uint256 targetAmount;       // amount buyer must fund
        uint64  deadline;           // unix timestamp when seller gets paid
        uint256 bondCap;            // optional override for bond cap (0 = use default)
        address arbitrator1;        // optional arbitrator
        address arbitrator2;        // optional arbitrator (requires arb1 + arb3)
        address arbitrator3;        // deadlock arbitrator (requires arb1 + arb2)
    }

    function _validateArbitrators(
        address _payout,
        address _funder,
        address _arbitrator1,
        address _arbitrator2,
        address _arbitrator3
    ) internal pure {
        bool hasArb1 = _arbitrator1 != address(0);
        bool hasArb2 = _arbitrator2 != address(0);
        bool hasArb3 = _arbitrator3 != address(0);
        
        // Enforce 0/1/3 rule: either none, only arb1, or all three
        if (hasArb2 || hasArb3) {
            require(hasArb1 && hasArb2 && hasArb3, "Factory: must have 0, 1, or 3 arbitrators");
        }
        
        if (hasArb1) {
            require(_arbitrator1 != _payout, "Factory: arbitrator1 == payout");
            require(_arbitrator1 != _funder, "Factory: arbitrator1 == funder");
        }
        if (hasArb2) {
            require(_arbitrator2 != _payout, "Factory: arbitrator2 == payout");
            require(_arbitrator2 != _funder, "Factory: arbitrator2 == funder");
            require(_arbitrator2 != _arbitrator1, "Factory: duplicate arbitrator");
        }
        if (hasArb3) {
            require(_arbitrator3 != _payout, "Factory: arbitrator3 == payout");
            require(_arbitrator3 != _funder, "Factory: arbitrator3 == funder");
            require(_arbitrator3 != _arbitrator1, "Factory: duplicate arbitrator");
            require(_arbitrator3 != _arbitrator2, "Factory: duplicate arbitrator");
        }
    }

    /**
     * @notice Create a new Escrow with immutable parties and specified token.
     * @param p Creation parameters (includes token selection)
     * @return escrow Address of the newly created Escrow contract
     */
    function createEscrow(CreateParams calldata p) external returns (address escrow) {
        require(p.payout != address(0), "Factory: zero payout");
        require(p.funder != address(0), "Factory: zero funder");
        require(p.payout != p.funder, "Factory: payout == funder");
        require(isAllowedToken[p.token], "Factory: token not allowed");
        require(p.targetAmount > 0, "Factory: zero target");
        require(p.deadline > block.timestamp, "Factory: deadline in past");
        require(p.deadline <= block.timestamp + MAX_DEADLINE_WINDOW, "Factory: deadline too far");
        require(p.bondCap <= MAX_BOND_CAP || p.bondCap == 0, "Factory: bondCap too high");
        _validateArbitrators(p.payout, p.funder, p.arbitrator1, p.arbitrator2, p.arbitrator3);

        uint256 bondCapAmt = p.bondCap > 0 ? p.bondCap : defaultBondCap;

        escrow = address(new Escrow(
            address(this),
            oracle,
            treasury,
            p.token,
            p.payout,
            p.funder,
            p.targetAmount,
            bondCapAmt,
            p.deadline,
            p.arbitrator1,
            p.arbitrator2,
            p.arbitrator3
        ));

        _emitEscrowCreated(escrow, p.funder, p.payout, p.token, p.targetAmount, bondCapAmt, p.deadline, p.arbitrator1, p.arbitrator2, p.arbitrator3);
    }

    /**
     * @notice Simplified creation with default bond cap.
     * @param _payout Seller address (receives funds)
     * @param _funder Buyer address (funds the escrow)
     * @param _token USDC or USDT address (must be in allowlist)
     * @param _targetAmount Amount buyer must fund
     * @param _deadline Unix timestamp when seller gets paid
     * @param _arbitrator1 Optional arbitrator
     * @param _arbitrator2 Optional arbitrator (requires arb1 + arb3)
     * @param _arbitrator3 Deadlock arbitrator (requires arb1 + arb2)
     */
    function createEscrowSimple(
        address _payout,
        address _funder,
        address _token,
        uint256 _targetAmount,
        uint64 _deadline,
        address _arbitrator1,
        address _arbitrator2,
        address _arbitrator3
    ) external returns (address escrow) {
        require(_payout != address(0), "Factory: zero payout");
        require(_funder != address(0), "Factory: zero funder");
        require(_payout != _funder, "Factory: payout == funder");
        require(isAllowedToken[_token], "Factory: token not allowed");
        require(_targetAmount > 0, "Factory: zero target");
        require(_deadline > block.timestamp, "Factory: deadline in past");
        require(_deadline <= block.timestamp + MAX_DEADLINE_WINDOW, "Factory: deadline too far");
        _validateArbitrators(_payout, _funder, _arbitrator1, _arbitrator2, _arbitrator3);

        escrow = address(new Escrow(
            address(this),
            oracle,
            treasury,
            _token,
            _payout,
            _funder,
            _targetAmount,
            defaultBondCap,
            _deadline,
            _arbitrator1,
            _arbitrator2,
            _arbitrator3
        ));

        _emitEscrowCreated(escrow, _funder, _payout, _token, _targetAmount, defaultBondCap, _deadline, _arbitrator1, _arbitrator2, _arbitrator3);
    }

    /**
     * @dev Internal helper to emit EscrowCreated event (reduces stack depth)
     */
    function _emitEscrowCreated(
        address escrow,
        address _funder,
        address _payout,
        address _token,
        uint256 _targetAmount,
        uint256 bondCapAmt,
        uint64 _deadline,
        address _arbitrator1,
        address _arbitrator2,
        address _arbitrator3
    ) internal {
        uint64 createdAt = uint64(block.timestamp);
        uint64 confirmDeadline = createdAt + 24 hours;
        uint64 arbWindowEnd = _deadline + ARB_WINDOW_DURATION;

        emit EscrowCreated(
            escrow,
            _funder,
            _payout,
            _token,
            _targetAmount,
            bondCapAmt,
            _deadline,
            createdAt,
            confirmDeadline,
            arbWindowEnd,
            _arbitrator1,
            _arbitrator2,
            _arbitrator3
        );
    }
}
