# Contract Deep Dive — ArbeskAsset.sol

Full Arbesk contract reference: inheritance, storage layout, function inventory, event signatures, tier pricing, and MockUSDC.

## 2. Arbesk Contract Deep Dive (Reference Implementation)

### Contract Overview

**File:** `blockchain/contracts/ArbeskAsset.sol`
**Solidity:** `^0.8.20` (compiled 0.8.24, Cancun EVM)
**Dependencies:** OpenZeppelin v5 — ERC721, Ownable, ReentrancyGuard, Pausable
**Test file:** `blockchain/test/ArbeskAsset.test.js`
**Security audit:** `blockchain/SECURITY.md`

### Inheritance Chain

```
ERC721 → ERC721Utils
Ownable
Pausable
ReentrancyGuard
       ↓
ArbeskAssetBase
       ↓
ArbeskAsset
```

### Storage Layout

| Variable | Type | Notes |
|----------|------|-------|
| `tierCosts` | `mapping(Tier => uint256)` | 4 tiers, 6-decimal USDC amounts (public getter) |
| `usdcToken` | `IERC20` | address(0) = disabled |
| `developerTreasuryWallet` | `address` | All payments go here |
| `_tokenURIs` | `mapping(uint256 => string)` | IPFS CIDs (inherited base) |
| `editorRoot` | `mapping(uint256 => bytes32)` | Merkle root per token (inherited base) |
| `editorSetVersion` | `mapping(uint256 => uint256)` | Monotonic editor-set version (inherited base) |
| `editorListURI` | `mapping(uint256 => string)` | IPFS CID of the full editor list (inherited base) |

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_EDITORS_PER_TOKEN` | 5000 | Soft cap per NFT (enforced off-chain; full list on IPFS) |

### Complete Function Inventory

#### Payment — USDC (ERC-20 Tiered, only payment path)
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `payForGenerationWithUSDC(bytes32,string,uint8)` | `external` | `nonReentrant whenNotPaused` | nodeId, prompt, tier | `AssetGenerationPaidUSDC` |
| `tierCosts(Tier)` | `public view` (auto getter) | — | tier | `uint256` |

There is no native-token payment path — `receive()`/`fallback()` revert with `DirectTransferNotAllowed`.

#### NFT Minting (inherited from `ArbeskAssetBase`)
| Function | Visibility | Modifiers | Parameters | Returns/Events |
|----------|-----------|-----------|------------|----------------|
| `publishAsset(string,uint256,bytes32,string)` | `public` | — | uri, tokenId, editorRoot_, editorListUri | `AssetPublished` |
| `tokenURI(uint256)` | `public view override` | — | tokenId | `string` |

`publishAsset` reverts `ZeroEditorRoot` when `editorRoot_` is zero (a zero root would brick the token). Generation entry points share `_validateGenerationInput(nodeId, prompt)` — reverts `InvalidPromptLength` (empty or >500 bytes) / `InvalidNodeId` (zero).

#### Collaboration (inherited from `ArbeskAssetBase`)
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `updateAssetURI(uint256,string,bytes32[])` | `public` | — | tokenId, newURI, proof | `AssetURIUpdated` |
| `updateEditors(uint256,bytes32,string,uint8,bytes32[])` | `external` | — | tokenId, newRoot, newListUri, callerRole, callerProof | `EditorSetChanged` |
| `burn(uint256,bytes32[])` | `public` | — | tokenId, proof | `AssetBurned` |

#### Admin
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `setTreasury(address)` | `external` | `onlyOwner` | newWallet | `TreasuryUpdated` |
| `setUsdcToken(address)` | `external` | `onlyOwner` | _usdcToken | `UsdcTokenUpdated` |
| `setTierCost(Tier,uint256)` | `external` | `onlyOwner` | tier, newCost | `TierCostUpdated` |
| `withdrawUSDC()` | `external` | `onlyOwner nonReentrant` | — | — |

#### Admin — Emergency (inherited from `ArbeskAssetBase`)
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `pause()` | `external` | `onlyOwner` | — | OZ `Paused` |
| `unpause()` | `external` | `onlyOwner` | — | OZ `Unpaused` |

Pause scope is payment/generation-only (`recordGeneration`, `payForGenerationWithUSDC`). Publishing, `updateAssetURI`, `updateEditors`, and `burn` stay live while paused.

#### Fallback
| Function | Visibility | Behavior |
|----------|-----------|----------|
| `receive()` | `external payable` | `revert DirectTransferNotAllowed()` |
| `fallback()` | `external payable` | `revert DirectTransferNotAllowed()` |

### Event Signatures

When verifying events in tx logs, use these keccak256 hashes:

```
AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)
  → keccak256 = topic[0]

AssetPublished(address,uint256,string)
  → keccak256 = topic[0]

EditorSetChanged(uint256,bytes32,uint256)
  → keccak256 = topic[0]

AssetBurned(uint256,address)
  → keccak256 = topic[0]

AssetURIUpdated(uint256,string)
  → keccak256 = topic[0]

TreasuryUpdated(address,address)
  → keccak256 = topic[0]

TierCostUpdated(uint8,uint256,uint256)
  → keccak256 = topic[0]

UsdcTokenUpdated(address,address)
  → keccak256 = topic[0]
```

### Tier Pricing (6 decimal USDC)

| Tier | Enum Value | Default Cost | USD |
|------|-----------|-------------|-----|
| Basic | 0 | 750,000 | $0.75 |
| Standard | 1 | 1,250,000 | $1.25 |
| Premium | 2 | 1,750,000 | $1.75 |
| Pro | 3 | 2,500,000 | $2.50 |

### MockUSDC (Local Testing)

**File:** `blockchain/contracts/mock/MockUSDC.sol`
**Purpose:** Local Hardhat-only USDC token for testing. 6 decimals, unrestricted minting.

```solidity
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}
```
