# Arbesk — Merkle Editor Architecture: Implementation Plan

**Version:** 2.0 · **Date:** 2026-06-21 · **Status:** Draft

---

## 1. What Changes

### 1.1 Architecture Shift

```
BEFORE (editor state on-chain)               AFTER (Merkle root on-chain)
─────────────────────────────────            ─────────────────────────────
_editorRoles[tokenId][addr] → Role           editorRoot[tokenId] → bytes32
members[tokenId] → address[]                 editorSetVersion[tokenId] → uint256
tokensIParticipate[addr] → uint256[]
_canBurn[tokenId][addr] → bool               
                                             Full editor list lives on IPFS
14 slots per token (3 editors)               5 slots per token (any editor count)
```

### 1.2 Gas Impact at 100K Tokens (0.01 gwei MegaETH)

| Operation | Old (m=8,192) | New (m=2,048) | Savings |
|-----------|--------------|--------------|---------|
| Mint token | $22.64 | $3.54 | 6.4× |
| Add editor | $5.66 | $0.0006 | 9,400× |
| Update URI | $0.0004 | $0.0004 | Same |
| Daily gen (ret.) | $0.001 | $0.001 | Same |

### 1.3 Editor Limits

| Limit | Old (Free) | Old (Paid) | New | Reason |
|-------|-----------|-----------|-----|--------|
| `maxEditorsPerToken` | 5 | 50 | **5,000** (both tiers) | Safety net only — no storage cost |
| `maxTokensPerEditor` | 50 | 500 | **Removed** | No on-chain participant list |
| `DAILY_GENERATION_LIMIT` | 10 | ∞ | Unchanged | Spam protection |

---

## 2. Contract Changes (`ArbeskAssetBase.sol` → New File)

### 2.1 Remove

| Item | Lines (approx) | Why |
|------|---------------|-----|
| `_editorRoles` mapping | L38 | Replaced by `editorRoot` |
| `members` mapping (array per token) | L37 | Replaced by `editorRoot` |
| `_canBurn` mapping | L39 | Replaced by role-based check in leaf data |
| `tokensIParticipate` mapping | L40 | No on-chain reverse index needed |
| `_addEditor(tokenId, addr)` | L349-351 | Gone |
| `_addCollaborator(...)` | L353-374 | Gone (200+ lines) |
| `_removeEditor(...)` | L376-420 | Gone (45 lines) |
| `_update(...)` override | L310-323 | No transfer-hook editor management |
| `addEditor` (all 3 overloads) | L144-173 | Gone |
| `removeEditor` | L176-181 | Gone |
| `setCollaboratorRole` | L183-202 | Gone |
| `getCollaboratorRole` | L204-209 | Gone |
| `listEditors` | L211-216 | Gone |
| `listCollaboratorsByRole` | L218-246 | Gone |
| `listTokens` | L248-250 | Gone |
| `setBurnPermission` | L274-288 | Gone (Editor role = burn permission) |
| `canBurn` | L290-292 | Gone |
| `_isEditor` | L325-330 | Replaced by `_requireEditor` |
| `_isCollaborator` | L332-337 | Gone |
| `_canBurnCheck` | L339-347 | Gone |
| `burn` — editor cleanup loop | L259-264 | Removed |
| Abstract `maxEditorsPerToken` | L43 | Bumped to 5000 constant |
| Abstract `maxTokensPerEditor` | L44 | Removed |
| `EditorAdded` event | L52 | Replaced by `EditorSetChanged` |
| `EditorRemoved` event | L53 | Replaced by `EditorSetChanged` |
| `CollaboratorRoleChanged` event | L54-58 | Gone |
| `BurnPermissionChanged` event | L59-63 | Gone |

### 2.2 Add

```solidity
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

mapping(uint256 => bytes32) public editorRoot;
mapping(uint256 => uint256) public editorSetVersion;

event EditorSetChanged(uint256 indexed tokenId, bytes32 newRoot, uint256 newVersion);

function _requireEditor(
    uint256 tokenId, address caller, CollaboratorRole requiredRole, bytes32[] calldata proof
) internal view {
    bytes32 leaf = keccak256(abi.encodePacked(caller, requiredRole, tokenId, editorSetVersion[tokenId]));
    require(MerkleProof.verify(proof, editorRoot[tokenId], leaf), "Not an authorized editor");
}

function initEditors(uint256 tokenId, bytes32 root) internal {
    require(editorRoot[tokenId] == bytes32(0), "Already initialized");
    editorRoot[tokenId] = root;
    editorSetVersion[tokenId] = 1;
    emit EditorSetChanged(tokenId, root, 1);
}

function updateEditors(
    uint256 tokenId, bytes32 newRoot,
    CollaboratorRole callerRole, bytes32[] calldata callerProof
) external {
    _requireEditor(tokenId, msg.sender, callerRole, callerProof);
    require(callerRole == CollaboratorRole.Editor, "Only editors can modify the set");
    editorSetVersion[tokenId]++;
    editorRoot[tokenId] = newRoot;
    emit EditorSetChanged(tokenId, newRoot, editorSetVersion[tokenId]);
}
```

