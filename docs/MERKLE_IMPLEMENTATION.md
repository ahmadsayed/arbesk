# Arbesk — Merkle Editor Architecture

**Version:** 2.1 · **Date:** 2026-06-21 · **Status:** Implemented

---

## 1. What Changed

### 1.1 Architecture Shift

```
BEFORE (editor state on-chain)               AFTER (Merkle root on-chain)
─────────────────────────────────            ─────────────────────────────
_editorRoles[tokenId][addr] → Role           editorRoot[tokenId] → bytes32
members[tokenId] → address[]                 editorSetVersion[tokenId] → uint256
tokensIParticipate[addr] → uint256[]         Full editor list lives on IPFS
_canBurn[tokenId][addr] → bool               tokenURI → collection manifest CID
                                             editorListUri stored on-chain
                                             
14+ slots per token (3 editors)              ~4 slots per token (any editor count)*

\* The Merkle migration first brought this to ~5 slots. The subsequent removal of `ERC721Enumerable` dropped the `_allTokens` / `_ownedTokens` arrays, leaving only `_owners`, `_tokenURIs`, `editorRoot`, `editorSetVersion`, and `editorListURI`.
```

### 1.2 Editor Limits

| Limit | Old (Free) | Old (Paid) | New | Reason |
|-------|-----------|-----------|-----|--------|
| `maxEditorsPerToken` | 5 | 50 | **5,000** (both tiers) | Safety net only — no storage cost |
| `maxTokensPerEditor` | 50 | 500 | **Removed** | No on-chain participant list |
| `DAILY_GENERATION_LIMIT` | 10 | ∞ | Unchanged | Spam protection |

---

## 2. Contract Implementation (`ArbeskAssetBase.sol`)

The existing contracts were updated in place. There are **no** separate "Merkle" contract files.

### 2.1 Removed

- `_editorRoles` mapping
- `members` mapping (array per token)
- `_canBurn` mapping
- `tokensIParticipate` mapping
- `addEditor` / `removeEditor` / `setCollaboratorRole` / `getCollaboratorRole`
- `listEditors` / `listCollaboratorsByRole` / `listTokens`
- `setBurnPermission` / `canBurn`
- `_addCollaborator` / `_removeEditor` / `_canBurnCheck`
- `EditorAdded` / `EditorRemoved` / `CollaboratorRoleChanged` / `BurnPermissionChanged` events
- `_tokenCounts` (redundant with ERC721Enumerable; the Enumerable extension itself was later removed)

### 2.2 Added

```solidity
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

mapping(uint256 => string) private _tokenURIs;
mapping(uint256 => bytes32) public editorRoot;
mapping(uint256 => uint256) public editorSetVersion;
mapping(uint256 => string) public editorListURI;

function publishAsset(
    string memory uri,
    uint256 tokenId,
    bytes32 editorRoot_,
    string memory editorListUri
) public returns (uint256) {
    if (_exists(tokenId)) revert TokenAlreadyMinted(tokenId);
    _mint(msg.sender, tokenId);
    _setTokenURI(tokenId, uri);
    initEditors(tokenId, editorRoot_, editorListUri);
    emit AssetPublished(msg.sender, tokenId, uri);
    return tokenId;
}

function updateAssetURI(
    uint256 tokenId,
    string memory newAssetURI,
    bytes32[] calldata proof
) public {
    if (!_exists(tokenId)) revert NonexistentToken(tokenId);
    _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof);
    _setTokenURI(tokenId, newAssetURI);
    emit AssetURIUpdated(tokenId, newAssetURI);
}

function updateEditors(
    uint256 tokenId,
    bytes32 newRoot,
    string memory newListUri,
    CollaboratorRole callerRole,
    bytes32[] calldata callerProof
) external {
    _requireEditor(tokenId, msg.sender, callerRole, callerProof);
    if (callerRole != CollaboratorRole.Editor)
        revert InvalidCollaboratorRole();

    unchecked {
        editorSetVersion[tokenId]++;
    }
    editorRoot[tokenId] = newRoot;
    editorListURI[tokenId] = newListUri;
    emit EditorSetChanged(tokenId, newRoot, editorSetVersion[tokenId]);
}

function burn(uint256 tokenId, bytes32[] calldata proof) public {
    if (!_exists(tokenId)) revert NonexistentToken(tokenId);
    _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof);
    _burn(tokenId);
    delete editorRoot[tokenId];
    delete editorSetVersion[tokenId];
    delete editorListURI[tokenId];
    emit AssetBurned(tokenId, msg.sender);
}

function _requireEditor(
    uint256 tokenId,
    address caller,
    CollaboratorRole requiredRole,
    bytes32[] calldata proof
) internal view {
    bytes32 leaf = keccak256(abi.encodePacked(caller, requiredRole, tokenId, editorSetVersion[tokenId]));
    if (!MerkleProof.verify(proof, editorRoot[tokenId], leaf))
        revert NotAuthorizedEditor(tokenId, caller);
}
```

### 2.3 Key Events

| Event | Signature |
|---|---|
| `AssetPublished` | `(address indexed owner, uint256 indexed tokenId, string tokenURI)` |
| `AssetURIUpdated` | `(uint256 indexed tokenId, string newAssetURI)` |
| `EditorSetChanged` | `(uint256 indexed tokenId, bytes32 newRoot, uint256 newVersion)` |
| `AssetBurned` | `(uint256 indexed tokenId, address indexed burner)` |

---

## 3. Complete Touch Point Map

### 3.1 Backend (`src/`)

