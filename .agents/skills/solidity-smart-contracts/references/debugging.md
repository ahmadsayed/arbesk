# Debugging — Solidity Smart Contracts

Hardhat console, inline console.log, event decoding, common scenarios, on-chain inspection, and test execution.

## 4. Debugging Smart Contracts

### Local Debugging with Hardhat Console

```bash
# Start an interactive Hardhat console against the running local node
# (`--network hardhat` would spawn an ephemeral in-process chain with no deployments)
docker compose up -d hardhat
docker compose run --rm hardhat npx hardhat console --network localhost

# Then in the console:
> const ArbeskAsset = await ethers.getContractFactory("ArbeskAsset")
> const asset = await ArbeskAsset.attach("<CONTRACT_ADDRESS>")
> await asset.name()                              // "ArbeskAsset"
> await asset.symbol()                            // "ARBA"
> await asset.tierCosts(0)                        // 750000 (Basic, 6-decimal USDC)
> await asset.usdcToken()                         // MockUSDC address (local)
> await asset.ownerOf(1)                          // Check token owner
> await asset.tokenURI(1)                         // Get IPFS CID
> await asset.editorRoot(1)                       // Merkle root of the editor set
> await asset.editorSetVersion(1)                 // Monotonic editor-set version
> await asset.editorListURI(1)                    // IPFS CID of the full editor list
```

### Hardhat `console.log` for Inline Debugging

Add to any `.sol` file:
```solidity
import "hardhat/console.sol";

function myFunction() external {
    console.log("tierCosts[Basic]:", tierCosts[Tier.Basic]);
    console.log("msg.sender:", msg.sender);
}
```

Then run the test/hardhat node — log output appears in the Hardhat container's stdout.

### Event Log Decoding

When a transaction reverts without a clear reason, decode the events:

```javascript
// In Hardhat test or console
const tx = await contract.payForGenerationWithUSDC(nodeId, prompt, tier);
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
const paidEvents = events.filter(e => e.name === 'AssetGenerationPaidUSDC');
```

### Common Debugging Scenarios

| Symptom | Likely Cause | Debug Step |
|---------|-------------|------------|
| `DirectTransferNotAllowed` | Native ETH sent to the contract | No native payment path — use `payForGenerationWithUSDC()` |
| `InvalidPromptLength` | Prompt empty or >500 bytes | Validate prompt length before sending |
| `InvalidNodeId` | Zero `nodeId` | Pass a non-zero scene node id |
| `ZeroEditorRoot` | `publishAsset` called with zero `editorRoot_` | Compute the Merkle root of the initial editor list |
| `USDC payments disabled` | `usdcToken` is `address(0)` | `setUsdcToken()` or deploy with valid USDC address |
| `Tier cost not set` | `tierCosts[tier]` is 0 | Call `setTierCost(tier, cost)` first |
| `ERC20: transfer amount exceeds allowance` | USDC `approve()` not confirmed before `payForGenerationWithUSDC()` | Check approval tx succeeded, allowance ≥ tier cost |
| `ERC20: transfer amount exceeds balance` | Wallet holds less USDC than tier cost | Mint MockUSDC (local) or fund the wallet |
| `DailyGenerationLimitReached` | Free-tier 10/day quota exhausted | Wait for next day (contract `owner()` bypasses quota) |
| `c.methods.X is not a function` | Stale ABI | Recompile |
| `Transaction reverted` | Wrong contract address or network | Run `npm run test:frontend` |
| `WRONG_CONTRACT` from backend | `receipt.to` ≠ `CONTRACT_ADDRESS` | Check root `.env` matches deployed address |
| `WRONG_CONTRACT` with smart account | MetaMask routed tx through proxy | See Section 9: Smart Account Proxy Validation |
| Session signing every request | Address case mismatch in localStorage | See Section 10: Session Authentication Pitfalls |

### On-Chain State Inspection (Backend Side)

The backend (`src/api/assets/generate-node.js`) does NOT validate payment transactions — generation is gated by session auth + rate limit, and the browser sends the on-chain `recordGeneration` / `payForGenerationWithUSDC` tx itself (BYOK providers bypass the on-chain gate entirely). To debug a rejected generation:

1. Check the backend logs for `[GEN]` prefix
2. Look for which step failed:
   - `401` → Session missing/expired (`Authorization: Session <token>`)
   - `429` → Generation rate limit hit
   - `400 VALIDATION_ERROR` → Request body failed the Zod schema
   - `rejected - providerKey required` → Real provider without BYOK key (`MISSING_PROVIDER_KEY`)
   - `cloud adapter not implemented` → Non-mock provider selected (`NOT_IMPLEMENTED`)
   - `[GEN] error:` → Adapter failure (`GENERATION_FAILED`)

3. For on-chain payment/quota issues, inspect the browser-sent tx manually:
```javascript
// In Node.js (from project root)
import Web3 from 'web3';
const web3 = new Web3('http://127.0.0.1:8545');
const receipt = await web3.eth.getTransactionReceipt('0x...');
console.log('Status:', receipt.status);
console.log('To:', receipt.to);
console.log('Logs:', receipt.logs.length);

// Decode event signatures
const usdcSig = web3.utils.keccak256('AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)');
for (const log of receipt.logs) {
  if (log.topics[0] === usdcSig) console.log('Found: AssetGenerationPaidUSDC');
}
```

### Contract Test Execution

```bash
# Run all Hardhat tests (inside container)
docker compose run --rm hardhat npx hardhat test

# Run specific test file
docker compose run --rm hardhat npx hardhat test test/ArbeskAsset.test.js

# Run with gas reporter
docker compose run --rm hardhat npx hardhat test --gas

# Run a single test (using .only in the test file)
# Edit blockchain/test/ArbeskAsset.test.js: change describe → describe.only or it → it.only
docker compose run --rm hardhat npx hardhat test
```

### Running the Deployment Integrity Suite

```bash
# Full pipeline check (requires Hardhat node running)
npm run test:frontend
```

This suite (`test/frontend/deployment-integrity.test.js`) validates:
- ✅ Compiled ABI artifact exists and is readable
- ✅ ABI contains all required functions (`REQUIRED_PAID_ABI_FUNCTIONS` / `REQUIRED_FREE_ABI_FUNCTIONS`, 12 each)
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
