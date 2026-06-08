# Debugging — Solidity Smart Contracts

Hardhat console, inline console.log, event decoding, common scenarios, on-chain inspection, and test execution.

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