| File | Change | Details |
|------|--------|---------|
| `src/api/abi-router.ts` | **None** | Serves compiled ABI by name; no change needed |
| `src/api/authentication.ts` | **None** | No contract function calls — validates sessions only |
| `src/api/assets/generate-node.ts` | **None** | Returns raw asset bytes; does not call contract functions |
| `src/api/manifest-utils.ts` | **None** | Works with IPFS manifests, not contract state |
| `src/api/routes/*` | **None** | No Merkle-specific route logic |
| `.env` (root) | **Update** | New `CONTRACT_ADDRESS` and `PAID_CONTRACT_ADDRESS` after deploy |

### 3.2 Frontend (`frontend/src/js/`)

| File | Impact | Functions Changed |
|------|--------|-------------------|
| `blockchain/wallet.ts` | **HIGH** | Backward-compat barrel; logic moved to `wallet-core.js`, `wallet-network.js`, `wallet-payments.js`, `wallet-publishing.js`, `wallet-guard.js` |
| `blockchain/wallet-publishing.ts` | **HIGH** | `publishAsset` (+`editorRoot` + `editorListUri`), `updateAssetURI` (+`proof`), `burn` (+`proof`), `updateEditors` (+proof params) |
| `ui/create-panel.ts` | **MEDIUM** | After generation, delegates save/publish; initial Merkle root built by `services/asset-save/editor-publish.ts` |
| `ui/asset-save.ts` | **HIGH** | Save/publish UI; delegates manifest building to `services/asset-save/manifest-builder.ts` |
| `services/asset-save/manifest-builder.ts` | **MEDIUM** | Manifest versioning, glTF decomposition, comment-archive embedding |
| `services/asset-save/editor-publish.ts` | **NEW** | Build Merkle proofs for republish; prepare initial editor list |
| `ui/collaborators-panel.ts` | **HIGH** | Reusable Merkle editor list UI (add/remove/role, owner-aware) |
| `services/team.ts` | **NEW** | Merkle-based editor add/remove with IPFS persistence |
| `asset-core/formats/gltf/merkle-editors.ts` | **NEW** | Merkle tree JS library (`computeRoot`, `getProof`, `makeLeaf`) |
| `services/asset-delete.ts` | **NEW** | Remove asset from collection manifest |
| `blockchain/network-config.ts` | **LOW** | Point to new contract addresses |
| `blockchain/token-resolver.ts` | **NONE** | Reads `tokenURI` — still in contract |

### 3.3 Tests

| File | Impact | Details |
|------|--------|---------|
| `blockchain/test/ArbeskAsset.test.js` | **UPDATED** | Payment + Merkle authorization tests |
| `blockchain/test/ArbeskAssetFree.test.js` | **UPDATED** | Quota + Merkle authorization tests |
| `test/frontend/deployment-integrity.test.js` | **UPDATED** | ABI paths, contract addresses, function signatures |
| `test/api.test.js` | **UPDATED** | Collection manifest save/validation |
| `e2e/helpers/manifest.mjs` | **UPDATE** | Add `type`, collection `assets`, editor root fields |
| `e2e/helpers/studio-selectors.mjs` | **UPDATE** | New selectors for Merkle editor UI |
| `e2e/specs/*.spec.js` | **REWRITE** | Editor/burn flows use Merkle proofs |

### 3.4 Unaffected Files

| File | Reason |
|------|--------|
| `mock/MockUSDC.sol` | Independent of editor changes |
| `hardhat.config.js` | Network config unchanged |
| `src/api/index.ts` routes | Routes unchanged (new collection validation only) |
| `src/api/sessions.ts` | SIWE unchanged |
| `src/api/rate-limiter.ts` | Rate limits unchanged |
| `frontend/src/js/engine/*` | Scene graph, 3D engine unchanged |
| `frontend/src/js/ipfs/*` | IPFS client unchanged |
| `packages/asset-core/src/formats/gltf/composer.ts` | Unchanged |
| `packages/asset-core/src/formats/gltf/decomposer.ts` | Unchanged |
| `frontend/src/js/services/api.ts` | Unchanged |

---

## 4. Merkle Leaf & Proof Format

The JS library in `packages/asset-core/src/formats/gltf/merkle-editors.ts` matches the Solidity leaf:

```javascript
makeLeaf(address, role, tokenId, setVersion)
// → soliditySha3(
//     { type: "address", value: address },
//     { type: "uint8",   value: role },
//     { type: "uint256", value: tokenId },
//     { type: "uint256", value: setVersion }
//   )
```

This is identical to:

```solidity
keccak256(abi.encodePacked(address, role, tokenId, editorSetVersion[tokenId]))
```

Pair hashing sorts the two child hashes before concatenation, matching OpenZeppelin `MerkleProof.verify`.

---

## 5. Files That Exist After Implementation

```
blockchain/contracts/
  ArbeskAssetBase.sol          ← updated with Merkle state
  ArbeskAsset.sol              ← updated with Merkle-compatible ABI
  ArbeskAssetFree.sol          ← updated with Merkle-compatible ABI
  mock/MockUSDC.sol            ← unchanged

packages/asset-core/src/formats/gltf/
  merkle-editors.ts            ← Merkle tree JS library

frontend/src/js/services/
  asset-save/
    editor-publish.js          ← Merkle proof building + initial editor list
  team.js                      ← Merkle editor add/remove
  asset-delete.js              ← collection asset removal

frontend/src/js/ui/
  collaborators-panel.js       ← Merkle editor list UI

docs/
  MERKLE_IMPLEMENTATION.md     ← this file
```
