# Phase 1: Data Bridge, Mock Adapters & Private IPFS

> **Source System**: SukaVerse (`/home/ahmedh/projects/arbesk/suka-forever`)  
> **Target System**: Arbesk (`/home/ahmedh/projects/arbesk/arabesk`)  
> **Scope**: Backend API, IPFS storage pipeline, mock generation adapters  
> **Constraint**: Reuse SukaVerse files verbatim where possible; adapt only where the data model diverges.

---

## 1. Core Architecture Understanding — GLB vs. glTF for Storage

SukaVerse taught us a critical lesson about 3D asset storage on IPFS that Arbesk must preserve exactly:

| Concern | Format | Reason |
|---------|--------|--------|
| **Rendering** | **GLB** | Babylon.js loads GLB efficiently as a single binary blob. Fast, compact, ideal for viewport playback. |
| **Storage** | **glTF JSON** | GLB bundles structure + mesh data into one opaque blob. If you store a GLB on IPFS, every tiny parametric edit (color change, scale change) produces a **new CID for the entire file**, including unchanged mesh data. |
| **Binary payload** | **Compressed base64 buffers** | When converting GLB → glTF for storage, mesh buffers are kept as compressed binary data (base64-encoded in the glTF `buffers[]` array). |
| **IPFS deduplication** | **CID-referenced buffers** | Before writing to IPFS, each base64 buffer is extracted, uploaded to IPFS as its own blob, and its URI in the glTF JSON is replaced with `data:application/cid;base64,<CID>`. The lightweight glTF JSON (structure-only, ~KBs) gets its own CID. Future parametric versions that only change material colors reuse the **same mesh CID** — only the glTF JSON CID changes. |

### Storage Lifecycle

```
Generation (Mock Adapter)
    │
    ▼
┌─────────────────┐
│   GLB Buffer    │  ← intro.glb / suka.glb (from SukaVerse assets)
│  (render-ready) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  Convert GLB → glTF JSON    │  ← structural extraction
│  with embedded base64 URIs  │
│  data:application/octet-    │
│  stream;base64,...          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Extract base64 buffers     │
│  → upload each to IPFS      │
│  → receive buffer CID       │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Rewrite buffer URIs:       │
│  data:application/cid;      │
│  base64,QmBuffer...         │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Upload glTF JSON to IPFS   │
│  → receive structure CID    │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Append to Manifest History │
│  {                          │
│    "v": 1,                  │
│    "type": "generation",    │
│    "src": "ipfs://Qm...",   │
│    ...                      │
│  }                          │
└─────────────────────────────┘
```

### Render Lifecycle (Reverse)

```
Babylon.js SceneLoader
    │
    ▼
┌─────────────────────────────┐
│  Fetch glTF JSON from IPFS  │
│  (via gateway)              │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  For each buffer URI:       │
│  if starts with             │
│  "data:application/cid;"    │
│  → fetch base64 from IPFS   │
│  → replace with             │
│  "data:application/octet-   │
│   stream;base64,..."        │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Stringify glTF JSON        │
│  → data URI                 │
│  data:{gltfString}          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  BABYLON.SceneLoader.       │
│  ImportMesh(dataURI)        │
└─────────────────────────────┘
```

**Golden Rule**: The mesh data (heavy) is content-addressed once and reused forever. The glTF JSON (light) captures structure, transforms, and material references and is versioned per edit. This is what makes the Fractal Manifest possible.

---

## 2. Reusable SukaVerse Files — Backend

These files live in `suka-forever/` and can be copied into `arabesk/` with only naming/path changes.

### 2.1 Express Server Bootstrap

**Source**: `suka-forever/src/index.js`  
**Target**: `arabesk/src/index.js`

```javascript
import express from 'express';
import path from 'path';
import http from 'http';
import url from 'url';
import api from './api/index.js';
import bodyParser from 'body-parser';

export const app = express();
const port = process.env.PORT || 9090;
export const server = http.createServer(app);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

app.use(express.static(__dirname + '/../frontend/dist'));
app.use(bodyParser({ limit: '50mb' }));
app.use(express.json());
app.use('/api', api());

server.listen(port);
console.log('Server started at http://localhost:' + port);
```

**Reusage notes**:
- ES modules (`import`/`export`) — matches Arbesk spec.
- `bodyParser` limit of `50mb` is necessary because glTF JSON with embedded base64 buffers can be large before CID extraction.
- Static file serving points to `frontend/dist` — unchanged.

