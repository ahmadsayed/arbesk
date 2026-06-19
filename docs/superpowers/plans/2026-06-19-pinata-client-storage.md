# Pinata Client-Side Storage Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all IPFS storage onto Pinata — browser uploads via short-lived presigned URLs, backend uploads via the master JWT — while keeping the local Kubo node available for the automated E2E suite.

**Architecture:** A backend storage abstraction (`src/api/storage/`) exposes one interface (`add`, `cat`, `unpin`, `mintUploadCredential`, `gatewayBase`) with two adapters (Kubo, Pinata) selected by the `IPFS_BACKEND` env var. A new session-gated, rate-limited route `POST /api/v1/ipfs/upload-url` mints either a Pinata presigned URL or the Kubo API URL. The browser write path branches on the returned `backend`. Reads use the gateway reported by `/config`.

**Tech Stack:** Node 20 ESM, Express, Jest (`--experimental-vm-modules`) + jsdom, Playwright, Pinata v3 SDK (`pinata` npm), `ipfs-http-client` (Kubo only).

## Global Constraints

- ES modules (`import`/`export`) in root + frontend; CommonJS only in `blockchain/scripts/`.
- Frontend has **no bundler** — frontend JS may NOT `import` the `pinata` npm package. The browser write path uses `fetch` against the presigned URL directly. The `pinata` SDK is a **backend-only** dependency.
- Backend logs use `[TAG]` prefixes — reuse `[IPFS]`, `[UNPIN]`; add `[STORAGE]` for adapter selection.
- Secrets (`PINATA_JWT`) are server-side only and never returned to the browser. Gitignore all `.env*`.
- CIDs are **CIDv1 (`baf…`)** in Pinata mode (e.g. `bafy…` for dag-pb, `bafkrei…` for raw JSON) — no `cidVersion: 0` override. Backward compatibility with existing `Qm…` CIDs is explicitly not a goal.
- Rate limit on uploads: **max 5 per 60_000 ms**, keyed on the SIWE wallet (`res.locals.userAddress`).
- Test commands:
  - Backend/API: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest <path> --runInBand`
  - Frontend unit: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/<file>`
  - E2E: `npx playwright test --config=e2e/playwright.config.js --project=chromium`

---

## File Structure

**Create:**
- `src/api/storage/index.js` — `getStorage()` factory + `_resetStorage()`; dispatches on `IPFS_BACKEND`.
- `src/api/storage/kubo-adapter.js` — `createKuboAdapter(ipfs, { apiUrl, gatewayBase })`.
- `src/api/storage/pinata-adapter.js` — `createPinataAdapter(pinata, { gatewayBase, uploadTtl })`.
- `test/api/storage-adapters.test.js` — adapter unit tests with injected fakes.
- `e2e/specs/07-pinata-storage.spec.js` — real-Pinata E2E (opt-in).

**Modify:**
- `src/api/rate-limiter.js` — prefer `res.locals.userAddress` whenever set.
- `src/api/index.js` — new `/ipfs/upload-url` route; `/ipfs/unpin` via storage; thumbnail/manifest writes via storage; `/config` exposes `ipfsBackend` + gateway.
- `src/api/assets/generate-node.js` — source-asset + manifest reads/writes via storage.
- `frontend/src/js/services/api.js` — add `getUploadCredential()`.
- `frontend/src/js/ipfs/write-to-ipfs.js` — branch pinata/kubo.
- `frontend/src/js/ipfs/remote-ipfs.js` — gateway from `/config`.
- `frontend/src/js/blockchain/uri-utils.js` — CIDv1 (verify; fix only if test fails).
- `test/api.test.js` — rate-limit + upload-url + unpin branching tests.
- `test/token-resolver.test.js` — CIDv1 normalization regression.
- `e2e/playwright.config.js` — add `pinata` project / `@pinata` grep isolation.
- `docs/CURRENT_STATUS.md` — §6.5 config docs.
- `package.json` — add `pinata` dependency.

---

## Task 1: Add `pinata` dependency and the two storage adapters

**Files:**
- Modify: `package.json` (add `pinata`)
- Create: `src/api/storage/kubo-adapter.js`
- Create: `src/api/storage/pinata-adapter.js`
- Create: `src/api/storage/index.js`
- Test: `test/api/storage-adapters.test.js`

**Interfaces:**
- Produces: `createKuboAdapter(ipfs, { apiUrl, gatewayBase }) -> adapter`, `createPinataAdapter(pinata, { gatewayBase, uploadTtl }) -> adapter`, `getStorage() -> adapter`, `_resetStorage()`.
- Adapter shape (both): `{ backend: "kubo"|"pinata", add(payload)->Promise<cidString>, cat(cid)->Promise<string>, unpin(cid)->Promise<boolean>, mintUploadCredential()->Promise<object>, gatewayBase()->string }`.
  - `add` uploads **and pins**, returns the CID string.
  - `cat` returns the content as a UTF-8 string (used for manifest JSON).
  - `unpin` returns `true` when the CID is no longer pinned (including "was never pinned").
  - `mintUploadCredential` (kubo) → `{ backend:"kubo", apiUrl }`; (pinata) → `{ backend:"pinata", url, gateway }`.

- [ ] **Step 1: Add the dependency**

Run: `npm install pinata`
Expected: `package.json` `dependencies` gains `"pinata": "^<version>"`, `package-lock.json` updated.

- [ ] **Step 2: Write the failing adapter tests**

Create `test/api/storage-adapters.test.js`:

```javascript
import { jest } from "@jest/globals";
import { createKuboAdapter } from "../../src/api/storage/kubo-adapter.js";
import { createPinataAdapter } from "../../src/api/storage/pinata-adapter.js";

describe("kubo adapter", () => {
  function fakeIpfs() {
    return {
      add: jest.fn(async () => ({ cid: { toString: () => "QmFakeCid" } })),
      pin: {
        add: jest.fn(async () => {}),
        rm: jest.fn(async () => {}),
      },
      cat: jest.fn(async function* () {
        yield new TextEncoder().encode('{"hello":"world"}');
      }),
    };
  }

  it("add() stores, pins, and returns the cid string", async () => {
    const ipfs = fakeIpfs();
    const a = createKuboAdapter(ipfs, {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    const cid = await a.add("payload");
    expect(cid).toBe("QmFakeCid");
    expect(ipfs.pin.add).toHaveBeenCalledWith("QmFakeCid");
  });

  it("cat() concatenates the async-iterable chunks into a string", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.cat("QmX")).toBe('{"hello":"world"}');
  });

  it("unpin() treats 'not pinned' as success", async () => {
    const ipfs = fakeIpfs();
    ipfs.pin.rm = jest.fn(async () => {
      throw new Error("not pinned or pinned indirectly");
    });
    const a = createKuboAdapter(ipfs, {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.unpin("QmX")).toBe(true);
  });

  it("mintUploadCredential() returns the kubo shape", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.mintUploadCredential()).toEqual({
      backend: "kubo",
      apiUrl: "http://127.0.0.1:5001",
    });
  });
});

describe("pinata adapter", () => {
  function fakePinata() {
    return {
      upload: {
        public: {
          file: jest.fn(async () => ({ id: "id-1", cid: "bafyFakeCid" })),
          createSignedURL: jest.fn(async () => "https://uploads.pinata.cloud/signed"),
        },
      },
      files: {
        public: {
          list: jest.fn(() => ({
            cid: async (_c) => ({ files: [{ id: "id-1", cid: "bafyFakeCid" }] }),
          })),
          delete: jest.fn(async () => [{ id: "id-1", status: "OK" }]),
        },
      },
      gateways: { public: {} },
    };
  }

  it("add() uploads to public IPFS and returns the cid", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.add("payload")).toBe("bafyFakeCid");
    expect(p.upload.public.file).toHaveBeenCalled();
  });

  it("mintUploadCredential() returns a presigned url and gateway, never the JWT", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 90,
    });
    const cred = await a.mintUploadCredential();
    expect(cred).toEqual({
      backend: "pinata",
      url: "https://uploads.pinata.cloud/signed",
      gateway: "https://gw.mypinata.cloud/ipfs/",
    });
    expect(p.upload.public.createSignedURL).toHaveBeenCalledWith({ expires: 90 });
    expect(JSON.stringify(cred)).not.toMatch(/jwt|JWT|Bearer/);
  });

  it("unpin() resolves cid -> file id(s) and deletes them", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.unpin("bafyFakeCid")).toBe(true);
    expect(p.files.public.delete).toHaveBeenCalledWith(["id-1"]);
  });

  it("unpin() returns true when no file matches the cid", async () => {
    const p = fakePinata();
    p.files.public.list = jest.fn(() => ({ cid: async () => ({ files: [] }) }));
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.unpin("bafyMissing")).toBe(true);
    expect(p.files.public.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/storage-adapters.test.js --runInBand`
Expected: FAIL — `Cannot find module '../../src/api/storage/kubo-adapter.js'`.

- [ ] **Step 4: Implement the Kubo adapter**

Create `src/api/storage/kubo-adapter.js`:

```javascript
/**
 * Kubo storage adapter — wraps the local ipfs-http-client.
 * Used only by the automated E2E suite (IPFS_BACKEND=kubo).
 */
export function createKuboAdapter(ipfs, { apiUrl, gatewayBase }) {
  return {
    backend: "kubo",

    async add(payload) {
      const { cid } = await ipfs.add(payload);
      const cidStr = cid.toString();
      try {
        await ipfs.pin.add(cidStr);
        console.log(`[IPFS] pinned → ${cidStr}`);
      } catch (e) {
        console.warn(`[IPFS] pin failed (non-fatal): ${e.message}`);
      }
      return cidStr;
    },

    async cat(cid) {
      let data = "";
      const decoder = new TextDecoder();
      for await (const chunk of ipfs.cat(cid)) {
        data += decoder.decode(chunk, { stream: true });
      }
      data += decoder.decode();
      return data;
    },

    async unpin(cid) {
      try {
        await ipfs.pin.rm(cid);
        return true;
      } catch (e) {
        if (e.message?.includes("not pinned")) return true;
        throw e;
      }
    },

    async mintUploadCredential() {
      return { backend: "kubo", apiUrl };
    },

    gatewayBase() {
      return gatewayBase;
    },
  };
}
```

- [ ] **Step 5: Implement the Pinata adapter**

Create `src/api/storage/pinata-adapter.js`:

```javascript
/**
 * Pinata storage adapter — Pinata v3 public IPFS.
 * `add` uses the master JWT (backend writes); `mintUploadCredential`
 * returns a short-lived presigned URL for browser uploads (JWT never leaves
 * the server). Public IPFS so CIDs resolve through a normal gateway and can be
 * embedded in on-chain tokenURIs.
 */
export function createPinataAdapter(pinata, { gatewayBase, uploadTtl }) {
  return {
    backend: "pinata",

    async add(payload) {
      const file = new File([payload], "upload.bin");
      const { cid } = await pinata.upload.public.file(file);
      console.log(`[IPFS] pinata add → ${cid}`);
      return cid;
    },

    async cat(cid) {
      const res = await fetch(`${gatewayBase}${cid}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`pinata gateway ${res.status} for ${cid}`);
      return await res.text();
    },

    async unpin(cid) {
      const { files } = await pinata.files.public.list().cid(cid);
      if (!files || files.length === 0) return true;
      await pinata.files.public.delete(files.map((f) => f.id));
      return true;
    },

    async mintUploadCredential() {
      const url = await pinata.upload.public.createSignedURL({ expires: uploadTtl });
      return { backend: "pinata", url, gateway: gatewayBase };
    },

    gatewayBase() {
      return gatewayBase;
    },
  };
}
```

- [ ] **Step 6: Implement the factory**

Create `src/api/storage/index.js`:

```javascript
import { create } from "ipfs-http-client";
import { PinataSDK } from "pinata";
import { createKuboAdapter } from "./kubo-adapter.js";
import { createPinataAdapter } from "./pinata-adapter.js";

