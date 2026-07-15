# Shared Token Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the backend token indexer to discover tokens where a wallet is a Merkle editor, expose that list via `GET /api/v1/indexer/shared`, and update the frontend asset library to use it.

**Architecture:** The indexer already scans ERC-721 `Transfer` events to build an ownership map. We will also scan `EditorSetChanged` events, read the on-chain `editorListURI` for each affected token, fetch the editor list JSON from IPFS, and maintain a reverse index (`editorAddress -> tokenIds`). A new API endpoint returns the editor-shared tokens for a wallet, and the frontend asset library calls it instead of relying only on the contract's optional `listTokens` fallback.

**Tech Stack:** Node.js, Web3.js, Express, Zod, Jest, ES modules.

---

## File Map

| File | Change |
|------|--------|
| `src/api/token-indexer.js` | Add editor-set indexing: combined ABI, editor log fetching, IPFS editor-list resolution, reverse-map state, `getSharedTokens` query method. |
| `src/api/routes/indexer.js` | Add `GET /api/v1/indexer/shared` route. |
| `src/api/schemas.js` | Add `sharedQuerySchema` (same shape as `ownedQuerySchema`). |
| `frontend/src/js/services/api.js` | Add `getSharedTokens` helper. |
| `frontend/src/js/ui/asset-library.js` | Use backend shared endpoint in `fetchAssetLibrary`. |
| `test/token-indexer-shared.test.js` | New unit tests for editor indexing logic. |
| `test/api/indexer-shared.test.js` | New API route tests for `/indexer/shared`. |
| `src/api/openapi.json` | Document `/indexer/shared`. |
| `docs/API_SPEC.md` | Document `/indexer/shared` and fix the "shared discovered alongside owned" claim. |
| `docs/CURRENT_STATUS.md` | Mark shared-token indexing as implemented. |

---

## Task 1: Extend `src/api/token-indexer.js` for editor indexing

**Files:**
- Modify: `src/api/token-indexer.js`

- [ ] **Step 1.1: Add imports and constants**

Add at the top of `src/api/token-indexer.js`, immediately after the existing imports:

```js
import { getStorage } from "./storage/index.js";

const EDITOR_SET_CHANGED_TOPIC0 =
  "0xe04346630a2a402b40ab5f6918205fee5369cca36e2e6c2eebc4188b5f10c8c3";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000".toLowerCase();

const INDEXER_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "from",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
      {
        internalType: "bytes32",
        name: "newRoot",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "newVersion",
        type: "uint256",
      },
    ],
    name: "EditorSetChanged",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
    ],
    name: "editorListURI",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];
```

- [ ] **Step 1.2: Update the `TokenIndexer` constructor**

Replace the existing `this.contract = new this.web3.eth.Contract(TRANSFER_ABI, this.contractAddress);` line with:

```js
    this.contract = new this.web3.eth.Contract(INDEXER_ABI, this.contractAddress);
```

Add the editor-map state fields right after `this.ownership = new Map();`:

```js
    /** @type {Map<string, string[]>} tokenId -> lowercase editor addresses */
    this.tokenEditors = new Map();
    /** @type {Map<string, string[]>} lowercase editor address -> tokenIds */
    this.editorTokens = new Map();
```

- [ ] **Step 1.3: Update `_loadState` to restore editor maps**

Replace the `_loadState` body with the following (keeps backward compatibility with old state files):

