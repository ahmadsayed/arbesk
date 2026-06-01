# Phase 3: PayGo Smart Contract & End-to-End On-Chain Integration

> **Source System**: SukaVerse (`/home/ahmedh/projects/arbesk/suka-forever`) — contract patterns reused for OpenZeppelin imports and Hardhat test structure  
> **Target System**: Arbesk (`/home/ahmedh/projects/arbesk/arabesk`)  
> **Scope**: Smart contract authoring, Hardhat testing, deployment pipeline, frontend contract integration, backend txHash hardening  
> **Constraint**: FIL-native payments (not ERC-20) for MVP simplicity; contract is upgradeable to USDC in a future v2.

---

## 1. Phase 1 & 2 Retrospective — What Already Works

### Phase 1: Data Bridge, Mock Adapters & Private IPFS ✅ DONE

| File | Status | Role in Phase 3 |
|------|--------|-----------------|
| `src/index.js` | ✅ Implemented | Express bootstrap — unchanged in Phase 3 |
| `src/api/index.js` | ✅ Implemented | API router — Phase 3 adds ABI router mount |
| `src/api/generate-asset-node.js` | ✅ Implemented | Generation pipeline — Phase 3 hardens txHash validation + replay prevention |
| `src/api/parametric-version.js` | ✅ Implemented | Free parametric edits — unchanged in Phase 3 |
| `src/api/authentication.js` | ✅ Implemented | Signature recovery — unchanged in Phase 3 |
| `src/api/adapters/mock-adapter.js` | ✅ Implemented | Mock adapter — unchanged in Phase 3 |
| `docker-compose.yml` | ✅ Implemented | IPFS + Hardhat containers — Phase 3 uses Hardhat for compile/test/deploy |
| `docker/hardhat.Dockerfile` | ✅ Implemented | Hardhat dev environment — Phase 3 uses it for contract dev |
| `test/api.test.js` | ✅ 8/8 passing | Jest backend tests — Phase 3 adds contract test suite |

### Phase 2: Parametric Versions & Babylon.js Rendering Engine ✅ DONE

| File | Status | Role in Phase 3 |
|------|--------|-----------------|
| `frontend/src/js/engine/scene-graph.js` | ✅ Implemented | Scene parser — unchanged in Phase 3 |
| `frontend/src/js/engine/time-travel.js` | ✅ Implemented | Version scrubber — unchanged in Phase 3 |
| `frontend/src/js/engine/parametric-preview.js` | ✅ Implemented | Live preview — unchanged in Phase 3 |
| `frontend/src/js/blockchain/wallet.js` | ✅ Implemented (stub) | **Phase 3 replaces mock tx with real contract call** |
| `frontend/src/pug/studio.pug` | ✅ Implemented | Studio shell — adds "Generate" button wiring |
| `frontend/src/scss/studio.scss` | ✅ Implemented | Styles — unchanged in Phase 3 |

### Phase 3 Gaps (This Document Addresses)

| Gap | Location | Phase 3 Fix |
|-----|----------|-------------|
| No Solidity contract | `blockchain/contracts/` → empty | Write `ArbeskPayGo.sol` |
| No contract tests | `blockchain/test/` → empty | Write `ArbeskPayGo.test.js` |
| No deploy scripts | `blockchain/scripts/` → empty | Write `deploy.js`, `verify.js` |
| Wallet uses mock tx | `wallet.js` lines 177–191 | Replace with real `payForGeneration()` ABI call |
| Backend accepts any txHash | `generate-asset-node.js` line 29 | Validate tx is specifically a contract `payForGeneration` call |
| No txHash replay prevention | `generate-asset-node.js` | Maintain `usedTxHashes` Set or scan manifest history |
| No ABI serving to frontend | — | Add `GET /api/abi/ArbeskPayGo.json` route |
| No rate limiting | — | Add in-memory rate limiter per wallet |

---

## 2. Payment Model Decision: FIL-Native (Not ERC-20)

Phase 3 uses **native FIL transfers** via a payable `payForGeneration()` function.

