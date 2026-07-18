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
        _validateGenerationInput(nodeId, prompt);

        uint256 today = block.timestamp / 86400;
        GenerationQuota storage quota = _generationQuota[msg.sender];

        if (today > quota.day) {
            quota.day = uint128(today);
            quota.count = 0;
        }

        // Quota check first: short-circuits before the owner() SLOAD in the
        // common case (any wallet under the daily limit).
        if (quota.count >= DAILY_GENERATION_LIMIT && msg.sender != owner())
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
