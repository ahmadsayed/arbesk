// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "./ArbeskAssetBase.sol";

/**
 * @title ArbeskAssetFree
 * @dev Free-tier contract: NFT + Merkle-root editor architecture.
 *      Inherits base NFT/Merkle logic from ArbeskAssetBase.
 *      Adds free `recordGeneration()` with a 10/day per-wallet quota.
 *
 *      MAX_EDITORS_PER_TOKEN = 5000 (safety net — full list on IPFS).
 */
contract ArbeskAssetFree is ArbeskAssetBase {
    // ── Custom Errors ──
    error InvalidPromptLength();
    error InvalidNodeId();
    error DailyGenerationLimitReached(uint256 limit);

    // ── Constants ──
    uint256 public constant MAX_EDITORS_PER_TOKEN = 5000;

    // ── Packed Quota State ──
    struct GenerationQuota {
        uint128 day;
        uint128 count;
    }

    mapping(address => GenerationQuota) internal _generationQuota;
    uint256 public constant DAILY_GENERATION_LIMIT = 10;

    // ── View Functions ──

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

    // ── Constructor ──
    constructor() ArbeskAssetBase("ArbeskAssetFree", "ARBF") {}

    // ── Free Generation Recording ──

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
