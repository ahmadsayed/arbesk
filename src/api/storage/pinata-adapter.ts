import type { BlobPart } from "node:buffer";
import type { PinataFile, PinataSDK } from "pinata";
import type { PinnedFile, StorageAdapter } from "./index.ts";

let _signCallSeq = 0;

/**
 * Logs each `/files/sign` HTTP attempt the Pinata SDK makes, including its
 * internal retries.
 * @remarks Without this a slow mint is invisible: the SDK's retry loop
 *   swallows failures, so the caller only sees the final result. Installed
 *   lazily, only when a Pinata adapter is constructed, and scoped to
 *   `/files/sign` URLs.
 */
function installSignedUrlDiagnostics(): void {
  const currentFetch = globalThis.fetch as typeof fetch & {
    __arbeskPinataDiagnostics?: boolean;
  };
  if (typeof currentFetch !== "function" || currentFetch.__arbeskPinataDiagnostics) {
    return;
  }

  const wrapped = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url =
      typeof input === "string"
        ? input
        : (input as { url?: string })?.url || "";
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
        `[IPFS] pinata sign #${seq} → ERROR (${ms}ms): ${(err as Error).message}`,
      );
      throw err;
    }
  };
  wrapped.__arbeskPinataDiagnostics = true;
  globalThis.fetch = wrapped;
}

interface PoolEntry {
  url: string;
  mintedAt: number;
}

/**
 * The published Pinata SDK types omit the `gateways` accessor.
 * @remarks Cast through this local interface for authenticated gateway reads.
 */
interface PinataWithGateways {
  gateways: {
    public: {
      get(cid: string): Promise<{ data: any; contentType: string }>;
    };
  };
}

export interface PinataAdapterOptions {
  gatewayBase: string;
  uploadTtl: number;
  poolSize?: number;
  poolExpiryMarginSeconds?: number;
}

/**
 * Pinata storage adapter (Pinata v3 public IPFS).
 * @remarks `add` uses the master JWT (backend writes); `mintUploadCredential`
 *   returns a short-lived presigned URL for browser uploads (JWT never leaves
 *   the server). Public IPFS so CIDs resolve through a gateway and can be
 *   embedded in on-chain tokenURIs. Credential mints are backed by a
 *   pre-minted pool so the request path is never blocked on `/files/sign`
 *   latency.
 */
/** Attempts per file delete; 429 and 5xx answers are retried. */
const DELETE_ATTEMPTS = 4;
/** Backoff before a retry when Pinata sends no Retry-After. */
const DELETE_RETRY_BASE_MS = 500;

/**
 * Adds one page of the Pinata file listing to `pins` and `seen` (CID → file
 * ids).
 * @remarks One CID can be pinned as several files: list it once, keep every id.
 */
function collectPinnedPage(
  files: PinataFile[],
  pins: PinnedFile[],
  seen: Map<string, string[]>,
): void {
  for (const f of files) {
    if (!f?.cid) continue;
    const ids = seen.get(f.cid);
    if (ids) {
      ids.push(f.id);
      continue;
    }
    seen.set(f.cid, [f.id]);
    pins.push({ cid: f.cid, bytes: f.size });
  }
}

/** Reads at most `length` bytes of a response body, then cancels the rest. */
async function readPrefix(res: Response, length: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < length) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel();
  return Buffer.concat(chunks).subarray(0, length);
}

