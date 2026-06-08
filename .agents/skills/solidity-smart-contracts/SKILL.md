---
name: solidity-smart-contracts
description: Expert guidance on Solidity smart contract architecture, deployment, debugging, and address alignment verification. Covers ERC721 NFTs, PayGo payment patterns, OpenZeppelin v5, Hardhat tooling, multi-network deployment, smart account (ERC-4337) proxy validation, session auth debugging, and the full compile→deploy→verify→integrate pipeline. Use when asked to "debug the contract", "check contract address alignment", "deploy contracts", "audit the contract", "add a function to the contract", "explain the payment flow", "smart account", "proxy contract", "session auth", or any Solidity/smart-contract question.
---

# Solidity Smart Contract Expertise

Use this skill for any task involving Solidity smart contracts: architecture review, function implementation, deployment, debugging, address alignment, event verification, smart account proxy handling, session authentication debugging, test coverage, or security audit. This skill is generic enough for any project but includes detailed knowledge of the Arbesk contract as a reference implementation.

## 1. General Solidity Expertise

### Contract Architecture Principles

| Principle | Rule |
|-----------|------|
| **Inheritance order** | Most-base → Most-derived. OpenZeppelin init calls go left-to-right. |
| **Storage layout** | `private`/`internal` vars first, then `public`, then mappings, then arrays. |
| **Event emission** | Every state-changing function must emit at least one event. |
| **Error handling** | Use `require()` for input validation, custom errors (Solidity 0.8.4+) for gas savings on complex conditions. |
| **Reentrancy** | Use OZ `ReentrancyGuard` on any function that transfers value or calls external contracts. |
| **Pausability** | Use OZ `Pausable` for emergency stop. Apply `whenNotPaused` to payment/mint functions. |
| **Access control** | Use OZ `Ownable` for single-owner, `AccessControl` for role-based. |
| **Upgradeability** | If using UUPS, storage gaps (`uint256[50] private __gap`) are mandatory in every base contract. |

### Common Patterns

**Payment pattern (PayGo):**
```solidity
function payForService(bytes32 requestId) external payable nonReentrant whenNotPaused {
    require(msg.value == serviceCost, "Incorrect payment");
    require(requestId != bytes32(0), "Invalid request");
    bytes32 key = keccak256(abi.encodePacked(requestId, msg.sender, block.number));
    require(!usedPayments[key], "Already paid");
    usedPayments[key] = true;
    (bool ok, ) = treasury.call{value: msg.value}("");
    require(ok, "Transfer failed");
    emit ServicePaid(msg.sender, requestId, msg.value, block.timestamp);
}
```

**ERC-20 payment pattern (tiered):**
```solidity
function payWithToken(bytes32 requestId, uint256 tierIndex) external nonReentrant whenNotPaused {
    uint256 cost = tierCosts[tierIndex];
    require(cost > 0, "Tier not set");
    bytes32 key = keccak256(abi.encodePacked(requestId, msg.sender, block.number));
    require(!usedPayments[key], "Already paid");
    usedPayments[key] = true;
    token.safeTransferFrom(msg.sender, treasury, cost);
    emit ServicePaidToken(msg.sender, requestId, cost, block.timestamp, tierIndex);
}
```

**Transfer hook for editor management:**
```solidity
function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
    address from = _ownerOf(tokenId);
    if (from != address(0) && from != to) {
        _removeEditor(tokenId, from);
        if (to != address(0)) _addEditor(tokenId, to);
    }
    return super._update(to, tokenId, auth);
}
```

**Swap-and-pop removal (O(1) array element removal):**
```solidity
function _removeFromArray(uint256[] storage arr, uint256 idx) internal {
    uint256 last = arr[arr.length - 1];
    arr[idx] = last;
    arr.pop();
}
```

### OpenZeppelin v5 Breaking Changes

