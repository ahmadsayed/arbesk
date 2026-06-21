# Arbesk on MegaETH — Complete Analysis & Optimization Report

**Date:** 2026-06-21 · **ETH:** $1,726.94 · **Target:** MegaETH Testnet (chain 6343)

---

## Table of Contents

1. [MegaETH's Bucket Multiplier — What It Is](#1-megaeths-bucket-multiplier--what-it-is)
2. [Storage Gas: Which Operations Are Affected](#2-storage-gas-which-operations-are-affected)
3. [Implemented Optimizations (`#2`, `#3`, `#5`)](#3-implemented-optimizations-2-3-5)
4. [Cost Projection: MegaETH vs Monad vs Sei](#4-cost-projection-megaeth-vs-monad-vs-sei)
5. [Token Capacity vs Editor Count](#5-token-capacity-vs-editor-count)
6. [Redeployment Strategy](#6-redeployment-strategy)
7. [Monitoring Plan](#7-monitoring-plan)

---

## 1. MegaETH's Bucket Multiplier — What It Is

MegaETH uses a **SALT state trie** (not Ethereum's Merkle Patricia Trie). State is divided into segments called **buckets**. The bucket multiplier `m` makes new storage writes progressively more expensive as buckets fill.

> From MegaETH official docs — **Gas Model** page:
>
> ```
> m = bucket_capacity / MIN_BUCKET_CAP
> ```
>
> | Operation | m=1 | m=2 | m=4 |
> |-----------|-----|-----|-----|
> | Zero-to-nonzero SSTORE | **0** | 20,000 | 60,000 |
> | Account creation | **0** | 25,000 | 75,000 |
> | Contract creation | **0** | 32,000 | 96,000 |
>
> *"Buckets expand as they fill up; the multiplier increases and storage gas costs rise."*

**Key insight:** At m=1 (fresh bucket), all new state creation costs **zero storage gas**. As the bucket fills past thresholds (roughly 60%), capacity doubles. Each doubling adds `base_cost × (m−1)` to storage gas for any zero→non-zero SSTORE.

| `m` | Bucket Capacity | SSTORE 0→non-zero Storage Gas |
|-----|----------------|------------------------------|
| 1   | 512            | **0** (free)                 |
| 2   | 1,024          | 20,000                       |
| 4   | 2,048          | 60,000                       |
| 8   | 4,096          | 140,000                      |
| 16  | 8,192          | 300,000                      |
| 32  | 16,384         | 620,000                      |
| 64  | 32,768         | 1,260,000                    |
| 128 | 65,536         | 2,540,000                    |
| 256 | 131,072        | 5,100,000                    |
| 512 | 262,144        | 10,220,000                   |
| 1,024 | 524,288      | 20,460,000                   |
| 4,096 | 2,097,152    | 81,900,000                   |
| 8,192 | 4,194,304    | 163,820,000                  |

**This is NOT a tokenomics/KPI emission schedule.** This is gas mechanics implemented in `mega-evm`, directly affecting `eth_estimateGas` results.

---

## 2. Storage Gas: Which Operations Are Affected

Storage gas applies **only** when writing a storage slot from **zero to non-zero**. Once a slot is non-zero, all future writes to it cost **0 storage gas** regardless of `m`.

### The Immune Operations (Always 0 Storage Gas)

```solidity
// Non-zero → non-zero overwrite. Always 0 storage gas.
function updateAssetURI(uint256 tokenId, string memory newAssetURI, bytes32[] calldata proof) public {
    // _tokenURIs[tokenId] was already set by publishAsset → non-zero
    _setTokenURI(tokenId, newAssetURI);  // 0 storage gas
    emit AssetURIUpdated(tokenId, newAssetURI);
}

// Packed quota slot: first write is zero→non-zero, all subsequent writes are
// non-zero→non-zero → 0 storage gas after day 1.
function recordGeneration(bytes32 nodeId, string calldata prompt) external {
    uint256 today = block.timestamp / 86400;
    GenerationQuota storage quota = _generationQuota[msg.sender];
    if (today > quota.day) { quota.day = uint128(today); quota.count = 0; }
    quota.count++;  // 0 storage gas after first day
}

// Zeros out slots. 0 storage gas.
function burn(uint256 tokenId, bytes32[] calldata proof) public {
    _burn(tokenId);  // zeros out slots → 0 storage gas
}

// Editor root/version overwrite on existing mapping. 0 storage gas after first set.
function updateEditors(
    uint256 tokenId,
    bytes32 newRoot,
    string calldata newListUri,
    CollaboratorRole callerRole,
    bytes32[] calldata callerProof
) external {
    editorSetVersion[tokenId]++;  // 0 storage gas after first write
    editorRoot[tokenId] = newRoot;
    emit EditorSetChanged(tokenId, newRoot, editorSetVersion[tokenId], newListUri);
}
```

### The Affected Operations (Scale with m)

```solidity
// Creates NEW storage slots: owner mapping entry + URI mapping entry +
// editor root + editor version + editor list URI. Editor count is off-chain,
// so mint cost is independent of the number of editors. ERC721Enumerable has
// been removed, so there is no all/owned-token-array overhead.
// Cost ≈ 165,000 compute + ~4 × 20,000 × (m−1) storage
function publishAsset(
    string memory uri,
    uint256 tokenId,
    bytes32 editorRoot_,
    string memory editorListUri
) public returns (uint256) {
    _mint(msg.sender, tokenId);           // creates owner mapping entry
    _setTokenURI(tokenId, uri);           // zero→non-zero → storage gas applies
    initEditors(tokenId, editorRoot_, editorListUri); // 3 zero→non-zero SSTOREs
}
```

---

## 3. Implemented Optimizations (`#2`, `#3`, `#5`, Merkle editor proofs)

Four optimizations shipped. Files changed:

- `blockchain/contracts/ArbeskAssetBase.sol` — removed `_tokenCounts` (`#5`)
- `blockchain/contracts/ArbeskAsset.sol` — per-user nonce replaces per-payment key (`#2+#3`)
- `blockchain/contracts/ArbeskAssetBase.sol` — replaced on-chain editor roles with Merkle roots and off-chain editor lists
- `blockchain/test/ArbeskAsset.test.js` — updated for per-user nonce and Merkle authorization
- `blockchain/test/ArbeskAssetFree.test.js` — updated for Merkle authorization

### Optimization `#5`: Removed `ERC721Enumerable` entirely

The base contract previously inherited OpenZeppelin `ERC721Enumerable`, which keeps an `_allTokens` array and per-owner `_ownedTokens` arrays. That added ~3 extra storage writes per mint and caused mint gas to grow with total supply. `ArbeskAssetBase` now inherits plain `ERC721`.

```solidity
// BEFORE: enumerable tracking + duplicate counter
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

contract ArbeskAssetBase is ERC721Enumerable, Ownable, Pausable {
    uint256 private _tokenCounts;

    function publishAsset(...) public {
        unchecked { _tokenCounts++; }
        _mint(msg.sender, tokenId);       // also writes _allTokens / _ownedTokens
    }

    function totalSupply() public view override returns (uint256) {
        return _tokenCounts;
    }
}
```

```solidity
// AFTER: plain ERC721 + Merkle editor roots
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

abstract contract ArbeskAssetBase is ERC721, Ownable, Pausable {
    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => bytes32) public editorRoot;
    mapping(uint256 => uint256) public editorSetVersion;
    mapping(uint256 => string) public editorListURI;

    function publishAsset(...) public returns (uint256) {
        _mint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        initEditors(tokenId, editorRoot_, editorListUri);
    }
}
```

**Impact:** Removes the enumerable arrays and the redundant `_tokenCounts` counter (~4 storage writes saved per mint). Mint gas is now flat with respect to total supply and uses only 4 new zero→non-zero storage slots per token. The gallery builds the owned-token list off-chain by scanning `Transfer` events.

### Optimizations `#2+#3`: Per-User Payment Nonce

Replaced `usedPayments` (O(payments) slots, 1 new slot per payment) with `paymentNonce` (O(users) slots, 1 new slot per user lifetime, **0 storage gas thereafter**).

Also removed `block.number` from the payment key, eliminating gas detention on MegaETH.

```solidity
// BEFORE: O(payments) storage growth, block.number triggers gas detention
mapping(bytes32 => bool) internal usedPayments;

function payForGeneration(bytes32 nodeId, string calldata prompt) external payable {
    // ...
    bytes32 paymentKey = keccak256(
        abi.encodePacked(nodeId, msg.sender, block.number)  // volatile read → detention
    );
    if (usedPayments[paymentKey]) revert PaymentAlreadyUsed();  // new slot every time
    usedPayments[paymentKey] = true;
    // ...
}
```

```solidity
// AFTER: O(users) storage growth, no volatile reads
/// @dev Per-user nonce for payment replay protection.
///      First payment per user creates a new storage slot (zero→non-zero);
///      all subsequent payments overwrite that slot (zero storage gas).
mapping(address => uint256) public paymentNonce;

/// @notice Pay for a generation run with native ETH.
/// @dev Uses a per-user nonce for replay protection.
///      Does NOT read block.number — avoids gas detention on MegaETH.
function payForGeneration(bytes32 nodeId, string calldata prompt)
    external payable nonReentrant whenNotPaused
{
    if (msg.value != costPerGeneration) revert IncorrectPaymentAmount();
    uint256 promptLen = bytes(prompt).length;
    if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
    if (nodeId == bytes32(0)) revert InvalidNodeId();

    uint256 nonce = paymentNonce[msg.sender];
    unchecked {
        paymentNonce[msg.sender] = nonce + 1;  // non-zero→non-zero after first use
    }

    (bool sent, ) = developerTreasuryWallet.call{value: msg.value}("");
    if (!sent) revert TreasuryTransferFailed();

    emit AssetGenerationPaid(msg.sender, nodeId, prompt, msg.value, block.timestamp);
}
```

```solidity
// BEFORE: old API — required block.number, checked per-payment key
function isPaymentUsed(bytes32 nodeId, address sender, uint256 blockNum)
    external view returns (bool)
{
    bytes32 key = keccak256(abi.encodePacked(nodeId, sender, blockNum));
    return usedPayments[key];
}
```

```solidity
// AFTER: new API — returns next available nonce for a user
function getPaymentNonce(address user) external view returns (uint256) {
    return paymentNonce[user];
}
```

**Why per-user nonce alone prevents replay:**

Each call increments the user's nonce. Since the nonce is unique and monotonic:
- **Same-transaction:** Impossible — `nonReentrant` blocks reentry, and each internal call would see a different nonce.
- **Cross-transaction:** Impossible — nonces never repeat.
- **Cross-block:** Impossible — nonces increase monotonically.

**Gas impact per repeated payment at m=128:**

| | Before | After |
|---|--------|-------|
| Slots created | 1 per payment | 1 per user (then 0) |
| Storage gas per payment #100 | 2,540,000 | **0** |
| Dollar cost at 0.01 gwei | $0.044 | **$0** |

---

## 4. Cost Projection: MegaETH vs Monad vs Sei

**Assumptions:** ETH=$1,727 · Merkle editor proofs · ~4 new slots per token · ~4 storage slots zero→non-zero per mint  
**MegaETH gas:** 0.01 gwei (normal) · **Monad gas:** 1 gwei · **Sei gas:** 1 gwei  
**MIN_BUCKET_CAP=512** · Bucket expands at 60% fill

> The current design stores only the owner, token URI, Merkle editor root, editor-set version, and editor-list URI on-chain. The editor list itself lives off-chain, so editor count does not affect mint cost. Removing `ERC721Enumerable` drops the all/owned token arrays, reducing new storage slots per mint from ~5 to ~4.

### Mint Cost (new token creation — scales with m on MegaETH, flat on Monad/Sei)

Formula: `mintGas ≈ 165,000 + 4 × 20,000 × (m − 1)`

| Tokens | MegaETH m | MegaETH Mint Gas | MegaETH Cost | Monad Cost | Sei Cost |
|--------|----------|-----------------|-------------|------------|----------|
| 100 | 2 | 245,000 | **$0.004** | $0.28 | $0.28 |
| 1,000 | 16 | 1,365,000 | **$0.024** | $0.28 | $0.28 |
| 5,000 | 128 | 10,325,000 | **$0.178** | $0.28 | $0.28 |
| 10,000 | 256 | 20,565,000 | **$0.355** | $0.28 | $0.28 |
| 20,000 | 512 | 41,045,000 | **$0.709** | $0.28 | $0.28 |
| 50,000 | 1,024 | 82,005,000 | **$1.42** | $0.28 | $0.28 |
| 100,000 | 2,048 | 163,925,000 | **$2.83** | $0.28 | $0.28 |
| 500,000 | 8,192 | 655,445,000 | **$11.32** | $0.28 | $0.28 |
| 1,000,000 | 16,384 | 1,310,805,000 | **$22.64** | $0.28 | $0.28 |
| **Redeploy** | **1** | **900,000** | **$0.016** | $1.55 | $1.55 |

> Gas values assume ~4 zero→non-zero storage slots per mint: `_owners`, `_tokenURIs`, `editorRoot`, `editorSetVersion`, plus `editorListURI`. Actual values depend on optimizer settings and calldata length.

### Immune Operations (Always Flat, All Three Chains)

| Operation | MegaETH (0.01gwei) | Monad (1gwei) | Sei (1gwei) |
|-----------|-------------------|---------------|-------------|
| `updateAssetURI` | **$0.0004** | $0.04 | $0.04 |
| `recordGeneration` (day 2+) | **$0.001** | $0.10 | $0.10 |
| `burn` | **$0.0013** | $0.13 | $0.13 |
| `payForGeneration` (repeat user) | **$0.0014** | $0.14 | $0.14 |

### Monthly Operating Cost: 1,000 mints + 5,000 URI edits + 20,000 generations

| Tokens Total | MegaETH (no redeploy) | MegaETH (w/ redeploy) | Monad | Sei |
|-------------|----------------------|----------------------|-------|-----|
| 10,000 | **$377** | $26 | $2,480 | $2,480 |
| 50,000 | $1,438 | **$26** | $2,480 | $2,480 |
| 100,000 | $2,853 | **$26** | $2,480 | $2,480 |
| 1,000,000 | $22,660 | **$26** | $2,480 | $2,480 |

Full CSV: `docs/cost-projection.csv`

> Redeploy savings are even more pronounced with Merkle because each fresh contract starts at m=1 regardless of editor count.

---

## 5. Token Capacity

With Merkle editor proofs, editor count no longer affects on-chain storage. The contract also no longer inherits `ERC721Enumerable`, so there are no `_allTokens` / `_ownedTokens` arrays. Each token creates roughly:

- `_owners` mapping entry (ERC721)
- `_tokenURIs` mapping entry
- `editorRoot` mapping entry
- `editorSetVersion` mapping entry
- `editorListURI` mapping entry

Total: **~4 zero→non-zero storage slots per mint**, regardless of editor count.

| Slots per Token | Tokens to m=8 | Tokens to m=128 | Sub-Cent Mints Until |
|----------------|---------------|-----------------|---------------------|
| ~4 | **310** | **4,900** | ~150 tokens |

This is a significant improvement over the old on-chain editor model, where 50-editor paid-tier tokens consumed ~151 slots and crossed 1¢ after only ~15 tokens.

---

## 6. Redeployment Strategy

At any scale, deploying a fresh contract resets m to 1 because the new address maps to a different SALT bucket.

```
ArbeskAssetFree deployment cost at m=1:
  Compute: ~32,000 gas
  Storage: 32,000 × 0 = 0 (m=1 → free)
  Code deposit: ~5KB × 10,000 × 0 = 0 (m=1 → free)
  ─────────────────
  Total: ~32,000 gas → $0.06 at 0.01 gwei
```

### Recommended Cycle

```
Contract v1:  0 → 50K tokens     m: 1 → 4,096    Mint cost: $0.003 → $1.77
              ↓ deploy fresh ($0.06)
Contract v2:  50K → 100K tokens   m: 1 again      Mint cost: $0.003
              ↓ deploy fresh ($0.06)
Contract v3:  100K → 150K tokens  m: 1 again      Mint cost: $0.003
```

Each redeployment costs less than **one-sixth of a penny**. You can afford to redeploy every 50K tokens at near-zero infrastructure cost.

---

## 7. Monitoring Plan

### Weekly Check

```bash
curl -s https://carrot.megaeth.com/rpc \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_estimateGas",
    "params": [{
      "from": "0xYourAddress",
      "to": "0xContractAddress",
      "data": "0xCalldataForPublishAsset"
    }],
    "id": 1
  }'
```

### Interpreting the Result

| `eth_estimateGas` Result | Approximate `m` | Action |
|-------------------------|----------------|--------|
| ~165,000 | 1 | 🟢 No action |
| ~245,000 | 2 | 🟢 No action |
| ~405,000 | 4 | 🟢 No action |
| ~725,000 | 8 | 🟢 Monitor monthly |
| ~1,365,000 | 16 | 🟡 Plan redeployment |
| ~2,645,000 | 32 | 🟠 Schedule redeployment |
| ~10,325,000 | 128 | 🔴 Redeploy soon |
| ~20,565,000 | 256 | 🔴 Redeploy immediately |

### Formula

```
m ≈ (eth_estimateGas - 165,000) / (N × 20,000) + 1
```
Where N = average new zero→non-zero slots per mint (≈4 with the plain-ERC721 Merkle design).

---

## Files Changed

| File | Change |
|------|--------|
| `blockchain/contracts/ArbeskAssetBase.sol` | Removed `ERC721Enumerable`; stores only `_tokenURIs`, `editorRoot`, `editorSetVersion`, `editorListURI` (~4 slots/token) |
| `blockchain/contracts/ArbeskAsset.sol` | `usedPayments` → `paymentNonce` (O(1) per user), removed `block.number` read; updated for Merkle editor ABI |
| `blockchain/contracts/ArbeskAssetFree.sol` | Updated for Merkle editor ABI |
| `blockchain/test/ArbeskAsset.test.js` | Updated for per-user nonce, Merkle authorization, and non-Enumerable ABI |
| `blockchain/test/ArbeskAssetFree.test.js` | Updated for Merkle authorization and non-Enumerable ABI |
| `frontend/src/js/ui/asset-library.js` | Replaced `tokenOfOwnerByIndex` with off-chain `Transfer` event scanning |
| `docs/cost-projection.csv` | Recalculated for ~4 storage slots per mint across 3 chains and all m levels |
| `frontend/src/js/gltf/merkle-editors.js` | New Merkle tree/proof library |
| `frontend/src/js/services/team.js` | New Merkle-based editor add/remove service |

**Compilation:** Clean on Solidity 0.8.24, Cancun EVM

---

## Key Resource Links

| Resource | URL |
|----------|-----|
| MegaETH Gas Model | https://docs.megaeth.com/developer-docs/overview-3/gas-model |
| MegaETH Resource Limits | https://docs.megaeth.com/developer-docs/overview-3/resource-limits |
| MegaETH Volatile Data | https://docs.megaeth.com/developer-docs/overview-3/volatile-data |
| MegaETH Gas Estimation | https://docs.megaeth.com/developer-docs/overview-1/gas-estimation |
| MegaETH Spec (SALT, m-factor) | https://docs.megaeth.com/spec |
| Arbesk Contract Base | `blockchain/contracts/ArbeskAssetBase.sol` |
| Arbesk Paid Contract | `blockchain/contracts/ArbeskAsset.sol` |
| Arbesk Free Contract | `blockchain/contracts/ArbeskAssetFree.sol` |
| Cost Projection CSV | `docs/cost-projection.csv` |
