# Arbesk on MegaETH — Storage Gas Analysis & Optimization Report

**Date:** 2026-06-22 · **Target:** MegaETH (testnet chain 6343 · mainnet chain 4326)

> **Major revision (2026-06-22).** Earlier versions of this report (and an interim "single-bucket" recomputation) were built on a wrong mental model of MegaETH's bucket multiplier. Verified against the [SALT source](https://github.com/megaeth-labs/salt), the MegaETH Gas Model / MegaEVM docs, and live network params:
>
> - **The multiplier is _global_, not per-contract.** Keys are assigned to buckets by `f(key) % 256^3` → **16,777,216 buckets**. A contract's storage slots scatter uniformly across all of them; you cannot fill "your own" bucket. The multiplier a write pays reflects *global* chain state density, which the docs say is **"typically 1"** — *"developers typically do not need to consider the bucket multiplier when designing contracts."*
> - **Buckets grow in 256-slot _segments_** (m = 1, 2, 3, 4 …), not by doubling (1, 2, 4, 8 …). A 768-slot bucket = three segments = m=3.
> - **`MIN_BUCKET_SIZE = 256`** (not 512). **No production fill-threshold (60 % / 80 %) exists** in the spec — the only load-factor knob is a *test* env var (`BUCKET_RESIZE_LOAD_FACTOR_PCT`, default 1 %).
> - **Base fee is `0.001` gwei** (not `0.01`), with EIP-1559 adjustment effectively disabled.
>
> **Consequences:** the previous token-count → `m` table, the redeployment "treadmill," and the §5–7 capacity math were all invalid and have been removed. The durable, well-sourced result is simpler and *better* than the old report claimed: **for any realistic app workload, your contract sits at m=1, so new-slot storage is free and overwrites/zeroing are always free.**

---

## Table of Contents