### 2.3 Modify

**`publishAsset`** — calls `initEditors`:

```solidity
function publishAsset(string memory uri, uint256 tokenId, bytes32 editorRoot_) public returns (uint256) {
    require(!_exists(tokenId), "Already minted");
    _mint(msg.sender, tokenId);
    _setTokenURI(tokenId, uri);
    initEditors(tokenId, editorRoot_);
    emit AssetPublished(msg.sender, tokenId, uri);
    return tokenId;
}
```

**`updateAssetURI`** — requires proof:

```solidity
function updateAssetURI(uint256 tokenId, string memory newAssetURI, bytes32[] calldata proof) public {
    _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof);
    _setTokenURI(tokenId, newAssetURI);
    emit AssetURIUpdated(tokenId, newAssetURI);
}
```

**`burn`** — simplified:

```solidity
function burn(uint256 tokenId, bytes32[] calldata proof) public {
    _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof);
    _burn(tokenId);
    delete editorRoot[tokenId];
    delete editorSetVersion[tokenId];
    emit AssetBurned(tokenId, msg.sender);
}
```

---

## 3. Complete Touch Point Map

### 3.1 Backend (`src/`)

| File | Change | Details |
|------|--------|---------|
| `src/api/abi-router.js` | **Add 2 entries** | `ArbeskAssetMerkle.json` and `ArbeskAssetFreeMerkle.json` → artifact paths |
| `src/api/authentication.js` | **None** | No contract function calls — validates sessions only |
| `src/api/assets/generate-node.js` | **None** | Reads events, doesn't call contract functions directly |
| `src/api/manifest-utils.js` | **None** | Works with IPFS manifests, not contract state |
| `.env` (root) | **Update** | New `CONTRACT_ADDRESS` and `PAID_CONTRACT_ADDRESS` |

### 3.2 Frontend (`frontend/src/js/`)

| File | Impact | Functions Changed |
|------|--------|-------------------|
| `blockchain/wallet.js` | **HIGH** | `publishAsset` (+`editorRoot` param), `updateAssetURI` (+`proof` param), `burn` (+`proof` param), `addEditor`→`updateEditors`, `removeEditor`→`updateEditors`, `addCollaboratorWithRole`→`updateEditors`, `setCollaboratorRole`→`updateEditors`, `getCollaboratorRole`→IPFS read, `listCollaboratorsByRole`→IPFS read, `canBurn`/`setBurnPermission`→removed |
| `ui/create-panel.js` | **MEDIUM** | After gen, compute Merkle root → pass to `publishAsset` |
| `ui/asset-save.js` | **MEDIUM** | Before `updateAssetURI`, get proof from IPFS editor list |
| `ui/collaborators.js` | **HIGH** | Complete rewrite — IPFS-based editor list display, Merkle-based add/remove, proof-based burn |
| `ui/nesting.js` | **LOW** | If editor checks exist, add proof submission |
| `blockchain/network-config.js` | **LOW** | Point to new Merkle contract addresses |
| `blockchain/token-resolver.js` | **NONE** | Reads `tokenURI` and `getAssetManifest` — still in contract |
| `gltf/merkle-editors.js` | **NEW** | Merkle tree JS library (computeRoot, getProof, makeLeaf) |

### 3.3 Tests

| File | Impact | Details |
|------|--------|---------|
| `blockchain/test/ArbeskAssetMerkle.test.js` | **NEW** | ~30 Merkle-specific tests |
| `blockchain/test/ArbeskAsset.test.js` | **KEEP** | Archive for legacy contract |
| `test/frontend/deployment-integrity.test.js` | **UPDATE** | Add Merkle ABI paths, contract addresses |
| `test/api.test.js` | **REVIEW** | May need updates if API endpoints reference contract functions |
| `e2e/helpers/manifest.mjs` | **UPDATE** | Add editorRoot, editorSetVersion fields |
| `e2e/helpers/studio-selectors.mjs` | **UPDATE** | New selectors for Merkle editor UI |
| `e2e/specs/*.spec.js` | **REWRITE** | All editor/burn/nesting flows |