| Concern | FIL-Native (Chosen) | USDC ERC-20 (Future v2) |
|---------|---------------------|-------------------------|
| Contract complexity | Low — one `payable` function | Medium — `transferFrom` + allowance check |
| User UX | One MetaMask popup | Two popups: `approve()` then `transferFrom()` |
| Gas cost on FEVM | Lowest possible | Higher (ERC-20 SSTORE) |
| Price stability | Volatile (wei/attofil) | Stable ($0.25 USDC) |
| FEVM liquidity | Native FIL always available | USDC liquidity on FEVM is limited |
| Upgrade path | Deploy v2 contract later | Replace or proxy-upgrade |

**Rationale**: The MVP optimizes for simplicity, gas efficiency, and developer velocity. The contract stores `costPerGeneration` as a configurable wei value. The backend or frontend can display a USD-equivalent price fetched from an oracle or hardcoded at build time. A USDC variant can be deployed as `ArbeskPayGoV2.sol` without changing the rest of the stack.

---

## 3. Smart Contract Specification

### 3.1 File: `blockchain/contracts/ArbeskPayGo.sol`

```solidity
// SPDX-License-Identifier: ISC
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ArbeskPayGo
 * @dev Pay-as-you-go generation contract for Arbesk 3D asset platform.
 *      Users pay native FIL to trigger AI mesh generation.
 *      100% of payment goes to developerTreasuryWallet.
 *      Parametric edits (color/scale) do NOT use this contract.
 */
contract ArbeskPayGo is Ownable, ReentrancyGuard, Pausable {

    /// @notice Cost per generation in wei (native FIL).
    /// @dev Default: 0.01 FIL = 10^16 wei. Owner can update.
    uint256 public costPerGeneration = 0.01 ether;

    /// @notice Treasury wallet receiving all generation payments.
    address public developerTreasuryWallet;

    /// @notice Mapping to prevent txHash replay attacks.
    /// @dev Key: keccak256(nodeId + txHash) → bool.
    mapping(bytes32 => bool) public usedPayments;

    /// @notice Emitted when a user pays for generation.
    /// @dev Backend API listens for this event to trigger cloud/mock generation.
    event AssetGenerationPaid(
        address indexed userWallet,
        bytes32 indexed nodeId,
        string prompt,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Emitted when treasury wallet is updated.
    event TreasuryUpdated(address indexed previousWallet, address indexed newWallet);

    /// @notice Emitted when generation cost is updated.
    event CostUpdated(uint256 previousCost, uint256 newCost);

    /// @param _treasury Initial treasury wallet address.
    constructor(address _treasury) {
        require(_treasury != address(0), "Treasury cannot be zero address");
        developerTreasuryWallet = _treasury;
    }

    /**
     * @notice Pay for a 3D asset generation.
     * @param nodeId Unique identifier for the target scene node.
     * @param prompt Text prompt sent to the generation engine.
     * @dev Requires exact `costPerGeneration` FIL value. Forwards 100% to treasury.
     *      Emits `AssetGenerationPaid` for backend indexing.
     */
    function payForGeneration(bytes32 nodeId, string calldata prompt)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        require(msg.value == costPerGeneration, "Incorrect payment amount");
        require(bytes(prompt).length > 0 && bytes(prompt).length <= 500, "Invalid prompt length");
        require(nodeId != bytes32(0), "Invalid nodeId");

        bytes32 paymentKey = keccak256(abi.encodePacked(nodeId, msg.sender, block.number));
        require(!usedPayments[paymentKey], "Payment already used");
        usedPayments[paymentKey] = true;

        // Forward 100% to treasury
        (bool sent, ) = developerTreasuryWallet.call{value: msg.value}("");
        require(sent, "Treasury transfer failed");

        emit AssetGenerationPaid(
            msg.sender,
            nodeId,
            prompt,
            msg.value,
            block.timestamp
        );
    }

    /**
     * @notice Update generation cost. Owner only.
     * @param newCost New cost in wei.
     */
    function setCost(uint256 newCost) external onlyOwner {
        require(newCost > 0, "Cost must be > 0");
        uint256 oldCost = costPerGeneration;
        costPerGeneration = newCost;
        emit CostUpdated(oldCost, newCost);
    }

    /**
     * @notice Update treasury wallet. Owner only.
     * @param newWallet New treasury address.
     */
    function setTreasury(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Treasury cannot be zero address");
        address oldWallet = developerTreasuryWallet;
        developerTreasuryWallet = newWallet;
        emit TreasuryUpdated(oldWallet, newWallet);
    }

    /**
     * @notice Emergency pause. Owner only.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume operations. Owner only.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Withdraw any accidental stray balance to treasury. Owner only.
     * @dev The contract should normally hold 0 balance because payForGeneration
     *      forwards immediately. This is a safety valve.
     */
    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance to withdraw");
        (bool sent, ) = developerTreasuryWallet.call{value: balance}("");
        require(sent, "Withdraw failed");
    }

    /**
     * @notice Check if a payment key has been consumed.
     * @param nodeId The node identifier.
     * @param sender The payer address.
     * @param blockNum The block number of the payment.
     */
    function isPaymentUsed(bytes32 nodeId, address sender, uint256 blockNum)
        external
        view
        returns (bool)
    {
        bytes32 key = keccak256(abi.encodePacked(nodeId, sender, blockNum));
        return usedPayments[key];
    }

    receive() external payable {
        revert("Use payForGeneration()");
    }

    fallback() external payable {
        revert("Use payForGeneration()");
    }
}
```

