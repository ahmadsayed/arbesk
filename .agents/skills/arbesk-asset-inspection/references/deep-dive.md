# Deep Dive — Arbesk Asset Inspection

Token resolution, common patterns, and infrastructure dependencies.

## Token Resolution (Frontend)

On the frontend, `child_ref` tokens are resolved at load time by `frontend/src/js/blockchain/token-resolver.js`:

1. **Cache check** — 30-second TTL in-memory cache by `chainId:contractAddress:tokenId`
2. **Contract call** — `tokenURI(tokenId)` on the ERC-721 contract
3. **URI normalization** — `normalizeTokenURI()` extracts the plain IPFS CID from various URI formats (`ipfs://`, `https://`, bare CID)
4. **IPFS fetch** — retrieves the manifest from the private IPFS node

Known RPC endpoints (in `KNOWN_RPC_ENDPOINTS`):
| Chain ID | Name | RPC |
|----------|------|-----|
| 31415822 | Hardhat local | `http://127.0.0.1:8545` |
| 314159 | Calibration testnet | `https://api.calibration.node.glif.io/rpc/v1` |
| 314 | Mainnet | `https://api.node.glif.io/rpc/v1` |

## Key Files

| File | Purpose |
|------|---------|
| `src/api/index.js` | `GET /api/v1/tokens/:tokenId/manifest`, `GET /api/v1/manifests/:cid/history` |
| `src/api/ipfs-utils.js` | `catManifest(ipfs, cid)` — IPFS read with timeout |
| `src/api/manifest-utils.js` | `getSceneNodes(manifest)`, `bumpManifestVersion()` |
| `frontend/src/js/blockchain/token-resolver.js` | `resolveChildRef()` — frontend token → CID resolution |
| `frontend/src/js/blockchain/uri-utils.js` | `normalizeTokenURI()` — CID extraction from token URIs |
| `blockchain/contracts/ArbeskAsset.sol` | `tokenURI(uint256)` — on-chain manifest CID lookup |

## Common Inspection Patterns

### Pattern 1: "Get asset X" where X is a number
→ Try `GET /api/v1/tokens/X/manifest` first. If the backend isn't running, start it with `npm start`.

### Pattern 2: "How many children in asset X?"
→ Fetch the manifest, count nodes with `child_ref` or `child_manifest_id`. See "Counting Children" above.

### Pattern 3: "Show the version history of asset X"
→ First get the manifest CID (via token resolution or direct), then call `GET /api/v1/manifests/:cid/history`.

### Pattern 4: "What's in the manifest at CID X?"
→ `curl -s http://127.0.0.1:9090/api/v1/tokens/TOKEN_ID/manifest` (if a token), or fetch directly from IPFS via `ipfs cat`.

## Dependency: Backend Must Be Running

**The backend server must be running** for the `/api/v1/tokens/` and `/api/v1/manifests/` endpoints to respond. If `curl` returns `Connection refused`, run:

```bash
npm start
# or with auto-reload:
npm run nodemon
```

Also requires:
- **IPFS container**: `docker-compose up -d ipfs`
- **Hardhat container**: `docker-compose up -d hardhat` (for on-chain `tokenURI` calls)
- **Compiled contracts**: `docker-compose run --rm hardhat npx hardhat compile`
- **CONTRACT_ADDRESS** set in root `.env`