```js
  _loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw = fs.readFileSync(this.stateFile, "utf8");
      /** @type {IndexerState} */
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.lastScannedBlock === "number" &&
        parsed.ownership &&
        typeof parsed.ownership === "object"
      ) {
        this.lastScannedBlock = Math.max(parsed.lastScannedBlock, this.deploymentBlock);
        this.ownership = new Map(Object.entries(parsed.ownership));
        this.tokenEditors = new Map(
          Object.entries(parsed.tokenEditors || {}).map(([k, v]) => [k, Array.isArray(v) ? v : []])
        );
        this.editorTokens = new Map(
          Object.entries(parsed.editorTokens || {}).map(([k, v]) => [k, Array.isArray(v) ? v : []])
        );
        console.log(
          `[${ts()}] [INDEXER] loaded state for chain ${this.chainId}: ` +
            `${this.ownership.size} tokens, ${this.editorTokens.size} editors, ` +
            `lastScannedBlock=${this.lastScannedBlock}`
        );
      }
    } catch (err) {
      console.warn(`[${ts()}] [INDEXER] failed to load state for chain ${this.chainId}:`, String(/** @type {Error} */ (err).message));
    }
  }
```

- [ ] **Step 1.4: Update `_saveState` to persist editor maps**

Replace the `_saveState` body with:

```js
  _saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      /** @type {IndexerState} */
      const state = {
        lastScannedBlock: this.lastScannedBlock,
        ownership: Object.fromEntries(this.ownership),
        tokenEditors: Object.fromEntries(this.tokenEditors),
        editorTokens: Object.fromEntries(this.editorTokens),
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(`[${ts()}] [INDEXER] failed to save state for chain ${this.chainId}:`, String(/** @type {Error} */ (err).message));
    }
  }
```

- [ ] **Step 1.5: Update the JSDoc `IndexerState` typedef**

Replace the existing `IndexerState` typedef with:

```js
/**
 * @typedef {Object} IndexerState
 * @property {number} lastScannedBlock
 * @property {Record<string, string>} ownership - tokenId (decimal string) -> owner address (lowercase)
 * @property {Record<string, string[]>} tokenEditors - tokenId -> lowercase editor addresses
 * @property {Record<string, string[]>} editorTokens - lowercase editor address -> tokenIds
 */
```

- [ ] **Step 1.6: Replace `_fetchTransferLogs` with a combined log fetcher**

Rename and generalize the method. Replace `_fetchTransferLogs` with `_fetchLogs`:

```js
  /**
   * Fetch Transfer and EditorSetChanged logs for a single block range.
   * @param {number} fromBlock
   * @param {number} toBlock
   * @returns {Promise<any[]>}
   */
  async _fetchLogs(fromBlock, toBlock) {
    const start = Date.now();
    const logs = await this.web3.eth.getPastLogs({
      address: this.contractAddress,
      topics: [[TRANSFER_TOPIC0, EDITOR_SET_CHANGED_TOPIC0]],
      fromBlock: fromBlock,
      toBlock: toBlock,
    });
    console.log(
      `[${ts()}] [INDEXER] getPastLogs ${fromBlock}..${toBlock} returned ${logs.length} logs ` +
        `in ${Date.now() - start}ms`
    );
    return logs;
  }
```

- [ ] **Step 1.7: Update `_applyLogs` to handle both event types**

Replace the existing `_applyLogs` method with:

```js
  /**
   * Apply Transfer and EditorSetChanged logs to the index.
   * @param {any[]} logs
   */
  _applyLogs(logs) {
    let maxBlock = this.lastScannedBlock;
    /** @type {Set<string>} */
    const editorTokensToRefresh = new Set();

    for (const log of logs) {
      const topic0 = log.topics[0];
      const blockNumber = Number(log.blockNumber);
      if (blockNumber > maxBlock) maxBlock = blockNumber;

      if (topic0 === TRANSFER_TOPIC0) {
        const tokenId = String(this.web3.utils.toBigInt(log.topics[3]));
        const to = "0x" + log.topics[2].slice(-40).toLowerCase();
        this.ownership.set(tokenId, to);
        if (to === ZERO_ADDRESS) {
          this._removeTokenEditors(tokenId);
        }
      } else if (topic0 === EDITOR_SET_CHANGED_TOPIC0) {
        const tokenId = String(this.web3.utils.toBigInt(log.topics[1]));
        editorTokensToRefresh.add(tokenId);
      }
    }

    return { maxBlock, editorTokensToRefresh };
  }
```

