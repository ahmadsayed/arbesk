# Security Notes — ArbeskAsset / ArbeskAssetFree

**Date:** 2026-07-18
**Contracts:** `blockchain/contracts/ArbeskAsset.sol` (paid tier), `ArbeskAssetFree.sol` (free tier), shared abstract base `ArbeskAssetBase.sol`
**Solidity:** ^0.8.20 (compiled 0.8.24, Cancun EVM) · OpenZeppelin v5

This document describes the current Merkle-editor design. It replaces the
previous assessment, which covered removed code (`usedPayments`,
`ERC721Enumerable`, on-chain editor arrays, `MAX_TOKENS_PER_EDITOR`).

---

## 1. Merkle Editor Authorization

The full editor list lives on IPFS; the chain stores only a Merkle root, a
monotonic `editorSetVersion`, and the list's CID per token (4 storage slots
per token total, no unbounded on-chain loops).

- **Leaf construction:** `keccak256(abi.encodePacked(address, role, tokenId, editorSetVersion))`.
  Binding `tokenId` prevents cross-token proof replay; binding
  `editorSetVersion` makes every proof stale the moment the set changes
  (`updateEditors` bumps the version before storing the new root).
- **Editor-gated operations:** `updateAssetURI`, `updateEditors`, and `burn`
  all require a valid proof of the `Editor` role against the *current* root.
  Verification is OpenZeppelin `MerkleProof` (sorted-pair hashing); the
  off-chain tree is built with `@openzeppelin/merkle-tree`
  (`SimpleMerkleTree`), which is byte-compatible by construction.
- **Zero-root guard:** `publishAsset` reverts with `ZeroEditorRoot` if given
  `bytes32(0)` — a zero root would permanently brick the token, since no
  proof can ever verify against it.
- **Transfers do not touch the editor set.** A new owner who is not in the
  Merkle tree cannot perform editor-gated operations until an existing
  Editor adds them via `updateEditors`. Contract `owner()` is likewise not
  implicitly an editor.

## 2. Generation Payments & Quotas

- **Free tier (`ArbeskAssetFree.recordGeneration`):** 10 generations/day per
  wallet, tracked in a packed `(uint128 day, uint128 count)` struct that
  resets on day rollover. The contract `owner()` bypasses the quota
  (operational convenience); Merkle editor checks still apply to owner
  publishes. The quota check short-circuits before the `owner()` SLOAD.
- **Paid tier (`ArbeskAsset.payForGenerationWithUSDC`):** USDC-only (there is
  no native-token payment path). Per-tier pricing in `tierCosts` (6-decimal
  USDC), owner-adjustable via `setTierCost`. Funds go directly to
  `developerTreasuryWallet` via `SafeERC20.safeTransferFrom`; `nonReentrant`
  guards the payment and `withdrawUSDC`. Payments emit
  `AssetGenerationPaidUSDC`, recording paid generations for off-chain
  indexing.
- **`receive()`/`fallback()` revert** — no way to accidentally lock ETH.
- **Payment verification is NOT wired yet.** `POST /api/v1/generations`
  gates on session + rate limit only — the backend does not validate
  transaction hashes or index payment events. Blast radius is zero today
  (only the mock generation adapter is wired; cloud adapters return 501),
  but on-chain payment/generation-event verification MUST be wired before
  real cloud generation adapters land. There is deliberately no on-chain
  payment nonce.

## 3. Pause Scope — Payment-Only by Design

`pause()` gates only the generation/payment entry points
(`recordGeneration`, `payForGenerationWithUSDC`). Publishing, URI updates,
editor-set changes, and burn stay live while paused, so an emergency pause
can never freeze users' ability to manage or burn their assets.

## 4. Burn & Data Lifecycle

`burn(tokenId, proof)` requires an Editor proof, deletes the Merkle state
(storage refund), and emits `AssetBurned`. The backend then unpins the
token's IPFS manifest chain and comments archive (`[UNPIN]`/`[BURN]` flow),
making the data GC-eligible. On-chain references are content-addressed
CIDs, so burned-token data simply becomes unreachable.

## 5. Centralization — Single Owner (Accepted for Dev, Multisig Before Mainnet)

All admin functions (`setTreasury`, `setUsdcToken`, `setTierCost`, `pause`,
`unpause`, `withdrawUSDC`) are single-`onlyOwner` calls with no timelock.
A compromised owner key can redirect future payments and pause generation
(but cannot steal published tokens or forge editor proofs).

| Milestone | Mitigation |
|-----------|------------|
| **Now (dev/testnet)** | Single owner key, Dockerized Hardhat, `.env` never committed |
| **Before mainnet** | Deploy with a multisig wallet (e.g., Gnosis Safe) as `owner` |
| **Future** | Optionally add OZ `TimelockController` for `setTreasury` / `setUsdcToken` |

## 6. Mock Generation Gating

The mock 3D-generation adapter exists for local dev/E2E only and is gated
strictly on `MOCK_3D_GENERATION` in the backend environment. MockUSDC minting
is likewise limited to local deploys (`deploy.js` deploys it only on
hardhat/localhost). Never deploy mock adapters to production.

---

## What the Test Suite Covers

`blockchain/test/ArbeskAsset.test.js` exercises: deployment state, USDC
payment (event, tier costs, disabled-USDC revert, input validation, pause),
Merkle proof verification (valid/invalid/stale/cross-token/single-leaf/
100-editor trees), `updateEditors` role enforcement and version-bump
invalidation, the zero-root publish guard, burn (proof required, state
cleanup, no double-burn), free-tier quota + owner bypass, and transfer
semantics (editor set unchanged; new owner has no implicit rights).
