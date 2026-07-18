// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ArbeskAssetBase.sol";

/**
 * @title ArbeskAsset
 * @dev Paid-tier contract: PayGo + NFT + Merkle-root editor architecture.
 *      Inherits base NFT/Merkle logic from ArbeskAssetBase.
 *      Adds the USDC payment path for 3D asset generation.
 *
 *      MAX_EDITORS_PER_TOKEN = 5000 (safety net — full list on IPFS).
 */
contract ArbeskAsset is ArbeskAssetBase, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Tier {
        Basic,    // 0
        Standard, // 1
        Premium,  // 2
        Pro       // 3
    }

    // ── Custom Errors ──
    error UsdcPaymentsDisabled();
    error TierCostNotSet();
    error InvalidCost();
    error NoBalanceToWithdraw();
    error UsdcTokenNotSet();
    error DirectTransferNotAllowed();

    // ── Constants ──
    uint256 public constant MAX_EDITORS_PER_TOKEN = 5000;

    // ── State ──
    mapping(Tier => uint256) public tierCosts;
    IERC20 public usdcToken;
    address public developerTreasuryWallet;

    // ── Events ──
    event AssetGenerationPaidUSDC(
        address indexed userWallet,
        bytes32 indexed nodeId,
        string prompt,
        uint256 amount,
        uint256 timestamp,
        Tier tier
    );
    event TreasuryUpdated(
        address indexed previousWallet,
        address indexed newWallet
    );
    event TierCostUpdated(
        Tier indexed tier,
        uint256 previousCost,
        uint256 newCost
    );
    event UsdcTokenUpdated(
        address indexed previousToken,
        address indexed newToken
    );

    // ── Constructor ──
    constructor(
        address _treasury,
        address _usdcToken
    ) ArbeskAssetBase("ArbeskAsset", "ARBA") {
        if (_treasury == address(0)) revert ZeroAddress();
        developerTreasuryWallet = _treasury;
        usdcToken = IERC20(_usdcToken);

        tierCosts[Tier.Basic] = 750000;
        tierCosts[Tier.Standard] = 1250000;
        tierCosts[Tier.Premium] = 1750000;
        tierCosts[Tier.Pro] = 2500000;
    }

    // ── Payment — USDC ──

    function payForGenerationWithUSDC(
        bytes32 nodeId,
        string calldata prompt,
        Tier tier
    ) external nonReentrant whenNotPaused {
        if (address(usdcToken) == address(0)) revert UsdcPaymentsDisabled();
        _validateGenerationInput(nodeId, prompt);

        uint256 cost = tierCosts[tier];
        if (cost == 0) revert TierCostNotSet();

        usdcToken.safeTransferFrom(msg.sender, developerTreasuryWallet, cost);

        emit AssetGenerationPaidUSDC(
            msg.sender,
            nodeId,
            prompt,
            cost,
            block.timestamp,
            tier
        );
    }

    // ── Admin ──

    function setTreasury(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        address oldWallet = developerTreasuryWallet;
        developerTreasuryWallet = newWallet;
        emit TreasuryUpdated(oldWallet, newWallet);
    }

    function setUsdcToken(address _usdcToken) external onlyOwner {
        address oldToken = address(usdcToken);
        usdcToken = IERC20(_usdcToken);
        emit UsdcTokenUpdated(oldToken, _usdcToken);
    }

    function setTierCost(Tier tier, uint256 newCost) external onlyOwner {
        if (newCost == 0) revert InvalidCost();
        uint256 oldCost = tierCosts[tier];
        tierCosts[tier] = newCost;
        emit TierCostUpdated(tier, oldCost, newCost);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        if (address(usdcToken) == address(0)) revert UsdcTokenNotSet();
        uint256 balance = usdcToken.balanceOf(address(this));
        if (balance == 0) revert NoBalanceToWithdraw();
        usdcToken.safeTransfer(developerTreasuryWallet, balance);
    }

    receive() external payable {
        revert DirectTransferNotAllowed();
    }

    fallback() external payable {
        revert DirectTransferNotAllowed();
    }
}
