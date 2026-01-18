// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 amt) internal {
        require(token.transfer(to, amt), "SafeERC20: transfer failed");
    }
    function safeTransferFrom(IERC20 token, address from, address to, uint256 amt) internal {
        require(token.transferFrom(from, to, amt), "SafeERC20: transferFrom failed");
    }
    function safeApprove(IERC20 token, address spender, uint256 amt) internal {
        require(token.approve(spender, amt), "SafeERC20: approve failed");
    }
}
