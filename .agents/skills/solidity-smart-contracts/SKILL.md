---
name: solidity-smart-contracts
description: Use for any Solidity/contract task in this repo — deploys, ABI mismatches, transaction reverts, address alignment checks, free vs paid tier (ArbeskAssetFree/ArbeskAsset), USDC PayGo, Merkle editor auth, OpenZeppelin v5, smart account proxy validation, or the compile→deploy→sync→test pipeline.
---

# Solidity Smart Contract Expertise

Two contracts share `ArbeskAssetBase.sol` (ERC-721 + Merkle editor auth + burn); OZ v5, Solidity `^0.8.20` (compiled 0.8.24, Cancun):

| Contract | File | Env var | Role |
|----------|------|---------|------|
| `ArbeskAssetFree` | `blockchain/contracts/ArbeskAssetFree.sol` | `CONTRACT_ADDRESS` | **Default** — 10 gen/day/wallet |
| `ArbeskAsset` | `blockchain/contracts/ArbeskAsset.sol` | `PAID_CONTRACT_ADDRESS` | USDC PayGo, unlimited gen |

## Quick Decision

| Symptom | Action |
|---------|--------|
| `c.methods.X is not a function` | Stale ABI → `docker compose run --rm hardhat npx hardhat compile` |
| `Transaction reverted` / `WRONG_CONTRACT` | Address mismatch → root `.env` vs `blockchain/.env` |
| `WRONG_CONTRACT` with MetaMask | Smart-account proxy → validate events, not `receipt.to` |
| Session signing every request | Case-sensitive address bug in localStorage |
| Adding a contract function | Solidity → tests → `REQUIRED_*_ABI_FUNCTIONS` → recompile → redeploy → sync `.env` |
| Failed generation tx | `[GEN]` logs, validate receipt, decode events |

## Networks

| Network | Chain ID | Hardhat name | Wallets |
|---------|----------|--------------|---------|
| Hardhat Local | 31415822 | `hardhat` / `localhost` | EOA |
| Base Sepolia | 84532 | `baseSepolia` | EOA + CDP smart accounts |

## Hard Rules

1. Lowercase ALL addresses in storage and comparison — case mismatch breaks sessions.
2. Every state-changing function emits an event — required for smart-account proxy validation.
3. Validate `log.address`, never `receipt.to` — proxies route through bundlers.
4. After any `.sol` change: compile → deploy → sync `CONTRACT_ADDRESS` `blockchain/.env` → root `.env` → `npm run test:frontend`. Deploy with `--network localhost`; bare `--network hardhat` targets an ephemeral chain that vanishes.
5. OZ v5: override `_update`, not `_beforeTokenTransfer`.
6. USDC only, 6 decimals — no native-token payment path (`receive()`/`fallback()` revert).
7. Gas: `immutable` for constructor values, `calldata` params, pack storage slots.
8. Smart wallets (CDP ERC-4337) on Base Sepolia only; generation UI via `wallet-payments.js` → `isFreeTierContract()` — never hard-code the paid path.

## References (read on demand)

- Read `references/contract-deep-dive.md` when you need storage layout, full function inventory, event signatures, tier pricing, or MockUSDC.
- Read `references/deployment-pipeline.md` when deploying, syncing addresses, or adding a function or network.
- Read `references/debugging.md` when a tx reverts or tests fail — Hardhat console, event decoding, scenario table, integrity suite.
- Read `references/checklists.md` when verifying a deployment end-to-end (5-phase checklist).
- Read `references/smart-accounts.md` when ERC-4337 / MetaMask Smart Transactions cause `WRONG_CONTRACT`.
- Read `references/session-auth.md` when debugging SIWE sessions or address-case bugs.
- Read `references/deep-dive.md` when writing new Solidity — patterns, OZ v5 breaking changes, gas checklist.
- Read `references/quick-reference.md` for the ASCII cheat sheet (constants, commands, endpoints).
