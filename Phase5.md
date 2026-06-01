# Phase 5: Micro-Ledger & Audit Infrastructure

> **Status**: Planned — next major focus after Phase 4.1 publishing/cache polish  
> **Target**: `src/ledger/`, `src/api/ledger.js`, `frontend/src/js/ui/ledger-panel.js`, contract extensions  
> **Objective**: Build a structured, queryable, append-only audit trail for every manifest mutation, generation, parametric edit, save, publish, mint/update, thumbnail attachment, and team-editor change. The micro-ledger decouples operational logging from the Babylon.js display layer so the system can be ported to XR/immersive environments with zero refactoring.

---

## 1. Motivation — Why a Micro-Ledger?

The backend currently logs operations to `console.log()` with tagged prefixes (`[SAVE]`, `[GEN]`, `[PARAM]`, `[IPFS]`, etc.). The frontend also emits custom events such as `manifest:saved`, `wallet:worldMinted`, and `scenegraph:ready`. This is excellent for development but insufficient for:

| Gap | Current State | Desired State |
|-----|--------------|---------------|
| **Forensic audit** | Console logs scroll away | Persistent queryable record: "Who changed what, when?" |
| **Cross-session replay** | `usedTxHashes` Set is in memory, with manifest-history fallback | Append-only log file survives restarts and supports replay indexes |
| **Analytics** | No aggregation | "Which prompts produce the most parametric edits?" |
| **Immersive ports** | Browser console only | Backend API serves logs to XR headsets |
| **On-chain proof** | Token URI points to latest manifest CID, but no separate anchor log | Contract stores manifest root CID hashes for immutability |
| **Publishing audit** | Thumbnail CIDs are stored in manifests only | Ledger records publish, thumbnail CID, token URI update/mint tx |

---

## 2. Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OPERATION SOURCES                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Generation │  │  Parametric │  │  Save / Load / Mint │  │
│  │  Pipeline   │  │  Version    │  │  Operations         │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          └────────────────┴────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    MICRO-LEDGER CORE                         │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │  Typed Schema   │  │  Append-Only    │                   │
│  │  (JSON/Class)   │  │  Store (JSONL)  │                   │
│  │                 │  │  or SQLite      │                   │
│  │  - opType       │  │                 │                   │
│  │  - manifestId   │  │  - No deletes   │                   │
│  │  - cid          │  │  - No mutations │                   │
│  │  - timestamp    │  │  - Sequential   │                   │
│  │  - actor        │  │    ordering     │                   │
│  │  - payload      │  │                 │                   │
│  └─────────────────┘  └─────────────────┘                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Query API      │  │  On-Chain       │  │  Analytics      │
│  GET /api/ledger│  │  Attestation    │  │  Export         │
│  ?manifestId=   │  │  Contract       │  │  (CSV/JSON)     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 3. Ledger Entry Schema

```typescript
interface LedgerEntry {
  // Metadata
  id: string;           // ULID or UUID v7 (sortable)
  timestamp: number;    // Unix millis
  opType:
    | 'GENERATION'
    | 'PARAMETRIC'
    | 'SAVE'
    | 'PUBLISH'
    | 'THUMBNAIL'
    | 'MINT'
    | 'TOKEN_URI_UPDATE'
    | 'TEAM_EDIT'
    | 'LOAD'
    | 'REVERT'
    | 'SNAPSHOT';
  
  // Identity
  manifestId: string;   // The manifest affected
  cid: string;          // IPFS CID of the resulting manifest
  prevCid: string;      // Previous manifest CID (null for genesis)
  
  // Actor
  actorType: 'USER' | 'SYSTEM' | 'CONTRACT';
  actorAddress: string; // Wallet address or 'system'
  
  // Payload (opType-specific)
  payload: {
    // GENERATION
    prompt?: string;
    provider?: string;
    txHash?: string;
    costWei?: string;
    
    // PARAMETRIC
    nodeId?: string;
    params?: { scale?: {x,y,z}, color?: string };
    
    // SAVE
    version?: number;
    nodeCount?: number;
    
    // PUBLISH / THUMBNAIL
    thumbnailCid?: string;
    thumbnailMime?: string;
    thumbnailBytes?: number;
    publishedCid?: string;

    // MINT / TOKEN_URI_UPDATE
    tokenId?: number | string;
    uri?: string;
    txHash?: string;
    
    // TEAM_EDIT
    editorsAdded?: string[];
    editorsRemoved?: string[];
  };
  
  // Integrity
  signature?: string;   // Optional: backend signs entry with deployer key
}
```

