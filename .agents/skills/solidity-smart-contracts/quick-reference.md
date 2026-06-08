# Quick Reference Card — ArbeskAsset

ASCII cheat sheet with all constants, commands, and endpoints.

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
