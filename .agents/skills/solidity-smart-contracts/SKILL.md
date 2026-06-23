---
name: solidity-smart-contracts
description: Expert guidance on Solidity smart contract architecture, deployment, debugging, and address alignment verification. Covers the two-tier contract system (ArbeskAssetFree / ArbeskAsset), ERC721 NFTs, PayGo USDC payment patterns, OpenZeppelin v5, Hardhat tooling, multi-network deployment, smart account (ERC-4337) proxy validation, session auth debugging, the full compile→deploy→verify→integrate pipeline, and MegaETH/MegaEVM-specific patterns (dual gas model, slot-reuse storage, volatile data access limits, Foundry deployment, eth_sendRawTransactionSync, EIP-7966). Use when asked to "debug the contract", "check contract address alignment", "deploy contracts", "audit the contract", "add a function to the contract", "explain the payment flow", "free tier vs paid tier", "ArbeskAssetFree", "smart account", "proxy contract", "session auth", "MegaETH", "MegaEVM", "Foundry", "gas model", "volatile data", or any Solidity/blockchain/NFT question in this codebase. When you see a contract error, ABI mismatch, or transaction revert, invoke this skill immediately.
---

# Solidity Smart Contract Expertise

Use this skill for any task involving Solidity smart contracts: architecture review, function implementation, deployment, debugging, address alignment, event verification, smart account proxy handling, session authentication debugging, test coverage, security audit, or MegaETH/MegaEVM-specific optimization.

## Quick Decision

| Question | Action |
|----------|--------|
| `c.methods.X is not a function`? | Stale ABI. Recompile: `docker-compose run --rm hardhat npx hardhat compile`. See [→ Deployment Pipeline](./references/deployment-pipeline.md) |
| `Transaction reverted` / `WRONG_CONTRACT`? | Address mismatch. Check root `.env` vs `blockchain/.env`. See [→ Deployment Pipeline](./references/deployment-pipeline.md) |
| `WRONG_CONTRACT` with MetaMask? | Smart account proxy. Validate events, not `receipt.to`. See [→ Smart Accounts](./references/smart-accounts.md) |
| Session signing every request? | Case-sensitive address bug in localStorage. See [→ Session Auth](./references/session-auth.md) |
| Need to add a contract function? | Write Solidity → add tests → add to `REQUIRED_ABI_FUNCTIONS` → recompile → redeploy → sync `.env`. See [→ Deployment Pipeline](./references/deployment-pipeline.md) |
| Debugging a failed generation tx? | Check `[GEN]` logs, validate receipt, decode events. See [→ Debugging](./references/debugging.md) |
| Deploying to MegaETH? | Use Foundry, skip local simulation, hardcode gas limits. See [→ MegaETH Patterns](./references/megaeth-patterns.md) |
| Out of gas after `block.timestamp`? | Hit MegaEVM volatile data cap (20M compute gas retroactive). Restructure or use timestamp oracle. See [→ MegaETH Patterns](./references/megaeth-patterns.md) |
| Expensive SSTORE on MegaETH? | New slots cost 2M+ gas. Favor slot reuse, RedBlackTreeLib, transient storage. See [→ MegaETH Patterns](./references/megaeth-patterns.md) |

## Contract Overview

Two production contracts share `ArbeskAssetBase.sol` (abstract ERC-721 base):

| Contract | File | Role | Limits |
|----------|------|------|--------|
| `ArbeskAssetFree` | `blockchain/contracts/ArbeskAssetFree.sol` | **Default** — free tier | 10 gen/day/wallet, 5 editors/token |
| `ArbeskAsset` | `blockchain/contracts/ArbeskAsset.sol` | Paid tier — USDC PayGo | Unlimited paid gen, 50 editors/token |

**`CONTRACT_ADDRESS`** → `ArbeskAssetFree` (default); **`PAID_CONTRACT_ADDRESS`** → `ArbeskAsset`

