---
name: arbesk-asset-inspection
description: Fetch and inspect Arbesk assets (by token ID, manifest CID, or IPFS CID), walk the manifest version chain, count child nodes, and understand the fractal manifest structure. Use when asked to "get asset X", "inspect token Y", "how many children", "show manifest", or "walk the version chain" for any Arbesk asset.
---

# Arbesk Asset Inspection

Use this skill when you need to:
- Inspect an asset by its **token ID** (numeric, e.g. `172409538`)
- Fetch a manifest by its **IPFS CID** (e.g. `Qmcuae4gCFFJ9Nkyyz7AyxATW1jSK63EvbtgzzXBWxt4gg`)
- Walk the **manifest version chain** (backward-linked IPFS history)
- Count or list **child worlds** embedded in a manifest
- Understand the **fractal manifest structure**

## Quick Decision

| Question | Action |
|----------|--------|
| "Get asset X" where X is a number? | `GET /api/v1/tokens/X/manifest`. See [→ API Reference](./api-reference.md) |
| "How many children in asset X?" | Fetch manifest, count nodes with `child_ref` or `child_manifest_id`. See [→ Manifest Structure](./manifest-structure.md) |
| "Show version history of asset X" | Get manifest CID, then `GET /api/v1/manifests/:cid/history`. See [→ API Reference](./api-reference.md) |
| "What's in the manifest at CID X?" | `curl` via token endpoint, or `ipfs cat` directly. See [→ API Reference](./api-reference.md) |

## Key Rules

1. **Token child nodes have no local history** — the referenced token's manifest owns the history. The parent only owns `transform_matrix` (placement).
2. **A node is a child if it has `child_ref` or `child_manifest_id`** — nodes with only `.source` are self-contained GLTF assets, not children.
3. **Backend must be running** for `/api/v1/tokens/` and `/api/v1/manifests/` endpoints. If `Connection refused`, run `npm start`.

## File Map

| File | Role | Details |
|------|------|---------|
| `src/api/index.js` | Token manifest + history routes | [→ Deep Dive](./deep-dive.md) |
| `src/api/ipfs-utils.js` | `catManifest()` — IPFS read with timeout | [→ Deep Dive](./deep-dive.md) |
| `src/api/manifest-utils.js` | `getSceneNodes()`, `bumpManifestVersion()` | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/blockchain/token-resolver.js` | `resolveChildRef()` — frontend token → CID | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/blockchain/uri-utils.js` | `normalizeTokenURI()` — CID extraction | [→ Deep Dive](./deep-dive.md) |
| `blockchain/contracts/ArbeskAsset.sol` | `tokenURI(uint256)` — on-chain CID lookup | [→ Deep Dive](./deep-dive.md) |

## Deep Reference

| Topic | File |
|-------|------|
| API Endpoints (curl, responses, errors) | [→ API Reference](./api-reference.md) |
| Manifest Schema & Node Types | [→ Manifest Structure](./manifest-structure.md) |
| Token Resolution, Patterns, Dependencies | [→ Deep Dive](./deep-dive.md) |