| v4.x | v5.x | Impact |
|------|------|--------|
| `_mint(to, id)` | `_mint(to, id)` (unchanged) | No change |
| `_burn(id)` | `_burn(id)` (unchanged) | No change |
| `Counters.Counter` | Removed | Use manual `uint256` increment |
| `ERC721._beforeTokenTransfer` | `ERC721._update` | Must override `_update`, not a hook |
| `Ownable()` | `Ownable(msg.sender)` | Constructor requires initial owner |
| `Address.functionCall` | Removed from OZ v5, use low-level `call` | Manual inline or SafeERC20 for tokens |

### Gas Optimization Checklist

- [ ] Use `immutable` for constructor-set values that never change
- [ ] Use `constant` for compile-time constants
- [ ] Pack related state variables into single storage slots (uint128 + uint128, etc.)
- [ ] Use `unchecked` blocks for arithmetic known not to overflow
- [ ] Avoid redundant `SLOAD` — cache storage reads to memory
- [ ] Use `calldata` instead of `memory` for function parameters where possible
- [ ] Batch external calls into a single transaction when possible

---

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

---

## 3. Deployment Pipeline & Address Alignment

### The Pipeline (Every .sol Change MUST Follow)

```
.sol change → compile → artifacts on host → backend serves ABI
           → deploy  → .env files update → frontend gets address
```

**If any link breaks, you get:**
- `c.methods.X is not a function` (stale ABI)
- `Transaction reverted` or `CONTRACT_NOT_CONFIGURED` (wrong address)
- `WRONG_CONTRACT` errors from backend validation

### Three Sources of Truth for CONTRACT_ADDRESS

| Source | File | Used By |
|--------|------|---------|
| Root `.env` | `./.env` → `CONTRACT_ADDRESS=0x...` | Backend (`src/config.js`) |
| Blockchain `.env` | `blockchain/.env` → `CONTRACT_ADDRESS=0x...` | Hardhat scripts |
| Deployment artifact | `blockchain/deployments/<network>/ArbeskAsset.json` | Reference only |

**All three must agree**, or the deployment-integrity tests fail.

### Contract Address Flow (End-to-End)

```
┌─ deploy.js ───────────────────────────────────────────────┐
│ 1. Deploys contract                                       │
│ 2. Saves → blockchain/deployments/<network>/ArbeskAsset.json │
│ 3. Updates blockchain/.env with CONTRACT_ADDRESS          │
│ 4. (For local) also sets USDC_TOKEN                       │
└───────────────────────────────────────────────────────────┘
         │
         ▼ (MANUAL step — copy CONTRACT_ADDRESS)
┌─ root .env ───────────────────────────────────────────────┐
│ CONTRACT_ADDRESS=0x...                                    │
│ HARDHAT_RPC_URL=http://127.0.0.1:8545                    │
└───────────────────────────────────────────────────────────┘
         │
         ▼
┌─ src/config.js ───────────────────────────────────────────┐
│ export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS │
└───────────────────────────────────────────────────────────┘
         │
         ├─► Backend: generate-node.js validates receipt.to
         ├─► Backend: GET /api/v1/config exposes address
         │
         ▼
┌─ Frontend wallet.js ──────────────────────────────────────┐
│ _initContract() fetches:                                 │
│   - GET /api/v1/config → contractAddress                 │
│   - GET /api/v1/contracts/ArbeskAsset/abi → abi         │
│ Instantiates: new web3.eth.Contract(abi, contractAddress) │
└───────────────────────────────────────────────────────────┘
```

### Deployment Commands

```bash
# Compile (writes artifacts to blockchain/artifacts/)
docker-compose run --rm hardhat npx hardhat compile

# Deploy to local Hardhat
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# Deploy to testnet (e.g. Base Sepolia — configure in hardhat.config.js)
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network baseSepolia

# Deploy to mainnet (e.g. Base — configure in hardhat.config.js)
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network base

# Verify on-chain
docker-compose run --rm hardhat npx hardhat run scripts/verify.js --network baseSepolia
```