### 3.2 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `paymentKey = keccak256(nodeId, sender, blockNumber)` | Prevents replay without storing the raw txHash on-chain (saves gas). The backend maps txHash → blockNumber → paymentKey for validation. |
| Immediate treasury transfer | No escrow, no vault, no refunds — aligns with MVP spec and minimizes attack surface. |
| `Pausable` | Emergency stop without losing state. Owner can pause during incident response. |
| `ReentrancyGuard` | Protects treasury transfer even though the contract holds no balance between calls. Defense in depth. |
| `receive()` / `fallback()` revert | Forces all payments through the validated `payForGeneration()` entrypoint. |
| Prompt length cap (500 bytes) | Prevents gas griefing via oversized calldata. |

---

## 4. Contract Test Specification

### 4.1 File: `blockchain/test/ArbeskPayGo.test.js`

Uses `@nomicfoundation/hardhat-toolbox` (ethers.js v6 style).

**Test Suite Structure:**

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArbeskPayGo", function () {
  let payGo, owner, treasury, user;
  const COST = ethers.parseEther("0.01"); // 0.01 FIL

  beforeEach(async () => {
    [owner, treasury, user] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ArbeskPayGo");
    payGo = await Factory.deploy(treasury.address);
    await payGo.waitForDeployment();
  });

  describe("Deployment", () => {
    it("sets owner to deployer", async () => { /* ... */ });
    it("sets treasury to provided address", async () => { /* ... */ });
    it("reverts if treasury is zero address", async () => { /* ... */ });
  });

  describe("payForGeneration", () => {
    it("accepts exact payment and emits AssetGenerationPaid", async () => { /* ... */ });
    it("forwards 100% to treasury", async () => { /* ... */ });
    it("reverts if payment amount is incorrect", async () => { /* ... */ });
    it("reverts if prompt is empty", async () => { /* ... */ });
    it("reverts if prompt exceeds 500 bytes", async () => { /* ... */ });
    it("reverts if nodeId is zero", async () => { /* ... */ });
    it("reverts if same paymentKey is reused", async () => { /* ... */ });
    it("reverts when paused", async () => { /* ... */ });
  });

  describe("Access Control", () => {
    it("only owner can setCost", async () => { /* ... */ });
    it("only owner can setTreasury", async () => { /* ... */ });
    it("only owner can pause/unpause", async () => { /* ... */ });
    it("only owner can withdraw", async () => { /* ... */ });
  });

  describe("setCost", () => {
    it("updates costPerGeneration", async () => { /* ... */ });
    it("emits CostUpdated", async () => { /* ... */ });
    it("reverts if cost is 0", async () => { /* ... */ });
  });

  describe("setTreasury", () => {
    it("updates treasury wallet", async () => { /* ... */ });
    it("emits TreasuryUpdated", async () => { /* ... */ });
    it("reverts if new wallet is zero address", async () => { /* ... */ });
  });

  describe("withdraw", () => {
    it("sends stray balance to treasury", async () => { /* ... */ });
    it("reverts if balance is 0", async () => { /* ... */ });
  });

  describe("receive/fallback", () => {
    it("reverts direct ETH transfers", async () => { /* ... */ });
  });
});
```

### 4.2 Running Tests

```bash
# Inside Hardhat Docker container (per AGENTS.md)
docker-compose run --rm hardhat npx hardhat test