---

## 4. Storage Backend Options

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **JSONL file** (`logs/ledger.jsonl`) | Human-readable, git-friendly, trivial to append | Slow queries, no indexing | **MVP default** |
| **SQLite** (`logs/ledger.db`) | Fast queries, indexing, small footprint | Binary file, needs schema migrations | **Post-MVP upgrade** |
| **IPFS itself** | Content-addressed, decentralized | Append-only is awkward on IPFS | **Archive snapshot only** |
| **Contract events** | On-chain, trustless | Expensive, limited payload | **Anchoring only** |

**MVP Plan**: Start with JSONL. Every `N` entries (e.g., 1000), snapshot to IPFS and record the snapshot CID in the ledger as a `SNAPSHOT` entry.

---

## 5. API Specification

### `GET /api/ledger`

Query the audit trail.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `manifestId` | string | Filter by manifest |
| `opType` | string | Filter by operation type |
| `actorAddress` | string | Filter by actor |
| `since` | number | Unix timestamp, entries >= this |
| `until` | number | Unix timestamp, entries <= this |
| `limit` | number | Max entries (default 50, max 500) |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "entries": [ /* LedgerEntry array */ ],
  "total": 128,
  "limit": 50,
  "offset": 0
}
```

### `GET /api/ledger/stats`

Aggregated analytics.

**Response:**
```json
{
  "totalOperations": 128,
  "byOpType": { "GENERATION": 45, "PARAMETRIC": 67, "SAVE": 16 },
  "byDay": { "2026-05-30": 12, "2026-05-29": 8 },
  "uniqueManifests": 5,
  "uniqueActors": 3
}
```

---

## 6. Smart Contract Extension — On-Chain Anchoring

Add a lightweight anchoring function to `ArbeskWorld.sol`:

```solidity
/// @notice Anchor a manifest CID to the blockchain for immutability proof.
/// @dev Does NOT store the full manifest — only its CID hash. Cheap operation.
/// @param manifestId The manifest identifier.
/// @param cid The IPFS CID to anchor.
event ManifestAnchored(
    string indexed manifestId,
    string cid,
    uint256 timestamp,
    address indexed anchorer
);

mapping(string => string[]) public manifestAnchors;