/** One DELETE request for a Pinata file id, on the SDK's endpoint and JWT. */
function sendPinataDelete(pinata: PinataSDK, id: string): Promise<Response> {
  const endpoint = pinata.config?.endpointUrl || "https://api.pinata.cloud/v3";
  const url = `${endpoint}/files/public/${id}`;
  return fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${pinata.config?.pinataJwt}` },
  });
}

/** How long to wait before retrying a delete: Retry-After, else backoff. */
function deleteRetryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && res.headers.has("retry-after")
    ? retryAfter * 1000
    : DELETE_RETRY_BASE_MS * 2 ** (attempt - 1);
}

/**
 * Deletes one Pinata file by id.
 * @remarks Calls the v3 endpoint directly instead of the SDK's
 *   `files.public.delete`: the SDK (pinata@2.5) sleeps 300 ms after every
 *   file and reports a failed delete as a status string with the HTTP code
 *   dropped, never throwing, so a refused delete looked like success and
 *   429s could not be told apart. A 404 means the file is already gone.
 * @throws when Pinata refuses the delete, after retrying 429 and 5xx
 */
async function deletePinataFile(pinata: PinataSDK, id: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await sendPinataDelete(pinata, id);
    if (res.ok || res.status === 404) {
      await res.body?.cancel();
      return;
    }
    const detail = (await res.text()).slice(0, 200);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= DELETE_ATTEMPTS) {
      throw new Error(`pinata delete ${id}: HTTP ${res.status} ${detail}`);
    }
    const waitMs = deleteRetryDelayMs(res, attempt);
    console.warn(`[IPFS] pinata delete ${id}: HTTP ${res.status}, retrying in ${waitMs} ms`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export function createPinataAdapter(
  pinata: PinataSDK,
  {
    gatewayBase,
    uploadTtl,
    poolSize = 0,
    poolExpiryMarginSeconds = 60,
  }: PinataAdapterOptions,
): StorageAdapter {
  installSignedUrlDiagnostics();

  if (poolSize > 0 && uploadTtl - poolExpiryMarginSeconds <= 0) {
    console.warn(
      `[IPFS] pinata pool misconfigured: uploadTtl=${uploadTtl}s <= expiry margin=${poolExpiryMarginSeconds}s, ` +
        `so pooled credentials would always be discarded as stale before use (no benefit from pooling). ` +
        `Increase PINATA_UPLOAD_TTL or decrease PINATA_POOL_EXPIRY_MARGIN.`,
    );
  }

  const pool: PoolEntry[] = [];
  /** File ids per CID from the last `listPinned`, so `unpin` skips a lookup. */
  let fileIdsByCid = new Map<string, string[]>();
  let refillPromise: Promise<void> | null = null;

  function pruneExpired(): void {
    const cutoffMs = Date.now() - (uploadTtl - poolExpiryMarginSeconds) * 1000;
    while (pool.length && pool[0].mintedAt <= cutoffMs) pool.shift();
  }

  async function mintFreshEntries(count: number): Promise<PoolEntry[]> {
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
   * Mints until the pool reaches `poolSize`.
   * @remarks Rechecks the shortfall after each round (not just once) so a
   *   burst of pops that arrives while a round is in flight still gets fully
   *   caught up.
   */
  async function refillLoop(): Promise<void> {
    for (let round = 0; round < MAX_REFILL_ROUNDS; round++) {
      pruneExpired();
      const shortfall = poolSize - pool.length;
      if (shortfall <= 0) return;
      const fresh = await mintFreshEntries(shortfall).catch((err) => {
        console.warn(
          `[IPFS] pinata pool refill failed (non-fatal): ${(err as Error).message}`,
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
   * Tops the pool back up to `poolSize` in the background.
   * @remarks Fire-and-forget (not awaited on the request path, non-fatal on
   *   failure). Returns the in-flight promise when already refilling, so
   *   concurrent triggers collapse into one refill chain.
   */
  function scheduleRefill(): Promise<void> {
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

    async add(payload, filename) {
      const file = new File(
        [payload as unknown as BlobPart],
        filename || "upload.bin",
      );
      const { cid } = await pinata.upload.public.file(file);
      console.log(`[IPFS] pinata add → ${cid} (${filename || "upload.bin"})`);
      return cid;
    },

    /**
     * Uploads multiple files as a single IPFS directory and returns the
     * directory root CID.
     * @remarks Groups a glTF + its buffers/textures into one browsable folder
     *   (organizational only — loading still uses bare CIDs).
     */
    async addDirectory(files) {
      const fileObjects = files.map(
        (f) => new File([f.data as any], f.name),
      );
      const { cid } = await pinata.upload.public.fileArray(fileObjects);
      console.log(`[IPFS] pinata addDirectory → ${cid}`);
      return cid;
    },

    async cat(cid) {
      const response = await (pinata as unknown as PinataWithGateways).gateways.public.get(cid);
      const data = response.data;
      if (typeof data === "string") return data;
      if (data instanceof Blob) return await data.text();
      if (data && typeof data === "object") return JSON.stringify(data);
      return "";
    },

    async catBytes(cid) {
      const response = await (pinata as unknown as PinataWithGateways).gateways.public.get(cid);
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
     * @remarks Uses the file ids the last `listPinned` saw for `cid`, else
     *   looks them up (one extra request).
     */
    /**
     * @remarks A Range request to the public gateway; reading stops at
     *   `length` bytes even when the gateway ignores Range and sends it all.
     */
    async catHead(cid, length) {
      const res = await fetch(`${gatewayBase}${cid}`, {
        headers: { Range: `bytes=0-${length - 1}` },
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`gateway ${res.status} for ${cid}`);
      }
      return readPrefix(res, length);
    },

    async unpin(cid) {
      let ids = fileIdsByCid.get(cid);
      if (!ids) {
        const { files } = await pinata.files.public.list().cid(cid);
        ids = (files || []).map((f: PinataFile) => f.id);
      }
      for (const id of ids) await deletePinataFile(pinata, id);
      fileIdsByCid.delete(cid);
      return true;
    },

    /**
     * Lists all pinned CIDs from the public Pinata network, with the size
     * Pinata reports for each file.
     */
    async listPinned() {
      const pins: { cid: string; bytes?: number }[] = [];
      const seen = new Map<string, string[]>();
      let pageToken: string | null = null;
      const limit = 100;
      let pages = 0;
      const maxPages = Number(process.env.PINATA_GC_MAX_PAGES || 1000);

      do {
        let query = pinata.files.public.list().limit(limit);
        if (pageToken) {
          query = query.pageToken(pageToken);
        }
        const { files, next_page_token } = await query;
        collectPinnedPage(files || [], pins, seen);
        pageToken = next_page_token;
        pages++;
      } while (pageToken && pages < maxPages);

      fileIdsByCid = seen;
      return pins;
    },

    /**
     * @remarks Serves from the pre-minted pool when available, else mints
     *   fresh inline (pool empty or disabled). Triggers a background top-up
     *   before returning.
     */
    async mintUploadCredential() {
      pruneExpired();
      const [entry] = pool.length ? pool.splice(0, 1) : await mintFreshEntries(1);
      scheduleRefill();
      return { strategy: "presigned-put", url: entry.url, gateway: gatewayBase, reusable: false };
    },

    /**
     * Mints `count` presigned URLs.
     * @remarks Pinata signed URLs are strictly single-use (HTTP 409 on
     *   reuse), so a multi-file upload needs one credential per file. Serves
     *   from the pool first, mints only the shortfall, then triggers a
     *   background top-up.
     */
    async mintUploadCredentials(count) {
      pruneExpired();
      const fromPool = pool.splice(0, count);
      const shortfall = count - fromPool.length;
      const fresh = shortfall > 0 ? await mintFreshEntries(shortfall) : [];
      scheduleRefill();
      return [...fromPool, ...fresh].map((entry) => ({
        strategy: "presigned-put",
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