---

### 2.2 API Router & IPFS Client Setup

**Source**: `suka-forever/src/api/index.js`  
**Target**: `arabesk/src/api/index.js` (base), `arabesk/src/api/generate-asset-node.js`, `arabesk/src/api/parametric-version.js`

**Key reusable sections**:

#### IPFS Client Initialization
```javascript
import { create } from 'ipfs-http-client';
const ipfs = create(new URL('http://127.0.0.1:5001'));  // ← changed from sukaverse.club
```

#### IPFS Write (`ipfs.add`)
```javascript
api.post('/push-ipfs', async (req, res) => {
    const { cid } = await ipfs.add(JSON.stringify(req.body));
    res.send(cid.toJSON());
});
```

#### IPFS Read (`ipfs.cat`)
```javascript
async function getFromIPFS(cid) {
    let data = '';
    for await (const file of ipfs.cat(cid)) {
        const buffer = new Uint16Array(file);
        buffer.forEach(code => {
            data += String.fromCharCode(code);
        });
    }
    return data;
}
```

**Critical divergence for Arbesk**:

SukaVerse stores a flat **microledger**:
```json
{
  "prev": "QmPrevious...",
  "ts": "2023-01-01 12:00:00",
  "cid": "QmGLTF...",
  "tokens": []
}
```

Arbesk stores a **fractal manifest**:
```json
{
  "manifest_id": "root_universe_world_001",
  "version": 4,
  "prev_manifest_cid": "QmPrevious...",
  "nodes": [
    {
      "node_id": "node_table_xyz_01",
      "gltf_source": "ipfs://Qm...",
      "transform_matrix": [...],
      "history": [
        { "v": 1, "type": "generation", "src": "ipfs://Qm...", "prompt": "...", "provider": "meshy", "txHash": "0x..." }
      ]
    }
  ]
}
```

The **IPFS read/write primitives** (`ipfs.add`, `ipfs.cat`) are identical. Only the JSON shape changes.

SukaVerse's linked-list traversal:
```javascript
async function microLedgerToList(cid, cids = []) {
    const data = JSON.parse(await getFromIPFS(cid));
    cids.push(data);
    if (data.prev != null) {
        await microLedgerToList(data.prev, cids);
    }
    return cids;
}
```

Arbesk replaces this with manifest-specific history traversal (per `node.history[]` array, not a global linked list).

---

### 2.3 Wallet Authentication Middleware

**Source**: `suka-forever/src/api/authentication.js`  
**Target**: `arabesk/src/api/authentication.js`

**What it does**:
- Reads `Authorization: Bearer <base64message>.<base64signature>` header
- Recovers Ethereum address from signed message via `web3.eth.accounts.recover()`
- For SukaVerse: verifies the signer owns the NFT via `ownerOf()`
- For Arbesk: adapt to verify `txHash` exists on-chain and matches `msg.sender` for the generation payment

**Reusable code**:
- `dotenv` loading from `blockchain/.env`
- Web3 provider setup via `createAlchemyWeb3` (or standard `Web3`)
- Base64 decoding of auth tokens
- Signature recovery pattern

**Adaptation for Arbesk**:
Replace the NFT ownership check with txHash validation:
```javascript
// SukaVerse checks:
// const ownerAddress = await contract.methods.ownerOf(tokenId).call();
// if (addressx != ownerAddress) { ... }

// Arbesk checks:
// const receipt = await web3.eth.getTransactionReceipt(txHash);
// if (!receipt || receipt.status !== BigInt(1)) { ... }
```

---

## 3. Reusable SukaVerse Files — Storage Pipeline (Frontend JS)

Although Phase 1 is backend-focused, the **glTF ↔ IPFS translation logic** from SukaVerse defines the data format that the backend must produce and consume. **Arbesk uses only Remote IPFS** (the private Kubo node at `127.0.0.1:5001` / `127.0.0.1:8080`). There is no in-browser IPFS node, no `Ipfs.create()`, and no Dexie local cache. All CID resolution happens via HTTP fetch against the Kubo gateway or the backend `ipfs-http-client`.

### 3.1 glTF Buffer URI Translation (CID ↔ base64)