- [ ] **Step 1.8: Add editor-map helper methods**

Insert the following methods after `_applyLogs`:

```js
  /**
   * Remove a token from the editor reverse maps.
   * @param {string} tokenId
   */
  _removeTokenEditors(tokenId) {
    const editors = this.tokenEditors.get(tokenId);
    if (!editors) return;
    for (const addr of editors) {
      const list = this.editorTokens.get(addr);
      if (list) {
        const filtered = list.filter((id) => id !== tokenId);
        if (filtered.length === 0) {
          this.editorTokens.delete(addr);
        } else {
          this.editorTokens.set(addr, filtered);
        }
      }
    }
    this.tokenEditors.delete(tokenId);
  }

  /**
   * Fetch the current editor list for a token from chain/IPFS and update maps.
   * @param {string} tokenId
   */
  async _refreshTokenEditors(tokenId) {
    try {
      const cid = await this.contract.methods.editorListURI(tokenId).call();
      if (!cid) {
        this._removeTokenEditors(tokenId);
        return;
      }
      const raw = await getStorage().cat(cid);
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) {
        this._removeTokenEditors(tokenId);
        return;
      }
      const editors = list
        .filter((entry) => entry && entry.address && Number(entry.role) === 2)
        .map((entry) => entry.address.toLowerCase());

      this._removeTokenEditors(tokenId);
      if (editors.length === 0) return;

      this.tokenEditors.set(tokenId, editors);
      for (const addr of editors) {
        const existing = this.editorTokens.get(addr) || [];
        if (!existing.includes(tokenId)) {
          existing.push(tokenId);
          this.editorTokens.set(addr, existing);
        }
      }
    } catch (err) {
      console.warn(
        `[${ts()}] [INDEXER] failed to refresh editors for token ${tokenId}:`,
        String(/** @type {Error} */ (err).message)
      );
    }
  }
```

- [ ] **Step 1.9: Update `_indexRange` to refresh editor lists**

Replace `_indexRange` with:

```js
  /**
   * Index a range of blocks. Safe to call repeatedly.
   * Processes logs in chain-specific chunks and saves state after each chunk.
   * @param {number} fromBlock
   * @param {number} toBlock
   */
  async _indexRange(fromBlock, toBlock) {
    if (fromBlock > toBlock) return;
    const start = Date.now();
    const chunkSize = LOG_CHUNK_SIZES[this.chainId] || 100;
    let totalLogs = 0;

    for (let from = fromBlock; from <= toBlock; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, toBlock);
      const logs = await this._fetchLogs(from, to);
      const { maxBlock, editorTokensToRefresh } = this._applyLogs(logs);
      this.lastScannedBlock = Math.max(maxBlock, to);

      for (const tokenId of editorTokensToRefresh) {
        await this._refreshTokenEditors(tokenId);
      }

      this._saveState();
      totalLogs += logs.length;
    }

    console.log(
      `[${ts()}] [INDEXER] _indexRange ${fromBlock}..${toBlock} total ` +
        `${totalLogs} logs in ${Date.now() - start}ms`
    );
  }
```

- [ ] **Step 1.10: Add `getSharedTokens` query method**

Insert the following method before the class closing brace:

```js
  /**
   * Get token IDs where the address is an editor but not the current owner.
   * @param {string} address
   * @returns {string[]}
   */
  getSharedTokens(address) {
    const lower = address.toLowerCase();
    const shared = [];
    const candidates = this.editorTokens.get(lower) || [];
    for (const tokenId of candidates) {
      const owner = this.ownership.get(tokenId);
      if (owner && owner !== lower) {
        shared.push(tokenId);
      }
    }
    return shared;
  }
```

- [ ] **Step 1.11: Run existing indexer tests to confirm no regression**

Run:

```bash
npm test -- test/token-indexer.test.js --runInBand
```