function anchorManifest(string calldata manifestId, string calldata cid)
    external
    whenNotPaused
{
    require(bytes(manifestId).length > 0, "Empty manifestId");
    require(bytes(cid).length > 0, "Empty CID");
    manifestAnchors[manifestId].push(cid);
    emit ManifestAnchored(manifestId, cid, block.timestamp, msg.sender);
}
```

**Why not store the full manifest on-chain?**
- FEVM storage is expensive. A manifest can be KBs or MBs.
- The CID is a cryptographic commitment to the content. Anyone can verify by fetching from IPFS and hashing.
- The ledger provides the temporal ordering; the contract provides the trust anchor.

---

## 7. Frontend Integration

### `frontend/src/js/ui/ledger-panel.js`

A new collapsible panel in the studio (similar to Team Panel) showing:
- **Operation list**: Timestamp, type, actor (truncated address), brief description
- **Filter bar**: By type, by date range
- **Export button**: Download ledger slice as JSON/CSV
- **Anchor button**: Call `anchorManifest()` on the current manifest

### Wire into existing events

The ledger should hook into both backend operations and frontend events:

Backend hooks:
- `POST /api/generate-asset-node` — generation result manifest CID, asset CID, tx hash
- `POST /api/parametric-version` — parametric edit result manifest CID and node params
- `POST /api/save-manifest` — draft save CID
- `POST /api/push-ipfs` — publish manifest CID and optional thumbnail CID

Frontend/contract hooks:
- `manifest:saved` — emitted by `save-world.js`
- `wallet:worldMinted` — emitted after mint/update refresh flows
- `wallet:generationPaid` — emitted by `wallet.js`
- `node:parametricSaved` — to be added to parametric preview
- `team:editorAdded` / `team:editorRemoved` — to be emitted by team panel operations

---

## 8. Implementation Checklist

### Phase 5a: MVP (JSONL + API + Basic Panel)

| # | Task | File | Est. |
|---|------|------|------|
| 1 | Define `LedgerEntry` schema and validation | `src/ledger/schema.js` | 1h |
| 2 | Implement JSONL append-only store | `src/ledger/store.js` | 2h |
| 3 | Implement query API | `src/api/ledger.js` | 2h |
| 4 | Mount ledger routes | `src/api/index.js` | 15m |
| 5 | Hook into existing operations | `src/api/generate-asset-node.js`, `parametric-version.js`, `save-manifest`, `push-ipfs` | 1h |
| 6 | Add `anchorManifest()` to contract | `blockchain/contracts/ArbeskWorld.sol` | 1h |
| 7 | Write contract tests for anchoring | `blockchain/test/ArbeskWorld.test.js` | 1h |
| 8 | Build basic ledger panel | `frontend/src/js/ui/ledger-panel.js` | 3h |
| 9 | Add ledger panel to studio layout | `frontend/src/pug/studio.pug` | 30m |
| 10 | Style ledger panel | `frontend/src/scss/studio.scss` | 1h |
| 11 | Add ledger panel script to template | `frontend/src/pug/studio.pug` | 30m |
| 12 | Update AGENTS.md and docs with ledger conventions | `AGENTS.md`, `docs/API_SPEC.md`, `docs/CURRENT_STATUS.md` | 30m |

### Phase 5b: Upgrade (SQLite + Analytics + Export)

| # | Task | File | Est. |
|---|------|------|------|
| 12 | Migrate store to SQLite with indexing | `src/ledger/store-sqlite.js` | 3h |
| 13 | Add `/api/ledger/stats` endpoint | `src/api/ledger.js` | 1h |
| 14 | Add CSV/JSON export | `src/api/ledger.js` | 1h |
| 15 | Periodic IPFS snapshot | `src/ledger/snapshot.js` | 2h |
| 16 | Ledger entry digital signatures | `src/ledger/signature.js` | 2h |

---

## 9. Security & Privacy Considerations

| Concern | Mitigation |
|---------|------------|
| Ledger contains user wallet addresses | These are already public on-chain. Ledger only records what the contract already knows. |
| Ledger files grow unbounded | Implement rotation: snapshot to IPFS every N entries, start new JSONL. |
| False entries | Backend signs entries with deployer key. Frontend verifies signature before trusting. |
| Ledger tampering | Append-only file permissions + periodic IPFS snapshots create audit trail of the audit trail. |
| PII in prompts | Prompts may contain personal info. Ledger storage should respect GDPR/CCPA if applicable. |

---

## 10. Relation to MVP_PLAN.md Principles

This phase directly implements the **"Complete Model Separation"** principle from `docs/MVP_PLAN.md`:

> *"Keep the state engine database entirely decoupled from the Babylon.js canvas display layer. If the frontend is ever ported from a web browser window to an immersive XR headset environment, the underlying microledger logging infrastructure should require zero code refactoring."*

The micro-ledger is the **state engine database**. It knows nothing about Babylon.js meshes, materials, or DOM nodes. It only knows:
- Which manifest changed
- What operation was performed
- Who performed it
- What the resulting CID is

An XR headset can query the same `GET /api/ledger` endpoint and render the audit trail in 3D space without touching any viewport code.

---

*End of Phase 5 Specification.*