### Address Alignment Verification

After every deploy, sync the addresses:

```bash
# Step 1: Check what deploy.js wrote
grep CONTRACT_ADDRESS blockchain/.env

# Step 2: Update root .env to match
# Manually copy the value, or run:
CONTRACT_ADDR=$(grep CONTRACT_ADDRESS blockchain/.env | cut -d= -f2)
sed -i "s/^CONTRACT_ADDRESS=.*/CONTRACT_ADDRESS=${CONTRACT_ADDR}/" .env

# Step 3: Run integrity tests
npm run test:frontend
```

---

## 4. Debugging Smart Contracts

### Local Debugging with Hardhat Console

```bash
# Start an interactive Hardhat console
docker-compose run --rm hardhat npx hardhat console --network hardhat

# Then in the console:
> const ArbeskAsset = await ethers.getContractFactory("ArbeskAsset")
> const asset = await ArbeskAsset.attach("<CONTRACT_ADDRESS>")
> await asset.name()                              // "ArbeskAsset"
> await asset.symbol()                            // "ARBA"
> await asset.costPerGeneration()                 // 10000000000000000 (0.01 ether)
> await asset.getTierCost(0)                      // 750000 (Basic)
> await asset.ownerOf(1)                          // Check token owner
> await asset.tokenURI(1)                         // Get IPFS CID
> await asset.listEditors(1)                      // List editors
> await asset.isPaymentUsed(nodeId, sender, blockNum)  // Check replay state
```

### Hardhat `console.log` for Inline Debugging

Add to any `.sol` file:
```solidity
import "hardhat/console.sol";

function myFunction() external {
    console.log("costPerGeneration:", costPerGeneration);
    console.log("msg.sender:", msg.sender);
    console.log("tierCosts[Basic]:", tierCosts[Tier.Basic]);
}
```

Then run the test/hardhat node — log output appears in the Hardhat container's stdout.

### Event Log Decoding

When a transaction reverts without a clear reason, decode the events:

```javascript
// In Hardhat test or console
const tx = await contract.payForGeneration(nodeId, prompt, { value: cost });
const receipt = await tx.wait();

// Decode all logs
for (const log of receipt.logs) {
  try {
    const parsed = contract.interface.parseLog(log);
    console.log("Event:", parsed.name, parsed.args);
  } catch (e) {
    console.log("Raw log:", log);
  }
}

// Find specific event
const events = receipt.logs
  .map(log => { try { return contract.interface.parseLog(log); } catch {} })
  .filter(Boolean);
const paidEvents = events.filter(e => e.name === 'AssetGenerationPaid');
```

### Common Debugging Scenarios

| Symptom | Likely Cause | Debug Step |
|---------|-------------|------------|
| `Incorrect payment amount` | Wrong `msg.value` or `costPerGeneration` changed | Check `costPerGeneration()` on-chain vs sent value |
| `Payment already used` | Same (nodeId, sender, blockNum) retried | Use different `nodeId` or wait for next block |
| `Treasury transfer failed` | Treasury is contract without `receive()` | Verify treasury is EOA or payable contract |
| `USDC payments disabled` | `usdcToken` is `address(0)` | `setUsdcToken()` or deploy with valid USDC address |
| `Tier cost not set` | `tierCosts[tier]` is 0 | Call `setTierCost(tier, cost)` first |
| `c.methods.X is not a function` | Stale ABI | Recompile |
| `Transaction reverted` | Wrong contract address or network | Run `npm run test:frontend` |
| `WRONG_CONTRACT` from backend | `receipt.to` ≠ `CONTRACT_ADDRESS` | Check root `.env` matches deployed address |
| `WRONG_CONTRACT` with smart account | MetaMask routed tx through proxy | See Section 9: Smart Account Proxy Validation |
| `ERC20: transfer amount exceeds allowance` | USDC `approve()` not confirmed before `payForGenerationWithUSDC()` | Check approval tx succeeded, allowance ≥ cost |
| Session signing every request | Address case mismatch in localStorage | See Section 10: Session Authentication Pitfalls |