**Solidity:** `^0.8.20` (compiled 0.8.24, Cancun EVM)
**Dependencies:** OpenZeppelin v5 — ERC721, Ownable, ReentrancyGuard, Pausable
**Test file:** `blockchain/test/ArbeskAsset.test.js` (~856 lines, 30+ test cases)
**Security audit:** `blockchain/SECURITY.md` (6 documented findings)

### Storage Layout (key variables)

| Variable | Type | Notes |
|----------|------|-------|
| `costPerGeneration` | `uint256` | 0.01 ether default |
| `tierCosts` | `mapping(Tier => uint256)` | 4 tiers, 6-decimal USDC |
| `usdcToken` | `IERC20` | address(0) = disabled |
| `developerTreasuryWallet` | `address` | All payments go here |
| `paymentNonce` | `mapping(address => uint256)` | Per-user replay guard |

### Function Categories

- **Payment — Native:** `payForGeneration(bytes32,string)` — payable, nonReentrant
- **Payment — USDC:** `payForGenerationWithUSDC(bytes32,string,uint8)` — tiered ERC-20
- **NFT Minting:** `publishAsset(string,uint256,bytes32,string)`, `tokenURI(uint256)`
- **Collaboration:** `updateAssetURI`, `updateEditors`, `burn`
- **Admin:** `setCost`, `setTreasury`, `setUsdcToken`, `setTierCost`, `pause`, `unpause`, `withdraw`

### Tier Pricing (6-decimal USDC)

| Tier | Value | Default Cost | USD |
|------|-------|-------------|-----|
| Basic | 0 | 750,000 | $0.75 |
| Standard | 1 | 1,250,000 | $1.25 |
| Premium | 2 | 1,750,000 | $1.75 |
| Pro | 3 | 2,500,000 | $2.50 |

### Event Signatures (keccak256 topic[0])

```
AssetGenerationPaid(address,bytes32,string,uint256,uint256)
AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)
AssetPublished(address,uint256,string)
EditorSetChanged(uint256,bytes32,uint256)
AssetBurned(uint256,address)
AssetURIUpdated(uint256,string)
```

## MegaETH / MegaEVM Deployment Context

Arbesk targets MegaETH testnet (`chainId 6343`) and eventually mainnet (`chainId 4326`). The Solidity skill now aligns with the `megaeth-developer` skill for deployment and runtime correctness on MegaEVM.

| Network | Chain ID | RPC | EVM Target |
|---------|----------|-----|------------|
| MegaETH Mainnet | 4326 | `https://mainnet.megaeth.com/rpc` | MegaEVM |
| MegaETH Testnet | 6343 | `https://carrot.megaeth.com/rpc` | MegaEVM |

### MegaEVM-Specific Considerations

- **Dual gas model:** compute gas and storage gas are tracked separately. Both come from the gas limit.
- **Base fee:** fixed at `0.001 gwei` (1,000,000 wei). No EIP-1559 buffer needed; ignore `maxPriorityFeePerGas`.
- **Intrinsic gas:** simple transfers cost **60,000 gas** on MegaETH, not 21,000.
- **SSTORE (0 → non-zero):** ~2M gas × bucket multiplier. New storage slots are very expensive; design for slot reuse.
- **State growth limit:** 1,000 new slots per transaction; 98% forwarded to child frames (Rex4).
- **Volatile data cap:** `block.timestamp`, `block.number`, etc. retroactively cap total compute gas at 20M for the whole transaction.
- **High-precision time:** use the timestamp oracle at `0x6342000000000000000000000000000000000002` for microseconds and to avoid the volatile-data cap.
- **Transaction submission:** prefer `eth_sendRawTransactionSync` (EIP-7966) for near-instant receipts on MegaETH.
- **Gas estimation:** always use remote `eth_estimateGas`; local Hardhat/Foundry simulation uses standard EVM costs, not MegaEVM.
- **Foundry on MegaETH:** use `--skip-simulation` and explicit `--gas-limit`; never rely on local gas estimates.

See the full MegaETH playbook in the `megaeth-developer` skill and [→ MegaETH Patterns](./references/megaeth-patterns.md) for code samples.

## Key Rules

