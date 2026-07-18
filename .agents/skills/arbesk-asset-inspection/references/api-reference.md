# API Reference — Arbesk Asset Inspection

Asset inspection is **client-side first**. There are no backend routes that proxy token or manifest reads. Use the contract + IPFS gateway directly, or call the same helpers the frontend uses.

## Resolve a token ID to its manifest

Call `tokenURI(tokenId)` on the ERC-721 contract, then fetch the returned CID from the IPFS gateway.

```js
import { normalizeTokenURI } from "frontend/src/js/blockchain/uri-utils.js";

const tokenURI = await contract.methods.tokenURI(tokenId).call();
const cid = normalizeTokenURI(tokenURI);
const manifest = await fetch(`http://127.0.0.1:8080/ipfs/${cid}`).then(r => r.json());
```

For collection tokens, `manifest.type === "collection"` and `manifest.assets` maps `assetId` → asset manifest CID. For standalone asset tokens, the manifest itself is `type: "asset"`.

## Walk the manifest version chain

`frontend/src/js/engine/time-travel.js` provides `walkManifestChain(cid, options)`:

```js
import { walkManifestChain } from "frontend/src/js/engine/time-travel.js";

const chain = await walkManifestChain(cid, { maxDepth: 50 });
// chain: [{ cid, version, name, timestamp }, ...]
```

It follows `prev_asset_manifest_cid` links client-side via IPFS gateway reads.

## Direct IPFS fetch

```bash
# In a browser/dev context:
curl -s http://127.0.0.1:8080/ipfs/<CID>

# Inside the Kubo container:
docker compose exec ipfs ipfs cat <CID>
```

## Backend helper (tests only)

In a Node.js test context, fetch content through the storage adapter directly:

```js
import { getStorage } from "../src/api/storage/index.js";
import { maybeDecompress } from "../src/api/ipfs-utils.js";

const raw = await maybeDecompress(await getStorage().catBytes(cid));
const manifest = JSON.parse(raw);
```