### On-Chain State Inspection (Backend Side)

The backend validates every generation transaction. To debug a rejected generation:

1. Check the backend logs for `[GEN]` prefix
2. Look for which validation step failed:
   - `tx validation failed` → Transaction not confirmed or failed
   - `contract mismatch` → `receipt.to` ≠ `CONTRACT_ADDRESS`
   - `payment event not found` → No `AssetGenerationPaid*` event in logs
   - `REPLAY detected` → Same txHash already consumed
   - `TIER MISMATCH` → Frontend tier ≠ on-chain tier

3. Manual tx inspection:
```javascript
// In Node.js (from project root)
import Web3 from 'web3';
const web3 = new Web3('http://127.0.0.1:8545');
const receipt = await web3.eth.getTransactionReceipt('0x...');
console.log('Status:', receipt.status);
console.log('To:', receipt.to);
console.log('Logs:', receipt.logs.length);

// Decode event signatures
const nativeSig = web3.utils.keccak256('AssetGenerationPaid(address,bytes32,string,uint256,uint256)');
const usdcSig = web3.utils.keccak256('AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)');
for (const log of receipt.logs) {
  if (log.topics[0] === nativeSig) console.log('Found: AssetGenerationPaid');
  if (log.topics[0] === usdcSig) console.log('Found: AssetGenerationPaidUSDC');
}
```

### Contract Test Execution

```bash
# Run all Hardhat tests (inside container)
docker-compose run --rm hardhat npx hardhat test

# Run specific test file
docker-compose run --rm hardhat npx hardhat test test/ArbeskAsset.test.js

# Run with gas reporter
docker-compose run --rm hardhat npx hardhat test --gas

# Run a single test (using .only in the test file)
# Edit blockchain/test/ArbeskAsset.test.js: change describe → describe.only or it → it.only
docker-compose run --rm hardhat npx hardhat test
```

### Running the Deployment Integrity Suite

```bash
# Full pipeline check (requires Hardhat node running)
npm run test:frontend
```

This suite (`test/frontend/deployment-integrity.test.js`) validates:
- ✅ Compiled ABI artifact exists and is readable
- ✅ ABI contains all 15 required function signatures
- ✅ Root `.env` and `blockchain/.env` agree on CONTRACT_ADDRESS
- ✅ `blockchain/.env` has USDC_TOKEN
- ✅ Deployment artifact matches configured CONTRACT_ADDRESS
- ✅ Docker volume mounts for artifacts/deployments
- ✅ USDC_TOKEN ≠ CONTRACT_ADDRESS (safety check)
- ✅ MockUSDC.sol is ERC20 (not ERC721)
- ✅ On-chain: contract bytecode exists and is distinct from MockUSDC
- ✅ On-chain: MockUSDC responds to ERC20 methods with correct values
- ✅ On-chain: `usdcToken()` returns MockUSDC address (not self)
- ✅ On-chain: tier costs match expected defaults

---

## 5. Integration Verification Checklist

After any contract change, run through this checklist:

### Phase 1: Compile Verification
- [ ] `docker-compose run --rm hardhat npx hardhat compile` succeeds
- [ ] `blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json` exists on host
- [ ] ABI contains all expected functions (15 required signatures)
- [ ] No compiler warnings (check Hardhat output)

### Phase 2: Deploy Verification
- [ ] Deploy script succeeds
- [ ] `blockchain/deployments/hardhat/ArbeskAsset.json` created with valid address
- [ ] `blockchain/.env` updated with new CONTRACT_ADDRESS and USDC_TOKEN
- [ ] USDC_TOKEN ≠ CONTRACT_ADDRESS (critical safety check!)
- [ ] MockUSDC deployed (if local) and deployer has USDC balance

