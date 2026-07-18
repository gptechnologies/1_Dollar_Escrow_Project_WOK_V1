// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/Ownable.sol";
import "./EscrowV2.sol";

/**
 * @title EscrowFactoryV2
 * @notice Factory for the P2P EscrowV2 contract. Each call deploys a fresh escrow
 *         with immutable parties, one settlement date, a terms hash, and optional 0/1/3
 *         arbitration. Escrows are denominated in allowlisted tokens (USDC / USDT).
 *
 *         No oracle, no bond. Creation is permissionless.
 */
contract EscrowFactoryV2 is Ownable {
    address public treasury;                        // receives fees + invalid-token recovery
    mapping(address => bool) public isAllowedToken; // USDC / USDT allowlist

    uint256 private constant MIN_TARGET_AMOUNT = 1e6; // $1 in 6 decimals
    uint64 private constant MAX_DEADLINE_WINDOW = 365 days;

    event EscrowCreated(
        address indexed escrow,
        address indexed funder,         // buyerRefundWallet
        address indexed payout,         // sellerWallet
        address token,
        uint256 targetAmount,
        uint64  settlementDate,
        uint64  createdAt,
        bytes32 termsHash,
        uint8   arbitrationMode,
        address arbitrator1,
        address arbitrator2,
        address arbitrator3
    );

    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TokenAllowlistUpdated(address indexed token, bool allowed);

    constructor(
        address _treasury,
        address _usdc,
        address _usdt
    ) {
        require(_treasury != address(0), "Factory: zero treasury");
        require(_usdc != address(0), "Factory: zero USDC");
        require(_usdt != address(0), "Factory: zero USDT");

        treasury = _treasury;
        isAllowedToken[_usdc] = true;
        isAllowedToken[_usdt] = true;

        emit TreasuryUpdated(address(0), _treasury);
        emit TokenAllowlistUpdated(_usdc, true);
        emit TokenAllowlistUpdated(_usdt, true);
    }

    // ---- Admin ---------------------------------------------------------------------------------

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Factory: zero treasury");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setTokenAllowed(address _token, bool _allowed) external onlyOwner {
        require(_token != address(0), "Factory: zero token");
        isAllowedToken[_token] = _allowed;
        emit TokenAllowlistUpdated(_token, _allowed);
    }

    // ---- Escrow creation -----------------------------------------------------------------------

    struct CreateParams {
        address payout;             // sellerWallet - receives funds on settle
        address funder;             // buyerRefundWallet - receives funds on refund
        address token;              // USDC or USDT (must be allowlisted)
        uint256 targetAmount;       // amount that must be funded
        uint64  settlementDate;     // resolution / underfunded-refund time
        bytes32 termsHash;          // hash/reference of off-chain terms
        address arbitrator1;
        address arbitrator2;
        address arbitrator3;
    }

    /**
     * @notice Create a new EscrowV2 with immutable parties and the specified token.
     * @return escrow Address of the newly deployed escrow.
     */
    function createEscrow(CreateParams calldata p) external returns (address escrow) {
        return _create(
            p.payout,
            p.funder,
            p.token,
            p.targetAmount,
            p.settlementDate,
            p.termsHash,
            p.arbitrator1,
            p.arbitrator2,
            p.arbitrator3
        );
    }

    /**
     * @notice Flat-argument creation helper (no struct).
     */
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
    ) external returns (address escrow) {
        return _create(
            _payout,
            _funder,
            _token,
            _targetAmount,
            _settlementDate,
            _termsHash,
            _arbitrator1,
            _arbitrator2,
            _arbitrator3
        );
    }

    function _create(
        address _payout,
        address _funder,
        address _token,
        uint256 _targetAmount,
        uint64  _settlementDate,
        bytes32 _termsHash,
        address _arbitrator1,
        address _arbitrator2,
        address _arbitrator3
    ) internal returns (address escrow) {
        require(_payout != address(0), "Factory: zero payout");
        require(_funder != address(0), "Factory: zero funder");
        require(_payout != _funder, "Factory: payout == funder");
        require(isAllowedToken[_token], "Factory: token not allowed");
        require(_targetAmount >= MIN_TARGET_AMOUNT, "Factory: target below minimum");
        require(_settlementDate > block.timestamp, "Factory: settlement in past");
        require(_settlementDate <= block.timestamp + MAX_DEADLINE_WINDOW, "Factory: deadline too far");
        _validateArbitrators(_payout, _funder, _arbitrator1, _arbitrator2, _arbitrator3);

        escrow = address(new EscrowV2(
            address(this),
            treasury,
            _token,
            _payout,
            _funder,
            _targetAmount,
            _settlementDate,
            _termsHash,
            _arbitrator1,
            _arbitrator2,
            _arbitrator3
        ));

        uint8 arbitrationMode = _arbitrator3 != address(0)
            ? 3
            : (_arbitrator1 != address(0) ? 1 : 0);

        emit EscrowCreated(
            escrow,
            _funder,
            _payout,
            _token,
            _targetAmount,
            _settlementDate,
            uint64(block.timestamp),
            _termsHash,
            arbitrationMode,
            _arbitrator1,
            _arbitrator2,
            _arbitrator3
        );
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

        if (hasArb2 || hasArb3) {
            require(hasArb1 && hasArb2 && hasArb3, "Factory: must have 0, 1, or 3 arbitrators");
        }
        if (hasArb1) {
            require(_arbitrator1 != _payout && _arbitrator1 != _funder, "Factory: arb1 is party");
        }
        if (hasArb2) {
            require(_arbitrator2 != _payout && _arbitrator2 != _funder, "Factory: arb2 is party");
            require(_arbitrator2 != _arbitrator1, "Factory: duplicate arbitrator");
        }
        if (hasArb3) {
            require(_arbitrator3 != _payout && _arbitrator3 != _funder, "Factory: arb3 is party");
            require(_arbitrator3 != _arbitrator1 && _arbitrator3 != _arbitrator2, "Factory: duplicate arbitrator");
        }
    }
}