1. **Lowercase ALL addresses** in storage and comparison — prevents case-mismatch session bugs.
2. **Every state-changing function emits an event** — required for smart account proxy validation.
3. **Validate `log.address`, not `receipt.to`** — proxy transactions route through bundlers.
4. **Always run `npm run test:frontend`** after any `.sol` change — catches ABI staleness and address misalignment.
5. **Sync `CONTRACT_ADDRESS`** from `blockchain/.env` → root `.env` after every deploy.
6. **OZ v5 breaking change:** override `_update`, not `_beforeTokenTransfer`.
7. **Gas:** use `immutable` for constructor values, `calldata` for params, pack storage slots.
8. **MegaETH gas model:** new storage slots cost ~2M gas. Prefer slot reuse, fixed-size arrays, RedBlackTreeLib, or off-chain storage over unbounded mappings.
9. **MegaETH volatile data:** keep total compute gas under 20M in any transaction touching `block.timestamp`/`block.number`/coinbase; otherwise use the timestamp oracle.
10. **MegaETH transactions:** use `eth_sendRawTransactionSync` (EIP-7966) and remote `eth_estimateGas`; don't rely on local Hardhat/Foundry simulation for gas costs.

## File Map

| File | Role | Details |
|------|------|---------|
| `blockchain/contracts/ArbeskAssetBase.sol` | Abstract base — ERC-721, collaboration, burn | [→ Contract Deep Dive](./references/contract-deep-dive.md) |
| `blockchain/contracts/ArbeskAssetFree.sol` | Free tier — 10 gen/day quota, no payment | [→ Contract Deep Dive](./references/contract-deep-dive.md) |
| `blockchain/contracts/ArbeskAsset.sol` | Paid tier — USDC PayGo, unlimited gen | [→ Contract Deep Dive](./references/contract-deep-dive.md) |
| `blockchain/contracts/mock/MockUSDC.sol` | Local testing USDC | [→ Contract Deep Dive](./references/contract-deep-dive.md) |
| `blockchain/hardhat.config.js` | Hardhat config | [→ Deployment Pipeline](./references/deployment-pipeline.md) |
| `blockchain/scripts/deploy.js` | Deploy script | [→ Deployment Pipeline](./references/deployment-pipeline.md) |
| `blockchain/scripts/verify.js` | Block explorer verify | [→ Deployment Pipeline](./references/deployment-pipeline.md) |
| `blockchain/test/ArbeskAsset.test.js` | Contract test suite | [→ Debugging](./references/debugging.md) |
| `test/frontend/deployment-integrity.test.js` | Address + ABI integrity | [→ Checklists](./references/checklists.md) |
| `src/api/assets/generate-node.js` | Tx validation backend | [→ Smart Accounts](./references/smart-accounts.md) |
| `src/api/sessions.js` | Session store | [→ Session Auth](./references/session-auth.md) |
| `frontend/src/js/blockchain/wallet.js` | Web3Modal, contract init | [→ Session Auth](./references/session-auth.md) |

## Deep Reference

| Topic | File |
|-------|------|
| General Solidity, OZ v5, Patterns, Gas | [→ Deep Dive](./references/deep-dive.md) |
| Arbesk Contract: Storage, Functions, Events, Tiers | [→ Contract Deep Dive](./references/contract-deep-dive.md) |
| Compile → Deploy → Address Sync → Multi-Network | [→ Deployment Pipeline](./references/deployment-pipeline.md) |
| Hardhat Console, Event Decoding, Common Scenarios | [→ Debugging](./references/debugging.md) |
| 5-Phase Integration Verification | [→ Checklists](./references/checklists.md) |
| ERC-4337 Proxy / Smart Account Validation | [→ Smart Accounts](./references/smart-accounts.md) |
| SIWE Sessions, Case-Sensitive Address Bug | [→ Session Auth](./references/session-auth.md) |
| MegaETH/MegaEVM patterns, gas, storage, volatile data | [→ MegaETH Patterns](./references/megaeth-patterns.md) |
| ASCII Quick Reference Card | [→ Quick Reference](./references/quick-reference.md) |
