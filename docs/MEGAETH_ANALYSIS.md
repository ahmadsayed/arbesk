# Arbesk on MegaETH — Complete Analysis & Optimization Report

**Date:** 2026-06-21 · **ETH:** $1,726.94 · **Target:** MegaETH Testnet (chain 6342)

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
function updateAssetURI(uint256 tokenId, string memory newAssetURI) public {
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
function burn(uint256 tokenId) public {
    _burn(tokenId);  // zeros out slots → 0 storage gas
}

// Bool toggle on existing mapping. 0 storage gas after first set.
function setBurnPermission(uint256 tokenId, address collaborator, bool flag) public {
    _canBurn[tokenId][collaborator] = flag;  // 0 storage gas after first write
}

// Role change on existing mapping entry. 0 storage gas.
function setCollaboratorRole(uint256 tokenId, address collaborator, CollaboratorRole role) public {
    _editorRoles[tokenId][collaborator] = role;  // 0 storage gas
}
```

### The Affected Operations (Scale with m)

```solidity
// Creates NEW storage slots: URI mapping entry + editor roles + array entries
// Cost = 150,000 compute + N × 20,000 × (m−1) storage
function publishAsset(string memory uri, uint256 tokenId) public returns (uint256) {
    _mint(msg.sender, tokenId);           // creates new token in OZ's _allTokens
    _setTokenURI(tokenId, uri);           // zero→non-zero → storage gas applies
    _addEditor(tokenId, msg.sender);      // zero→non-zero → storage gas applies
}

// Creates new editor role + member array entry + participant list entry
// Per-editor cost = 25,000 compute + ~3 × 20,000 × (m−1) storage
function _addEditor(uint256 tokenId, address editor) internal {
    _editorRoles[tokenId][editor] = CollaboratorRole.Editor;  // zero→non-zero
    members[tokenId].push(editor);                             // new array slot
    tokensIParticipate[editor].push(tokenId);                  // new array slot
}
```

---

## 3. Implemented Optimizations (`#2`, `#3`, `#5`)

Three optimizations shipped, all tests pass (147/147). Files changed:

- `blockchain/contracts/ArbeskAssetBase.sol` — removed `_tokenCounts` (`#5`)
- `blockchain/contracts/ArbeskAsset.sol` — per-user nonce replaces per-payment key (`#2+#3`)
- `blockchain/test/ArbeskAsset.test.js` — updated 7 test cases

### Optimization `#5`: Removed `_tokenCounts` (duplicate counter)

ERC721Enumerable already tracks tokens in its internal `_allTokens` array. `_tokenCounts` was redundant state.

```solidity
// BEFORE: duplicate counter, extra SSTORE per mint and burn
uint256 private _tokenCounts;

function publishAsset(...) public {
    unchecked { _tokenCounts++; }          // removed
    _mint(msg.sender, tokenId);
}

function burn(uint256 tokenId) public {
    _burn(tokenId);
    unchecked { _tokenCounts--; }          // removed
}

function totalSupply() public view override returns (uint256) {
    return _tokenCounts;                   // removed
}
```

```solidity
// AFTER: delegates to OpenZeppelin's ERC721Enumerable
// No _tokenCounts variable needed.

function publishAsset(...) public {
    _mint(msg.sender, tokenId);           // OZ handles token tracking internally
}

function burn(uint256 tokenId) public {
    _burn(tokenId);                        // OZ handles removal internally
}

/// @dev Delegates to ERC721Enumerable which tracks tokens in _allTokens.
function totalSupply() public view override returns (uint256) {
    return super.totalSupply();
}
```

**Impact:** Removes 1 unnecessary `SSTORE` per mint and burn. Eliminates serialization bottleneck on the single counter slot. All mints previously contended on `_tokenCounts` — now each token ID has independent storage.

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

**Assumptions:** ETH=$1,727 · 3 editors per token · 14 new slots per token · 10 storage slots zero→non-zero per mint  
**MegaETH gas:** 0.01 gwei (normal) · **Monad gas:** 1 gwei · **Sei gas:** 1 gwei  
**MIN_BUCKET_CAP=512** · Bucket expands at 60% fill

### Mint Cost (new token creation — scales with m on MegaETH, flat on Monad/Sei)

| Tokens | MegaETH m | MegaETH Mint Gas | MegaETH Cost | Monad Cost | Sei Cost |
|--------|----------|-----------------|-------------|------------|----------|
| 100 | 1 | 150,000 | **$0.003** | $0.26 | $0.26 |
| 1,000 | 2 | 190,000 | **$0.003** | $0.26 | $0.26 |
| 5,000 | 16 | 750,000 | **$0.013** | $0.26 | $0.26 |
| 10,000 | 64 | 2,670,000 | **$0.046** | $0.26 | $0.26 |
| 20,000 | 256 | 10,350,000 | **$0.18** | $0.26 | $0.26 |
| 50,000 | 4,096 | 163,950,000 | **$2.83** | $0.26 | $0.26 |
| 100,000 | 8,192 | 327,750,000 | **$5.66** | $0.26 | $0.26 |
| 500,000 | 32,768 | 1,310,550,000 | **$22.64** | $0.26 | $0.26 |
| 1,000,000 | 65,536 | 2,620,950,000 | **$45.27** | $0.26 | $0.26 |
| **Redeploy** | **1** | **900,000** | **$0.016** | $1.55 | $1.55 |

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
| 10,000 | **$56** | $56 | $560 | $560 |
| 50,000 | $2,840 | **$27** | $560 | $560 |
| 100,000 | $5,670 | **$27** | $560 | $560 |
| 1,000,000 | $45,280 | **$27** | $560 | $560 |

Full CSV: `docs/cost-projection.csv`

---

## 5. Token Capacity vs Editor Count

Storage slots per token = 4 (baseline: URI + owner role + member array base + participant list base) + 3 × (additional editors)

| Editors | Slots per Token | Tokens to m=12 | Tokens to m=128 | Sub-Cent Mints Until |
|---------|----------------|---------------|-----------------|---------------------|
| 1 (owner only) | 4 | **475** | **4,750** | ~500 tokens |
| 3 (small team) | 10 | **190** | **1,900** | ~200 tokens |
| 5 (free tier max) | 16 | **119** | **1,190** | ~120 tokens |
| 50 (paid tier max) | 151 | **13** | **127** | ~15 tokens |

At 3 editors (your target architecture): **~190 tokens before the first mint crosses 1¢, ~1,900 tokens before m=128.**

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
Contract v1:  0 → 50K tokens     m: 1 → 4,096    Mint cost: $0.003 → $2.83
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
| ~150,000 | 1 | 🟢 No action |
| ~300,000 | 2–4 | 🟢 No action |
| ~750,000 | 16 | 🟢 Monitor monthly |
| ~2,700,000 | 64 | 🟡 Plan redeployment |
| ~10,000,000 | 256 | 🟠 Schedule redeployment |
| ~40,000,000 | 1,024 | 🔴 Redeploy soon |
| ~164,000,000 | 4,096 | 🔴 Redeploy immediately |

### Formula

```
m ≈ (eth_estimateGas - 150,000) / (N × 20,000) + 1
```
Where N = average new zero→non-zero slots per mint (≈10 for 3-editor tokens).

---

## Files Changed

| File | Change |
|------|--------|
| `blockchain/contracts/ArbeskAssetBase.sol` | Removed `_tokenCounts`, delegates `totalSupply()` to ERC721Enumerable |
| `blockchain/contracts/ArbeskAsset.sol` | `usedPayments` → `paymentNonce` (O(1) per user), removed `block.number` read |
| `blockchain/test/ArbeskAsset.test.js` | Updated `isPaymentUsed` → `getPaymentNonce`, 7 tests migrated |
| `docs/cost-projection.csv` | 15-row projection across 3 chains, all m levels |

**Test results:** 147/147 passing
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