let _storage = null;

/**
 * Returns the process-wide storage adapter, selected by IPFS_BACKEND.
 * Defaults to "kubo" so the E2E suite and local Docker stack keep working.
 */
export function getStorage() {
  if (_storage) return _storage;

  const backend = process.env.IPFS_BACKEND || "kubo";
  if (backend === "pinata") {
    const gateway = process.env.PINATA_GATEWAY;
    const pinata = new PinataSDK({
      pinataJwt: process.env.PINATA_JWT,
      pinataGateway: gateway,
    });
    _storage = createPinataAdapter(pinata, {
      gatewayBase: `https://${gateway}/ipfs/`,
      uploadTtl: Number(process.env.PINATA_UPLOAD_TTL || 60),
    });
    console.log(`[STORAGE] backend=pinata gateway=${gateway}`);
  } else {
    const apiUrl = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
    const gatewayBase =
      process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080/ipfs/";
    _storage = createKuboAdapter(create(new URL(apiUrl)), { apiUrl, gatewayBase });
    console.log(`[STORAGE] backend=kubo api=${apiUrl}`);
  }
  return _storage;
}

/** Test helper — clears the cached adapter so IPFS_BACKEND can be re-read. */
export function _resetStorage() {
  _storage = null;
}
```

- [ ] **Step 7: Run the adapter tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/storage-adapters.test.js --runInBand`
Expected: PASS (9 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/api/storage test/api/storage-adapters.test.js
git commit -m "feat(storage): add Pinata/Kubo storage adapters and factory (#27)"
```

---

## Task 2: Generalize the rate limiter to prefer the session wallet

**Files:**
- Modify: `src/api/rate-limiter.js:8-14`
- Test: `test/api/rate-limiter.test.js` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `rateLimit({ max, windowMs })` middleware that keys on `res.locals.userAddress` when present, else `req.ip`.

- [ ] **Step 1: Write the failing test**

Create `test/api/rate-limiter.test.js`:

```javascript
import { jest } from "@jest/globals";
import rateLimit, { _resetRateLimiter } from "../../src/api/rate-limiter.js";

function run(mw, { userAddress, ip }) {
  const req = { body: {}, ip };
  const res = {
    locals: userAddress ? { userAddress } : {},
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

describe("rate limiter keying", () => {
  beforeEach(() => _resetRateLimiter());

  it("keys on res.locals.userAddress even without txHash", () => {
    const mw = rateLimit({ max: 2, windowMs: 60000 });
    expect(run(mw, { userAddress: "0xWallet", ip: "1.1.1.1" }).nextCalled).toBe(true);
    expect(run(mw, { userAddress: "0xWallet", ip: "2.2.2.2" }).nextCalled).toBe(true);
    const third = run(mw, { userAddress: "0xWallet", ip: "3.3.3.3" });
    expect(third.nextCalled).toBe(false);
    expect(third.res.statusCode).toBe(429);
  });

  it("falls back to req.ip when no session address", () => {
    const mw = rateLimit({ max: 1, windowMs: 60000 });
    expect(run(mw, { ip: "9.9.9.9" }).nextCalled).toBe(true);
    expect(run(mw, { ip: "9.9.9.9" }).nextCalled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/rate-limiter.test.js --runInBand`
Expected: FAIL — the first test's third call still calls `next()` (current code keys on `req.ip` because there is no `txHash`).

- [ ] **Step 3: Update the key selection**

In `src/api/rate-limiter.js`, replace the `wallet` assignment (lines 10-12):

```javascript
  return (req, res, next) => {
    // Prefer the authenticated wallet (set by the authenticate middleware,
    // which runs before this limiter). Fall back to IP for unauthenticated routes.
    const wallet = res.locals.userAddress || req.ip;
```

- [ ] **Step 4: Run rate-limiter + existing API tests**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/rate-limiter.test.js test/api.test.js --runInBand`
Expected: rate-limiter tests PASS; `test/api.test.js` shows the same 4 pre-existing env failures (ABI/tokenURI), no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/api/rate-limiter.js test/api/rate-limiter.test.js
git commit -m "feat(api): rate-limit by session wallet, not just txHash routes (#27)"
```

---

## Task 3: Add `POST /api/v1/ipfs/upload-url` (session-gated, rate-limited)

**Files:**
- Modify: `src/api/index.js` — import storage + `authenticate` + `rateLimit`; add route near `/ipfs/unpin`.
- Modify: `test/api.test.js` — new describe block.

**Interfaces:**
- Consumes: `getStorage()` (Task 1), `authenticate` (`src/api/authentication.js`, default export), `rateLimit` (Task 2).
- Produces: `POST /api/v1/ipfs/upload-url` → `200 { backend, url?, gateway?, apiUrl? }`; `401` without session; `429` after >5 calls / 60s per wallet.

- [ ] **Step 1: Write the failing tests**

Add to `test/api.test.js` (new top-level `describe`, after the Rate Limiting block):

```javascript
  describe("POST /api/v1/ipfs/upload-url", () => {
    beforeEach(() => _resetRateLimiter());

    it("rejects without a session (401)", async () => {
      const res = await request(app).post("/api/v1/ipfs/upload-url").send({});
      expect(res.status).toBe(401);
    });

    it("returns a credential for an authed session", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/upload-url")
        .set("Authorization", await makeSessionHeader())
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("backend");
      // Kubo mode in tests (no IPFS_BACKEND set):
      expect(res.body.backend).toBe("kubo");
      expect(res.body).toHaveProperty("apiUrl");
      // master secret must never appear
      expect(JSON.stringify(res.body)).not.toMatch(/PINATA_JWT|Bearer/i);
    });

    it("rate-limits to 5 per minute per wallet (6th = 429), no upload performed", async () => {
      const auth = await makeSessionHeader("0xRateWallet000000000000000000000000000001");
      let last = 200;
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post("/api/v1/ipfs/upload-url")
          .set("Authorization", auth)
          .send({});
        last = res.status;
      }
      expect(last).toBe(429);
    });
  });
```

Ensure `_resetRateLimiter` is imported at the top of `test/api.test.js` (it already is, line 3).

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "upload-url" --runInBand`
Expected: FAIL — route returns 404 (not yet defined).

- [ ] **Step 3: Wire imports in `src/api/index.js`**

After the existing `import rateLimit, { _resetRateLimiter } from "./rate-limiter.js";` line, add:

```javascript
import authenticate from "./authentication.js";
import { getStorage } from "./storage/index.js";
```

- [ ] **Step 4: Add the route**

In `src/api/index.js`, immediately before the `// ─── IPFS Unpin ───` comment, add:

```javascript
  // ─── IPFS Upload Credential ────────────────────────────────────────────────

  /**
   * POST /api/v1/ipfs/upload-url
   * Mint a short-lived client upload credential. Session-gated and rate-limited
   * per wallet. In Pinata mode returns a presigned URL; in Kubo mode returns the
   * local API URL. The master Pinata JWT never reaches the client.
   */
  v1.post(
    "/ipfs/upload-url",
    authenticate,
    rateLimit({ max: 5, windowMs: 60 * 1000 }),
    async (req, res) => {
      try {
        const credential = await getStorage().mintUploadCredential();
        console.log(
          `[IPFS] minted upload credential — backend=${credential.backend} wallet=${res.locals.userAddress}`,
        );
        res.json(credential);
      } catch (error) {
        console.error("[IPFS] upload-url error:", error.message);
        sendError(res, 500, "UPLOAD_URL_FAILED", error.message);
      }
    },
  );
```

- [ ] **Step 5: Run the upload-url tests**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "upload-url" --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/api/index.js test/api.test.js
git commit -m "feat(api): add session-gated, wallet-rate-limited /ipfs/upload-url (#27)"
```

---

## Task 4: Route `/ipfs/unpin` through the storage abstraction

**Files:**
- Modify: `src/api/index.js` — `/ipfs/unpin` body (the `catManifest(ipfs, …)` and `ipfs.pin.rm(cid)` calls).
- Test: `test/api.test.js` — unpin still works through a mocked storage.

**Interfaces:**
- Consumes: `getStorage().cat(cid)`, `getStorage().unpin(cid)` (Task 1).
- Produces: `/ipfs/unpin` unchanged response shape `{ unpinned, count, errors? }`.

- [ ] **Step 1: Write the failing test**

Add to `test/api.test.js` inside (or after) the unpin coverage:

```javascript
  describe("POST /api/v1/ipfs/unpin via storage", () => {
    it("walks the chain and reports unpinned CIDs", async () => {
      // Single-manifest chain with one source CID, no prev link.
      const manifest = {
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "n", source: { cid: "QmSource" } }] },
      };
      // Store the manifest so cat() can read it back in kubo test mode.
      const addRes = await request(app)
        .post("/api/v1/manifests")
        .set("Authorization", await makeSessionHeader())
        .send(manifest);
      const startCid = addRes.body.cid || addRes.body.manifestCid;

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .send({ cid: startCid });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.unpinned)).toBe(true);
      expect(res.body.unpinned).toContain(startCid);
    });
  });
```

> Note: this exercises the real kubo path against the local IPFS node used by the Jest run. If the API test environment has no live IPFS, keep this test but guard it the same way existing IPFS-dependent tests are guarded in `test/api.test.js` (follow the established pattern in that file — e.g. skip when `catManifest` throws). Match whatever the neighbouring manifest tests already do.

- [ ] **Step 2: Run to verify current behavior**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "unpin via storage" --runInBand`
Expected: behaves per current direct-`ipfs` implementation (PASS if IPFS reachable). This test pins the contract before the refactor.

- [ ] **Step 3: Refactor the route to use storage**

In `src/api/index.js` `/ipfs/unpin` handler:

1. Replace `const raw = await catManifest(ipfs, currentCid);` with:
   ```javascript
   const raw = await getStorage().cat(currentCid);
   ```
2. Replace the unpin loop body that calls `ipfs.pin.rm(cid)` + the "not pinned" branch with:
   ```javascript
      for (const cid of toUnpin) {
        try {
          await getStorage().unpin(cid);
          unpinned.push(cid);
          console.log(`[UNPIN] unpinned → ${cid}`);
        } catch (e) {
          console.warn(`[UNPIN] failed to unpin ${cid}: ${e.message}`);
          errors.push(`unpin ${cid}: ${e.message}`);
        }
      }
   ```
   (The "already unpinned" case is now handled inside `adapter.unpin`, which returns `true`.)

- [ ] **Step 4: Run the unpin test**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "unpin" --runInBand`
Expected: PASS (same behavior, now via storage).

- [ ] **Step 5: Commit**

```bash
git add src/api/index.js test/api.test.js
git commit -m "refactor(api): route /ipfs/unpin through storage adapter (#27)"
```

---

## Task 5: Route backend writes/reads through storage

**Files:**
- Modify: `src/api/index.js` — `addAndPin(ipfs, …)` helper call sites (thumbnail ~line 116, manifest ~line 69) → storage.
- Modify: `src/api/assets/generate-node.js` — `generateAssetNode(ipfs)` → `generateAssetNode(storage)`; source-asset + manifest `ipfs.add`/`pin.add` and `catManifest(ipfs, …)` → storage.
- Modify: `src/api/index.js` — change `generateAssetNode(ipfs)` mount (line ~187) to `generateAssetNode(getStorage())`.
- Test: `test/api.test.js` — existing generation tests must still pass.

**Interfaces:**
- Consumes: `getStorage()` adapter with `add`, `cat`.
- Produces: generation response unchanged (`{ assetManifestCid, sourceAssetCid, tier? }`).

- [ ] **Step 1: Confirm the generation tests are the safety net**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "generat" --runInBand`
Expected: the existing generation tests PASS (these guard the refactor).

- [ ] **Step 2: Refactor `generate-node.js` to accept a storage adapter**

In `src/api/assets/generate-node.js`:
- Change the signature `export default function generateAssetNode(ipfs) {` → `export default function generateAssetNode(storage) {`.
- Replace the source-asset block (lines ~207-217):
  ```javascript
        const sourceAssetCid = await storage.add(assetPayload);
        console.log(`[IPFS] add source asset → ${sourceAssetCid}`);
  ```
- Replace the previous-manifest read (lines ~225): `const data = await catManifest(ipfs, prevAssetManifestCid);` →
  ```javascript
            const data = await storage.cat(prevAssetManifestCid);
  ```
- Replace the manifest write (lines ~294-306):
  ```javascript
        const assetManifestCid = await storage.add(JSON.stringify(manifest));
        console.log(`[IPFS] add asset manifest → ${assetManifestCid}`);
  ```
- Remove the now-unused `import { catManifest } from "../ipfs-utils.js";` if nothing else uses it in that file.

- [ ] **Step 3: Refactor `index.js` thumbnail/manifest writes**

In `src/api/index.js`:
- Update the mount: `v1.use("/generations", generateAssetNode(getStorage()));`
- Replace the `addAndPin(ipfs, payload)` call sites for the manifest save (`/manifests`) and thumbnail (`/manifests/:cid/publish`) with `await getStorage().add(payload)`. Remove the local `addAndPin` helper if no callers remain.
- Replace any remaining `catManifest(ipfs, …)` reads in the manifest history/token routes with `getStorage().cat(…)` **only if** they currently use the `ipfs` client; leave `catManifest` import if still referenced.

- [ ] **Step 4: Run the full API suite**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand`
Expected: same 4 pre-existing env failures only (ABI/tokenURI); all generation/manifest/unpin/upload-url tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/index.js src/api/assets/generate-node.js
git commit -m "refactor(api): route backend writes/reads through storage adapter (#27)"
```

---

## Task 6: Expose backend + gateway via `/config`

**Files:**
- Modify: `src/api/index.js` — `/config` route (lines ~169-181).
- Test: `test/api.test.js` — `/config` includes `ipfsBackend` + gateway.

**Interfaces:**
- Consumes: `getStorage().backend`, `getStorage().gatewayBase()`.
- Produces: `/config` JSON gains `ipfsBackend` and an authoritative `ipfsGatewayUrl`.

- [ ] **Step 1: Write the failing test**

Add to `test/api.test.js`:

```javascript
  describe("GET /api/v1/config storage fields", () => {
    it("reports the ipfs backend and gateway", async () => {
      const res = await request(app).get("/api/v1/config");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("ipfsBackend");
      expect(res.body).toHaveProperty("ipfsGatewayUrl");
      expect(res.body.ipfsGatewayUrl).toMatch(/\/ipfs\/$/);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "config storage" --runInBand`
Expected: FAIL — `ipfsBackend` missing.

- [ ] **Step 3: Update the `/config` route**

Replace the `ipfsGatewayUrl` line and add `ipfsBackend`:

```javascript
  v1.get("/config", (req, res) => {
    const storage = getStorage();
    res.json({
      contractAddress: CONTRACT_ADDRESS,
      networkConfigs: NETWORK_CONFIGS,
      ipfsBackend: storage.backend,
      ipfsGatewayUrl: storage.gatewayBase(),
      hardhatRpcUrl: HARDHAT_RPC_URL,
      mockGeneration: process.env.MOCK_3D_GENERATION === "true",
      walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || null,
    });
  });
```

- [ ] **Step 4: Run the config test**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "config" --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/index.js test/api.test.js
git commit -m "feat(api): expose ipfsBackend + gateway via /config (#27)"
```

---

## Task 7: Frontend — `getUploadCredential()` service

**Files:**
- Modify: `frontend/src/js/services/api.js` — add `getUploadCredential()`.
- Test: `test/frontend/upload-credential.test.js` (create).

**Interfaces:**
- Consumes: existing session helper in `services/api.js` (`getOrCreateSession()` and the `Authorization: Session <token>` convention — reuse exactly how `generateAsset` builds its headers).
- Produces: `getUploadCredential() -> Promise<{ backend, url?, gateway?, apiUrl? }>`.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/upload-credential.test.js`:

```javascript
/** @jest-environment jsdom */
import { jest } from "@jest/globals";

describe("getUploadCredential", () => {
  afterEach(() => jest.resetModules());

  it("POSTs to /api/v1/ipfs/upload-url with the session header and returns the credential", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ backend: "pinata", url: "https://signed", gateway: "https://gw/ipfs/" }),
    }));
    global.fetch = fetchMock;

    const api = await import("../../frontend/src/js/services/api.js");
    // Make a session resolvable; reuse whatever the module exposes.
    // If getOrCreateSession reads from a token store, stub it:
    jest.spyOn(api, "getOrCreateSession").mockResolvedValue("test-token");

    const cred = await api.getUploadCredential();
    expect(cred.backend).toBe("pinata");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/ipfs\/upload-url$/);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toMatch(/^Session /);
  });
});
```

> If `getOrCreateSession` is not an exported, spy-able binding, adapt the stub to the module's actual session mechanism (e.g. seed `localStorage`/token store the way `test/frontend/wallet-exports.test.js` or the session tests do). Match the existing pattern in the repo rather than inventing one.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/upload-credential.test.js`
Expected: FAIL — `getUploadCredential is not a function`.

- [ ] **Step 3: Implement `getUploadCredential`**

In `frontend/src/js/services/api.js`, add (mirroring how `generateAsset` attaches the session header):

```javascript
/**
 * POST /api/v1/ipfs/upload-url
 * Mint a short-lived client upload credential (Pinata presigned URL or Kubo API URL).
 * @returns {Promise<{backend:string, url?:string, gateway?:string, apiUrl?:string}>}
 */
export async function getUploadCredential() {
  const token = await getOrCreateSession();
  const res = await fetch(`${API_BASE}/ipfs/upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Session ${token}`,
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`upload-url failed: HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 4: Run the test**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/upload-credential.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/api.js test/frontend/upload-credential.test.js
git commit -m "feat(frontend): add getUploadCredential() service (#27)"
```

---

## Task 8: Frontend — Pinata-aware write path

**Files:**
- Modify: `frontend/src/js/ipfs/write-to-ipfs.js`.
- Test: `test/frontend/write-to-ipfs.test.js` (create).

**Interfaces:**
- Consumes: `getUploadCredential()` (Task 7).
- Produces: `writeToIPFS(data, filename?) -> Promise<cidString>`, `writeJSONToIPFS(json) -> Promise<cidString>` (signatures unchanged; callers in `glb-parser.js`, `decomposer.js`, `material-editor.js`, `source-color-editor.js` are unaffected).

- [ ] **Step 1: Write the failing tests**

Create `test/frontend/write-to-ipfs.test.js`:

```javascript
/** @jest-environment jsdom */
import { jest } from "@jest/globals";

async function loadModule(credential, uploadResponse) {
  jest.resetModules();
  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    getUploadCredential: jest.fn(async () => credential),
  }));
  const fetchMock = jest.fn(async () => uploadResponse);
  global.fetch = fetchMock;
  const mod = await import("../../frontend/src/js/ipfs/write-to-ipfs.js");
  return { mod, fetchMock };
}

