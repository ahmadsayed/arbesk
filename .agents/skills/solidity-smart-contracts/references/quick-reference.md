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
│  Payment:             USDC only (no native-token path)  │
│  USDC Tiers:          Basic $0.75 · Standard $1.25      │
│                        Premium $1.75 · Pro $2.50        │
│  USDC Decimals:       6                                 │
│  Editors/Token Cap:   5000 (safety net, list on IPFS)   │
│  Editor Auth:         Merkle root + version on-chain    │
│  Replay Protection:   Rate limit + session (backend)  │
│  Minting:             Public, gas-only, manual tokenId  │
│  TokenURI:            IPFS CIDs (content-addressed)     │
│  Pausable:            Payment/generation-only scope     │
│  Admin:               Single owner (multisig for prod)  │
├─────────────────────────────────────────────────────────┤
│  SMART ACCOUNT SUPPORT                                │
│  • Validate events, not receipt.to                    │
│  • Check log.address === contractAddress              │
│  • Support both direct and proxy/bundler paths        │
├─────────────────────────────────────────────────────────┤
│  NETWORK CONFIG (Base Sepolia)                        │
│  • Chain ID: 84532                                    │
│  • Contract: ArbeskAssetFree (free tier)              │
│  • USDC:     Not deployed on testnet (local only)     │
│  • RPC:      https://sepolia.base.org                 │
├─────────────────────────────────────────────────────────┤
│  SESSION AUTH RULES                                   │
│  • Lowercase ALL addresses in storage/comparison      │
│  • 24h TTL, 60s grace period                          │
│  • Auto-retry on 401 (backend restart)                │
│  • Clear on wallet disconnect                         │
├─────────────────────────────────────────────────────────┤
│  DEPLOY:              docker compose up -d hardhat     │
│                        docker compose exec -T hardhat   │
│                        npx hardhat run scripts/deploy.js│
│                        --network localhost               │
│  TEST:                docker compose run --rm hardhat   │
│                        npx hardhat test                  │
│  INTEGRITY CHECK:     npm run test:frontend             │
│  ABI SERVE:           GET /api/v1/contracts/            │
│                        ArbeskAsset/abi                  │
│  CONFIG ENDPOINT:     GET /api/v1/config                │
└─────────────────────────────────────────────────────────┘
```