**Source**: `suka-forever/frontend/src/js/gltf/uri_to_cid.js`  
**Target**: `arabesk/frontend/src/js/gltf/uri_to_cid.js` (Phase 2 reference) / logic extracted for backend adapter

**Core functions**:

#### `convertURItoCID(gltf)` — Prepare for Storage
```javascript
async function convertURItoCID(gltf) {
    let cloned = _.cloneDeep(gltf);
    const base64_prefix = "data:application/octet-stream;base64,";
    const cid_prefix = "data:application/cid;base64,";
    for (const buffer of cloned.buffers) {
        const current_uri = buffer.uri;
        if (current_uri.startsWith("data:application/octet-stream;base64,")) {
            const base64_data = current_uri.replace(base64_prefix, "");
            let cid = null;
            // Upload buffer to IPFS
            cid = await saveToRemoteIPFS(base64_data);
            // Replace URI with CID reference
            buffer.uri = cid_prefix + cid;
        }
    }
    return cloned;
}
```

**What happens**: Each base64 buffer is uploaded to IPFS and replaced with a CID reference. In SukaVerse this ran in the browser via `IpfsHttpClient`. **In Arbesk, this operation is backend-only**: the `saveToRemoteIPFS` step is performed by the Express API using `ipfs-http-client` against `127.0.0.1:5001`. The frontend never writes directly to IPFS.

#### `convertToDataURI(gltf)` — Prepare for Rendering
```javascript
async function convertToDataURI(gltf) {
    let cloned = _.cloneDeep(gltf);
    const base64_prefix = "data:application/octet-stream;base64,";
    const cid_prefix = "data:application/cid;base64,";
    for (const buffer of cloned.buffers) {
        const current_uri = buffer.uri;
        if (current_uri.startsWith("data:application/cid;base64,")) {
            const cid_uri = current_uri.replace(cid_prefix, "");
            // Resolve CID back to base64 via Remote IPFS gateway only
            const base64 = await getBase64FromRemoteIPFS(cid_uri);
            buffer.uri = base64_prefix + base64;
        }
    }
    return cloned;
}
```

**What happens**: Before handing to Babylon.js, CID references are resolved back to base64 data URIs by fetching directly from the remote IPFS gateway (`127.0.0.1:8080`). No local cache layer exists.

**Why this matters for Phase 1 backend**:
- The backend's `generate-asset-node.js` must produce a glTF JSON that follows this exact URI format.
- The mock adapter currently returns raw GLB. The backend (or a future pipeline step) must convert GLB → glTF JSON with `data:application/octet-stream;base64,...` URIs so that `convertURItoCID` can process it.
- For Phase 1 pragmatism: if GLB→glTF conversion is not yet implemented, the backend may store the GLB directly and reference it as `gltf_source: "ipfs://Qm.../asset.glb"`. The full CID-separated pipeline is the architectural target and should be implemented as soon as the rendering engine (Phase 2) requires it.
- **All IPFS operations are remote**. The backend uses `ipfs-http-client` against `127.0.0.1:5001`. The frontend uses `fetch` against `127.0.0.1:8080`. No browser IPFS node.

---

### 3.2 Frontend IPFS Reader (Gateway-Only)

**Source**: `suka-forever/frontend/src/js/ipfs/remote-ipfs.js`  
**Target**: `arabesk/frontend/src/js/ipfs/remote-ipfs.js`

**Reusable functions**:

```javascript
async function getFromRemoteIPFS(cid) {
    const url = `http://127.0.0.1:8080/ipfs/${cid}`;  // ← changed from sukaverse.club
    const json = await (await fetch(url)).json();
    return json;
}

async function getBase64FromRemoteIPFS(cid) {
    const url = `http://127.0.0.1:8080/ipfs/${cid}`;
    const text = await (await fetch(url)).text();
    return text;
}

async function remoteMicroLedgerToList(cid, cids = []) {
    const data = await getFromRemoteIPFS(cid);
    cids.push(data);
    if (data.prev != null) {
        await remoteMicroLedgerToList(data.prev, cids);
    }
    return cids;
}
```

**Adaptation**: Replace `https://ipfs.sukaverse.club` with `http://127.0.0.1:8080` (private Kubo gateway).

