let _signCallSeq = 0;

/**
 * Log each individual HTTP attempt the Pinata SDK's `createSignedURL()` makes
 * against `/files/sign`, including the ones its own internal retry loop
 * (maxRetries=3, backoff min(1000*2^attempt, 4000)ms - see
 * node_modules/pinata/dist/index.mjs) swallows silently. Without this, a slow
 * mint (e.g. the SDK retrying through a transient Pinata 5xx/429 or a network
 * failure) is invisible - the caller only ever sees the final success or
 * failure, several seconds later, with no way to tell which attempt(s) failed
 * or why.
 *
 * Installed once, lazily, only when a Pinata adapter is actually constructed
 * (never in Kubo-only deployments). Scoped strictly to `/files/sign` URLs -
 * every other fetch call in the process (RPC, other Pinata endpoints, etc.)
 * passes through completely unchanged. Safe under concurrency: there is
 * nothing to toggle or restore, so parallel mints (e.g. mintUploadCredentials'
 * Promise.all batch) can't race on install/uninstall. The sequence number is
 * process-global rather than per-mint (the SDK gives us no correlation id
 * across its own retries), so log lines stay individually orderable even
 * when multiple mints are in flight - adjacent numbers usually belong to the
 * same logical mint, but don't assume that under heavy concurrency.
 */
function installSignedUrlDiagnostics() {
  const currentFetch = /** @type {typeof fetch & { __arbeskPinataDiagnostics?: boolean }} */ (
    globalThis.fetch
  );
  if (typeof currentFetch !== "function" || currentFetch.__arbeskPinataDiagnostics) {
    return;
  }

  /**
   * @param {Parameters<typeof fetch>[0]} input
   * @param {Parameters<typeof fetch>[1]} [init]
   */
  const wrapped = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : /** @type {{ url?: string }} */ (input)?.url || "";
    if (!url.includes("/files/sign")) {
      return currentFetch(input, init);
    }

    const seq = ++_signCallSeq;
    const start = Date.now();
    console.log(`[IPFS] pinata sign #${seq} → dispatched`);
    try {
      const res = await currentFetch(input, init);
      const ms = Date.now() - start;
      if (res.ok) {
        console.log(`[IPFS] pinata sign #${seq} → OK (${ms}ms)`);
      } else {
        console.warn(`[IPFS] pinata sign #${seq} → HTTP ${res.status} (${ms}ms)`);
      }
      return res;
    } catch (err) {
      const ms = Date.now() - start;
      console.warn(
        `[IPFS] pinata sign #${seq} → ERROR (${ms}ms): ${(/** @type {Error} */ (err)).message}`,
      );
      throw err;
    }
  };
  wrapped.__arbeskPinataDiagnostics = true;
  globalThis.fetch = wrapped;
}

/**
 * @typedef {{ url: string, mintedAt: number }} PoolEntry
 */

/**
 * Pinata storage adapter - Pinata v3 public IPFS.
 * `add` uses the master JWT (backend writes); `mintUploadCredential`
 * returns a short-lived presigned URL for browser uploads (JWT never leaves
 * the server). Public IPFS so CIDs resolve through a normal gateway and can be
 * embedded in on-chain tokenURIs.
 *
 * The published Pinata SDK types omit the `gateways` accessor, so we cast
 * through a local typedef when performing authenticated gateway reads.
 *
 * `mintUploadCredential(s)` are backed by a small pre-minted pool (see
 * `PINATA_POOL_SIZE`) so the request path is never blocked on Pinata's
 * `/files/sign` latency (observed 0.4-6s+ from this environment, sometimes
 * with internal SDK retries pushing it to ~9-10s - see
 * `.claude/skills/arbesk-ipfs-storage/references/pinata-mode.md`). The pool
 * is entirely internal: callers see the exact same credential shape as
 * before, whether served from the pool or minted fresh.
 *
 * @typedef {{ gateways: { public: { get(cid: string): Promise<{data: any, contentType: string}> } } }} PinataWithGateways
 *
 * @param {import('pinata').PinataSDK} pinata
 * @param {{ gatewayBase: string; uploadTtl: number; poolSize?: number; poolExpiryMarginSeconds?: number }} options
 * @returns {import('./index.js').StorageAdapter}
 */