### Phase 3: Address Alignment
- [ ] Root `.env` CONTRACT_ADDRESS matches `blockchain/.env`
- [ ] `npm run test:frontend` passes all tests
- [ ] Backend starts without errors (`npm start`, then check `[BOOT]` log)
- [ ] `GET /api/v1/config` returns correct `contractAddress`
- [ ] `GET /api/v1/contracts/ArbeskAsset/abi` returns valid JSON

### Phase 4: On-Chain Verification
- [ ] `ArbeskAsset` has code on-chain (`web3.eth.getCode(address) !== '0x'`)
- [ ] `MockUSDC` has code on-chain and is a different contract
- [ ] `ArbeskAsset.usdcToken()` returns MockUSDC address (not self)
- [ ] Tier costs are initialized: `tierCosts(Basic)` = 750000
- [ ] `costPerGeneration()` = 0.01 ether (10000000000000000 wei)

### Phase 5: Functional Verification
- [ ] `payForGeneration()` accepts exact payment and emits event
- [ ] `payForGenerationWithUSDC()` works for all 4 tiers
- [ ] `publishAsset()` mints NFT and stores tokenURI
- [ ] `addEditor()` / `removeEditor()` work correctly
- [ ] `updateAssetURI()` works for owner and editors
- [ ] Replay prevention: same (nodeId, sender) in same block rejects
- [ ] Transfer hook: transfer revokes old owner, adds new owner as editor
- [ ] Pause/unpause work as expected
- [ ] `receive()` reverts direct ETH transfers

---

## 6. Files Reference

| File | Role |
|------|------|
| `blockchain/contracts/ArbeskAsset.sol` | Main contract (PayGo + ERC721 + Collaboration) |
| `blockchain/contracts/mock/MockUSDC.sol` | Local testing USDC token |
| `blockchain/hardhat.config.js` | Hardhat config: solc 0.8.24, Cancun, 5 networks |
| `blockchain/scripts/deploy.js` | Deploy script: deploys MockUSDC (local), ArbeskAsset, updates .env |
| `blockchain/scripts/verify.js` | On-chain verification on block explorers |
| `blockchain/test/ArbeskAsset.test.js` | Full contract test suite (30+ cases) |
| `blockchain/SECURITY.md` | Security audit (6 findings, all addressed) |
| `blockchain/deployments/<network>/ArbeskAsset.json` | Per-network deployment artifacts |
| `test/frontend/deployment-integrity.test.js` | Address alignment + ABI + on-chain integrity |
| `src/config.js` | Backend: reads CONTRACT_ADDRESS from env |
| `src/api/index.js` | Backend: exposes /api/v1/config, token resolver, manifest routes |
| `src/api/abi-router.js` | Backend: serves compiled ABI to frontend |
| `src/api/assets/generate-node.js` | Backend: validates tx receipt, contract address, payment events, replay |
| `src/api/authentication.js` | Backend: session + bearer auth, validates tx on-chain |
| `frontend/src/js/blockchain/wallet.js` | Frontend: Web3Modal, contract init, payForGeneration*, publishAsset |
| `frontend/src/js/services/api.js` | Frontend: session caching, generation API calls, auth headers |
| `frontend/src/js/blockchain/network-config.js` | Frontend: per-chain contract addresses, RPCs, USDC tokens |

---

## 7. Adding a New Function to the Contract

When asked to add a function:

1. **Write the Solidity code** in `blockchain/contracts/ArbeskAsset.sol`
   - Add proper access control (`onlyOwner` where needed)
   - Emit an event for every state change
   - Add `nonReentrant` if transferring value
   - Add `whenNotPaused` if it's a payment/mint function
   - Add NatSpec comments (`@notice`, `@param`, `@return`, `@dev`)

2. **Add the event signature** to the event inventory

3. **Add tests** in `blockchain/test/ArbeskAsset.test.js`
   - Success case, access control, edge cases

4. **Add to `REQUIRED_ABI_FUNCTIONS`** in `test/frontend/deployment-integrity.test.js`

