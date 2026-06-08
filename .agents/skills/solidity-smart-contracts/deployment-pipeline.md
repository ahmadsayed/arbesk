# Deployment Pipeline — Solidity Smart Contracts

Compile → deploy → address sync → multi-network config. Adding new networks and new contract functions.

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