### 3.4 Unaffected Files

| File | Reason |
|------|--------|
| `ArbeskAssetBase.sol` | Legacy archive |
| `ArbeskAsset.sol` | Legacy archive |
| `ArbeskAssetFree.sol` | Legacy archive |
| `mock/MockUSDC.sol` | Independent of editor changes |
| `hardhat.config.js` | Network config unchanged |
| `src/api/index.js` | Routes unchanged |
| `src/api/sessions.js` | SIWE unchanged |
| `src/api/rate-limiter.js` | Rate limits unchanged |
| `frontend/src/js/engine/*` | Scene graph, 3D engine unchanged |
| `frontend/src/js/ipfs/*` | IPFS client unchanged (already used) |
| `frontend/src/js/gltf/composer.js` | Unchanged |
| `frontend/src/js/gltf/decomposer.js` | Unchanged |
| `frontend/src/js/services/api.js` | Unchanged |

---

## 4. Implementation Order (7 Phases)

### Phase 1: Contract Core

```
☐  Create ArbeskAssetBaseMerkle.sol, ArbeskAssetMerkle.sol, ArbeskAssetFreeMerkle.sol
☐  Compile: docker compose run --rm hardhat npx hardhat compile
```

### Phase 2: JS Merkle Library

```
☐  Create frontend/src/js/gltf/merkle-editors.js
☐  Unit test: 0/1/3/100 leaves, proofs, version invalidation
```

### Phase 3: Deploy + Contract Tests

```
☐  Update blockchain/scripts/deploy.js
☐  Deploy to hardhat local
☐  Create blockchain/test/ArbeskAssetMerkle.test.js (~30 tests)
☐  npx hardhat test — all pass
```

### Phase 4: Backend

```
☐  Update src/api/abi-router.js (add Merkle ABI paths)
☐  Sync .env with new contract addresses
☐  Update frontend/src/js/blockchain/network-config.js
```

### Phase 5: Frontend — Wallet

```
☐  Rewrite wallet.js contract functions (proof params, IPFS reads, removed functions)
```

### Phase 6: Frontend — UI

```
☐  Rewrite collaborators.js (Merkle-based editor management)
☐  Update create-panel.js (computeRoot → publishAsset)
☐  Update asset-save.js (getProof → updateAssetURI)
☐  Update nesting.js (proof-based editor checks if any)
```

### Phase 7: E2E Tests

```
☐  Update manifest.mjs, studio-selectors.mjs
☐  Rewrite e2e specs for Merkle flow
☐  npx playwright test — all pass
```

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Merkle proof format incompatibility with OZ | Use OZ `MerkleProof.sol` directly; match leaf structure in JS |
| Large editor lists → large calldata | Limit to 5,000 editors (proof ~13 hashes, ~416 bytes) |
| IPFS unavailability for editor list reads | Cache editor lists locally; root verification still works |
| Transfer hook removal breaks trust assumptions | Burn now requires proof; no auto-editor on transfer |
| Existing tokens on old contract | Old contract becomes read-only archive; reads are free |

---

## 6. Files That Will Exist After Implementation

```
blockchain/contracts/
  ArbeskAssetBase.sol          ← KEEP (archive reference)
  ArbeskAssetBaseMerkle.sol    ← NEW  (~250 lines)
  ArbeskAsset.sol              ← KEEP (archive reference)
  ArbeskAssetMerkle.sol        ← NEW
  ArbeskAssetFree.sol          ← KEEP (archive reference)
  ArbeskAssetFreeMerkle.sol    ← NEW
  mock/MockUSDC.sol            ← UNCHANGED

blockchain/test/
  ArbeskAsset.test.js          ← KEEP (archive)
  ArbeskAssetMerkle.test.js    ← NEW (~30 tests)

frontend/src/js/gltf/
  merkle-editors.js            ← NEW (Merkle tree JS library)

docs/
  MEGAETH_ANALYSIS.md          ← EXISTS
  MERKLE_IMPLEMENTATION.md     ← THIS FILE
  MERKLE_SESSION_PROMPT.md     ← Copy-paste prompt for Phase 1
  cost-projection.csv          ← EXISTS
```
