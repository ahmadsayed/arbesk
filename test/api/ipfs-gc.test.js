import { afterAll, beforeAll, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { ContractFunctionRevertedError } from "viem";

const FREE = "0x00000000000000000000000000000000000000f1";
const PAID = "0x00000000000000000000000000000000000000f2";
const OWNER = "0x0000000000000000000000000000000000000abc";

/**
 * Chain state per contract: tokenId → { uri, editorListUri?, burned? }.
 * `failures` maps "<address>:<fn>:<tokenId>" to "revert" | "rpc".
 */
let chain;
let failures;

function revertError(functionName) {
  return new ContractFunctionRevertedError({ abi: [], functionName });
}

/** Mint logs in [fromBlock, toBlock]; a token's mintBlock defaults to 0. */
function mintLogs({ address, fromBlock, toBlock }) {
  return Object.entries(chain[address] || {})
    .filter(([, t]) => BigInt(t.mintBlock ?? 0) >= fromBlock && BigInt(t.mintBlock ?? 0) <= toBlock)
    .map(([id]) => ({ args: { tokenId: BigInt(id) } }));
}

const fakeClient = {
  getBlockNumber: jest.fn(async () => 10n),
  getChainId: jest.fn(async () => 84532),
  getLogs: jest.fn(async (query) => mintLogs(query)),
  readContract: jest.fn(async ({ address, functionName, args }) => {
    const id = String(args[0]);
    const failure = failures[`${address}:${functionName}:${id}`];
    if (failure === "revert") throw revertError(functionName);
    if (failure === "rpc") throw new Error("request timed out (ETIMEDOUT)");
    const token = chain[address]?.[id];
    if (!token || token.burned) throw revertError(functionName);
    if (functionName === "ownerOf") return OWNER;
    if (functionName === "tokenURI") return token.uri;
    if (functionName === "editorListURI") return token.editorListUri ?? "";
    throw new Error(`unexpected ${functionName}`);
  }),
};

mock.module("../../src/config.ts", () => ({
  getPublicClient: () => fakeClient,
  getContractAddress: () => null,
}));

const { runIpfsGC } = await import("../../src/api/ipfs-gc.ts");

describe("runIpfsGC", () => {
  let blobs;
  let pinned;
  let storage;
  let statePath;
  const spies = [];

  beforeAll(() => {
    // Contract artifacts are gitignored build output; the fake client
    // ignores the ABI anyway.
    const realExists = fs.existsSync;
    const realRead = fs.readFileSync;
    const isArtifact = (p) => String(p).includes("blockchain/artifacts/contracts/");
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p, ...rest) =>
        isArtifact(p) ? true : realExists(p, ...rest),
      ),
      spyOn(fs, "readFileSync").mockImplementation((p, ...rest) =>
        isArtifact(p) ? JSON.stringify({ abi: [] }) : realRead(p, ...rest),
      ),
      spyOn(console, "log").mockImplementation(() => {}),
      spyOn(console, "warn").mockImplementation(() => {}),
      spyOn(console, "error").mockImplementation(() => {}),
    );
  });

  afterAll(() => {
    for (const s of spies) s.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    blobs = new Map();
    pinned = new Set();
    chain = { [FREE]: {}, [PAID]: {} };
    failures = {};
    statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "arbesk-gc-")), "state.json");
    storage = {
      backend: "kubo",
      catBytes: jest.fn(async (cid) => {
        if (!blobs.has(cid)) throw new Error(`missing block for ${cid}`);
        return Buffer.from(blobs.get(cid), "utf-8");
      }),
      listPinned: jest.fn(async () => Array.from(pinned, (cid) => ({ cid }))),
      unpin: jest.fn(async (cid) => {
        pinned.delete(cid);
        return true;
      }),
    };
  });

  function putManifest(cid, manifest) {
    blobs.set(cid, JSON.stringify(manifest));
    pinned.add(cid);
    return cid;
  }

  function gc(opts = {}) {
    return runIpfsGC(
      {
        dryRun: false,
        freeContractAddress: FREE,
        paidContractAddress: PAID,
        graceMs: 0,
        statePath,
        indexerStatePath: path.join(path.dirname(statePath), "no-indexer-state.json"),
        refCachePath: path.join(path.dirname(statePath), "ref-cache.json"),
        ...opts,
      },
      storage,
    );
  }

  it("unpins only CIDs unreachable from live tokens", async () => {
    putManifest("bafyLive", {
      version: 1,
      scene: { nodes: [{ node_id: "n", source: { cid: "bafyLiveSrc" } }] },
    });
    blobs.set("bafyLiveSrc", "{}");
    pinned.add("bafyLiveSrc");
    putManifest("bafyBurned", { version: 1, scene: { nodes: [] } });
    chain[FREE]["1"] = { uri: "bafyLive" };
    chain[FREE]["2"] = { uri: "bafyBurned", burned: true };

    const result = await gc();

    expect(result.errors).toEqual([]);
    expect(result.aborted).toBe(false);
    expect(result.unpinned).toBe(1);
    expect(Array.from(pinned).sort()).toEqual(["bafyLive", "bafyLiveSrc"]);
  });

  describe("mint scan", () => {
    function writeIndexerState(state) {
      const file = path.join(path.dirname(statePath), "token-indexer.json");
      fs.writeFileSync(file, JSON.stringify(state));
      return file;
    }

    it("narrows the getLogs range to the cap the RPC names", async () => {
      putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
      chain[FREE]["1"] = { uri: "bafyLive", mintBlock: 650 };
      fakeClient.getBlockNumber.mockImplementation(async () => 1000n);
      fakeClient.getLogs.mockImplementation(async (query) => {
        if (query.toBlock - query.fromBlock + 1n > 200n) {
          throw new Error("RPC Request failed.\n\nDetails: eth_getLogs is limited to a 200 range");
        }
        return mintLogs(query);
      });

      try {
        const result = await gc();

        expect(result.errors).toEqual([]);
        expect(result.liveTokens).toBe(1);
        expect(pinned.has("bafyLive")).toBe(true);
      } finally {
        fakeClient.getBlockNumber.mockImplementation(async () => 10n);
        fakeClient.getLogs.mockImplementation(async (query) => mintLogs(query));
      }
    });

    it("starts from the token indexer's snapshot and scans only the blocks after it", async () => {
      putManifest("bafyOld", { version: 1, scene: { nodes: [] } });
      putManifest("bafyNew", { version: 1, scene: { nodes: [] } });
      // Minted before the snapshot: no getLogs call may reach block 2.
      chain[FREE]["1"] = { uri: "bafyOld", mintBlock: 2 };
      chain[FREE]["5"] = { uri: "bafyNew", mintBlock: 9 };
      const indexerStatePath = writeIndexerState({
        contractAddress: FREE,
        lastScannedBlock: 8,
        ownership: { 1: OWNER },
      });

      const result = await gc({ indexerStatePath });

      expect(result.errors).toEqual([]);
      expect(result.liveTokens).toBe(2);
      expect(result.unpinned).toBe(0);
      const freeScans = fakeClient.getLogs.mock.calls.filter(([q]) => q.address === FREE);
      expect(freeScans.length).toBeGreaterThan(0);
      for (const [{ fromBlock }] of freeScans) {
        expect(fromBlock).toBeGreaterThanOrEqual(8n);
      }
    });

    it("ignores an indexer snapshot of another contract", async () => {
      putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
      chain[FREE]["1"] = { uri: "bafyLive", mintBlock: 2 };
      const indexerStatePath = writeIndexerState({
        contractAddress: PAID,
        lastScannedBlock: 8,
        ownership: {},
      });

      const result = await gc({ indexerStatePath });

      expect(result.liveTokens).toBe(1);
      expect(fakeClient.getLogs.mock.calls[0][0].fromBlock).toBe(0n);
    });
  });

  it("logs a progress line for each walked token", async () => {
    putManifest("bafyA", { version: 1, scene: { nodes: [] } });
    putManifest("bafyB", { version: 1, scene: { nodes: [] } });
    chain[FREE]["1"] = { uri: "bafyA" };
    chain[FREE]["2"] = { uri: "bafyB" };

    await gc();

    const lines = console.log.mock.calls.map(([line]) => String(line));
    const progress = lines.filter((l) => l.startsWith("[GC] walked "));
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatch(/^\[GC\] walked 1\/2 ArbeskAssetFree#1 \| 1 CIDs, 1 reads, \d+ B, [\d.]+s$/);
    expect(progress[1]).toMatch(/^\[GC\] walked 2\/2 ArbeskAssetFree#2 /);
  });

  it("unpins several orphans at a time", async () => {
    for (let i = 0; i < 12; i++) pinned.add(`bafyOrphan${i}`);
    let inFlight = 0;
    let maxInFlight = 0;
    storage.unpin.mockImplementation(async (cid) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      pinned.delete(cid);
      return true;
    });

    const result = await gc();

    expect(result.unpinned).toBe(12);
    expect(pinned.size).toBe(0);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  describe("source reference cache", () => {
    function liveTokenWithSource(sourceBody) {
      putManifest("bafyLive", {
        version: 1,
        scene: { nodes: [{ node_id: "n", source: { cid: "bafySrc" } }] },
      });
      blobs.set("bafySrc", sourceBody);
      pinned.add("bafySrc");
      pinned.add("bafyBuf");
      chain[FREE]["1"] = { uri: "bafyLive" };
    }
    const sourceReads = () => storage.catBytes.mock.calls.filter(([cid]) => cid === "bafySrc").length;
    const gltfSource = JSON.stringify({ buffers: [{ uri: "ipfs://bafyBuf" }] });

    it("reads a source once, then reuses the CIDs it references", async () => {
      liveTokenWithSource(gltfSource);

      await gc();
      const second = await gc();

      expect(sourceReads()).toBe(1);
      expect(second.errors).toEqual([]);
      expect(second.unpinned).toBe(0);
      expect(pinned.has("bafyBuf")).toBe(true);
    });

    it("remembers that a binary source references nothing", async () => {
      liveTokenWithSource("glTF\u0002binary mesh");

      await gc();
      await gc();

      expect(sourceReads()).toBe(1);
    });

    it("reads a source again when its earlier read failed", async () => {
      liveTokenWithSource(gltfSource);
      blobs.delete("bafySrc");
      const first = await gc();
      blobs.set("bafySrc", gltfSource);

      const second = await gc();

      expect(first.aborted).toBe(true);
      expect(second.errors).toEqual([]);
      expect(sourceReads()).toBe(2);
      expect(pinned.has("bafyBuf")).toBe(true);
    });

    describe("with a storage that can read a file's first bytes", () => {
      beforeEach(() => {
        storage.catHead = jest.fn(async (cid, length) =>
          Buffer.from(blobs.get(cid), "utf-8").subarray(0, length),
        );
      });

      it("does not download a source whose first bytes are binary", async () => {
        liveTokenWithSource("glTF\u0002\u0000\u0000\u0000binary mesh");

        const result = await gc();

        expect(sourceReads()).toBe(0);
        expect(result.errors).toEqual([]);
        expect(pinned.has("bafySrc")).toBe(true);
      });

      it("downloads a JSON source in full", async () => {
        liveTokenWithSource(gltfSource);

        await gc();

        expect(sourceReads()).toBe(1);
        expect(pinned.has("bafyBuf")).toBe(true);
      });

      it("downloads the source in full when its first bytes cannot be read", async () => {
        liveTokenWithSource(gltfSource);
        storage.catHead.mockRejectedValue(new Error("gateway 502"));

        const result = await gc();

        expect(result.errors).toEqual([]);
        expect(sourceReads()).toBe(1);
        expect(pinned.has("bafyBuf")).toBe(true);
      });
    });

    it("dry runs do not write the cache", async () => {
      liveTokenWithSource(gltfSource);

      await gc({ dryRun: true });
      await gc({ dryRun: true });

      expect(sourceReads()).toBe(2);
    });
  });

  it("keeps reference images of live tokens", async () => {
    putManifest("bafyLive", {
      version: 1,
      scene: {
        nodes: [{ node_id: "n", reference_images: [{ cid: "bafyRef", view: "front" }] }],
      },
    });
    pinned.add("bafyRef");
    chain[FREE]["1"] = { uri: "bafyLive" };

    const result = await gc();

    expect(result.unpinned).toBe(0);
    expect(pinned.has("bafyRef")).toBe(true);
  });

  it("aborts unpinning when ownerOf fails with an RPC error", async () => {
    putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
    pinned.add("bafyOrphan");
    chain[FREE]["1"] = { uri: "bafyLive" };
    failures[`${FREE}:ownerOf:1`] = "rpc";

    const result = await gc();

    expect(result.aborted).toBe(true);
    expect(result.errors.some((e) => /ownerOf\(1\)/.test(e))).toBe(true);
    expect(result.orphans).toBe(2);
    expect(storage.unpin).not.toHaveBeenCalled();
  });

  it("aborts unpinning when a manifest in the chain cannot be read", async () => {
    putManifest("bafyV2", { version: 2, prev_asset_manifest_cid: "bafyV1", scene: { nodes: [] } });
    pinned.add("bafyV1"); // pinned but unreadable (e.g. a cat timeout)
    chain[FREE]["1"] = { uri: "bafyV2" };

    const result = await gc();

    expect(result.aborted).toBe(true);
    expect(storage.unpin).not.toHaveBeenCalled();
    expect(pinned.has("bafyV1")).toBe(true);
  });

  it("aborts unpinning when tokenURI fails for a live token", async () => {
    putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
    chain[PAID]["7"] = { uri: "bafyLive" };
    failures[`${PAID}:tokenURI:7`] = "rpc";

    const result = await gc();

    expect(result.aborted).toBe(true);
    expect(storage.unpin).not.toHaveBeenCalled();
  });

  it("treats an editorListURI revert (older contract) as absent, not an error", async () => {
    putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
    pinned.add("bafyOrphan");
    chain[FREE]["1"] = { uri: "bafyLive" };
    failures[`${FREE}:editorListURI:1`] = "revert";

    const result = await gc();

    expect(result.errors).toEqual([]);
    expect(result.unpinned).toBe(1);
    expect(pinned.has("bafyOrphan")).toBe(false);
  });

  it("keeps the editor list of a live token", async () => {
    putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
    pinned.add("bafyEditors");
    chain[FREE]["1"] = { uri: "bafyLive", editorListUri: "ipfs://bafyEditors" };

    const result = await gc();

    expect(result.unpinned).toBe(0);
    expect(pinned.has("bafyEditors")).toBe(true);
  });

  it("reads tokenURI only on the contract where the token is live", async () => {
    putManifest("bafyPaid", { version: 1, scene: { nodes: [] } });
    chain[PAID]["1"] = { uri: "bafyPaid" };

    const result = await gc();

    const tokenUriCalls = fakeClient.readContract.mock.calls.filter(
      ([req]) => req.functionName === "tokenURI",
    );
    expect(tokenUriCalls.map(([req]) => req.address)).toEqual([PAID]);
    expect(result.liveTokens).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("still reports orphans in a dry run with errors", async () => {
    putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
    pinned.add("bafyOrphan");
    chain[FREE]["1"] = { uri: "bafyLive" };
    failures[`${FREE}:ownerOf:1`] = "rpc";

    const result = await gc({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.orphans).toBe(2);
    expect(storage.unpin).not.toHaveBeenCalled();
  });

  describe("asset deleted from a collection", () => {
    function putSource(cid) {
      blobs.set(cid, "\u0000bin");
      pinned.add(cid);
    }
    const asset = (source, prev) => ({
      version: 1,
      type: "asset",
      thumbnail: { cid: `${source}Thumb` },
      scene: { nodes: [{ node_id: "n", source: { cid: source } }] },
      prev_asset_manifest_cid: prev,
    });

    /** Token 1: asset A (two versions) was deleted, asset B stays. */
    function setupDeleted() {
      for (const cid of ["srcA1", "srcA1Thumb", "srcA2", "srcA2Thumb", "srcB", "srcBThumb"]) putSource(cid);
      putManifest("A1", asset("srcA1", null));
      putManifest("A2", asset("srcA2", "A1"));
      putManifest("B1", asset("srcB", null));
      putManifest("COL1", { version: 1, type: "collection", assets: { a: "A2", b: "B1" } });
      putManifest("COL2", { version: 2, type: "collection", assets: { b: "B1" }, prev_asset_manifest_cid: "COL1" });
      chain[FREE]["1"] = { uri: "COL2" };
    }

    it("reclaims every version of the deleted asset and keeps the collection history", async () => {
      setupDeleted();

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(Array.from(pinned).sort()).toEqual(["B1", "COL1", "COL2", "srcB", "srcBThumb"]);
    });

    it("keeps the versions a fork in another collection has in its history", async () => {
      setupDeleted();
      // Forked at A1, then edited on its own.
      putSource("srcF2");
      putSource("srcF2Thumb");
      putManifest("F2", asset("srcF2", "A1"));
      putManifest("COLX", { version: 1, type: "collection", assets: { a: "F2" } });
      chain[FREE]["2"] = { uri: "COLX" };

      const result = await gc();

      expect(result.errors).toEqual([]);
      for (const cid of ["F2", "srcF2", "A1", "srcA1", "srcA1Thumb"]) expect(pinned.has(cid)).toBe(true);
      // A2 was made after the fork: nothing reaches it.
      for (const cid of ["A2", "srcA2", "srcA2Thumb"]) expect(pinned.has(cid)).toBe(false);
    });

    it("does not abort when the deleted asset's manifests are already gone", async () => {
      setupDeleted();
      // Deletes made before this rule unpinned the chain right away.
      for (const cid of ["A1", "A2"]) {
        blobs.delete(cid);
        pinned.delete(cid);
      }

      const result = await gc();

      expect(result.aborted).toBe(false);
      expect(result.errors).toEqual([]);
      expect(pinned.has("srcA1")).toBe(false);
    });
  });

  describe("storage figures", () => {
    const HOUR = 3600000;
    const T0 = 1_800_000_000_000;

    function setupTwoOrphans() {
      putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
      pinned.add("bafyOld");
      pinned.add("bafyNew");
      chain[FREE]["1"] = { uri: "bafyLive" };
    }

    it("sums the sizes the pin listing reports (Pinata)", async () => {
      setupTwoOrphans();
      const sizes = { bafyLive: 10, bafyOld: 3000, bafyNew: 500 };
      storage.listPinned = jest.fn(async () =>
        Array.from(pinned, (cid) => ({ cid, bytes: sizes[cid] })),
      );
      await gc({ graceMs: HOUR, now: () => T0 });

      // Both are past grace now; maxUnpin leaves bafyNew for the next run.
      const result = await gc({ graceMs: HOUR, now: () => T0 + HOUR, maxUnpin: 1 });

      expect(Array.from(pinned).sort()).toEqual(["bafyLive", "bafyNew"]);
      expect(result.orphanBytes).toBe(3500);
      expect(result.eligibleBytes).toBe(3500);
      expect(result.unpinnedBytes).toBe(3000);
      expect(result.sizeUnknown).toBe(0);
    });

    it("looks sizes up per orphan when the listing has none (Kubo)", async () => {
      setupTwoOrphans();
      storage.pinnedBytes = jest.fn(async (cid) => ({ bafyOld: 2048, bafyNew: 1024 })[cid]);

      const result = await gc();

      expect(storage.pinnedBytes).toHaveBeenCalledTimes(2);
      expect(storage.pinnedBytes).not.toHaveBeenCalledWith("bafyLive");
      expect(result.unpinned).toBe(2);
      expect(result.unpinnedBytes).toBe(3072);
      expect(result.orphanBytes).toBe(3072);
    });

    it("still unpins when a size cannot be read, and counts it as unknown", async () => {
      setupTwoOrphans();
      storage.pinnedBytes = jest.fn(async (cid) => {
        if (cid === "bafyOld") throw new Error("stat timed out");
        return 1024;
      });

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(result.aborted).toBe(false);
      expect(result.unpinned).toBe(2);
      expect(result.unpinnedBytes).toBe(1024);
      expect(result.sizeUnknown).toBe(1);
    });

    it("reports sizes in a dry run without unpinning", async () => {
      setupTwoOrphans();
      storage.pinnedBytes = jest.fn(async () => 100);

      const result = await gc({ dryRun: true });

      expect(result.orphanBytes).toBe(200);
      expect(result.unpinnedBytes).toBe(0);
      expect(storage.unpin).not.toHaveBeenCalled();
    });
  });

  describe("grace period", () => {
    const HOUR = 3600000;
    const T0 = 1_800_000_000_000;

    function setupOrphan() {
      putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
      pinned.add("bafyOrphan");
      chain[FREE]["1"] = { uri: "bafyLive" };
    }

    it("only marks a newly seen orphan on the first live run", async () => {
      setupOrphan();

      const result = await gc({ graceMs: 24 * HOUR, now: () => T0 });

      expect(result.orphans).toBe(1);
      expect(result.eligible).toBe(0);
      expect(result.unpinned).toBe(0);
      expect(pinned.has("bafyOrphan")).toBe(true);
    });

    it("unpins an orphan once it has stayed orphaned past the grace period", async () => {
      setupOrphan();
      await gc({ graceMs: 24 * HOUR, now: () => T0 });

      const early = await gc({ graceMs: 24 * HOUR, now: () => T0 + 23 * HOUR });
      expect(early.unpinned).toBe(0);

      const late = await gc({ graceMs: 24 * HOUR, now: () => T0 + 24 * HOUR });
      expect(late.eligible).toBe(1);
      expect(late.unpinned).toBe(1);
      expect(pinned.has("bafyOrphan")).toBe(false);
    });

    it("restarts the clock when an orphan becomes reachable in between (mint landed)", async () => {
      setupOrphan();
      await gc({ graceMs: 24 * HOUR, now: () => T0 });

      // The orphan gets minted, then burned again later.
      putManifest("bafyOrphan", { version: 1, scene: { nodes: [] } });
      chain[FREE]["2"] = { uri: "bafyOrphan" };
      await gc({ graceMs: 24 * HOUR, now: () => T0 + 12 * HOUR });
      chain[FREE]["2"].burned = true;

      const result = await gc({ graceMs: 24 * HOUR, now: () => T0 + 30 * HOUR });

      expect(result.orphans).toBe(1);
      expect(result.unpinned).toBe(0);
      expect(pinned.has("bafyOrphan")).toBe(true);
    });

    it("dry runs do not record marks", async () => {
      setupOrphan();
      await gc({ dryRun: true, graceMs: 24 * HOUR, now: () => T0 });
      expect(fs.existsSync(statePath)).toBe(false);

      // The live run 48h later is the first to see the orphan.
      const result = await gc({ graceMs: 24 * HOUR, now: () => T0 + 48 * HOUR });

      expect(result.unpinned).toBe(0);
    });

    it("aborted runs do not record marks", async () => {
      setupOrphan();
      failures[`${FREE}:ownerOf:1`] = "rpc";
      const aborted = await gc({ graceMs: 24 * HOUR, now: () => T0 });
      expect(aborted.aborted).toBe(true);
      expect(fs.existsSync(statePath)).toBe(false);
    });

    it("dry runs report orphans already past grace as eligible", async () => {
      setupOrphan();
      await gc({ graceMs: 24 * HOUR, now: () => T0 });

      const result = await gc({ dryRun: true, graceMs: 24 * HOUR, now: () => T0 + 25 * HOUR });

      expect(result.eligible).toBe(1);
      expect(storage.unpin).not.toHaveBeenCalled();
    });

    it("keeps marks separate per chain", async () => {
      setupOrphan();
      await gc({ chainId: 1, graceMs: 24 * HOUR, now: () => T0 });

      const other = await gc({ chainId: 2, graceMs: 24 * HOUR, now: () => T0 + 48 * HOUR });

      expect(other.unpinned).toBe(0);
    });

    it("keeps marks for eligible orphans left over by maxUnpin", async () => {
      setupOrphan();
      pinned.add("bafyOrphan2");
      await gc({ graceMs: 24 * HOUR, now: () => T0 });

      const first = await gc({ maxUnpin: 1, graceMs: 24 * HOUR, now: () => T0 + 24 * HOUR });
      expect(first.unpinned).toBe(1);

      const second = await gc({ graceMs: 24 * HOUR, now: () => T0 + 24 * HOUR });
      expect(second.unpinned).toBe(1);
      expect(pinned.size).toBe(1);
    });
  });
});
