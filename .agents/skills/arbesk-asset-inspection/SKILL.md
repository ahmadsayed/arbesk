---
name: arbesk-asset-inspection
description: Fetch and inspect Arbesk assets by token ID, manifest CID, or IPFS CID. Covers manifest chain walking, child node counting, fractal manifest structure, and token URI resolution. Use whenever someone wants to look up, fetch, inspect, or describe an Arbesk asset — "get asset 42", "what's in token 172409538", "show the manifest for CID baf...", "how many children does this world have", "walk the version history", "why can't I resolve token X", "what does this asset contain", or any question about a specific asset's content, structure, or history.
---

# Arbesk Asset Inspection

Use this skill when you need to:
- Inspect an asset by its **token ID** (numeric, e.g. `172409538`)
- Fetch a manifest by its **IPFS CID** (e.g. `bafkreifsk5guke4cc7nzx72gugg5sakgwaqe4zso76vyamwzwadtuqmbri`)
- Walk the **manifest version chain** (backward-linked IPFS history)
- Count or list **child worlds** embedded in a manifest
- Understand the **fractal manifest structure**

## Quick Decision

| Question | Action |
|----------|--------|
| "Get asset X" where X is a number? | Read the token's `tokenURI()` from the contract, then fetch the collection/asset manifest from IPFS. See [→ API Reference](./references/api-reference.md) |
| "How many children in asset X?" | Fetch manifest, count nodes with `child_ref` or `child_manifest_id`. See [→ Manifest Structure](./references/manifest-structure.md) |
| "Show version history of asset X" | Get the latest manifest CID, then walk `prev_asset_manifest_cid` client-side. See [→ Deep Dive](./references/deep-dive.md) |
| "What's in the manifest at CID X?" | Fetch it from the configured IPFS gateway, or `ipfs cat` directly. See [→ API Reference](./references/api-reference.md) |

## Key Rules

1. **Token child nodes have no local history** — the referenced token's manifest owns the history. The parent only owns `transform_matrix` (placement).
2. **A node is a child if it has `child_ref` or `child_manifest_id`** — nodes with only `.source` are self-contained GLTF assets, not children.
3. **Manifest and token resolution are client-side.** There are no `/api/v1/tokens/` or `/api/v1/manifests/` backend routes.

## File Map

| File | Role | Details |
|------|------|---------|
| `src/api/ipfs-utils.js` | `catManifest()` — backend IPFS read with timeout | [→ Deep Dive](./references/deep-dive.md) |
| `src/api/manifest-utils.js` | `getSceneNodes()`, `bumpManifestVersion()` | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/blockchain/token-resolver.js` | `resolveChildRef()` — frontend token → CID | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/blockchain/uri-utils.js` | `normalizeTokenURI()` — CID extraction | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/engine/time-travel.js` | `walkManifestChain()` — client-side history walk | [→ Deep Dive](./references/deep-dive.md) |
| `blockchain/contracts/ArbeskAssetBase.sol` | `tokenURI(uint256)` — on-chain CID lookup | [→ Deep Dive](./references/deep-dive.md) |

## Deep Reference

| Topic | File |
|-------|------|
| API Endpoints (curl, responses, errors) | [→ API Reference](./references/api-reference.md) |
| Manifest Schema & Node Types | [→ Manifest Structure](./references/manifest-structure.md) |
| Token Resolution, Patterns, Dependencies | [→ Deep Dive](./references/deep-dive.md) |