describe("writeToIPFS — pinata mode", () => {
  it("POSTs the file to the presigned URL and returns the CIDv1", async () => {
    const { mod, fetchMock } = await loadModule(
      { backend: "pinata", url: "https://uploads.pinata.cloud/signed", gateway: "https://gw/ipfs/" },
      { ok: true, json: async () => ({ data: { cid: "bafyNew", id: "id-1" } }) },
    );
    const cid = await mod.writeToIPFS("hello", "asset.bin");
    expect(cid).toBe("bafyNew");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://uploads.pinata.cloud/signed");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
  });
});

describe("writeToIPFS — kubo mode", () => {
  it("POSTs multipart to the kubo /api/v0/add endpoint and returns the hash", async () => {
    const { mod, fetchMock } = await loadModule(
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" },
      { ok: true, json: async () => ({ Hash: "QmKubo", Size: "5" }) },
    );
    // second fetch (pin) also resolves ok
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ Hash: "QmKubo", Size: "5" }) });
    const cid = await mod.writeToIPFS("hello", "asset.bin");
    expect(cid).toBe("QmKubo");
    expect(fetchMock.mock.calls[0][0]).toMatch(/127\.0\.0\.1:5001\/api\/v0\/add/);
  });
});
```

> Verify the Pinata presigned-upload field names against a real signed URL during Task 11 (the E2E spec). Pinata v3 expects `multipart/form-data` with a `file` field and `network: "public"`; the response is `{ data: { cid, id, ... } }`. If the real response differs, fix `writeToIPFS` and this test together — the E2E spec is the source of truth for the live format.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/write-to-ipfs.test.js`
Expected: FAIL — current module always POSTs to Kubo and ignores credentials.