**Critical difference from SukaVerse**: Arbesk does **not** use `IpfsHttpClient` in the browser. The frontend only **reads** from IPFS via HTTP fetch against the gateway (`8080`). All **writes** go through the backend API (`POST /api/generate-asset-node`, `POST /api/parametric-version`) which uses the backend `ipfs-http-client` against the API port (`5001`). This eliminates the need for an in-browser IPFS node and keeps write authorization centralized.

---

---

## 4. Mock Asset Source Files

**Source Directory**: `suka-forever/frontend/src/assets/glb/`  
**Target Reference**: `arabesk` reads from `../suka-forever/frontend/src/assets/glb/`

| File | Purpose | Prompt Trigger |
|------|---------|----------------|
| `intro.glb` | Default generic mock asset | Any prompt (fallback) |
| `suka.glb` | Character / figure mock asset | Prompt contains "character", "figure", "person", "avatar" |
| `suka.gltf` | Fallback format mock asset | Fallback if GLB fails |

**Note**: These are **GLB** files (render-ready). The mock adapter returns them as Buffers. The backend pipeline must decide whether to:
- **Option A (Phase 1 pragmatic)**: Store the GLB binary directly to IPFS. Reference in manifest as `src: "ipfs://Qm..."` with implied `.glb` format.
- **Option B (architecturally correct)**: Convert GLB → glTF JSON with embedded base64 buffers → extract buffers to IPFS CIDs → store CID-referenced glTF JSON. This matches the SukaVerse `uri_to_cid.js` pattern.

**Recommendation for Phase 1**: Implement Option A to get the pipeline working end-to-end. Document Option B as the Phase 2 refinement when the Babylon.js engine needs to manipulate individual materials and buffers.

---

## 5. Dependency Manifest

### Root `package.json` (Backend)

**Source**: `suka-forever/package.json`  
**Target**: `arabesk/package.json`

Reusable dependencies:
```json
{
  "type": "module",
  "dependencies": {
    "body-parser": "^1.20.1",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "ipfs-http-client": "^60.0.0",
    "web3": "^4.x"
  },
  "devDependencies": {
    "jest": "^29.3.1",
    "supertest": "^6.3.1"
  }
}
```

**Removed from SukaVerse** (not needed for Phase 1):
- `@filecoin-shipyard/lotus-client-*` — Arbesk uses standard Web3 JSON-RPC, not Lotus directly
- `ipfs-core` — backend uses `ipfs-http-client` against the Kubo container
- `request` — deprecated; use native `fetch` or `axios`
- `filecoin-api-client` — not needed

**Added for Arbesk**:
- `web3` (or `ethers`) — for txHash validation against Hardhat local node or Filecoin RPC

---

## 6. New Files to Create for Arbesk Phase 1

These do not exist in SukaVerse and must be written from scratch.

### 6.1 Mock Adapter
**File**: `src/api/adapters/mock-adapter.js`

```javascript
import fs from 'fs';
import path from 'path';

const MOCK_ASSETS_DIR = process.env.MOCK_ASSETS_DIR || '../suka-forever/frontend/src/assets/glb';

export default class MockAdapter {
    async generate(prompt) {
        const lower = prompt.toLowerCase();
        let filename = 'intro.glb';
        if (lower.includes('character') || lower.includes('figure') || lower.includes('person') || lower.includes('avatar')) {
            filename = 'suka.glb';
        }
        const filepath = path.resolve(MOCK_ASSETS_DIR, filename);
        const buffer = fs.readFileSync(filepath);
        return { buffer, format: 'glb', provider: 'mock' };
    }
}
```

### 6.2 Generation Route
**File**: `src/api/generate-asset-node.js`

Responsibilities:
1. Accept `POST { prompt, nodeId, txHash, provider? }`
2. Validate `txHash` on-chain via Web3 (`web3.eth.getTransactionReceipt`)
3. If `MOCK_3D_GENERATION=true`, call `MockAdapter`
4. Upload resulting asset to private IPFS (`127.0.0.1:5001`)
5. Read current manifest from IPFS (if exists)
6. Append `type: "generation"` history entry
7. Write updated manifest to IPFS
8. Return `{ newManifestCid, historyEntry }`

### 6.3 Parametric Version Route
**File**: `src/api/parametric-version.js`

Responsibilities:
1. Accept `POST { nodeId, manifestId, color, scale {x,y,z} }`
2. Validate inputs (hex regex, positive numbers)
3. Read current manifest from IPFS
4. Append `type: "parametric"` history entry with `params: { scale, color }`
5. Write updated manifest to IPFS
6. Return `{ newManifestCid, historyEntry }`

