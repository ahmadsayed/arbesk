# Contract Deep Dive — ArbeskAsset.sol

Full Arbesk contract reference: inheritance, storage layout, function inventory, event signatures, tier pricing, and MockUSDC.

## 2. Arbesk Contract Deep Dive (Reference Implementation)

### Contract Overview

**File:** `blockchain/contracts/ArbeskAsset.sol`
**Solidity:** `^0.8.20` (compiled 0.8.24, Cancun EVM)
**Dependencies:** OpenZeppelin v5 — ERC721Enumerable, Ownable, ReentrancyGuard, Pausable
**Test file:** `blockchain/test/ArbeskAsset.test.js` (~856 lines, 30+ test cases)
**Security audit:** `blockchain/SECURITY.md` (6 documented findings)

### Inheritance Chain

```
ERC721Enumerable → ERC721 → ERC721Utils
Ownable
ReentrancyGuard
Pausable
       ↓
ArbeskAsset
```

### Storage Layout

| Variable | Type | Notes |
|----------|------|-------|
| `costPerGeneration` | `uint256` | 0.01 ether default |
| `tierCosts` | `mapping(Tier => uint256)` | 4 tiers, 6-decimal USDC amounts |
| `usdcToken` | `IERC20` | address(0) = disabled |
| `developerTreasuryWallet` | `address` | All payments go here |
| `usedPayments` | `mapping(bytes32 => bool)` | Per-block replay guard |
| `_tokenCounts` | `uint256` | Manual counter (OZ v5 removed Counters) |
| `_tokenURIs` | `mapping(uint256 => string)` | IPFS CIDs |
| `members` | `mapping(uint256 => address[])` | Editor list per token |
| `_isEditorMap` | `mapping(uint256 => mapping => bool))` | O(1) membership |
| `tokensIParticipate` | `mapping(address => uint256[])` | Reverse lookup |

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_EDITORS_PER_TOKEN` | 50 | Editor cap per NFT |
| `MAX_TOKENS_PER_EDITOR` | 500 | Tokens-per-address cap |

### Complete Function Inventory

#### Payment — Native Token
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `payForGeneration(bytes32,string)` | `external payable` | `nonReentrant whenNotPaused` | nodeId, prompt | `AssetGenerationPaid` |

#### Payment — USDC (ERC-20 Tiered)
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `payForGenerationWithUSDC(bytes32,string,uint8)` | `external` | `nonReentrant whenNotPaused` | nodeId, prompt, tier | `AssetGenerationPaidUSDC` |
| `getTierCost(Tier)` | `external view` | — | tier | — |

#### Payment Queries
| Function | Visibility | Parameters | Returns |
|----------|-----------|------------|---------|
| `isPaymentUsed(bytes32,address,uint256)` | `external view` | nodeId, sender, blockNum | `bool` |

#### NFT Minting
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `publishAsset(string,uint256)` | `public` | — | uri, tokenId | `AssetPublished` |
| `publishAsset(string,uint256,address[])` | `public` | — | uri, tokenId, editors | `AssetPublished` |
| `tokenURI(uint256)` | `public view override` | — | tokenId | `string` |
| `totalSupply()` | `public view override` | — | — | `uint256` |
| `getAssetManifest(uint256)` | `public view` | — | tokenId | `(uri, owner, editors[])` |

#### Collaboration
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `updateAssetURI(uint256,string)` | `public` | — | tokenId, newURI | `AssetURIUpdated` |
| `addEditor(uint256,address)` | `public` | owner-only | tokenId, editor | `EditorAdded` |
| `addEditor(uint256,address[])` | `public` | owner-only | tokenId, editors[] | `EditorAdded` (per editor) |
| `removeEditor(uint256,address)` | `public` | owner-only | tokenId, editor | `EditorRemoved` |
| `listEditors(uint256)` | `public view` | — | tokenId | `address[]` |
| `listTokens(address)` | `public view` | — | editor | `uint256[]` |

#### Admin — Native Token
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `setCost(uint256)` | `external` | `onlyOwner` | newCost | `CostUpdated` |
| `setTreasury(address)` | `external` | `onlyOwner` | newWallet | `TreasuryUpdated` |

#### Admin — USDC
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `setUsdcToken(address)` | `external` | `onlyOwner` | _usdcToken | `UsdcTokenUpdated` |
| `setTierCost(Tier,uint256)` | `external` | `onlyOwner` | tier, newCost | `TierCostUpdated` |

#### Admin — Emergency
| Function | Visibility | Modifiers | Parameters | Events |
|----------|-----------|-----------|------------|--------|
| `pause()` | `external` | `onlyOwner` | — | OZ `Paused` |
| `unpause()` | `external` | `onlyOwner` | — | OZ `Unpaused` |
| `withdraw()` | `external` | `onlyOwner nonReentrant` | — | — |
| `withdrawUSDC()` | `external` | `onlyOwner nonReentrant` | — | — |

#### Fallback
| Function | Visibility | Behavior |
|----------|-----------|----------|
| `receive()` | `external payable` | `revert("Use payForGeneration()")` |

### Event Signatures

When verifying events in tx logs, use these keccak256 hashes:

```
AssetGenerationPaid(address,bytes32,string,uint256,uint256)
  → keccak256 = topic[0]

AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)
  → keccak256 = topic[0]

AssetPublished(address,uint256,string)
  → keccak256 = topic[0]

EditorAdded(uint256,address)
  → keccak256 = topic[0]

EditorRemoved(uint256,address)
  → keccak256 = topic[0]

AssetURIUpdated(uint256,string)
  → keccak256 = topic[0]

TreasuryUpdated(address,address)
  → keccak256 = topic[0]

CostUpdated(uint256,uint256)
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