- [ ] **Step 3: Rewrite `write-to-ipfs.js`**

```javascript
/**
 * Arbesk Browser-Side IPFS Writer
 *
 * Fetches a short-lived upload credential from the backend, then uploads
 * directly to the chosen storage backend:
 *   - pinata: POST the file to a presigned URL (CIDv1 returned)
 *   - kubo:   POST multipart to the local Kubo node (E2E/dev fallback)
 */
import { getUploadCredential } from "../services/api.js";

function toBlob(data) {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) return new Blob([data]);
  if (typeof data === "string") return new Blob([data], { type: "application/octet-stream" });
  throw new Error("writeToIPFS: unsupported data type");
}

async function uploadToPinata(blob, filename, credential) {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("network", "public");
  const res = await fetch(credential.url, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinata upload failed: ${res.status} — ${text}`);
  }
  const json = await res.json();
  const cid = json?.data?.cid || json?.cid;
  if (!cid) throw new Error("Pinata upload returned no CID");
  console.log(`[IPFS-WRITE] pinata stored → ${cid}`);
  return cid;
}

async function uploadToKubo(blob, filename, credential) {
  const apiUrl = credential.apiUrl || "http://127.0.0.1:5001";
  const form = new FormData();
  form.append("file", blob, filename);
  const res = await fetch(`${apiUrl}/api/v0/add`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`IPFS add failed: ${res.status} — ${text}`);
  }
  const result = await res.json();
  console.log(`[IPFS-WRITE] kubo stored → ${result.Hash} (${result.Size} bytes)`);
  try {
    await fetch(`${apiUrl}/api/v0/pin/add?arg=${encodeURIComponent(result.Hash)}`, { method: "POST" });
  } catch (e) {
    console.warn(`[IPFS-WRITE] pin failed (non-fatal): ${e.message}`);
  }
  return result.Hash;
}