**No txHash validation. No SaaS call. No payment.**

---

## 7. Data Flow: Phase 1 End-to-End

```
┌─────────────────┐     POST /api/generate-asset-node
│   Client        │─────► { prompt, nodeId, txHash }
│   (Studio)      │
└─────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  1. Validate txHash         │
│     web3.eth.getTransaction │
│     Receipt(txHash)         │
│     → check status == 1     │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  2. Select Adapter          │
│     if MOCK_3D_GENERATION:  │
│        MockAdapter.generate │
│     else:                   │
│        Cloud adapter        │
│     → returns GLB Buffer    │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  3. Upload to Private IPFS  │
│     ipfs.add(buffer)        │
│     → assetCID              │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  4. Read Manifest           │
│     (if manifestId provided)│
│     ipfs.cat(manifestCID)   │
│     → currentManifest       │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  5. Append History Entry    │
│  {                          │
│    "v": nextVersion,        │
│    "timestamp": Date.now(), │
│    "src": "ipfs://{assetCID}",│
│    "prompt": prompt,        │
│    "provider": "mock",      │
│    "txHash": txHash,        │
│    "type": "generation"     │
│  }                          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  6. Write Manifest to IPFS  │
│     ipfs.add(JSON.stringify │
│       (updatedManifest))    │
│     → newManifestCID        │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  7. Respond                 │
│     { newManifestCid,       │
│       historyEntry }        │
└─────────────────────────────┘
```

---

## 8. IPFS Configuration for Phase 1

The private IPFS node is already configured in `arabesk/docker-compose.yml` and `arabesk/docker/entrypoint.sh`.

**Backend connection**:
```javascript
import { create } from 'ipfs-http-client';
const ipfs = create(new URL('http://127.0.0.1:5001'));
```

**Gateway for debugging**:
```
http://127.0.0.1:8080/ipfs/<CID>
```

**Important**: The backend must use the **API port** (`5001`) for writes (`add`, `cat`, `pin`). The gateway (`8080`) is read-only and suitable for browser fetch requests.

---

## 9. Testing Strategy for Phase 1

**Source reference**: `suka-forever/test/api.test.js`

Replicate the Jest + Supertest pattern. Minimum tests:

1. `POST /api/generate-asset-node` — mock mode
   - Returns `newManifestCid` and `historyEntry`
   - History entry has `type: "generation"`
   - Asset CID is retrievable from IPFS

2. `POST /api/parametric-version`
   - Returns `newManifestCid`
   - History entry has `type: "parametric"`
   - `params.scale` and `params.color` are preserved

3. Manifest structure validation
   - JSON matches fractal manifest schema
   - `nodes[]` exists
   - `history[]` exists per node

4. IPFS round-trip
   - Write manifest → read back → deep equal

---

## 10. Files Summary Table

| SukaVerse Path | Arbesk Path | Action | Notes |
|---|---|---|---|
| `src/index.js` | `src/index.js` | **Copy** | Change nothing except maybe port |
| `src/api/index.js` | `src/api/index.js` | **Adapt** | Keep IPFS primitives; replace microledger routes with manifest routes |
| `src/api/authentication.js` | `src/api/authentication.js` | **Adapt** | Replace NFT ownership check with txHash receipt validation |
| `frontend/src/js/gltf/uri_to_cid.js` | `frontend/src/js/gltf/uri_to_cid.js` | **Copy** | Defines the storage format; backend must produce compatible glTF |
| `frontend/src/js/ipfs/remote-ipfs.js` | `frontend/src/js/ipfs/remote-ipfs.js` | **Adapt** | Change gateway URL to `127.0.0.1:8080` |

| `frontend/src/assets/glb/*.glb` | (referenced externally) | **Read** | Mock adapter reads from `../suka-forever/frontend/src/assets/glb/` |
| `package.json` | `package.json` | **Adapt** | Remove Lotus deps, add Web3/Ethers |
| *new* | `src/api/adapters/mock-adapter.js` | **Create** | Reads GLB files based on prompt keywords |
| *new* | `src/api/generate-asset-node.js` | **Create** | Core generation route |
| *new* | `src/api/parametric-version.js` | **Create** | Free parametric edit route |

---

*End of Phase 1 Specification.*