Expected: 3 tests pass.

---

## Task 2: Add `GET /api/v1/indexer/shared` route

**Files:**
- Modify: `src/api/routes/indexer.js`
- Modify: `src/api/schemas.js`

- [ ] **Step 2.1: Add `sharedQuerySchema` to `src/api/schemas.js`**

Add right after `ownedQuerySchema`:

```js
export const sharedQuerySchema = z.object({
  address: ethereumAddressSchema,
  chainId: chainIdSchema,
  force: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "1"),
});
```

- [ ] **Step 2.2: Update `src/api/routes/indexer.js`**

Replace the imports at the top with:

```js
import { getIndexer } from "../token-indexer.js";
import { validateQuery } from "../validation.js";
import { ownedQuerySchema, sharedQuerySchema } from "../schemas.js";
```

Add the new route inside `indexerRoutes()` after the `/owned` handler:

```js
  router.get("/shared", validateQuery(sharedQuerySchema), async (req, res) => {
    const { address, chainId, force } = /** @type {{ address: string, chainId: number, force: boolean }} */ (/** @type {unknown} */ (req.query));

    try {
      const indexer = getIndexer(chainId);
      const catchUpStart = Date.now();
      const msSinceCatchUp = Date.now() - indexer.lastCatchUpAt;
      if (force || msSinceCatchUp > 30000) {
        try {
          await indexer.catchUp();
        } catch (catchUpErr) {
          console.warn(
            `[${ts()}] [INDEXER-API] catchUp failed for chain`,
            chainId,
            String(/** @type {Error} */ (catchUpErr).message)
          );
        }
        console.log(
          `[${ts()}] [INDEXER-API] catchUp for chain ${chainId} took ` +
            `${Date.now() - catchUpStart}ms, lastScannedBlock=${indexer.lastScannedBlock}` +
            (force ? " (forced)" : "")
        );
      } else {
        console.log(
          `[${ts()}] [INDEXER-API] skipped catchUp for chain ${chainId} ` +
            `(${msSinceCatchUp}ms since last)`
        );
      }
      const shared = indexer.getSharedTokens(address);
      res.json({
        chainId,
        address: address.toLowerCase(),
        shared,
        lastScannedBlock: indexer.lastScannedBlock,
      });
    } catch (err) {
      console.error(`[${ts()}] [INDEXER-API] failed to get shared tokens:`, String(/** @type {Error} */ (err).message));
      res.status(500).json({ error: "failed to read indexer state" });
    }
  });
```

- [ ] **Step 2.3: Verify the route compiles and existing tests pass**

Run:

```bash
npx eslint src/api/routes/indexer.js src/api/schemas.js
npm test -- test/api.test.js --runInBand
```

Expected: ESLint clean; API tests pass.

---

## Task 3: Add frontend API helper

**Files:**
- Modify: `frontend/src/js/services/api.js`

- [ ] **Step 3.1: Add `getSharedTokens`**

Insert immediately after `getOwnedTokens`:

```js
/**
 * GET /api/v1/indexer/shared?address=0x...&chainId=...
 * Returns token IDs where the address is an editor but not the owner,
 * or null on failure.
 *
 * @param {string} address
 * @param {number} chainId
 * @param {boolean} [force]
 * @returns {Promise<string[]|null>}
 */
export async function getSharedTokens(address, chainId, force = false) {
  try {
    const forceParam = force ? "&force=true" : "";
    const res = await fetch(
      `${API_BASE}/indexer/shared?address=${encodeURIComponent(address)}&chainId=${chainId}${forceParam}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`indexer returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.shared)) throw new Error("invalid indexer response");
    return data.shared.map(String);
  } catch (err) {
    warn("[SESSION] shared indexer query failed:", err.message);
    return null;
  }
}
```

- [ ] **Step 3.2: Verify no lint errors**

Run:

```bash
npx eslint frontend/src/js/services/api.js
```

