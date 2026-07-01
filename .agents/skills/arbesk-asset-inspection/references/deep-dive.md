# Deep Dive — Arbesk Asset Inspection

Token resolution, common patterns, and infrastructure dependencies.

## Token Resolution (Frontend)

On the frontend, `child_ref` tokens are resolved at load time by `frontend/src/js/blockchain/token-resolver.js`:

1. **Cache check** — 30-second TTL in-memory cache by `chainId:contractAddress:tokenId`
2. **Contract call** — `tokenURI(tokenId)` on the ERC-721 contract
3. **URI normalization** — `normalizeTokenURI()` extracts the plain IPFS CID from various URI formats (`ipfs://`, `https://`, bare CID)
4. **IPFS fetch** — retrieves the manifest from the private IPFS gateway

Supported networks (from `constants/chains.js` / `frontend/src/js/blockchain/network-config.js`):
| Chain ID | Name | RPC |
|----------|------|-----|
| 31415822 | Hardhat local | `http://127.0.0.1:8545` |
| 84532 | Base Sepolia Testnet | `https://sepolia.base.org` |

## Key Files

| File | Purpose |
|------|---------|
| `src/api/ipfs-utils.js` | `catManifest(cid)` — backend IPFS read with timeout |
| `src/api/manifest-utils.js` | `getSceneNodes(manifest)`, `bumpManifestVersion()` |
| `frontend/src/js/blockchain/token-resolver.js` | `resolveChildRef()` — frontend token → CID resolution |
| `frontend/src/js/blockchain/uri-utils.js` | `normalizeTokenURI()` — CID extraction from token URIs |
| `frontend/src/js/engine/time-travel.js` | `walkManifestChain()` — client-side manifest history walk |
| `blockchain/contracts/ArbeskAssetBase.sol` | `tokenURI(uint256)` — on-chain manifest CID lookup |

## Common Inspection Patterns

### Pattern 1: "Get asset X" where X is a number
→ Call `contract.methods.tokenURI(X).call()`, normalize the URI to a CID, then fetch the CID from the IPFS gateway. For collection tokens, look up the desired `assetId` in `manifest.assets`.

### Pattern 2: "How many children in asset X?"
→ Fetch the manifest, count nodes with `child_ref` or `child_manifest_id`. See `manifest-structure.md`.

### Pattern 3: "Show the version history of asset X"
→ Get the latest manifest CID, then walk `prev_asset_manifest_cid` client-side (e.g. `walkManifestChain(cid)`).

### Pattern 4: "What's in the manifest at CID X?"
→ Fetch it directly from the IPFS gateway: `curl -s http://127.0.0.1:8080/ipfs/<CID>`.

## Dependency: Local Dev Stack

For on-chain `tokenURI` calls and IPFS reads you need:
- **Full stack**: `./scripts/start-dev.sh --setup-only` (IPFS + Hardhat + Nostr + contracts + frontend)
- **Or individual**: `docker compose up -d ipfs`, `docker compose up -d hardhat`
- **Compiled contracts**: `docker compose run --rm hardhat npx hardhat compile`
- **CONTRACT_ADDRESS** set in root `.env`
