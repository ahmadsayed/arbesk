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
        // Draft retention off unless a test is about drafts ("unpublished drafts").
        draftRetentionMs: 0,
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
      blobs.set("bafyBuf", "\u0000binary buffer");
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
        const head = storage.catHead.getMockImplementation();
        storage.catHead.mockImplementation(async (cid, length) => {
          if (cid === "bafySrc") throw new Error("gateway 502");
          return head(cid, length);
        });

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

  describe("references in any form", () => {
    /** A CID-shaped string, as the decomposers write them (bare, base32). */
    const cidOf = (tag) => `bafkrei${tag.toLowerCase().replace(/[^a-z2-7]/g, "")}`.padEnd(59, "q");
    const json = (value) => JSON.stringify(value);
    function pin(cid, body) {
      blobs.set(cid, body);
      pinned.add(cid);
      return cid;
    }
    const designCid = cidOf("design");
    const textureCid = cidOf("texture");
    const thumbCid = cidOf("thumb");
    const composite3mf = () =>
      json({
        arbesk_format: "composite-3mf",
        model: "<model/>",
        parts: {
          "Metadata/arbesk_cad.json": { cid: designCid, _arbesk: { hash: "ab12", compressed: false } },
          "3D/Textures/t.png": { cid: textureCid, _arbesk: { hash: "cd34" } },
        },
      });

    beforeEach(() => {
      storage.catHead = jest.fn(async (cid, length) => {
        if (!blobs.has(cid)) throw new Error(`gateway 403 for ${cid}`);
        return Buffer.from(blobs.get(cid), "utf-8").subarray(0, length);
      });
    });

    function assetWithSource(sourceCid) {
      putManifest("bafyLive", {
        version: 1,
        thumbnail: { cid: thumbCid },
        scene: { nodes: [{ node_id: "n", source: { cid: sourceCid, format: "3mf" } }] },
      });
      chain[FREE]["1"] = { uri: "bafyLive" };
    }

    it("keeps the parts a composite 3MF lists by bare CID, the CAD design included", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(designCid, json({ arbesk_cad: 1, code: "return box()" }));
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      assetWithSource(src);

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(result.unpinned).toBe(0);
      expect(pinned.has(designCid)).toBe(true);
      expect(pinned.has(textureCid)).toBe(true);
    });

    it("does not download images it follows in full", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(designCid, json({ arbesk_cad: 1 }));
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      assetWithSource(src);

      await gc();

      const fullReads = storage.catBytes.mock.calls.map(([cid]) => cid);
      expect(fullReads).not.toContain(textureCid);
      expect(fullReads).not.toContain(thumbCid);
    });

    it("ignores a source ref cache written before bare CIDs were followed", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(designCid, json({ arbesk_cad: 1 }));
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      assetWithSource(src);
      const refCachePath = path.join(path.dirname(statePath), "old-ref-cache.json");
      fs.writeFileSync(refCachePath, JSON.stringify({ [src]: [] }));

      const result = await gc({ refCachePath });

      expect(result.unpinned).toBe(0);
      expect(pinned.has(designCid)).toBe(true);
    });

    it("keeps the buffers of a composite listed directly as a collection entry (besk upload)", async () => {
      const bufCid = pin(cidOf("buffer"), "\u0000bin");
      const composite = pin(cidOf("gltf"), json({ asset: { version: "2.0" }, buffers: [{ uri: `ipfs://${bufCid}` }] }));
      putManifest("bafyCol", { version: 1, type: "collection", assets: { up: composite } });
      chain[FREE]["1"] = { uri: "bafyCol" };

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(pinned.has(bufCid)).toBe(true);
    });

    it("keeps a forked child's model when the parent's source is the child's manifest (besk link --fork)", async () => {
      const childSrc = pin(cidOf("childsrc"), "glTF\u0002binary");
      const childThumb = pin(cidOf("childthumb"), "RIFF webp");
      const childPrevSrc = pin(cidOf("childoldsrc"), "glTF\u0002binary");
      const childV1 = pin(cidOf("childone"), json({ version: 1, scene: { nodes: [{ node_id: "c", source: { cid: childPrevSrc } }] } }));
      const childV2 = pin(cidOf("childtwo"), json({
        version: 2,
        prev_asset_manifest_cid: childV1,
        thumbnail: { cid: childThumb },
        scene: { nodes: [{ node_id: "c", source: { cid: childSrc } }] },
      }));
      pin(thumbCid, "RIFF webp");
      assetWithSource(childV2);

      const result = await gc();

      expect(result.errors).toEqual([]);
      for (const cid of [childV2, childSrc, childThumb]) expect(pinned.has(cid)).toBe(true);
    });

    it("does not keep a forked child's older versions through the parent", async () => {
      const childPrevSrc = pin(cidOf("childoldsrc"), "glTF\u0002binary");
      const childV1 = pin(cidOf("childone"), json({ version: 1, scene: { nodes: [{ node_id: "c", source: { cid: childPrevSrc } }] } }));
      const childSrc = pin(cidOf("childsrc"), "glTF\u0002binary");
      const childV2 = pin(cidOf("childtwo"), json({ version: 2, prev_asset_manifest_cid: childV1, scene: { nodes: [{ node_id: "c", source: { cid: childSrc } }] } }));
      pin(thumbCid, "RIFF webp");
      assetWithSource(childV2);

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(pinned.has(childSrc)).toBe(true);
      expect(pinned.has(childV1)).toBe(false);
      expect(pinned.has(childPrevSrc)).toBe(false);
    });

    it("does not fail on a referenced file that is no longer pinned anywhere", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      // designCid was never pinned on this account: unreadable, and not ours.
      assetWithSource(src);

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(result.aborted).toBe(false);
    });

    it("aborts when a pinned document it follows cannot be read", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pinned.add(designCid); // pinned, but every read fails
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      pinned.add(cidOf("orphan"));
      assetWithSource(src);

      const result = await gc();

      expect(result.aborted).toBe(true);
      expect(storage.unpin).not.toHaveBeenCalled();
    });

    // A: a flaky peek must not stop all unpinning.
    it("downloads a followed file whose first bytes could not be peeked", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(designCid, json({ arbesk_cad: 1 }));
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      pinned.add(cidOf("orphan"));
      assetWithSource(src);
      const head = storage.catHead.getMockImplementation();
      storage.catHead.mockImplementation(async (cid, length) => {
        if (cid === designCid) throw new Error("gateway 429");
        return head(cid, length);
      });

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(result.aborted).toBe(false);
      expect(pinned.has(designCid)).toBe(true);
    });

    // B: leaf files are peeked once, not every night and not once per token.
    it("remembers files that are not JSON across runs", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(designCid, json({ arbesk_cad: 1 }));
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      assetWithSource(src);
      await gc();
      storage.catHead.mockClear();

      await gc();

      expect(storage.catHead.mock.calls.map(([cid]) => cid)).not.toContain(textureCid);
    });

    it("peeks a file shared by two tokens once per run", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(designCid, json({ arbesk_cad: 1 }));
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      assetWithSource(src);
      chain[FREE]["2"] = { uri: "bafyLive" };

      await gc();

      expect(storage.catHead.mock.calls.filter(([cid]) => cid === textureCid).length).toBeLessThanOrEqual(1);
    });

    // C: a node source keeps its strict "unreadable = error" rule, however it was reached first.
    it("aborts on an unreadable old node source even when a newer version names it in another field", async () => {
      const bufCid = pin(cidOf("buffer"), "\u0000bin");
      const oldSrc = cidOf("oldsource"); // its pin was lost: unreadable, not listed
      const v1 = pin(cidOf("vone"), json({ version: 1, scene: { nodes: [{ node_id: "n", source: { cid: oldSrc } }] } }));
      const newSrc = pin(cidOf("newsource"), "glTF\u0002binary");
      const rep = pin(cidOf("rep"), "solid stl");
      const v2 = pin(cidOf("vtwo"), json({
        version: 2,
        prev_asset_manifest_cid: v1,
        representations: [{ cid: rep, derived_from: { ref: "primary", cid: oldSrc } }],
        scene: { nodes: [{ node_id: "n", source: { cid: newSrc } }] },
      }));
      chain[FREE]["1"] = { uri: v2 };

      const result = await gc();

      expect(result.aborted).toBe(true);
      expect(pinned.has(bufCid)).toBe(true);
    });

    // E: a CID pasted into free text keeps nothing.
    it("does not follow a CID mentioned inside free text", async () => {
      const deleted = pin(cidOf("deletedasset"), json({ version: 1, scene: { nodes: [] } }));
      putManifest("bafyLive", {
        version: 1,
        metadata: { chat: [{ prompt: `make it like ${deleted} but red` }] },
        scene: { nodes: [] },
      });
      chain[FREE]["1"] = { uri: "bafyLive" };

      await gc();

      expect(pinned.has(deleted)).toBe(false);
    });

    // E/F: leaf fields are kept without being opened.
    it("keeps the comments archive and a bundle directory without opening them", async () => {
      const archive = pin(cidOf("comments"), json({ events: [{ content: "nice" }] }));
      const bundle = cidOf("bundledir");
      pinned.add(bundle); // a UnixFS directory: cat fails on it
      putManifest("bafyLive", {
        version: 1,
        comments_archive_cid: archive,
        scene: { nodes: [{ node_id: "n", source: { cid: cidOf("glb"), bundleCid: bundle } }] },
      });
      pin(cidOf("glb"), "glTF\u0002binary");
      chain[FREE]["1"] = { uri: "bafyLive" };
      delete storage.catHead; // the Kubo backend has none

      const result = await gc();

      expect(result.errors).toEqual([]);
      expect(pinned.has(archive)).toBe(true);
      expect(pinned.has(bundle)).toBe(true);
      const opened = storage.catBytes.mock.calls.map(([cid]) => cid);
      expect(opened).not.toContain(archive);
      expect(opened).not.toContain(bundle);
    });

    it("still reclaims a deleted asset's 3MF parts", async () => {
      const src = pin(cidOf("composite"), composite3mf());
      pin(designCid, json({ arbesk_cad: 1 }));
      pin(textureCid, "\u0089PNG binary");
      pin(thumbCid, "RIFF webp");
      const gone = pin(cidOf("goneasset"), json({ version: 1, thumbnail: { cid: thumbCid }, scene: { nodes: [{ node_id: "n", source: { cid: src } }] } }));
      const kept = pin(cidOf("keptasset"), json({ version: 1, scene: { nodes: [] } }));
      const col1 = pin(cidOf("colone"), json({ version: 1, type: "collection", assets: { gone, kept } }));
      const col2 = pin(cidOf("coltwo"), json({ version: 2, type: "collection", assets: { kept }, prev_asset_manifest_cid: col1 }));
      chain[FREE]["1"] = { uri: col2 };

      const result = await gc();

      expect(result.errors).toEqual([]);
      for (const cid of [gone, src, designCid, textureCid, thumbCid]) expect(pinned.has(cid)).toBe(false);
      for (const cid of [col2, col1, kept]) expect(pinned.has(cid)).toBe(true);
    });
  });

  describe("unpublished drafts", () => {
    const DAY = 24 * 3600000;
    const RETENTION = 90 * DAY;
    const T0 = Date.UTC(2026, 10, 13);
    const cidOf = (tag) => `bafkrei${tag.toLowerCase().replace(/[^a-z2-7]/g, "")}`.padEnd(59, "q");
    const json = (value) => JSON.stringify(value);
    function pin(cid, body) {
      blobs.set(cid, body);
      pinned.add(cid);
      return cid;
    }
    const at = (t, opts = {}) => gc({ now: () => t, draftRetentionMs: RETENTION, ...opts });

    beforeEach(() => {
      storage.catHead = jest.fn(async (cid, length) => {
        if (!blobs.has(cid)) throw new Error(`gateway 403 for ${cid}`);
        return Buffer.from(blobs.get(cid), "utf-8").subarray(0, length);
      });
      // One live token, so the run has something to walk.
      putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
      chain[FREE]["1"] = { uri: "bafyLive" };
    });

    /** A never-published CAD asset: generation v1, then a Save-draft v2. */
    function cadDraft(tag) {
      const raw = pin(cidOf(`${tag}raw`), "PK\u0003\u0004zip");
      const v1 = pin(cidOf(`${tag}vone`), json({ asset_id: `asset_${tag}`, version: 1, scene: { nodes: [{ node_id: "n", source: { cid: raw, format: "3mf" } }] } }));
      const design = pin(cidOf(`${tag}design`), json({ arbesk_cad: 1, code: "return box()" }));
      const composite = pin(cidOf(`${tag}composite`), json({ arbesk_format: "composite-3mf", parts: { "Metadata/arbesk_cad.json": { cid: design } } }));
      const v2 = pin(cidOf(`${tag}vtwo`), json({ asset_id: `asset_${tag}`, version: 2, prev_asset_manifest_cid: v1, scene: { nodes: [{ node_id: "n", source: { cid: composite, format: "3mf" } }] } }));
      return { raw, v1, design, composite, v2, all: [raw, v1, design, composite, v2] };
    }

    it("keeps an unpublished draft and everything it references", async () => {
      const draft = cadDraft("xwing");

      const result = await at(T0);

      expect(result.errors).toEqual([]);
      expect(result.drafts).toBe(1);
      for (const cid of draft.all) expect(pinned.has(cid)).toBe(true);
    });

    it("keeps both branches of a forked draft", async () => {
      const draft = cadDraft("guard");
      const regen = pin(cidOf("guardregen"), json({ asset_id: "asset_guard", version: 2, prev_asset_manifest_cid: draft.v1, scene: { nodes: [] } }));

      const result = await at(T0);

      expect(result.drafts).toBe(2);
      for (const cid of [...draft.all, regen]) expect(pinned.has(cid)).toBe(true);
    });

    it("keeps a draft for the retention period, then reclaims it", async () => {
      const draft = cadDraft("coaster");

      await at(T0);
      await at(T0 + 60 * DAY); // still kept: its clock must not restart
      for (const cid of draft.all) expect(pinned.has(cid)).toBe(true);

      const expired = await at(T0 + RETENTION + DAY);

      expect(expired.drafts).toBe(0);
      for (const cid of draft.all) expect(pinned.has(cid)).toBe(false);
    });

    it("gives a newer save of the draft its own clock", async () => {
      const draft = cadDraft("filter");
      await at(T0);
      const v3 = pin(cidOf("filtervthree"), json({ asset_id: "asset_filter", version: 3, prev_asset_manifest_cid: draft.v2, scene: { nodes: [] } }));

      await at(T0 + 60 * DAY);
      const result = await at(T0 + RETENTION + DAY);

      expect(result.errors).toEqual([]);
      for (const cid of [...draft.all, v3]) expect(pinned.has(cid)).toBe(true);
    });

    it("forgets a draft once it is published", async () => {
      const draft = cadDraft("stand");
      await at(T0);
      putManifest("bafyCol", { version: 1, type: "collection", assets: { stand: draft.v2 } });
      chain[FREE]["2"] = { uri: "bafyCol" };

      const result = await at(T0 + DAY);

      expect(result.drafts).toBe(0);
      for (const cid of draft.all) expect(pinned.has(cid)).toBe(true);
    });

    it("does not count staged uploads without a manifest as drafts", async () => {
      const rawUpload = pin(cidOf("chavflaraw"), "PK\u0003\u0004zip");
      const staged = pin(cidOf("chavflacomposite"), json({ arbesk_format: "composite-3mf", parts: { "3D/x.model": { cid: cidOf("chavflamodel") } } }));
      pin(cidOf("chavflamodel"), "<model/>");

      const result = await at(T0);

      expect(result.drafts).toBe(0);
      for (const cid of [rawUpload, staged]) expect(pinned.has(cid)).toBe(false);
    });

    it("keeps a draft whose source is no longer pinned anywhere, without failing", async () => {
      const v1 = pin(cidOf("brokenvone"), json({ asset_id: "asset_broken", version: 1, scene: { nodes: [{ node_id: "n", source: { cid: cidOf("lostsource") } }] } }));

      const result = await at(T0);

      expect(result.errors).toEqual([]);
      expect(result.aborted).toBe(false);
      expect(pinned.has(v1)).toBe(true);
    });

    it("dry runs do not start a draft's clock", async () => {
      const draft = cadDraft("servo");
      await at(T0, { dryRun: true });

      const result = await at(T0 + RETENTION + DAY);

      expect(result.drafts).toBe(1);
      for (const cid of draft.all) expect(pinned.has(cid)).toBe(true);
    });

    // Review 1: an earlier version already gone must not stop the GC.
    it("keeps a draft whose earlier version is no longer pinned, without failing", async () => {
      const v2 = pin(cidOf("lonelyvtwo"), json({ asset_id: "asset_lonely", version: 2, prev_asset_manifest_cid: cidOf("lonelyvonegone"), scene: { nodes: [] } }));

      const first = await at(T0);
      const later = await at(T0 + RETENTION + DAY);

      expect(first.errors).toEqual([]);
      expect(first.aborted).toBe(false);
      expect(first.drafts).toBe(1);
      expect(later.drafts).toBe(0); // its clock was recorded, so it expires
      expect(pinned.has(v2)).toBe(false);
    });

    // Review 2: a run that aborts for another reason still starts draft clocks.
    it("records draft clocks even when the run aborts", async () => {
      const draft = cadDraft("servo");
      putManifest("bafyLive", { version: 1, scene: { nodes: [] } });
      failures[`${FREE}:ownerOf:1`] = "rpc";
      const aborted = await at(T0);
      delete failures[`${FREE}:ownerOf:1`];

      const later = await at(T0 + RETENTION + DAY);

      expect(aborted.aborted).toBe(true);
      expect(later.drafts).toBe(0);
      for (const cid of draft.all) expect(pinned.has(cid)).toBe(false);
    });

    // Review 3: a long draft is read in linear, not quadratic, time.
    it("reads each manifest of a long draft about once per run", async () => {
      let prev = null;
      for (let v = 1; v <= 30; v++) {
        prev = pin(cidOf(`longv${"abcdefghijklmnopqrstuvwxyz234567"[v]}x${v > 26 ? "z" : ""}`), json({ asset_id: "asset_long", version: v, prev_asset_manifest_cid: prev, scene: { nodes: [] } }));
      }
      storage.catBytes.mockClear();

      await at(T0);

      expect(storage.catBytes.mock.calls.length).toBeLessThanOrEqual(2 * 30 + 5);
    });

    // Review 4: unreferenced files are classified once, ever.
    it("does not re-check unreferenced files it has already classified", async () => {
      const staged = pin(cidOf("stagedcomposite"), json({ arbesk_format: "composite-3mf", parts: {} }));
      await at(T0, { graceMs: 30 * DAY });
      storage.catHead.mockClear();
      storage.catBytes.mockClear();

      await at(T0 + DAY, { graceMs: 30 * DAY });

      expect(storage.catHead.mock.calls.map(([cid]) => cid)).not.toContain(staged);
      expect(storage.catBytes.mock.calls.map(([cid]) => cid)).not.toContain(staged);
    });

    // Review 4: an unreadable unreferenced file must not block the GC; it only
    // narrows that run to files older than the draft retention.
    it("does not fail on an unreadable unreferenced file, and spares anything that could be a draft", async () => {
      const unreadable = cidOf("unreadable");
      pinned.add(unreadable); // pinned, every read fails
      const old = pin(cidOf("oldjunk"), "\u0000bin");
      await at(T0, { graceMs: 0 }); // marks both
      const fresh = pin(cidOf("freshjunk"), "\u0000bin");

      const result = await at(T0 + RETENTION + DAY, { graceMs: 0 });

      expect(result.aborted).toBe(false);
      expect(pinned.has(old)).toBe(false); // older than the retention: safe to reclaim
      expect(pinned.has(unreadable)).toBe(false);
      expect(pinned.has(fresh)).toBe(true); // could belong to the unreadable draft
    });
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
