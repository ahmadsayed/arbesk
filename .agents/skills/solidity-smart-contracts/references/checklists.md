# Checklists — Solidity Smart Contracts

5-phase integration verification: compile, deploy, address alignment, on-chain, functional.

## 5. Integration Verification Checklist

After any contract change, run through this checklist:

### Phase 1: Compile Verification
- [ ] `docker compose run --rm hardhat npx hardhat compile` succeeds
- [ ] `blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json` exists on host
- [ ] ABI contains all expected functions (`REQUIRED_PAID_ABI_FUNCTIONS` / `REQUIRED_FREE_ABI_FUNCTIONS` in `test/frontend/deployment-integrity.test.js`)
- [ ] No compiler warnings (check Hardhat output)

### Phase 2: Deploy Verification
- [ ] Deploy script succeeds (`docker compose up -d hardhat` → `docker compose exec -T hardhat npx hardhat run scripts/deploy.js --network localhost`)
- [ ] `blockchain/deployments/localhost/ArbeskAssetFree.json` created with valid address
- [ ] `blockchain/.env` updated with new CONTRACT_ADDRESS, PAID_CONTRACT_ADDRESS, and USDC_TOKEN
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
- [ ] `ArbeskAssetFree` deployed alongside paid contract (local) with `DAILY_GENERATION_LIMIT` = 10

### Phase 5: Functional Verification
- [ ] `payForGenerationWithUSDC()` works for all 4 tiers and emits `AssetGenerationPaidUSDC`
- [ ] `recordGeneration()` emits `AssetGenerationRecorded` and enforces the 10/day quota (free tier)
- [ ] `publishAsset()` mints NFT and stores tokenURI; reverts `ZeroEditorRoot` on a zero root
- [ ] `updateEditors()` rotates the Merkle root and bumps `editorSetVersion`
- [ ] `updateAssetURI()` works with a valid Editor Merkle proof
- [ ] Free-tier quota increments per call (`countToday` in `AssetGenerationRecorded`)
- [ ] Transfer does NOT auto-add the new owner as editor (no transfer hook)
- [ ] Pause/unpause gate generation/payment only — publish, `updateAssetURI`, `updateEditors`, `burn` stay live
- [ ] `receive()` reverts direct ETH transfers (`DirectTransferNotAllowed`)