5. **Recompile and redeploy:**
   ```bash
   docker-compose run --rm hardhat npx hardhat compile
   docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat
   # Sync CONTRACT_ADDRESS (blockchain/.env → root .env)
   npm run test:frontend
   ```

6. **Update frontend** if called from browser:
   - Add wrapper in `frontend/src/js/blockchain/wallet.js`
   - Export if used by other modules

7. **Run full test suite:**
   ```bash
   docker-compose run --rm hardhat npx hardhat test
   npm run test:frontend
   ```

---

## 8. Multi-Network Deployment (Hardhat Local + Base Sepolia)

### Why Per-Network Config?

Different networks have different contract addresses, USDC tokens, and RPC endpoints. Hard-coding a single `CONTRACT_ADDRESS` in `.env` breaks when users switch networks. The solution is a `NETWORK_CONFIGS` map keyed by `chainId`.

### Network Configurations

```javascript
// frontend/src/js/blockchain/network-config.js
// src/config.js (backend)
export const NETWORK_CONFIGS = {
  31415822: {
    name: "Hardhat Local",
    chainId: 31415822,
    contractAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    usdcToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorer: null,
  },
  84532: {
    name: "Base Sepolia",
    chainId: 84532,
    contractAddress: "0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B",
    usdcToken: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpcUrl: "https://sepolia.base.org",
    blockExplorer: "https://sepolia.basescan.org",
  },
};
```

### Backend Chain-Aware Validation

The backend must use the correct RPC and contract address for the chain the user is on:

```javascript
// src/api/assets/generate-node.js
const { chainId } = req.body;
const effectiveChainId = chainId || req.headers["x-chain-id"];
const txWeb3 = effectiveChainId ? getWeb3(effectiveChainId) : web3;
const contractAddr = getContractAddress(effectiveChainId);
```

**Critical:** Pass `chainId` in both the request body AND `x-chain-id` header for redundancy.

### Base Sepolia Specifics

- **Chain ID:** 84532
- **Currency:** ETH (for gas), USDC (for payments)
- **USDC Token:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle's official Base Sepolia USDC)
- **Block Time:** ~2 seconds
- **Faucet:** https://www.coinbase.com/faucets/base-sepolia-faucet
- **Explorer:** https://sepolia.basescan.org

### Adding a New Network

1. Add entry to `NETWORK_CONFIGS` in both frontend and backend
2. Deploy contract to the new network
3. Update contract address and USDC token in the config
4. Add chain ID to `SUPPORTED_CHAIN_IDS` in `src/api/siwe-verify.js`
5. Update `hardhat.config.js` with the new network RPC

---

## 9. Smart Accounts (ERC-4337) & Proxy Contract Validation

### The Problem

MetaMask's **"Smart Transactions"** feature (and other ERC-4337 wallets) route user transactions through a **proxy/bundler contract** rather than calling the dapp contract directly. This means:

- `receipt.to` is the **proxy address**, NOT the dapp contract address
- `receipt.from` is the **bundler/entrypoint**, NOT the user's EOA
- Standard `receipt.to === CONTRACT_ADDRESS` validation **fails**

**Symptom:** Backend returns `WRONG_CONTRACT` even though the user successfully paid.

### The Solution: Event-Based Validation

Instead of validating `receipt.to`, validate that the transaction contains a valid payment event **emitted by the contract**:

```javascript
// src/api/assets/generate-node.js
const nativeEventSig = txWeb3.utils.keccak256(
  "AssetGenerationPaid(address,bytes32,string,uint256,uint256)"
);
const usdcEventSig = txWeb3.utils.keccak256(
  "AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)"
);
const contractAddrLower = contractAddr?.toLowerCase();

const hasPaymentEvent = contractAddr
  ? receipt.logs.some(
      (log) =>
        (log.topics[0] === nativeEventSig || log.topics[0] === usdcEventSig) &&
        log.address.toLowerCase() === contractAddrLower
    )
  : false;

// Smart account support: accept if direct call OR payment event from contract
if (
  contractAddr &&
  receipt.to &&
  receipt.to.toLowerCase() !== contractAddrLower &&
  !hasPaymentEvent
) {
  return res.status(403).json({
    code: "WRONG_CONTRACT",
    message: "Transaction not sent to ArbeskAsset contract",
  });
}

if (contractAddr && !hasPaymentEvent) {
  return res.status(403).json({
    code: "EVENT_NOT_FOUND",
    message: "No valid payment event found in transaction logs",
  });
}
```