1. [How MegaETH Storage Gas Actually Works](#1-how-megaeth-storage-gas-actually-works)
2. [Which Operations Cost Storage Gas](#2-which-operations-cost-storage-gas)
3. [Implemented Optimizations](#3-implemented-optimizations)
4. [Cross-Chain Cost Comparison (Per Unit of Gas)](#4-cross-chain-cost-comparison-per-unit-of-gas)
5. [What This Means for Arbesk](#5-what-this-means-for-arbesk)
6. [Monitoring](#6-monitoring)

---

## 1. How MegaETH Storage Gas Actually Works

MegaETH uses a **SALT state trie** (not Ethereum's Merkle Patricia Trie). MegaEVM splits gas into **compute gas** (identical to Ethereum) and **storage gas** (new). Storage gas models the cost of growing on-chain state and is the only part that behaves differently from Ethereum.

### The bucket multiplier

State lives in **buckets**. Per the [SALT spec](https://github.com/megaeth-labs/salt):

- *"A bucket is initialized with 256 slots."* (`MIN_BUCKET_SIZE = 256`)
- *"When it fills up, it can be resized to a multiple of 256. If a bucket grows beyond 256 slots, it is partitioned into 256-slot segments."* → capacities are 256, 512, 768, 1024 … and the multiplier increments by 1 per segment.
- *"a hash of the key (`f(key) % 256^3`) is used to identify the correct bucket"* → **16,777,216 buckets**, and a key's bucket is chosen by hash, so any contract's slots are spread uniformly across the whole space.

```
m = bucket_capacity / MIN_BUCKET_SIZE        // MIN_BUCKET_SIZE = 256, m ∈ {1, 2, 3, 4, …}
storage_gas(zero→non-zero) = base_cost × (m − 1)
```

| Operation | base | m=1 | m=2 | m=3 |
|-----------|------|-----|-----|-----|
| Zero→non-zero SSTORE | 20,000 | **0** | 20,000 | 40,000 |
| Account creation | 25,000 | **0** | 25,000 | 50,000 |
| Contract creation | 32,000 | **0** | 32,000 | 64,000 |

### Why `m` is effectively always 1 for your contract

Because buckets are chosen by hashing the key, the multiplier a write pays is a function of how full *that one bucket* is — and that fullness is the sum of keys from the **entire chain**, not from your app. For the average bucket to even reach m=2, total chain state must approach `16.7M × 256 ≈ 4.3 billion` populated slots. A contract minting, say, 100,000 tokens (~400,000 slots) sprays those slots across millions of otherwise-near-empty buckets — its own contribution to any single bucket's fill is negligible.

MegaETH's docs say this directly:

> *"Unless a bucket has expanded to handle heavy storage needs, the bucket multiplier is typically 1. Developers typically do not need to consider the bucket multiplier when designing contracts."*

**Takeaway:** treat new-slot storage as **free** in normal operation. The multiplier only bites under chain-wide state pressure that no single application controls — and which (see §5) you cannot escape by redeploying.

---

## 2. Which Operations Cost Storage Gas

Storage gas applies **only** when a slot goes **zero → non-zero**, and only then scaled by `m`. Once a slot is non-zero, every future write to it costs **0 storage gas** regardless of `m`. Zeroing a slot is also free. At m=1 (the normal case) even the zero→non-zero writes are free.

### Immune operations (0 storage gas at any `m`)

```solidity
// Non-zero → non-zero overwrite. Always 0 storage gas.
function updateAssetURI(uint256 tokenId, string memory newAssetURI, bytes32[] calldata proof) public {
    _setTokenURI(tokenId, newAssetURI);  // _tokenURIs[tokenId] already non-zero from publishAsset
    emit AssetURIUpdated(tokenId, newAssetURI);
}

// Packed quota slot: first write zero→non-zero, all later writes non-zero→non-zero.
function recordGeneration(bytes32 nodeId, string calldata prompt) external {
    uint256 today = block.timestamp / 86400;
    GenerationQuota storage quota = _generationQuota[msg.sender];
    if (today > quota.day) { quota.day = uint128(today); quota.count = 0; }
    quota.count++;  // 0 storage gas after the first write of the day
}

// Zeros out slots → 0 storage gas.
function burn(uint256 tokenId, bytes32[] calldata proof) public { _burn(tokenId); }

// Root/version overwrite on an existing mapping → 0 storage gas after first set.
function updateEditors(uint256 tokenId, bytes32 newRoot, string calldata newListUri,
                       CollaboratorRole callerRole, bytes32[] calldata callerProof) external {
    editorSetVersion[tokenId]++;
    editorRoot[tokenId] = newRoot;
    emit EditorSetChanged(tokenId, newRoot, editorSetVersion[tokenId], newListUri);
}
```

### New-slot operations (would scale with `m`, but `m=1` in practice)

```solidity
// Creates ~4 new zero→non-zero slots: owner entry, URI entry, editorRoot, editorSetVersion,
// editorListURI. Editor count is off-chain, so mint cost is independent of editor count.
// Compute ≈ 165,000 gas. Storage gas = 4 × 20,000 × (m−1) — which is 0 while m=1.
function publishAsset(string memory uri, uint256 tokenId, bytes32 editorRoot_, string memory editorListUri)
    public returns (uint256)
{
    _mint(msg.sender, tokenId);
    _setTokenURI(tokenId, uri);
    initEditors(tokenId, editorRoot_, editorListUri);
}
```

> Two refinements reported in the `mega-evm` repo that this report does not independently verify but flags for completeness: a per-transaction **intrinsic storage-gas baseline (~39,000)** and a **10× storage-gas multiplier on LOG data** for emitted events. Both are small next to compute gas and do not change the m=1 conclusion.

---

## 3. Implemented Optimizations

These are real, code-accurate wins. They reduce **absolute slot count and compute gas** — they are *not* needed to control the multiplier (which stays at 1 anyway), but lower state growth and gas are good hygiene regardless.

| Optimization | File | Effect |
|---|---|---|
| Removed `ERC721Enumerable` | `ArbeskAssetBase.sol` | Drops `_allTokens` / `_ownedTokens` arrays + redundant `_tokenCounts`; mint gas no longer grows with supply |
| Merkle editor roots | `ArbeskAssetBase.sol` | Editor list moves off-chain; only a root + version + URI on-chain, independent of editor count |
| `usedPayments` → `paymentNonce` | `ArbeskAsset.sol` | Replaces O(payments) slot growth with O(users); removes the volatile `block.number` read |

### Removed `ERC721Enumerable` (valid)

The base previously inherited `ERC721Enumerable`, whose `_allTokens` / per-owner `_ownedTokens` arrays added ~3 writes per mint and made mint gas grow with total supply. It now inherits plain `ERC721`; the gallery rebuilds the owned-token list off-chain by scanning `Transfer` events. Mint now touches ~4 new slots per token, flat with respect to supply. ✅

### Merkle editor roots (valid)

The editor set lives off-chain as a list on IPFS; the contract stores only `editorRoot`, `editorSetVersion`, and `editorListURI`. Authorization is by Merkle proof. Mint and editor-update cost are independent of editor count. ✅

### `paymentNonce` — storage win is real, the "replay protection" claim is **false**

The change from `usedPayments` (a new slot per payment, keyed partly on `block.number`) to a per-user `paymentNonce` does two genuinely useful things:

1. **Eliminates O(payments) state growth** — `usedPayments` minted a fresh slot on every payment forever; `paymentNonce` is one slot per user, overwritten thereafter.
2. **Removes the `block.number` read**, which is volatile data subject to MegaETH's gas-detention rules.

But the documented rationale — *"per-user nonce for payment replay protection"* — does not hold. In the shipped code (`ArbeskAsset.sol:103-127`, USDC path `131-159`):

```solidity
uint256 nonce = paymentNonce[msg.sender];
unchecked { paymentNonce[msg.sender] = nonce + 1; }   // incremented…
// …but `nonce` is never read in a require/revert, and never included in the emitted event.
```

The nonce is **inert**: it is never checked and never emitted, so it enforces nothing. And there is nothing to replay in the first place — the caller *is* the payer (`msg.sender`), no signature is submitted, and each call transfers real ETH/USDC. The "same-transaction / cross-transaction / cross-block: impossible" proof in earlier versions reasoned about a non-problem.

This is **not a security hole** (you cannot forge `msg.sender`, and value moves on every call), but the NatSpec is misleading and the nonce is a **wasted SSTORE on every payment**. A future contract revision could drop it entirely; until then, document it as currently inert. *(Per this turn's decision, no contract change is made here — doc correction only.)*

---

## 4. Cross-Chain Cost Comparison (Per Unit of Gas)

The original report priced **Monad and Sei gas using ETH's price (~$1,700)**, when those chains pay in **MON** and **SEI**. Corrected, the four chains land within a small multiple of each other — Monad/Sei are *not* ~100× more expensive than MegaETH; they're roughly on par.

The robust, operation-independent comparison is just `gas_price × token_price`:

| Chain | Gas token | Gas price | Cost per 1M gas |
|---|---|---|---|
| Sei | SEI | 10 gwei | **~$0.00053** |
| MegaETH | ETH | 0.001 gwei | **~$0.00173** |
| Optimism (L2 only) | ETH | ~0.001 gwei | **~$0.00173** + L1 data fee |
| Monad | MON | 100 gwei | **~$0.00207** |

All four sit within ~4× per unit of gas. MegaETH's near-zero gwei × expensive ETH and Monad's high gwei × cheap MON nearly cancel out.

> ⚠️ **Caveats — read before quoting any dollar figure:**
> - **Token prices are point-in-time (June 2026) and volatile.** Only ETH (~$1,725) was independently re-verified here; MON (~$0.0207) and SEI (~$0.053) are taken from the supplied research and should be re-checked before use. The per-1M-gas column moves with these prices.
> - **Per-*operation* dollar totals require `eth_estimateGas`** against the actual compiled contract on each chain — the gas-*used* figures depend on contract bytecode, calldata, and optimizer settings.
> - **Chain-specific quirks not captured above:** Optimism adds an **L1 data fee** (the largest swing — cheap today at low Ethereum base fee + blobs, but real); **Monad bills the gas _limit_, not gas _used_** (pad ~1.3×); **Sei reportedly charges 72,000 gas per SSTORE** (would inflate storage-heavy mints — unverified here).
> - **MegaETH testnet (6343) costs are testnet ETH with no real value;** mainnet is chain 4326 at the same 0.001 gwei base fee.

For a realistic mint at **m=1** (~165–200k compute gas, 0 storage gas) the MegaETH cost is on the order of **$0.0003**. See `docs/cost-projection.csv` for the per-1M-gas and m=1 per-operation figures with the price assumptions spelled out.

---

## 5. What This Means for Arbesk

- **No redeployment strategy is needed — and redeploying wouldn't help anyway.** A fresh contract gets a new address, so its keys hash into *different* buckets — but those buckets live in the same 16.7M-bucket global space at the same global fill level. You resample the same distribution. Worse, the old contract's slots are not deleted, so global density doesn't drop. **Redeploying does not reset the multiplier.** The earlier "redeploy every 50K tokens" treadmill solved a problem that does not exist.
- **Effective token capacity is unbounded from your contract's perspective.** You will not drive your own `m` up by minting; only chain-wide state growth (billions of slots) could, and that is outside any single app's control.
- **The durable optimizations still pay off** (smaller absolute state, mint gas flat with supply, editor-count-independent storage) — keep them for hygiene, not for multiplier control.
- **At m=1, the whole cost model collapses to compute gas**, which is standard EVM gas and trivially cheap at 0.001 gwei.

---

## 6. Monitoring

You don't need to track token-count thresholds. The single useful check is whether mint gas has risen above its m=1 baseline — which would signal **chain-wide** congestion, not anything you can fix by redeploying.

```bash
curl -s https://carrot.megaeth.com/rpc \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_estimateGas","params":[{
        "from":"0xYourAddress","to":"0xContractAddress",
        "data":"0xCalldataForPublishAsset"}],"id":1}'
```

- **Result ≈ compute baseline (~165–200k):** `m = 1`, storage free. Normal — no action.
- **Result materially above baseline:** some bucket(s) your slots hit have globally expanded (`storage_gas = N × 20,000 × (m−1)`, N ≈ 4 new slots/mint). This is a network-wide condition; redeploying will not help. Re-evaluate whether to keep minting during the congestion window.

`eth_estimateGas` is the **only** authoritative source for `m` on a live contract — never derive it from your own token count.

---

## Files Changed (contracts/frontend — unchanged by this report)

| File | Change |
|------|--------|
| `blockchain/contracts/ArbeskAssetBase.sol` | Removed `ERC721Enumerable`; stores only `_tokenURIs`, `editorRoot`, `editorSetVersion`, `editorListURI` (~4 slots/token) |
| `blockchain/contracts/ArbeskAsset.sol` | `usedPayments` → `paymentNonce` (O(users)), removed `block.number` read; updated for Merkle editor ABI. **Note:** `paymentNonce` is currently inert (never checked/emitted) — see §3 |
| `blockchain/contracts/ArbeskAssetFree.sol` | Updated for Merkle editor ABI |
| `blockchain/test/ArbeskAsset.test.js` · `ArbeskAssetFree.test.js` | Updated for per-user nonce, Merkle authorization, non-Enumerable ABI |
| `frontend/src/js/ui/asset-library.js` | Replaced `tokenOfOwnerByIndex` with off-chain `Transfer` event scanning |
| `frontend/src/js/gltf/merkle-editors.js` · `frontend/src/js/services/team.js` | Merkle tree/proof library + editor service |
| `docs/cost-projection.csv` | Replaced invalid token-count→m projection with per-1M-gas + m=1 per-operation costs across 4 chains |

**Compilation:** Clean on Solidity 0.8.24, Cancun EVM

---

## Key Resource Links

| Resource | URL |
|----------|-----|
| MegaETH Gas Model | https://docs.megaeth.com/developer-docs/overview-3/gas-model |
| MegaEVM | https://docs.megaeth.com/megaevm |
| SALT source (bucket assignment, segments) | https://github.com/megaeth-labs/salt |
| MegaETH Resource Limits | https://docs.megaeth.com/developer-docs/overview-3/resource-limits |
| MegaETH Volatile Data | https://docs.megaeth.com/developer-docs/overview-3/volatile-data |
| MegaETH Gas Estimation | https://docs.megaeth.com/developer-docs/overview-1/gas-estimation |
| Arbesk contracts | `blockchain/contracts/ArbeskAsset{,Base,Free}.sol` |
| Cost Projection CSV | `docs/cost-projection.csv` |
