// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @dev Mock USDC token for local Hardhat testing.
 *      Mintable — any address can mint() to bootstrap test balances.
 *      6 decimals, mirrors real USDC on Base.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    /**
     * @notice Mint USDC to any address. Unrestricted for testing.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Match real USDC decimals.
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
