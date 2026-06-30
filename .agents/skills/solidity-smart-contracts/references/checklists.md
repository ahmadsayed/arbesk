# Checklists — Solidity Smart Contracts

5-phase integration verification: compile, deploy, address alignment, on-chain, functional.

## 5. Integration Verification Checklist

After any contract change, run through this checklist:

### Phase 1: Compile Verification
- [ ] `docker compose run --rm hardhat npx hardhat compile` succeeds
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
