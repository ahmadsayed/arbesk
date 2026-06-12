// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ArbeskAssetBase.sol";

/**
 * @title ArbeskAsset
 * @dev Paid-tier contract: PayGo + NFT + Collaboration.
 *      Inherits all base NFT/collaboration logic from ArbeskAssetBase.
 *      Adds native-token and USDC payment paths for 3D asset generation.
 */
contract ArbeskAsset is ArbeskAssetBase, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Tier {
        Basic, // 0
        Standard, // 1
        Premium, // 2
        Pro // 3
    }

    // ── Custom Errors ──
    error IncorrectPaymentAmount();
    error InvalidPromptLength();
    error InvalidNodeId();
    error PaymentAlreadyUsed();
    error TreasuryTransferFailed();
    error UsdcPaymentsDisabled();
    error TierCostNotSet();
    error InvalidCost();
    error NoBalanceToWithdraw();
    error WithdrawFailed();
    error UsdcTokenNotSet();
    error DirectTransferNotAllowed();

    // ── State ──
    uint256 public costPerGeneration = 0.01 ether;
    mapping(Tier => uint256) public tierCosts;
    IERC20 public usdcToken;
    address public developerTreasuryWallet;
    mapping(bytes32 => bool) internal usedPayments;

    // ── Events ──
    event AssetGenerationPaid(
        address indexed userWallet,
        bytes32 indexed nodeId,
        string prompt,
        uint256 amount,
        uint256 timestamp
    );
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
    event CostUpdated(uint256 previousCost, uint256 newCost);
    event TierCostUpdated(
        Tier indexed tier,
        uint256 previousCost,
        uint256 newCost
    );
    event UsdcTokenUpdated(
        address indexed previousToken,
        address indexed newToken
    );

    // ── Quota Overrides ──
    function maxEditorsPerToken() public pure override returns (uint256) {
        return 50;
    }

    function maxTokensPerEditor() public pure override returns (uint256) {
        return 500;
    }

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

    // ── Payment — Native Token ──

    function payForGeneration(
        bytes32 nodeId,
        string calldata prompt
    ) external payable nonReentrant whenNotPaused {
        if (msg.value != costPerGeneration) revert IncorrectPaymentAmount();
        uint256 promptLen = bytes(prompt).length;
        if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
        if (nodeId == bytes32(0)) revert InvalidNodeId();

        bytes32 paymentKey = keccak256(
            abi.encodePacked(nodeId, msg.sender, block.number)
        );
        if (usedPayments[paymentKey]) revert PaymentAlreadyUsed();
        usedPayments[paymentKey] = true;

        (bool sent, ) = developerTreasuryWallet.call{value: msg.value}("");
        if (!sent) revert TreasuryTransferFailed();

        emit AssetGenerationPaid(
            msg.sender,
            nodeId,
            prompt,
            msg.value,
            block.timestamp
        );
    }

    // ── Payment — USDC ──

    function payForGenerationWithUSDC(
        bytes32 nodeId,
        string calldata prompt,
        Tier tier
    ) external nonReentrant whenNotPaused {
        if (address(usdcToken) == address(0)) revert UsdcPaymentsDisabled();
        uint256 promptLen = bytes(prompt).length;
        if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
        if (nodeId == bytes32(0)) revert InvalidNodeId();

        uint256 cost = tierCosts[tier];
        if (cost == 0) revert TierCostNotSet();

        bytes32 paymentKey = keccak256(
            abi.encodePacked(nodeId, msg.sender, block.number)
        );
        if (usedPayments[paymentKey]) revert PaymentAlreadyUsed();
        usedPayments[paymentKey] = true;

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

    function getTierCost(Tier tier) external view returns (uint256) {
        return tierCosts[tier];
    }

    function isPaymentUsed(
        bytes32 nodeId,
        address sender,
        uint256 blockNum
    ) external view returns (bool) {
        bytes32 key = keccak256(abi.encodePacked(nodeId, sender, blockNum));
        return usedPayments[key];
    }

    // ── Admin ──

    function setCost(uint256 newCost) external onlyOwner {
        if (newCost == 0) revert InvalidCost();
        uint256 oldCost = costPerGeneration;
        costPerGeneration = newCost;
        emit CostUpdated(oldCost, newCost);
    }

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

    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoBalanceToWithdraw();
        (bool sent, ) = developerTreasuryWallet.call{value: balance}("");
        if (!sent) revert WithdrawFailed();
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
