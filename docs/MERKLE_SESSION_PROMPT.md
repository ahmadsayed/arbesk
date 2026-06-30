Implement Phase 1 of the Merkle editor architecture for Arbesk as specified in docs/MERKLE_IMPLEMENTATION.md.

> **Historical note:** This was the original Phase 1 prompt. The final implementation applied these Merkle changes directly to the existing contracts (`ArbeskAssetBase.sol`, `ArbeskAsset.sol`, and `ArbeskAssetFree.sol`) rather than creating separate `*Merkle.sol` copies. `editorListURI[tokenId]` is also stored on-chain, and `publishAsset` / `initEditors` accept an `editorListUri` parameter. The legacy on-chain editor functions listed below were removed from the base contract in place.

## Context

We're replacing ~400 lines of on-chain editor management (mappings, arrays, swap-and-pop) with Merkle roots. The full editor list lives on IPFS; the contract stores `editorRoot[tokenId]`, `editorSetVersion[tokenId]`, and `editorListURI[tokenId]`. This cuts storage slots per token from ~14 to ~5, making mint costs 6.4× cheaper at 100K scale and editor operations 9,400× cheaper.

The current contracts are at:
- `blockchain/contracts/ArbeskAssetBase.sol` — abstract base (updated in place with Merkle state)
- `blockchain/contracts/ArbeskAsset.sol` — paid tier, already has per-user nonce (#2+#3)
- `blockchain/contracts/ArbeskAssetFree.sol` — free tier with packed quota

## What to Build (Phase 1 ONLY — contracts, no JS, no frontend)

### 1. `blockchain/contracts/ArbeskAssetBaseMerkle.sol` (new file)

Copy the structure from `ArbeskAssetBase.sol` but make these changes:

**STRIP (everything gone):**
- `_editorRoles` mapping
- `members` mapping (address[] per token)
- `_canBurn` mapping
- `tokensIParticipate` mapping
- `_addEditor(tokenId, addr)` function
- `_addCollaborator(...)` function (~25 lines)
- `_removeEditor(...)` function (~45 lines)
- `_update(...)` override (transfer hook)
- `addEditor` — all 3 overloads
- `removeEditor`
- `setCollaboratorRole`
- `getCollaboratorRole`
- `listEditors`
- `listCollaboratorsByRole`
- `listTokens`
- `_isEditor`, `_isCollaborator`, `_canBurnCheck`
- Editor cleanup loop in `burn`
- `EditorAdded`, `EditorRemoved`, `CollaboratorRoleChanged`, `BurnPermissionChanged` events
- `maxTokensPerEditor` abstract function (completely removed)
- `maxEditorsPerToken` — keep but change to 5000 constant in each concrete contract

**ADD (new code):**
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

**MODIFY:**
- `publishAsset(string uri, uint256 tokenId)` → add `bytes32 editorRoot_` parameter. After `_mint` and `_setTokenURI`, call `initEditors(tokenId, editorRoot_)` instead of `_addEditor(tokenId, msg.sender)`.
- `publishAsset(string uri, uint256 tokenId, address[] editors)` overload → REMOVE (editors are in the Merkle root now).
- `updateAssetURI(uint256 tokenId, string memory newAssetURI)` → add `bytes32[] calldata proof` parameter. Replace `_isEditor` check with `_requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof)`.
- `burn(uint256 tokenId)` → add `bytes32[] calldata proof` parameter. Replace `_canBurnCheck` with `_requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof)`. Remove the editor cleanup loop. After `_burn`, `delete editorRoot[tokenId]` and `delete editorSetVersion[tokenId]`.
- `setBurnPermission` → REMOVE (burn permission now just means being in the editor list with Editor role).
- `canBurn` → REMOVE.
- `getAssetManifest` → remove `editorList` from return; return just `(manifestURI, owner)`.
- `totalSupply()` — REMOVE. The base now inherits plain `ERC721` (non-Enumerable), so no `totalSupply` is exposed.
- Keep: `tokenURI`, `pause`, `unpause`, `_setTokenURI`, `_exists`, `_ownerOf`, `_mint`, `_burn`, all events except the removed ones, constructor, custom errors.
- `CollaboratorRole` enum — KEEP (None=0, Viewer=1, Editor=2). Used in `_requireEditor`.
- `MAX_EDITORS_PER_TOKEN` — make it a constant 5000 in each concrete contract, not an abstract function.
- `maxTokensPerEditor` abstract — fully removed.

### 2. `blockchain/contracts/ArbeskAssetMerkle.sol` (new file)

Copy `ArbeskAsset.sol`. Change:
- Inherit from `ArbeskAssetBaseMerkle` instead of `ArbeskAssetBase`
- Add `uint256 public constant MAX_EDITORS_PER_TOKEN = 5000;`
- Remove `maxEditorsPerToken()` pure override
- Keep ALL payment logic (payForGeneration, payForGenerationWithUSDC, getPaymentNonce, admin functions, etc.) — unchanged

### 3. `blockchain/contracts/ArbeskAssetFreeMerkle.sol` (new file)

Copy `ArbeskAssetFree.sol`. Change:
- Inherit from `ArbeskAssetBaseMerkle` instead of `ArbeskAssetBase`
- Add `uint256 public constant MAX_EDITORS_PER_TOKEN = 5000;`
- Remove `maxEditorsPerToken()` pure override, `maxTokensPerEditor()` pure override
- Keep ALL free tier logic (recordGeneration, packed quota, DAILY_GENERATION_LIMIT, etc.) — unchanged

### 4. Compile

```bash
docker compose run --rm hardhat npx hardhat compile
```

## Key Design Decisions Made

1. `editorSetVersion` is baked into every leaf hash → proofs die on set changes
2. `initEditors` is `internal` — called from `publishAsset`, not directly
3. `updateEditors` is `external` — caller submits proof they're in the current tree
4. `MAX_EDITORS_PER_TOKEN = 5000` — pure safety net, 5000 leaves = 13-deep tree = ~5K gas proof
5. No `maxTokensPerEditor` — no on-chain participant list
6. Burn just requires Editor role + valid proof; no separate burn permission
7. Transfer hook (`_update` override) removed — no auto-editor on transfer
8. Old contract files preserved as-is for archive reference (the final implementation updated them in place instead)

## Files NOT to touch
- `ArbeskAssetBase.sol` — keep as legacy reference
- `ArbeskAsset.sol` — keep
- `ArbeskAssetFree.sol` — keep
- `hardhat.config.js` — unchanged
- `deploy.js` — will update in Phase 3
- Any frontend files
- Test files (Phase 3)

> In the final implementation these contract files were updated in place; no separate `*Merkle.sol` files were kept.

## Success Criteria

- [ ] 3 new .sol files compile cleanly with `docker compose run --rm hardhat npx hardhat compile`
- [ ] No `_editorRoles`, `members`, `tokensIParticipate`, `_canBurn` in any new file
- [ ] `publishAsset` accepts `editorRoot_` parameter
- [ ] `updateAssetURI` and `burn` accept `bytes32[] calldata proof`
- [ ] No `totalSupply()` function — base inherits plain `ERC721`
- [ ] All payment functions preserved exactly as-is from ArbeskAsset.sol
- [ ] All free-tier functions preserved exactly as-is from ArbeskAssetFree.sol
- [ ] `MAX_EDITORS_PER_TOKEN = 5000`
- [ ] Old contract files untouched