export function createPinataAdapter(
  pinata,
  { gatewayBase, uploadTtl, poolSize = 0, poolExpiryMarginSeconds = 60 },
) {
  installSignedUrlDiagnostics();

  if (poolSize > 0 && uploadTtl - poolExpiryMarginSeconds <= 0) {
    console.warn(
      `[IPFS] pinata pool misconfigured: uploadTtl=${uploadTtl}s <= expiry margin=${poolExpiryMarginSeconds}s, ` +
        `so pooled credentials would always be discarded as stale before use (no benefit from pooling). ` +
        `Increase PINATA_UPLOAD_TTL or decrease PINATA_POOL_EXPIRY_MARGIN.`,
    );
  }

  /** @type {PoolEntry[]} */
  const pool = [];
  /** @type {Promise<void> | null} */
  let refillPromise = null;

  function pruneExpired() {
    const cutoffMs = Date.now() - (uploadTtl - poolExpiryMarginSeconds) * 1000;
    while (pool.length && pool[0].mintedAt <= cutoffMs) pool.shift();
  }

  /**
   * @param {number} count
   * @returns {Promise<PoolEntry[]>}
   */
  async function mintFreshEntries(count) {
    const urls = await Promise.all(
      Array.from({ length: count }, () =>
        pinata.upload.public.createSignedURL({ expires: uploadTtl }),
      ),
    );
    return urls.map((url) => ({ url, mintedAt: Date.now() }));
  }

  // Hard cap on refill rounds per call. If uploadTtl <= poolExpiryMarginSeconds
  // (the misconfiguration warned about at construction), every freshly-minted
  // entry has mintedAt <= the prune cutoff *immediately*, so pruneExpired
  // discards a round's entries before the next shortfall check ever sees them
  // as available - shortfall never reaches 0 and an unbounded loop spins
  // forever. This cap converts that into a bounded, logged no-op instead of a
  // hang (caught by actually running this against that exact misconfigured
  // case, not by inspection).
  const MAX_REFILL_ROUNDS = 5;

  /**
   * Mint until the pool reaches `poolSize`, rechecking the shortfall after
   * each round (not just once) so a burst of pops that all arrive while a
   * round is in flight still gets fully caught up - not just the shortfall
   * that existed at the moment the first one triggered a refill. Verified
   * empirically this matters: a live 5-pop burst against the real Pinata
   * account topped the pool up by only 1 (the shortfall at the *first* pop)
   * before this loop existed, leaving it at 1/5 until a later, non-
   * overlapping trigger recomputed correctly.
   */
  async function refillLoop() {
    for (let round = 0; round < MAX_REFILL_ROUNDS; round++) {
      pruneExpired();
      const shortfall = poolSize - pool.length;
      if (shortfall <= 0) return;
      const fresh = await mintFreshEntries(shortfall).catch((err) => {
        console.warn(
          `[IPFS] pinata pool refill failed (non-fatal): ${(/** @type {Error} */ (err)).message}`,
        );
        return [];
      });
      if (fresh.length === 0) return; // minting failed; avoid spinning
      pool.push(...fresh);
      console.log(
        `[IPFS] pinata pool refilled +${fresh.length} (size=${pool.length}/${poolSize})`,
      );
    }
    pruneExpired();
    if (poolSize - pool.length > 0) {
      console.warn(
        `[IPFS] pinata pool refill gave up after ${MAX_REFILL_ROUNDS} rounds still short ` +
          `(size=${pool.length}/${poolSize}) - pooled entries may be expiring faster than they ` +
          `can be minted; check PINATA_UPLOAD_TTL vs PINATA_POOL_EXPIRY_MARGIN`,
      );
    }
  }

  /**
   * Top the pool back up to `poolSize` in the background. Deliberately not
   * awaited by callers on the request path - fire-and-forget, non-fatal on
   * failure (same "best-effort" posture as pin calls elsewhere in this
   * codebase). Returns the in-flight promise (rather than a fresh one) when
   * already refilling, so concurrent triggers - a pop plus the construction-
   * time warm-up, or several pops in a burst - collapse into one refill
   * *chain* (see refillLoop) instead of stacking redundant mints.
   * @returns {Promise<void>}
   */
  function scheduleRefill() {
    if (refillPromise) return refillPromise;
    pruneExpired();
    if (poolSize - pool.length <= 0) return Promise.resolve();
    refillPromise = refillLoop().finally(() => {
      refillPromise = null;
    });
    return refillPromise;
  }

  // Warm the pool shortly after construction, without blocking startup or
  // the first request. No-op when pooling isn't enabled (poolSize 0).
  scheduleRefill();

  return {
    backend: "pinata",

    /**
     * @param {string | Uint8Array} payload
     * @param {string} [filename]
     */
    async add(payload, filename) {
      const file = new File(
        [/** @type {import('node:buffer').BlobPart} */ (/** @type {unknown} */ (payload))],
        filename || "upload.bin",
      );
      const { cid } = await pinata.upload.public.file(file);
      console.log(`[IPFS] pinata add → ${cid} (${filename || "upload.bin"})`);
      return cid;
    },

    /**
     * Upload multiple files as a single IPFS directory and return the
     * directory root CID. Used to group a glTF + its buffers/textures into one
     * browsable folder (organizational only - loading still uses bare CIDs).
     * @param {{name: string, data: Uint8Array|string}[]} files
     * @returns {Promise<string>} directory root CID
     */
    async addDirectory(files) {
      const fileObjects = files.map(
        (f) => new File([/** @type {any} */ (f.data)], f.name),
      );
      const { cid } = await pinata.upload.public.fileArray(fileObjects);
      console.log(`[IPFS] pinata addDirectory → ${cid}`);
      return cid;
    },

    /**
     * @param {string} cid
     */
    async cat(cid) {
      const response = await /** @type {PinataWithGateways} */ (/** @type {unknown} */ (pinata)).gateways.public.get(cid);
      const data = response.data;
      if (typeof data === "string") return data;
      if (data instanceof Blob) return await data.text();
      if (data && typeof data === "object") return JSON.stringify(data);
      return "";
    },

    /**
     * @param {string} cid
     */
    async catBytes(cid) {
      const response = await /** @type {PinataWithGateways} */ (/** @type {unknown} */ (pinata)).gateways.public.get(cid);
      const data = response.data;
      if (Buffer.isBuffer(data)) return data;
      if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (data instanceof ArrayBuffer) return Buffer.from(data);
      if (data instanceof Blob) return Buffer.from(await data.arrayBuffer());
      if (typeof data === "string") return Buffer.from(data, "utf-8");
      if (data && typeof data === "object") return Buffer.from(JSON.stringify(data), "utf-8");
      return Buffer.alloc(0);
    },

    /**
     * @param {string} cid
     */
    async unpin(cid) {
      const { files } = await pinata.files.public.list().cid(cid);
      if (!files || files.length === 0) return true;
      await pinata.files.public.delete(files.map((/** @type {import('pinata').PinataFile} */ f) => f.id));
      return true;
    },

    /**
     * List all pinned CIDs from the public Pinata network.
     * Paginates through the file list API.
     * @returns {Promise<string[]>}
     */
    async listPinned() {
      const cids = [];
      let pageToken = null;
      const limit = 100;
      let pages = 0;
      const maxPages = Number(process.env.PINATA_GC_MAX_PAGES || 1000);

      do {
        let query = pinata.files.public.list().limit(limit);
        if (pageToken) {
          query = query.pageToken(pageToken);
        }
        const { files, next_page_token } = await query;
        for (const f of files || []) {
          if (f?.cid) cids.push(f.cid);
        }
        pageToken = next_page_token;
        pages++;
      } while (pageToken && pages < maxPages);

      return cids;
    },

    /**
     * Serves from the pre-minted pool when available (instant, no Pinata call
     * on the request path); falls back to minting fresh inline when the pool
     * is empty or disabled (poolSize 0) - identical behavior to before pooling
     * existed. Either way, triggers a background top-up before returning.
     */
    async mintUploadCredential() {
      pruneExpired();
      const [entry] = pool.length ? pool.splice(0, 1) : await mintFreshEntries(1);
      scheduleRefill();
      return { backend: "pinata", url: entry.url, gateway: gatewayBase, reusable: false };
    },

    /**
     * Mint `count` presigned URLs. Pinata signed URLs are strictly single-use
     * (a second upload against the same URL gets HTTP 409 "duplicate file id"
     * - verified empirically, not documented), so callers uploading multiple
     * files must get one credential per file up front instead of reusing one
     * mint across a batch. Serves as many as available from the pool first,
     * mints only the shortfall fresh (in parallel), then triggers a
     * background top-up.
     * @param {number} count
     */
    async mintUploadCredentials(count) {
      pruneExpired();
      const fromPool = pool.splice(0, count);
      const shortfall = count - fromPool.length;
      const fresh = shortfall > 0 ? await mintFreshEntries(shortfall) : [];
      scheduleRefill();
      return [...fromPool, ...fresh].map((entry) => ({
        backend: "pinata",
        url: entry.url,
        gateway: gatewayBase,
        reusable: false,
      }));
    },

    gatewayBase() {
      return gatewayBase;
    },
  };
}


