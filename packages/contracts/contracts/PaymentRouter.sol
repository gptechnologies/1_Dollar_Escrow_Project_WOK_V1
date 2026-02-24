// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/IERC20.sol";
import "./utils/SafeERC20.sol";

/**
 * @title PaymentRouter
 * @notice On-chain enforced payment links for stablecoin transfers.
 *         Links are created by the owner (oracle) and store the exact
 *         token, recipient, and amount. Payers call pay(id) after
 *         approving the router for the exact amount — the contract
 *         enforces the stored parameters so nothing can be altered.
 *
 *         Links are reusable (multiple payers can pay the same link).
 */
contract PaymentRouter {
    using SafeERC20 for IERC20;

    struct PaymentLink {
        address token;
        address recipient;
        uint256 amount;
    }

    mapping(bytes32 => PaymentLink) public links;
    mapping(address => bool) public allowedTokens;
    address public owner;

    event LinkCreated(
        bytes32 indexed id,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    event PaymentCompleted(
        bytes32 indexed id,
        address indexed payer,
        address indexed recipient,
        address token,
        uint256 amount
    );

    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event TokenAllowlistUpdated(address indexed token, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "Router: not owner");
        _;
    }

    constructor(address _usdc, address _usdt) {
        require(_usdc != address(0), "Router: zero USDC");
        require(_usdt != address(0), "Router: zero USDT");

        owner = msg.sender;
        allowedTokens[_usdc] = true;
        allowedTokens[_usdt] = true;

        emit OwnerUpdated(address(0), msg.sender);
        emit TokenAllowlistUpdated(_usdc, true);
        emit TokenAllowlistUpdated(_usdt, true);
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Router: zero owner");
        emit OwnerUpdated(owner, _newOwner);
        owner = _newOwner;
    }

    function setTokenAllowed(address _token, bool _allowed) external onlyOwner {
        require(_token != address(0), "Router: zero token");
        allowedTokens[_token] = _allowed;
        emit TokenAllowlistUpdated(_token, _allowed);
    }

    // ── Link management ──────────────────────────────────────────────────

    /**
     * @notice Register a payment link on-chain (owner only).
     * @param id    keccak256(code) where code is the off-chain nanoid
     * @param token USDC or USDT (must be allowlisted)
     * @param recipient Merchant wallet that receives funds
     * @param amount    Raw token amount (6 decimals for USDC/USDT)
     */
    function createLink(
        bytes32 id,
        address token,
        address recipient,
        uint256 amount
    ) external onlyOwner {
        require(links[id].recipient == address(0), "Router: link exists");
        require(allowedTokens[token], "Router: token not allowed");
        require(recipient != address(0), "Router: zero recipient");
        require(amount > 0, "Router: zero amount");

        links[id] = PaymentLink(token, recipient, amount);
        emit LinkCreated(id, token, recipient, amount);
    }

    // ── Payment ──────────────────────────────────────────────────────────

    /**
     * @notice Pay a link. Caller must have approved this contract for
     *         at least link.amount of link.token beforehand.
     * @param id The link identifier (keccak256 of the off-chain code)
     */
    function pay(bytes32 id) external {
        PaymentLink memory link = links[id];
        require(link.recipient != address(0), "Router: link not found");

        IERC20(link.token).safeTransferFrom(
            msg.sender,
            link.recipient,
            link.amount
        );

        emit PaymentCompleted(id, msg.sender, link.recipient, link.token, link.amount);
    }

    // ── Views ────────────────────────────────────────────────────────────

    /**
     * @notice Check whether a link exists on-chain.
     */
    function linkExists(bytes32 id) external view returns (bool) {
        return links[id].recipient != address(0);
    }
}