# Or start an interactive shell
docker-compose run --rm hardhat sh
npx hardhat test
```

---

## 5. Deployment Scripts

### 5.1 File: `blockchain/scripts/deploy.js`

```javascript
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  console.log("Treasury wallet:", treasury);

  const ArbeskPayGo = await hre.ethers.getContractFactory("ArbeskPayGo");
  const payGo = await ArbeskPayGo.deploy(treasury);
  await payGo.waitForDeployment();

  const address = await payGo.getAddress();
  console.log("ArbeskPayGo deployed to:", address);

  // Save deployment artifact
  const network = hre.network.name;
  const deployDir = path.join(__dirname, "..", "deployments", network);
  fs.mkdirSync(deployDir, { recursive: true });
  fs.writeFileSync(
    path.join(deployDir, "ArbeskPayGo.json"),
    JSON.stringify({
      address,
      treasury,
      deployer: deployer.address,
      blockNumber: await hre.ethers.provider.getBlockNumber(),
      timestamp: new Date().toISOString()
    }, null, 2)
  );

  // Update .env if local network
  if (network === "hardhat") {
    const envPath = path.join(__dirname, "..", ".env");
    let env = fs.readFileSync(envPath, "utf8");
    env = env.replace(/CONTRACT_ADDRESS=.*/g, `CONTRACT_ADDRESS=${address}`);
    fs.writeFileSync(envPath, env);
    console.log("Updated blockchain/.env with CONTRACT_ADDRESS");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### 5.2 File: `blockchain/scripts/verify.js`

```javascript
const hre = require("hardhat");

async function main() {
  const address = process.env.CONTRACT_ADDRESS;
  const treasury = process.env.TREASURY_ADDRESS;
  if (!address || !treasury) {
    console.error("Set CONTRACT_ADDRESS and TREASURY_ADDRESS in .env");
    process.exit(1);
  }

  console.log("Verifying ArbeskPayGo at:", address);
  await hre.run("verify:verify", {
    address,
    constructorArguments: [treasury],
  });
}

main().catch(console.error);
```

### 5.3 Deployment Commands

```bash
# Local Hardhat Network
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat

# Filecoin Calibration Testnet
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network filecoinCalibration

# Filecoin Mainnet
docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network filecoin

# Verify on Calibration
docker-compose run --rm hardhat npx hardhat run scripts/verify.js --network filecoinCalibration
```

---

## 6. Frontend Integration — `wallet.js`

### 6.1 Replace Mock Transaction with Real Contract Call

In `frontend/src/js/blockchain/wallet.js`, replace the mock flow (lines 177–191) with:

```javascript
/**
 * Pay for a generation using the ArbeskPayGo contract.
 * @param {string} nodeId — hex or string node identifier
 * @param {string} prompt — generation prompt
 * @returns {string|null} txHash on success, null on failure
 */
async function payForGeneration(nodeId, prompt) {
    if (!web3 || !window.walletAddress) {
        console.error('Wallet not connected');
        return null;
    }

    try {
        // Fetch contract address + ABI from backend
        const [addrRes, abiRes] = await Promise.all([
            fetch('/api/contract_address'),
            fetch('/abi/ArbeskPayGo.json')
        ]);
        const { contract_address: contractAddress } = await addrRes.json();
        const abi = await abiRes.json();

        if (!contractAddress) {
            console.warn('No contract address configured; falling back to mock tx');
            return _mockPayForGeneration(nodeId, prompt);
        }

        const contract = new web3.eth.Contract(abi.abi, contractAddress);

        // Fetch current cost from contract
        const cost = await contract.methods.costPerGeneration().call();

        // Encode nodeId as bytes32
        const nodeIdBytes32 = web3.utils.padRight(
            web3.utils.utf8ToHex(nodeId),
            64
        );

        const tx = contract.methods.payForGeneration(nodeIdBytes32, prompt);
        const gas = await tx.estimateGas({ from: window.walletAddress, value: cost });

        const receipt = await tx.send({
            from: window.walletAddress,
            value: cost,
            gas: Math.floor(Number(gas) * 1.2) // 20% buffer
        });

        document.dispatchEvent(new CustomEvent('wallet:generationPaid', {
            detail: {
                txHash: receipt.transactionHash,
                nodeId,
                prompt,
                blockNumber: receipt.blockNumber,
                contractAddress
            }
        }));

        return receipt.transactionHash;
    } catch (error) {
        console.error('payForGeneration failed:', error);
        return null;
    }
}

// Retain mock flow for offline development when contract is not deployed
async function _mockPayForGeneration(nodeId, prompt) {
    const tx = {
        from: window.walletAddress,
        to: window.walletAddress,
        value: web3.utils.toWei('0', 'ether'),
        gas: 21000,
        data: web3.utils.asciiToHex(`arbesk:generate:${nodeId}`)
    };
    const receipt = await web3.eth.sendTransaction(tx);
    document.dispatchEvent(new CustomEvent('wallet:generationPaid', {
        detail: { txHash: receipt.transactionHash, nodeId, prompt }
    }));
    return receipt.transactionHash;
}
```

### 6.2 Studio.pug — Add Generate Button Wiring

In `frontend/src/pug/studio.pug`, ensure the Generate button exists and wires to `window.payForGeneration`:

```pug
//- In the inspector or editor panel
#editorPanel
  textarea#promptInput(placeholder="Describe your 3D asset...")
  button#generateBtn Generate Asset
```

And in a bootstrap script module:

```javascript
document.getElementById('generateBtn').addEventListener('click', async () => {
    const prompt = document.getElementById('promptInput').value.trim();
    if (!prompt) return alert('Enter a prompt');
    if (!window.walletAddress) return alert('Connect wallet first');

    const nodeId = window.selectedNodeId || `node_${Date.now()}`;
    const txHash = await window.payForGeneration(nodeId, prompt);
    if (!txHash) return;

    // POST to backend after on-chain confirmation
    const res = await fetch('/api/generate-asset-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, nodeId, txHash })
    });
    const data = await res.json();
    window.activeManifestId = data.newManifestCid;
});
```

---

## 7. Backend Hardening

### 7.1 txHash Replay Prevention

Modify `src/api/generate-asset-node.js` to track consumed txHashes.

**Option A: In-Memory Set (MVP)**

```javascript
// At module level
const usedTxHashes = new Set();

// In the POST handler, after receipt validation:
if (usedTxHashes.has(effectiveTxHash)) {
    return res.status(409).json({ error: 'REPLAY_DETECTED', message: 'txHash already consumed' });
}
usedTxHashes.add(effectiveTxHash);
```

**Option B: Manifest History Scan (Stateless)**

```javascript
// Scan all node histories in the manifest for the same txHash
const isReplay = manifest.nodes.some(node =>
    node.history.some(entry => entry.txHash === effectiveTxHash)
);
if (isReplay) {
    return res.status(409).json({ error: 'REPLAY_DETECTED', message: 'txHash already consumed' });
}
```

**Recommendation**: Use **Option A for speed** in the MVP. Add Option B as a fallback for server restarts.

### 7.2 Validate Contract Call Specificity

Replace generic txHash receipt validation with contract-specific log decoding:

```javascript
import { Router } from 'express';
import Web3 from 'web3';
// ... other imports

const CONTRACT_ABI = [ /* ArbeskPayGo ABI */ ];

// In POST handler:
const receipt = await web3.eth.getTransactionReceipt(effectiveTxHash);
if (!receipt || Number(receipt.status) !== 1) {
    return res.status(403).json({ error: 'Invalid or failed transaction' });
}

// Optional: verify receipt.to matches deployed contract address
const contractAddress = process.env.CONTRACT_ADDRESS;
if (contractAddress && receipt.to && receipt.to.toLowerCase() !== contractAddress.toLowerCase()) {
    return res.status(403).json({ error: 'Transaction not sent to ArbeskPayGo contract' });
}

// Optional: decode logs to verify AssetGenerationPaid event
if (contractAddress && CONTRACT_ABI.length > 0) {
    const contract = new web3.eth.Contract(CONTRACT_ABI, contractAddress);
    const eventSignature = web3.utils.keccak256('AssetGenerationPaid(address,bytes32,string,uint256,uint256)');
    const hasEvent = receipt.logs.some(log =>
        log.topics[0] === eventSignature &&
        log.address.toLowerCase() === contractAddress.toLowerCase()
    );
    if (!hasEvent) {
        return res.status(403).json({ error: 'Transaction did not emit expected payment event' });
    }
}
```

### 7.3 Rate Limiting

Add simple in-memory rate limiting per wallet address:

**File: `src/api/rate-limiter.js`**

```javascript
const rateMap = new Map(); // walletAddress → { count, resetTime }

export default function rateLimit({ max, windowMs }) {
    return (req, res, next) => {
        const wallet = req.body.txHash
            ? res.locals.walletAddress // set by authenticate middleware
            : req.ip; // fallback for unauthenticated routes

        if (!wallet) return next();

        const now = Date.now();
        const entry = rateMap.get(wallet) || { count: 0, resetTime: now + windowMs };

        if (now > entry.resetTime) {
            entry.count = 0;
            entry.resetTime = now + windowMs;
        }

        entry.count += 1;
        rateMap.set(wallet, entry);

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));

        if (entry.count > max) {
            return res.status(429).json({
                error: 'RATE_LIMITED',
                message: `Limit: ${max} requests per ${windowMs / 1000}s`,
                retryAfter: Math.ceil((entry.resetTime - now) / 1000)
            });
        }

        next();
    };
}
```

Mount in `src/api/index.js`:

```javascript
import rateLimit from './rate-limit.js';

// On generation route
api.use('/generate-asset-node', rateLimit({ max: 10, windowMs: 60 * 60 * 1000 }));
api.use('/generate-asset-node', generateAssetNode(ipfs));
```

### 7.4 ABI Serving Route

**File: `src/api/abi-router.js`**

```javascript
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export default function abiRouter() {
    const router = Router();

    router.get('/ArbeskPayGo.json', (req, res) => {
        const abiPath = path.resolve(__dirname, '../../blockchain/artifacts/contracts/ArbeskPayGo.sol/ArbeskPayGo.json');
        if (!fs.existsSync(abiPath)) {
            return res.status(404).json({ error: 'ABI not found. Run: docker-compose run --rm hardhat npx hardhat compile' });
        }
        res.setHeader('Content-Type', 'application/json');
        res.sendFile(abiPath);
    });

    return router;
}
```

Mount in `src/api/index.js`:

```javascript
import abiRouter from './abi-router.js';

// After other mounts
api.use('/abi', abiRouter());
```

---

## 8. Data Flow: Phase 3 End-to-End

```
User clicks "Generate Asset" in Studio
    │
    ▼
┌─────────────────────────────┐
│  1. wallet.js calls         │
│     payForGeneration()      │
│     → contract methods call │
│     → MetaMask popup        │
│     → user signs            │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  2. Transaction mined       │
│     on Filecoin FEVM        │
│     (~30s tipset)           │
│     → emit                  │
│     AssetGenerationPaid     │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  3. Studio receives txHash  │
│     via wallet:generation   │
│     Paid event              │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  4. POST /api/generate-     │
│     asset-node              │
│     { prompt, nodeId,       │
│       txHash }              │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  5. Backend validates       │
│     a. txHash receipt exists│
│     b. receipt.status == 1  │
│     c. receipt.to ==        │
│        CONTRACT_ADDRESS     │
│     d. logs contain         │
│        AssetGenerationPaid  │
│     e. txHash not in        │
│        usedTxHashes Set     │
│     f. wallet under rate    │
│        limit                │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  6. Backend runs generation │
│     pipeline (mock or cloud)│
│     → uploads to IPFS       │
│     → appends manifest      │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  7. Studio loads new        │
│     manifest CID →          │
│     Babylon.js viewport     │
└─────────────────────────────┘
```

---

## 9. Environment Variable Updates

### `blockchain/.env` (Updated)

```ini
# Filecoin RPC endpoints
API_URL=http://127.0.0.1:8545
# Calibration: https://api.calibration.node.glif.io/rpc/v1
# Mainnet: https://api.node.glif.io/rpc/v1

PRIVATE_KEY=0x...
PUBLIC_KEY=0x...
CONTRACT_ADDRESS=0x...          # ← populated by deploy.js
TREASURY_ADDRESS=0x...          # ← set before deployment
ETHERSCAN_API_KEY=              # ← for Filfox verification if available
ASSETS_IPFS=
```

### `blockchain/.env.example` (Updated)

```ini
# Filecoin RPC endpoints
API_URL=https://api.calibration.node.glif.io/rpc/v1
# For mainnet: https://api.node.glif.io/rpc/v1

PRIVATE_KEY=<0x...>
PUBLIC_KEY=<0x...>
CONTRACT_ADDRESS=<0x...>
TREASURY_ADDRESS=<0x...>
ETHERSCAN_API_KEY=<optional>
ASSETS_IPFS=<CID>
```

### Root `.env` (Backend — no changes required)

The backend already reads `CONTRACT_ADDRESS` from `blockchain/.env` via `dotenv` in `generate-asset-node.js`.

---

## 10. Testing Strategy for Phase 3

### 10.1 Contract Tests (Hardhat — inside Docker)

| Test | Command | Expected |
|------|---------|----------|
| Compile | `docker-compose run --rm hardhat npx hardhat compile` | No errors, artifacts written to `artifacts/` |
| Unit tests | `docker-compose run --rm hardhat npx hardhat test` | All tests pass |
| Coverage | `docker-compose run --rm hardhat npx hardhat coverage` | > 90% coverage |
| Local deploy | `docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat` | Contract deployed, `.env` updated |

### 10.2 Integration Tests (Backend — host Jest)

Extend `test/api.test.js` with:

1. **Replay prevention**: Same txHash rejected on second `POST /api/generate-asset-node`.
2. **Contract address validation**: If `CONTRACT_ADDRESS` is set, backend verifies `receipt.to` matches.
3. **Rate limiting**: 11th request from same wallet within 1 hour returns `429`.
4. **ABI route**: `GET /abi/ArbeskPayGo.json` returns valid JSON when compiled.

### 10.3 Manual End-to-End Checklist

1. Start Docker Compose (`docker-compose up -d`).
2. Deploy contract locally (`docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat`).
3. Start backend (`npm start`).
4. Open Studio in browser.
5. Connect MetaMask to Hardhat Local (`127.0.0.1:8545`, chainId `31337`).
6. Click Generate → MetaMask prompts for 0.01 FIL → sign.
7. Transaction confirms → Studio POSTs to `/api/generate-asset-node`.
8. Backend validates txHash against contract → returns `newManifestCid`.
9. Mesh appears in Babylon.js viewport.
10. Click Generate again with **same txHash** → backend returns `409 REPLAY_DETECTED`.

---

## 11. Hardhat Configuration Update

### `blockchain/hardhat.config.js`

Add `etherscan` block for Filfox verification support:

```javascript
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { API_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

module.exports = {
  solidity: "0.8.17",
  settings: {
    optimizer: { enabled: true, runs: 1000 },
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {},
    filecoinCalibration: {
      url: API_URL || "https://api.calibration.node.glif.io/rpc/v1",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
    },
    filecoin: {
      url: API_URL || "https://api.node.glif.io/rpc/v1",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
    },
  },
  etherscan: {
    apiKey: {
      filecoinCalibration: ETHERSCAN_API_KEY || "",
      filecoin: ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "filecoinCalibration",
        chainId: 314159,
        urls: {
          apiURL: "https://calibration.filfox.info/api/v1/tools/verify",
          browserURL: "https://calibration.filfox.info",
        },
      },
      {
        network: "filecoin",
        chainId: 314,
        urls: {
          apiURL: "https://filfox.info/api/v1/tools/verify",
          browserURL: "https://filfox.info",
        },
      },
    ],
  },
};
```

---

## 12. Files Summary Table

### New Files

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `blockchain/contracts/ArbeskPayGo.sol` | PayGo smart contract (FIL-native) | ~120 |
| `blockchain/test/ArbeskPayGo.test.js` | Hardhat test suite (all contract functions) | ~250 |
| `blockchain/scripts/deploy.js` | Deploy + save artifact + update .env | ~50 |
| `blockchain/scripts/verify.js` | Verify contract on Filfox | ~25 |
| `src/api/abi-router.js` | Serve compiled ABI JSON to frontend | ~20 |
| `src/api/rate-limiter.js` | In-memory rate limiting per wallet | ~35 |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/js/blockchain/wallet.js` | Replace mock `_mockPayForGeneration` with real contract call; fetch ABI + address from backend; estimate gas + 20% buffer |
| `src/api/generate-asset-node.js` | Add `usedTxHashes` Set for replay prevention; optionally validate `receipt.to === CONTRACT_ADDRESS`; optionally decode `AssetGenerationPaid` event logs |
| `src/api/index.js` | Mount `/abi` router; mount rate limiter on `/generate-asset-node` |
| `blockchain/hardhat.config.js` | Add `etherscan` config with Filfox custom chains |
| `blockchain/.env.example` | Add `TREASURY_ADDRESS`, `ETHERSCAN_API_KEY` |
| `AGENTS.md` | Update Phase 3 status to "In Progress"; add contract test/deploy commands |
| `docs/API_SPEC.md` | Add `REPLAY_DETECTED` (409), `RATE_LIMITED` (429) error codes; document rate limit headers |

### Unchanged Files (Verified Working)

| File | Reason |
|------|--------|
| `src/index.js` | No contract-related changes needed |
| `src/api/parametric-version.js` | Parametric edits remain free — no contract interaction |
| `src/api/authentication.js` | Signature recovery unchanged |
| `src/api/adapters/mock-adapter.js` | Mock adapter unchanged |
| `frontend/src/js/engine/*.js` | Rendering engine decoupled from blockchain layer |
| `frontend/src/pug/studio.pug` | Layout shell unchanged (wiring in separate JS) |
| `docker-compose.yml` | Hardhat service already configured |
| `docker/hardhat.Dockerfile` | Already exists and functional |

---

## 13. Security Checklist

| Threat | Mitigation in Phase 3 |
|--------|----------------------|
| Replay attacks (same txHash) | `usedTxHashes` in-memory Set + manifest history scan fallback |
| Fake txHash (any successful tx) | Validate `receipt.to === CONTRACT_ADDRESS`; decode `AssetGenerationPaid` event |
| Contract reentrancy | `ReentrancyGuard` on `payForGeneration()` and `withdraw()` |
| Unauthorized admin functions | `Ownable` modifier on `setCost`, `setTreasury`, `pause`, `withdraw` |
| Zero-address treasury | `require(_treasury != address(0))` in constructor and setter |
| Direct ETH transfer to contract | `receive()` and `fallback()` revert |
| Prompt griefing (oversized calldata) | `bytes(prompt).length <= 500` |
| Rate limit evasion | Per-wallet in-memory limiter (10 req/hour for generation) |
| Server restart losing usedTxHashes | Scan manifest history as fallback validation |
| Pause bypass | `whenNotPaused` modifier on `payForGeneration` |

---

## 14. Performance Targets (Aligned with MVP_PLAN.md)

| Metric | Target | Phase 3 Impact |
|--------|--------|----------------|
| Payment confirmation | < 60s | Filecoin tipset time (~30s) + receipt polling |
| Contract deployment (local) | < 10s | Hardhat local network |
| Contract deployment (Calibration) | < 5 min | Includes block confirmation |
| txHash validation backend | < 500ms | Single `eth_getTransactionReceipt` RPC call |
| Replay check | < 1ms | Set lookup O(1) |
| Rate limit check | < 1ms | Map lookup O(1) |
| Mock generation end-to-end | < 5s | Contract call + backend pipeline + IPFS |

---

## 15. Phase 3 → Phase 4 Handoff

Phase 4 (per MVP_PLAN.md) was originally "UI Assembly & Consolidated Workspace Studio" but Phase 2 already delivered the studio shell. Phase 4 should therefore pivot to:

1. **Cloud Adapter Implementation** — Real Tripo3D, Meshy, Hunyuan3D API integrations (currently return 501).
2. **OpenSCAD WASM Integration** — Port procedural CAD compiler from PromptSCAD into the browser viewport.
3. **GLB → glTF CID-Separated Pipeline** — Implement the full SukaVerse-style buffer extraction + CID deduplication in the backend generation route.
4. **Production Mainnet Deployment** — Deploy contract to Filecoin Mainnet, switch backend RPC to Glif mainnet.
5. **Public Gateway Bridge** — Optional Pinata pinning for selective asset sharing.

**What Phase 3 leaves ready for Phase 4:**
- A deployed, tested, verified PayGo contract on local and Calibration networks.
- Frontend `wallet.js` fully wired to real contract calls.
- Backend hardened against replay attacks and rate-limited.
- ABI serving endpoint so the frontend always uses the correct contract interface.

---

*End of Phase 3 Specification.*
