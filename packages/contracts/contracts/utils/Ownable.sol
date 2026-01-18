// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract Ownable {
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    address public owner;
    constructor() { owner = msg.sender; emit OwnershipTransferred(address(0), msg.sender); }
    modifier onlyOwner() { require(msg.sender == owner, "Ownable: not owner"); _; }
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Ownable: zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
