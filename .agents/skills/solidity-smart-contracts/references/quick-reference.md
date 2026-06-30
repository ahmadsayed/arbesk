# Quick Reference Card — ArbeskAsset

ASCII cheat sheet with all constants, commands, and endpoints.

## 11. Quick Reference Card

```text
┌─────────────────────────────────────────────────────────┐
│  ARBESKASSET QUICK REFERENCE                            │
├─────────────────────────────────────────────────────────┤
│  Token Name:          ArbeskAsset (ARBA)                │
│  Solidity:            0.8.24 (Cancun EVM)               │
│  Dependencies:        OZ v5 (ERC721, Ownable,            │
│                        ReentrancyGuard, Pausable)        │
│  Native Cost:         0.01 ETH/FIL (flat rate)          │
│  USDC Tiers:          Basic $0.75 · Standard $1.25      │
│                        Premium $1.75 · Pro $2.50        │
│  USDC Decimals:       6                                 │
│  Editors/Token Cap:   50                                 │
│  Tokens/Editor Cap:   500                                │
│  Payment Nonce:       paymentNonce[sender] monotonic    │
│  Replay Protection:   Per-user nonce (on-chain)         │
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
│  NETWORK CONFIG (Optimism Sepolia)                    │
│  • Chain ID: 11155420                                 │
│  • Contract: (deploy to Optimism Sepolia first)       │
│  • USDC:     0x5fd84259d66Cd461235407180D3B4c8d0F273e15│
│  • RPC:      https://sepolia.optimism.io              │
├─────────────────────────────────────────────────────────┤
│  SESSION AUTH RULES                                   │
│  • Lowercase ALL addresses in storage/comparison      │
│  • 24h TTL, 60s grace period                          │
│  • Auto-retry on 401 (backend restart)                │
│  • Clear on wallet disconnect                         │
├─────────────────────────────────────────────────────────┤
│  DEPLOY:              docker compose run --rm hardhat   │
│                        npx hardhat run scripts/deploy.js│
│                        --network hardhat                 │
│  TEST:                docker compose run --rm hardhat   │
│                        npx hardhat test                  │
│  INTEGRITY CHECK:     npm run test:frontend             │
│  ABI SERVE:           GET /api/v1/contracts/            │
│                        ArbeskAsset/abi                  │
│  CONFIG ENDPOINT:     GET /api/v1/config                │
└─────────────────────────────────────────────────────────┘
```