Expected: clean.

---

## Task 4: Update `frontend/src/js/ui/asset-library.js` to use the backend shared endpoint

**Files:**
- Modify: `frontend/src/js/ui/asset-library.js`

- [ ] **Step 4.1: Update imports**

Change the import from `../services/api.js` to also import `getSharedTokens`:

```js
import { getOwnedTokens, getSharedTokens } from "../services/api.js";
```

- [ ] **Step 4.2: Update `fetchAssetLibrary`**

Replace the body of `fetchAssetLibrary` (lines 190-211) with:

```js
  let owned = [];
  let shared = [];

  try {
    [owned, shared] = await Promise.all([
      fetchOwnedTokenIds(contract, address, forceIndexer),
      getSharedTokens(address, walletState.get().chainId, forceIndexer),
    ]);
    if (!Array.isArray(shared)) shared = [];

    // Fallback for local/dev contracts that expose listTokens(address).
    if (shared.length === 0 && typeof contract.methods.listTokens === "function") {
      const memberTokens = await contract.methods.listTokens(address).call();
      for (const tokenId of memberTokens) {
        const id = String(tokenId);
        if (!owned.includes(id)) shared.push(id);
      }
    }
  } catch (err) {
    console.error("Asset library fetch failed:", err);
  }

  return { owned, shared };
```

Note: `fetchAssetLibrary` currently receives `address` and `forceIndexer`. Ensure the function signature remains `async function fetchAssetLibrary(address, forceIndexer = false)`.

- [ ] **Step 4.3: Verify with frontend unit tests**

Run:

```bash
npm test -- test/frontend/asset-library.test.js test/library-context-menu-create.test.js test/library-toolbar.test.js --runInBand
```

Expected: tests pass. If they fail because the new `getSharedTokens` import is not mocked, update the test mocks to include it.

---

## Task 5: Add backend tests for shared indexing

**Files:**
- Create: `test/token-indexer-shared.test.js`

- [ ] **Step 5.1: Write the test file**

```js
/**
 * Shared token indexing tests.
 */
import { jest } from "@jest/globals";

const TEST_CHAIN = 999901;

let _getBlockNumber;
let _getPastLogs;
let _editorListURI;
let _cat;

async function loadModule() {
  _getBlockNumber = jest.fn().mockResolvedValue(0);
  _getPastLogs = jest.fn().mockResolvedValue([]);
  _editorListURI = jest.fn().mockResolvedValue("");
  _cat = jest.fn().mockResolvedValue("[]");

  const fakeContractMethods = {
    editorListURI: (tokenId) => ({ call: () => _editorListURI(tokenId) }),
  };

  const fakeWeb3 = {
    eth: {
      getBlockNumber: _getBlockNumber,
      getPastLogs: _getPastLogs,
      Contract: class {
        constructor() {
          this.methods = fakeContractMethods;
        }
      },
    },
    utils: { toBigInt: (x) => BigInt(x) },
  };

  await jest.unstable_mockModule("../src/config.js", () => ({
    getWeb3: jest.fn(() => fakeWeb3),
    getContractAddress: jest.fn(() => "0x0000000000000000000000000000000000000001"),
    NETWORK_CONFIGS: {},
  }));

  await jest.unstable_mockModule("../src/api/storage/index.js", () => ({
    getStorage: jest.fn(() => ({ cat: _cat })),
  }));

  return import("../src/api/token-indexer.js");
}

beforeEach(() => {
  jest.resetModules();
});

test("indexes editor-shared tokens from EditorSetChanged events", async () => {
  const { getIndexer } = await loadModule();
  const indexer = getIndexer(TEST_CHAIN);
  indexer._saveState = () => {};

  const owner = "0x0000000000000000000000000000000000000AAA".toLowerCase();
  const editor = "0x0000000000000000000000000000000000000BBB".toLowerCase();

  _getPastLogs.mockResolvedValue([
    {
      blockNumber: 10,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "0x000000000000000000000000" + owner.slice(2),
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
    {
      blockNumber: 10,
      topics: [
        "0xe04346630a2a402b40ab5f6918205fee5369cca36e2e6c2eebc4188b5f10c8c3",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
  ]);

  _editorListURI.mockResolvedValueOnce("bafyEditorList");
  _cat.mockResolvedValueOnce(JSON.stringify([{ address: editor, role: 2 }]));

  await indexer.catchUp();

  expect(indexer.getOwnedTokens(owner)).toEqual(["1"]);
  expect(indexer.getSharedTokens(editor)).toEqual(["1"]);
  expect(indexer.getSharedTokens(owner)).toEqual([]);
});

test("removes shared token when it is burned (transferred to zero)", async () => {
  const { getIndexer } = await loadModule();
  const indexer = getIndexer(TEST_CHAIN);
  indexer._saveState = () => {};

  const editor = "0x0000000000000000000000000000000000000BBB".toLowerCase();

  // Seed state as if token 1 was previously indexed with an editor.
  indexer.ownership.set("1", editor);
  indexer.tokenEditors.set("1", [editor]);
  indexer.editorTokens.set(editor, ["1"]);

  _getPastLogs.mockResolvedValue([
    {
      blockNumber: 20,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000" + editor.slice(2),
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
  ]);

  await indexer.catchUp();

  expect(indexer.ownership.get("1")).toBe("0x0000000000000000000000000000000000000000");
  expect(indexer.getSharedTokens(editor)).toEqual([]);
  expect(indexer.tokenEditors.has("1")).toBe(false);
});
```