### Key Rules for Smart Account Support

1. **Always emit an event** for every payment — this is your proof
2. **Validate `log.address`** not `receipt.to` — `log.address` is the contract that emitted the event
3. **Check event signature** (topic[0]) to ensure it's the right event type
4. **Support both paths:** direct EOA calls AND proxy/bundler calls
5. **Log proxy detection** for debugging — log `receipt.to` vs expected contract

### MetaMask Smart Transaction Settings

In MetaMask Settings → Advanced:
- **"Smart Transactions"** — ON (routes through MetaMask's bundler)
- **"Smart account requests from dapps"** — ON (enables ERC-4337)

When these are enabled, the transaction flow is:
```
User → MetaMask → Bundler Proxy (0xdb9b...7db3) → EntryPoint → ArbeskAsset
```

When disabled:
```
User → MetaMask → ArbeskAsset (direct)
```

### Detecting Smart Account Transactions

```javascript
function isSmartAccountTx(receipt, contractAddr) {
  const isDirectCall =
    receipt.to && receipt.to.toLowerCase() === contractAddr.toLowerCase();
  const hasContractEvent = receipt.logs.some(
    (log) => log.address.toLowerCase() === contractAddr.toLowerCase()
  );
  return !isDirectCall && hasContractEvent;
}
```

### Brave Wallet Note

Brave Wallet also supports smart accounts and may route through proxies. The same event-based validation applies. If users report `WRONG_CONTRACT` or `-32603` errors with Brave Wallet, check if smart account features are enabled.

---

## 10. Session Authentication Pitfalls

### The Session Flow

Arbesk uses SIWE (EIP-4361) for session auth to reduce MetaMask pop-ups:

| Generation | Pop-ups | What Happens |
|------------|---------|-------------|
| 1st | 3 | USDC approve + PayGo payment + SIWE session sign |
| 2nd+ | 2 | USDC approve + PayGo payment (session token reused) |

### The Caching Bug (Case-Sensitive Addresses)

**Root cause:** Ethereum addresses have two formats:
- **Checksummed:** `0x52997428F4DB7D6646E3ff135C64cdca5196a1B0` (mixed case, valid per EIP-55)
- **Lowercase:** `0x52997428f4db7d6646e3ff135c64cdca5196a1b0`

**The bug:** Session was stored with checksummed address but compared against lowercased `window.walletAddress`. JavaScript string comparison is case-sensitive, so they never matched.

```javascript
// BUGGY CODE (before fix):
function cacheSession(token, expiresAt, address) {
  localStorage.setItem("arbesk_session",
    JSON.stringify({ token, expiresAt, address })  // ← stored as-is (checksummed)
  );
}
// Comparison:
if (cached.address === window.walletAddress?.toLowerCase())  // ← NEVER MATCHES

// FIXED CODE:
function cacheSession(token, expiresAt, address) {
  localStorage.setItem("arbesk_session",
    JSON.stringify({ token, expiresAt, address: address.toLowerCase() })  // ← normalized
  );
}
```

### Session Implementation Rules

1. **Always lowercase addresses** when storing or comparing
2. **Include expiry grace period** (60s) for clock skew
3. **Bind token to wallet address** — validate on every use
4. **Clear on disconnect** — listen for `wallet:disconnected` event
5. **Auto-retry on 401** — if backend restarts and loses sessions, create fresh one
6. **Log session state** — `[SESSION] reused cached token` vs `[SESSION] no cached token`

### Backend Session Store

```javascript
// src/api/sessions.js
const sessions = new Map();  // In-memory, resets on server restart
const SESSION_TTL = 24 * 60 * 60 * 1000;  // 24 hours

function createSession(address) {
  const token = crypto.randomUUID();
  sessions.set(token, {
    address: address.toLowerCase(),  // ← normalize here too
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
  });
  return token;
}
```

**Note:** The backend session store is in-memory. If the Node server restarts, all sessions are lost. The frontend auto-retry logic handles this gracefully by creating a new session.

### SIWE Chain ID Support

When adding a new network, update `SUPPORTED_CHAIN_IDS` in `src/api/siwe-verify.js`:

```javascript
const SUPPORTED_CHAIN_IDS = [
  1,        // Ethereum Mainnet
  11155111, // Sepolia
  137,      // Polygon
  8453,     // Base Mainnet
  84532,    // Base Sepolia ← ADD THIS
  31415822, // Hardhat Local
  314159,   // Filecoin Calibration
  314,      // Filecoin Mainnet
];
```

If the chain ID is not in this list, session creation returns `400 Bad Request`.

---

## 11. Quick Reference Card

```text
┌─────────────────────────────────────────────────────────┐
│  ARBESKASSET QUICK REFERENCE                            │
├─────────────────────────────────────────────────────────┤
│  Token Name:          ArbeskAsset (ARBA)                │
│  Solidity:            0.8.24 (Cancun EVM)               │
│  Dependencies:        OZ v5 (ERC721Enumerable, Ownable, │
│                        ReentrancyGuard, Pausable)        │
│  Native Cost:         0.01 ETH/FIL (flat rate)          │
│  USDC Tiers:          Basic $0.75 · Standard $1.25      │
│                        Premium $1.75 · Pro $2.50        │
│  USDC Decimals:       6                                 │
│  Editors/Token Cap:   50                                 │
│  Tokens/Editor Cap:   500                                │
│  Payment Key:         keccak256(nodeId+sender+blockNum) │
│  Replay Protection:   Per-block (on-chain)              │
│                        Cross-block (backend usedTxHashes)│
│  Minting:             Public, gas-only, manual tokenId  │
│  TokenURI:            IPFS CIDs (content-addressed)     │
│  Pausable:            Yes (emergency stop)              │
│  Admin:               Single owner (multisig for prod)  │
├─────────────────────────────────────────────────────────┤
│  SMART ACCOUNT SUPPORT                                │
│  • Validate events, not receipt.to                    │
│  • Check log.address === contractAddress              │
│  • Support both direct and proxy/bundler paths        │
├─────────────────────────────────────────────────────────┤
│  NETWORK CONFIG (Base Sepolia)                        │
│  • Chain ID: 84532                                    │
│  • Contract: 0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B│
│  • USDC:     0x036CbD53842c5426634e7929541eC2318f3dCF7e│
│  • RPC:      https://sepolia.base.org                 │
├─────────────────────────────────────────────────────────┤
│  SESSION AUTH RULES                                   │
│  • Lowercase ALL addresses in storage/comparison      │
│  • 24h TTL, 60s grace period                          │
│  • Auto-retry on 401 (backend restart)                │
│  • Clear on wallet disconnect                         │
├─────────────────────────────────────────────────────────┤
│  DEPLOY:              docker-compose run --rm hardhat   │
│                        npx hardhat run scripts/deploy.js│
│                        --network hardhat                 │
│  TEST:                docker-compose run --rm hardhat   │
│                        npx hardhat test                  │
│  INTEGRITY CHECK:     npm run test:frontend             │
│  ABI SERVE:           GET /api/v1/contracts/            │
│                        ArbeskAsset/abi                  │
│  CONFIG ENDPOINT:     GET /api/v1/config                │
└─────────────────────────────────────────────────────────┘
```