/**
 * Write raw binary/string data to IPFS and return its CID.
 * @param {Uint8Array|ArrayBuffer|Blob|string} data
 * @param {string} [filename="asset.bin"]
 * @returns {Promise<string>}
 */
export async function writeToIPFS(data, filename = "asset.bin") {
  const blob = toBlob(data);
  const credential = await getUploadCredential();
  console.log(`[IPFS-WRITE] uploading ${blob.size} bytes via ${credential.backend}`);
  return credential.backend === "pinata"
    ? uploadToPinata(blob, filename, credential)
    : uploadToKubo(blob, filename, credential);
}

/**
 * Write JSON to IPFS and return its CID.
 * @param {object} json
 * @returns {Promise<string>}
 */
export async function writeJSONToIPFS(json) {
  return writeToIPFS(JSON.stringify(json, null, 2), "composite.gltf");
}
```

- [ ] **Step 4: Run the write-path tests**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/write-to-ipfs.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the glTF tests that use `writeToIPFS`**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/glb-parser.test.js test/decomposer-composer.test.js`
Expected: PASS (these inject their own `writer` or mock; confirm no regressions).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ipfs/write-to-ipfs.js test/frontend/write-to-ipfs.test.js
git commit -m "feat(frontend): branch IPFS write path on upload credential backend (#27)"
```

---

## Task 9: Frontend — gateway from `/config`

**Files:**
- Modify: `frontend/src/js/ipfs/remote-ipfs.js`.
- Test: `test/frontend/remote-ipfs-gateway.test.js` (create).

**Interfaces:**
- Consumes: `getConfig()` from `services/api.js` (returns `{ ipfsGatewayUrl, ... }`).
- Produces: all reads use the gateway from `/config`, cached after first fetch; falls back to `http://127.0.0.1:8080/ipfs/` if `/config` fails.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/remote-ipfs-gateway.test.js`:

```javascript
/** @jest-environment jsdom */
import { jest } from "@jest/globals";

async function load(gateway) {
  jest.resetModules();
  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    getConfig: jest.fn(async () => ({ ipfsGatewayUrl: gateway })),
  }));
  const fetchMock = jest.fn(async () => ({
    ok: true,
    text: async () => '{"version":1}',
    json: async () => ({ version: 1 }),
  }));
  global.fetch = fetchMock;
  const mod = await import("../../frontend/src/js/ipfs/remote-ipfs.js");
  return { mod, fetchMock };
}

it("reads CIDs from the gateway reported by /config", async () => {
  const { mod, fetchMock } = await load("https://gw.mypinata.cloud/ipfs/");
  await mod.getFromRemoteIPFS("bafyManifest");
  const calledUrl = fetchMock.mock.calls.find((c) => String(c[0]).includes("bafyManifest"))[0];
  expect(calledUrl).toBe("https://gw.mypinata.cloud/ipfs/bafyManifest");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/remote-ipfs-gateway.test.js`
Expected: FAIL — module uses the hard-coded `GATEWAY_URL` constant, not `/config`.

- [ ] **Step 3: Make the gateway dynamic**

In `frontend/src/js/ipfs/remote-ipfs.js`:
- Add at top: `import { getConfig } from "../services/api.js";`
- Replace the `GATEWAY_URL` constant with a cached async resolver:

```javascript
const FALLBACK_GATEWAY = "http://127.0.0.1:8080/ipfs/";
let _gatewayPromise = null;

async function gatewayBase() {
  if (!_gatewayPromise) {
    _gatewayPromise = getConfig()
      .then((cfg) => cfg?.ipfsGatewayUrl || FALLBACK_GATEWAY)
      .catch(() => FALLBACK_GATEWAY);
  }
  return _gatewayPromise;
}
```
- In `fetchAndCacheIpfsPayload` and `getArrayBufferFromRemoteIPFS` and `isIpfsCidReachable`, build the URL with `const url = `${await gatewayBase()}${cid}`;` instead of the constant.

- [ ] **Step 4: Run the gateway test + token-resolver test (reads)**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/remote-ipfs-gateway.test.js test/token-resolver.test.js`
Expected: PASS (token-resolver may mock reads; confirm no regression).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ipfs/remote-ipfs.js test/frontend/remote-ipfs-gateway.test.js
git commit -m "feat(frontend): resolve IPFS read gateway from /config (#27)"
```

---

## Task 10: CIDv1 normalization regression test

**Files:**
- Modify (if needed): `frontend/src/js/blockchain/uri-utils.js`.
- Test: `test/token-resolver.test.js` (add a `normalizeTokenURI` CIDv1 case) or a new `test/uri-utils-cidv1.test.js`.

**Interfaces:**
- Consumes: `normalizeTokenURI` from `uri-utils.js`.
- Produces: confidence that CIDv1 (`baf…`) CIDs round-trip through normalization.

- [ ] **Step 1: Write the failing/again-green test**

Create `test/uri-utils-cidv1.test.js`:

```javascript
import { normalizeTokenURI } from "../frontend/src/js/blockchain/uri-utils.js";

const CIDV1 = "bafkreid7qoywk77r7rj3slobqfekdvs57qwuwh5d2z3sqsw52iabe3mqne";

describe("normalizeTokenURI — CIDv1", () => {
  it("returns a bare CIDv1 unchanged", () => {
    expect(normalizeTokenURI(CIDV1)).toBe(CIDV1);
  });
  it("strips ipfs:// from a CIDv1", () => {
    expect(normalizeTokenURI(`ipfs://${CIDV1}`)).toBe(CIDV1);
  });
  it("extracts a CIDv1 from a gateway path", () => {
    expect(normalizeTokenURI(`https://gw.mypinata.cloud/ipfs/${CIDV1}`)).toBe(CIDV1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/uri-utils-cidv1.test.js`
Expected: PASS (the `[A-Za-z0-9]{46,}` regex already matches CIDv1). **If any case FAILS**, fix the regex/logic in `uri-utils.js` so all three pass, then re-run.

- [ ] **Step 3: Commit**

```bash
git add test/uri-utils-cidv1.test.js frontend/src/js/blockchain/uri-utils.js
git commit -m "test(uri): verify CIDv1 normalization round-trips (#27)"
```

---

## Task 11: E2E — Pinata storage spec (opt-in, real Pinata)

**Files:**
- Create: `e2e/specs/07-pinata-storage.spec.js`
- Modify: `e2e/playwright.config.js` — isolate the Pinata spec (separate project or `@pinata` grep) so the default `chromium` run excludes it.
- Reference: `e2e/README.md`, `e2e/helpers/studio-selectors.mjs`, `e2e/helpers/manifest.mjs`.

**Interfaces:**
- Consumes: existing E2E helpers and flow (wallet connect → generate → save).
- Produces: a spec that runs only when `IPFS_BACKEND=pinata` + `PINATA_JWT`/`PINATA_GATEWAY` are set; otherwise skips.

- [ ] **Step 1: Ensure the default suite stays on Kubo**

Confirm `e2e/setup.mjs` / config start the backend with `IPFS_BACKEND=kubo` (default). If the backend is launched without setting it, no change needed (factory defaults to kubo). Document the assumption inline in the new spec.

- [ ] **Step 2: Add Pinata isolation to `e2e/playwright.config.js`**

Add a dedicated project so the default `--project=chromium` never runs it:

```javascript
// in `projects: [ ... ]`
{
  name: "pinata",
  testMatch: /07-pinata-storage\.spec\.js/,
  use: { ...devices["Desktop Chrome"] },
},
```
And exclude `07-pinata-storage.spec.js` from the `chromium` project via `testIgnore: /07-pinata-storage\.spec\.js/` on that project.

- [ ] **Step 3: Write the spec**

Create `e2e/specs/07-pinata-storage.spec.js`:

```javascript
import { test, expect } from "@playwright/test";
import { selectors } from "../helpers/studio-selectors.mjs";
// Reuse the same connect→generate→save helpers specs 02/03 use.

const PINATA_ENABLED =
  process.env.IPFS_BACKEND === "pinata" &&
  !!process.env.PINATA_JWT &&
  !!process.env.PINATA_GATEWAY;

test.describe("Pinata storage (real network)", () => {
  test.skip(!PINATA_ENABLED, "Set IPFS_BACKEND=pinata + PINATA_JWT + PINATA_GATEWAY to run");

  test("stores an asset on Pinata, returns a CIDv1, resolves via gateway, never leaks the JWT", async ({ page }) => {
    const signedUrls = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("uploads.pinata.cloud") || u.includes("/v3/files")) signedUrls.push(u);
    });

    // 1. Connect wallet + generate (reuse the spec-02 flow helpers).
    // 2. Save/publish (reuse the spec-03 flow helpers).
    // 3. Capture the resulting asset manifest CID from the UI/selectors.

    const manifestCid = await /* read the saved manifest CID via selectors */ "";
    expect(manifestCid).toMatch(/^baf[a-z0-9]{50,}$/); // CIDv1

    // 4. Resolve it back through the Pinata gateway.
    const gw = `https://${process.env.PINATA_GATEWAY}/ipfs/${manifestCid}`;
    const res = await page.request.get(gw);
    expect(res.ok()).toBeTruthy();

    // 5. The browser only ever talked to presigned URLs — never the master JWT.
    expect(signedUrls.length).toBeGreaterThan(0);
    const allRequests = [];
    // (optional) assert no Authorization: Bearer <jwt> header was sent to Pinata.
  });
});
```

> Fill the `/* ... */` placeholders by copying the exact connect→generate→save steps and selectors from `e2e/specs/02-*.spec.js` and `e2e/specs/03-*.spec.js`. Do not invent selectors — use `e2e/helpers/studio-selectors.mjs`. Read `e2e/README.md` for the per-spec contract before writing.

- [ ] **Step 4: Verify the default suite is unaffected**

Run: `npx playwright test --config=e2e/playwright.config.js --project=chromium`
Expected: specs `01`–`06` run and pass; `07` is NOT executed by this project.

- [ ] **Step 5: Verify the Pinata spec runs when enabled**

Run: `IPFS_BACKEND=pinata PINATA_JWT=… PINATA_GATEWAY=… npx playwright test --config=e2e/playwright.config.js --project=pinata`
Expected: spec `07` PASSES against real Pinata (CIDv1 returned, gateway resolves, signed URLs observed).

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/07-pinata-storage.spec.js e2e/playwright.config.js
git commit -m "test(e2e): add opt-in Pinata storage spec; isolate from default run (#27)"
```

---

## Task 12: Documentation + env reference

**Files:**
- Modify: `docs/CURRENT_STATUS.md` §6.5 (env reference).
- Modify: `.env.example` / `blockchain/.env.example` if a root example exists (add the new vars, no secrets).

**Interfaces:** none (docs only).

- [ ] **Step 1: Document the new env vars**

In `docs/CURRENT_STATUS.md §6.5`, add:

```markdown
| `IPFS_BACKEND` | backend | `pinata` (dev/prod) or `kubo` (E2E). Default `kubo`. |
| `PINATA_JWT` | backend secret | Master JWT for the Pinata v3 SDK — server-only, never sent to the browser. |
| `PINATA_GATEWAY` | backend | Dedicated gateway host, e.g. `your-gw.mypinata.cloud`. |
| `PINATA_UPLOAD_TTL` | backend | Presigned upload URL lifetime in seconds (default 60). |
```
Add a short paragraph: browser uploads use short-lived presigned URLs minted by `POST /api/v1/ipfs/upload-url` (session-gated, 5/min per wallet); the master JWT stays server-side; E2E runs against Kubo via `IPFS_BACKEND=kubo`.

- [ ] **Step 2: Update env example(s)**

Add the four vars (empty/example values, no real secrets) to the root `.env.example` if present.

- [ ] **Step 3: Commit**

```bash
git add docs/CURRENT_STATUS.md .env.example
git commit -m "docs: document Pinata storage env vars and upload flow (#27)"
```

---

## Final Verification

- [ ] **Full unit/API suite**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand`
Expected: only the 4 pre-existing env failures (ABI/tokenURI, which need a running Hardhat node + compiled ABI); everything new passes.

- [ ] **Frontend suite**

Run: `npm run test:frontend`
Expected: PASS.

- [ ] **E2E default (Kubo) critical path**

Run: `npx playwright test --config=e2e/playwright.config.js --project=chromium`
Expected: specs `01`–`06` PASS.

- [ ] **E2E Pinata (when credentials available)**

Run: `IPFS_BACKEND=pinata PINATA_JWT=… PINATA_GATEWAY=… npx playwright test --config=e2e/playwright.config.js --project=pinata`
Expected: spec `07` PASS.

- [ ] **Manual acceptance (issue #27 criteria)**
  - A browser on a different machine than the backend stores an asset/manifest and resolves it via the Pinata gateway.
  - Network inspector shows only short-lived presigned URLs reaching the browser — never `PINATA_JWT`.
  - Burn → unpin removes the pins from Pinata.