- [ ] **Step 5.2: Run the new tests**

```bash
npm test -- test/token-indexer-shared.test.js --runInBand
```

Expected: 2 tests pass.

---

## Task 6: Add API route tests for `/indexer/shared`

**Files:**
- Create: `test/api/indexer-shared.test.js`

- [ ] **Step 6.1: Write the test file**

Model it on the existing `test/api.test.js` patterns. Use a mocked `token-indexer.js` module so the test does not need a running chain or IPFS.

```js
import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

async function buildApp() {
  const mockIndexer = {
    catchUp: jest.fn().mockResolvedValue(undefined),
    lastCatchUpAt: 0,
    lastScannedBlock: 100,
    getSharedTokens: jest.fn().mockReturnValue(["7", "42"]),
  };

  await jest.unstable_mockModule("../src/api/token-indexer.js", () => ({
    getIndexer: jest.fn(() => mockIndexer),
  }));

  const { default: indexerRoutes } = await import("../src/api/routes/indexer.js");

  const app = express();
  app.use("/indexer", indexerRoutes());
  return { app, mockIndexer };
}

beforeEach(() => {
  jest.resetModules();
});

test("GET /indexer/shared returns shared token IDs", async () => {
  const { app } = await buildApp();
  const res = await request(app)
    .get("/indexer/shared?address=0x0000000000000000000000000000000000000BBB&chainId=31415822&force=true")
    .set("Accept", "application/json");

  expect(res.status).toBe(200);
  expect(res.body.shared).toEqual(["7", "42"]);
  expect(res.body.address).toBe("0x0000000000000000000000000000000000000bbb");
  expect(res.body.chainId).toBe(31415822);
});

test("GET /indexer/shared rejects invalid address", async () => {
  const { app } = await buildApp();
  const res = await request(app)
    .get("/indexer/shared?address=not-an-address&chainId=31415822")
    .set("Accept", "application/json");

  expect(res.status).toBe(400);
});
```

- [ ] **Step 6.2: Run the new API route tests**

```bash
npm test -- test/api/indexer-shared.test.js --runInBand
```

Expected: 2 tests pass.

---

## Task 7: Update OpenAPI spec

**Files:**
- Modify: `src/api/openapi.json`

- [ ] **Step 7.1: Add the `/indexer/shared` path**

