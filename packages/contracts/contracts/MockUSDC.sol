// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/IERC20.sol";

contract MockUSDC is IERC20 {
    string public name;
    string public symbol;
    uint8  public immutable decimals;
    uint256 public override totalSupply;

    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals; // 6 for USDC-like behavior
    }

    function balanceOf(address a) external view override returns (uint256) {
        return _bal[a];
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allow[owner][spender];
    }

    function transfer(address to, uint256 amt) external override returns (bool) {
        _transfer(msg.sender, to, amt);
        return true;
    }

    function approve(address spender, uint256 amt) external override returns (bool) {
        _allow[msg.sender][spender] = amt;
        emit Approval(msg.sender, spender, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external override returns (bool) {
        uint256 a = _allow[from][msg.sender];
        require(a >= amt, "allowance");
        if (a != type(uint256).max) {
            _allow[from][msg.sender] = a - amt;
            emit Approval(from, msg.sender, _allow[from][msg.sender]);
        }
        _transfer(from, to, amt);
        return true;
    }

    function mint(address to, uint256 amt) external {
        require(to != address(0), "zero");
        totalSupply += amt;
        _bal[to] += amt;
        emit Transfer(address(0), to, amt);
    }

    function burn(uint256 amt) external {
        _transfer(msg.sender, address(0), amt);
        totalSupply -= amt;
    }

    function _transfer(address from, address to, uint256 amt) internal {
        require(from != address(0) && to != address(0), "zero");
        uint256 b = _bal[from];
        require(b >= amt, "balance");
        unchecked { _bal[from] = b - amt; }
        _bal[to] += amt;
        emit Transfer(from, to, amt);
    }
}
