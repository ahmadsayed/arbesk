// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "./ArbeskAssetBase.sol";

/**
 * @title ArbeskAssetFree
 * @dev Free-tier contract: NFT + Collaboration with no payment.
 *      Inherits all base logic from ArbeskAssetBase.
 *      Adds free `recordGeneration()` with a 10/day per-wallet quota.
 *      Collaboration limits are 10x lower than the paid tier.
 *      Quota state is packed into a single 256-bit storage slot to minimize gas.
 */
contract ArbeskAssetFree is ArbeskAssetBase {
    // ── Custom Errors ──
    error InvalidPromptLength();
    error InvalidNodeId();
    error DailyGenerationLimitReached(uint256 limit);

    // ── Packed Quota State ──
    // Packs day + count into one slot: one cold SLOAD/SSTORE on first use,
    // one warm SLOAD/SSTORE on subsequent uses same day.
    struct GenerationQuota {
        uint128 day;
        uint128 count;
    }

    mapping(address => GenerationQuota) internal _generationQuota;
    uint256 public constant DAILY_GENERATION_LIMIT = 10;

    // ── Backward-Compatible View Functions ──
    function lastGenerationDay(address user) public view returns (uint256) {
        return _generationQuota[user].day;
    }

    function generationCountToday(address user) public view returns (uint256) {
        return _generationQuota[user].count;
    }

    // ── Events ──
    event AssetGenerationRecorded(
        address indexed userWallet,
        bytes32 indexed nodeId,
        string prompt,
        uint256 timestamp,
        uint256 countToday
    );

    // ── Quota Overrides ──
    function maxEditorsPerToken() public pure override returns (uint256) {
        return 5;
    }

    function maxTokensPerEditor() public pure override returns (uint256) {
        return 50;
    }

    // ── Constructor ──
    constructor() ArbeskAssetBase("ArbeskAssetFree", "ARBF") {}

    // ── Free Generation Recording ──

    /**
     * @notice Record a free generation attempt. Enforces a 10/day per-wallet quota.
     * @param nodeId Unique identifier for the target scene node.
     * @param prompt Text prompt sent to the generation engine.
     * @dev No payment required. Emits AssetGenerationRecorded for off-chain tracking.
     */
    function recordGeneration(
        bytes32 nodeId,
        string calldata prompt
    ) external whenNotPaused {
        uint256 promptLen = bytes(prompt).length;
        if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
        if (nodeId == bytes32(0)) revert InvalidNodeId();

        uint256 today = block.timestamp / 86400;
        GenerationQuota storage quota = _generationQuota[msg.sender];

        if (today > quota.day) {
            quota.day = uint128(today);
            quota.count = 0;
        }

        // Owner bypasses the daily quota for administration/load testing,
        // but we still count usage for observability.
        if (msg.sender != owner() && quota.count >= DAILY_GENERATION_LIMIT)
            revert DailyGenerationLimitReached(DAILY_GENERATION_LIMIT);

        unchecked {
            quota.count++;
        }

        emit AssetGenerationRecorded(
            msg.sender,
            nodeId,
            prompt,
            block.timestamp,
            quota.count
        );
    }
}