Add the following path object after `/indexer/owned` in `src/api/openapi.json`:

```json
    "/indexer/shared": {
      "get": {
        "summary": "List editor-shared tokens",
        "description": "Returns token IDs where the address has the Editor role but is not the current owner.",
        "tags": ["Indexer"],
        "parameters": [
          {
            "name": "address",
            "in": "query",
            "required": true,
            "schema": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" }
          },
          {
            "name": "chainId",
            "in": "query",
            "required": true,
            "schema": { "type": "integer" }
          },
          {
            "name": "force",
            "in": "query",
            "required": false,
            "schema": { "type": "boolean", "default": false }
          }
        ],
        "responses": {
          "200": {
            "description": "Shared token IDs",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "chainId": { "type": "integer" },
                    "address": { "type": "string" },
                    "shared": { "type": "array", "items": { "type": "string" } },
                    "lastScannedBlock": { "type": "integer" }
                  }
                }
              }
            }
          },
          "400": { "description": "Validation error" },
          "500": { "description": "Indexer failure" }
        }
      }
    }
```

- [ ] **Step 7.2: Validate the OpenAPI file is valid JSON**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('src/api/openapi.json','utf8')); console.log('openapi.json valid')"
```

Expected: prints `openapi.json valid`.

---

## Task 8: Update documentation

**Files:**
- Modify: `docs/API_SPEC.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CURRENT_STATUS.md`

- [ ] **Step 8.1: Update `docs/API_SPEC.md`**

Add a new section for `GET /api/v1/indexer/shared` immediately after the `/indexer/owned` section (around line 450). Use the same format as `/indexer/owned`:

```markdown
### `GET /api/v1/indexer/shared`

Returns token IDs for which the address is a Merkle editor but not the current owner.

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `address` | string (0x…) | yes | Wallet address |
| `chainId` | integer | yes | Chain ID |
| `force` | boolean | no | Force an immediate catch-up before responding |

**Response**

```json
{
  "chainId": 31415822,
  "address": "0x...",
  "shared": ["7", "42"],
  "lastScannedBlock": 12345
}
```
```

Also update the `/indexer/owned` description to clarify that it returns owned tokens only, and shared tokens are available via `/indexer/shared`.

- [ ] **Step 8.2: Update `docs/ARCHITECTURE.md`**

Find the section that says "Shared collections (where the wallet is a Merkle editor) are discovered alongside owned ones." Replace it with:

```markdown
Shared collections (where the wallet is a Merkle editor) are discovered via the token indexer. The indexer scans `EditorSetChanged` events, reads the on-chain `editorListURI`, fetches the editor list from IPFS, and builds a reverse index of editor address → token IDs. The frontend requests these via `GET /api/v1/indexer/shared`.
```

- [ ] **Step 8.3: Update `docs/CURRENT_STATUS.md`**

In the indexer/ownership section, replace the claim that shared collections are discovered alongside owned ones with:

```markdown
- Token indexer: owned tokens via `Transfer` events; shared/editor tokens via `EditorSetChanged` events and IPFS editor-list CIDs, exposed on `GET /api/v1/indexer/shared`.
```

Also update the test-count line if you added tests, and bump the generation date.

---

## Task 9: Final verification

- [ ] **Step 9.1: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 9.2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 9.3: Run the full Jest suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9.4: (Optional) Run the E2E critical path**

If infrastructure is up:

```bash
npx playwright test --config=e2e/playwright.config.js --project=chromium
```

Expected: studio critical path passes.

---

## Self-Review Checklist

- [ ] Backend indexer scans `EditorSetChanged` events and refreshes editor lists from IPFS.
- [ ] New `/indexer/shared` endpoint returns editor-but-not-owner tokens.
- [ ] Frontend asset library calls the new endpoint.
- [ ] Tests cover happy path, burn removal, and API validation.
- [ ] OpenAPI and docs updated.
