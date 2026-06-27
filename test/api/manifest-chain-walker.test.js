import { jest } from "@jest/globals";
import zlib from "zlib";

jest.setTimeout(30000);

describe("walkManifestChain", () => {
  let walkManifestChain;
  let ipfsStorage;
  let mockIPFS;
  let _resetStorage;

  beforeAll(async () => {
    // Suppress production logs during focused unit tests.
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    ipfsStorage = new Map();
    mockIPFS = {
      cat: jest.fn(async function* (cid) {
        const stored = ipfsStorage.get(cid);
        if (!stored) {
          const err = new Error(`missing block for ${cid}`);
          throw err;
        }
        if (stored instanceof Uint8Array || Buffer.isBuffer(stored)) {
          yield stored;
        } else {
          const chars = stored.split("").map((c) => c.charCodeAt(0));
          yield new Uint16Array(chars);
        }
      }),
      pin: {
        add: jest.fn(async () => {}),
        rm: jest.fn(async () => {}),
        ls: jest.fn(async function* () {
          for (const cid of ipfsStorage.keys()) {
            yield { cid: { toString: () => cid, toJSON: () => cid } };
          }
        }),
      },
    };

    jest.unstable_mockModule("ipfs-http-client", () => ({
      create: jest.fn(() => mockIPFS),
    }));

    process.env.IPFS_BACKEND = "kubo";

    const walkerMod = await import("../../src/api/manifest-chain-walker.js");
    walkManifestChain = walkerMod.walkManifestChain;

    const storageMod = await import("../../src/api/storage/index.js");
    _resetStorage = storageMod._resetStorage;

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
    };
  });

  beforeEach(() => {
    _resetStorage();
    ipfsStorage.clear();
    jest.clearAllMocks();
  });

  let _seq = 0;
  function putManifest(manifest, { compress = false } = {}) {
    _seq++;
    const cid = `QmTest${String(_seq).padStart(4, "0")}`;
    const payload = JSON.stringify(manifest);
    ipfsStorage.set(
      cid,
      compress ? zlib.gzipSync(Buffer.from(payload, "utf-8")) : payload,
    );
    return cid;
  }

  it("classifies a single asset manifest CID as assetUnique", async () => {
    const cid = putManifest({
      version: 1,
      prev_asset_manifest_cid: null,
      scene: { nodes: [] },
    });

    const { visited, assetUnique, shared, allReachable, errors } =
      await walkManifestChain(cid);

    expect(errors).toHaveLength(0);
    expect(Array.from(visited)).toEqual([cid]);
    expect(Array.from(assetUnique)).toEqual([cid]);
    expect(Array.from(shared)).toHaveLength(0);
    expect(Array.from(allReachable)).toEqual([cid]);
  });

  it("walks prev_asset_manifest_cid chain and marks every manifest assetUnique", async () => {
    const v1 = putManifest({ version: 1, prev_asset_manifest_cid: null, scene: {} });
    const v2 = putManifest({ version: 2, prev_asset_manifest_cid: v1, scene: {} });
    const v3 = putManifest({ version: 3, prev_asset_manifest_cid: v2, scene: {} });

    const { visited, assetUnique } = await walkManifestChain(v3);

    expect(Array.from(visited)).toEqual([v3, v2, v1]);
    expect(Array.from(assetUnique)).toEqual([v3, v2, v1]);
  });

  it("marks source.cid and source.bundleCid as shared", async () => {
    const cid = putManifest({
      version: 1,
      scene: {
        nodes: [
          {
            node_id: "n1",
            source: { cid: "QmSource", bundleCid: "QmBundle" },
          },
        ],
      },
    });

    const { assetUnique, shared, allReachable } = await walkManifestChain(cid);

    expect(Array.from(assetUnique)).toEqual([cid]);
    expect(Array.from(shared).sort()).toEqual(["QmBundle", "QmSource"]);
    expect(Array.from(allReachable).sort()).toEqual(["QmBundle", "QmSource", cid]);
  });

  it("marks history src.cid and src.bundleCid as shared", async () => {
    const cid = putManifest({
      version: 1,
      scene: {
        nodes: [
          {
            node_id: "n1",
            history: [
              { src: { cid: "QmHistSource", bundleCid: "QmHistBundle" } },
            ],
          },
        ],
      },
    });

    const { shared } = await walkManifestChain(cid);

    expect(Array.from(shared).sort()).toEqual(["QmHistBundle", "QmHistSource"]);
  });

  it("collects thumbnail.cid and comments_archive_cid as assetUnique", async () => {
    const cid = putManifest({
      version: 1,
      thumbnail: { cid: "QmThumb" },
      comments_archive_cid: "QmComments",
      scene: { nodes: [] },
    });

    const { assetUnique, shared } = await walkManifestChain(cid);

    expect(Array.from(assetUnique).sort()).toEqual(
      [cid, "QmComments", "QmThumb"].sort(),
    );
    expect(Array.from(shared)).toHaveLength(0);
  });

  it("treats collection asset CIDs as shared by default", async () => {
    const assetCid = putManifest({ version: 1, type: "asset", scene: { nodes: [] } });
    const collectionCid = putManifest({
      version: 1,
      type: "collection",
      assets: { a1: assetCid },
    });

    const { assetUnique, shared, visited } = await walkManifestChain(collectionCid);

    expect(Array.from(visited)).toEqual([collectionCid]);
    expect(Array.from(assetUnique)).toEqual([collectionCid]);
    expect(Array.from(shared)).toEqual([assetCid]);
  });

  it("recurses into collection assets when recurseIntoCollectionAssets is true", async () => {
    const assetCid = putManifest({
      version: 1,
      type: "asset",
      scene: { nodes: [{ node_id: "n", source: { cid: "QmSource" } }] },
    });
    const collectionCid = putManifest({
      version: 1,
      type: "collection",
      assets: { a1: assetCid },
    });

    const { visited, assetUnique, shared } = await walkManifestChain(
      collectionCid,
      { recurseIntoCollectionAssets: true },
    );

    expect(Array.from(visited)).toEqual([collectionCid, assetCid]);
    expect(Array.from(assetUnique)).toEqual([collectionCid, assetCid]);
    expect(Array.from(shared)).toEqual(["QmSource"]);
  });

  it("recurses into source JSON and collects embedded buffer/image CIDs when recurseIntoSources is true", async () => {
    ipfsStorage.set(
      "QmSource",
      JSON.stringify({
        buffers: [{ uri: "ipfs://QmBuffer" }],
        images: [{ uri: "ipfs://QmImage" }],
      }),
    );
    const cid = putManifest({
      version: 1,
      scene: {
        nodes: [{ node_id: "n", source: { cid: "QmSource" } }],
      },
    });

    const { shared, allReachable } = await walkManifestChain(cid, {
      recurseIntoSources: true,
    });

    // Embedded buffer/image CIDs are reachable but not classified as shared.
    expect(Array.from(shared)).toEqual(["QmSource"]);
    expect(allReachable.has("QmSource")).toBe(true);
    expect(allReachable.has("QmBuffer")).toBe(true);
    expect(allReachable.has("QmImage")).toBe(true);
  });

  it("stops at shared source CIDs without recursing when recurseIntoSources is false", async () => {
    ipfsStorage.set(
      "QmSource",
      JSON.stringify({ buffers: [{ uri: "ipfs://QmBuffer" }] }),
    );
    const cid = putManifest({
      version: 1,
      scene: { nodes: [{ node_id: "n", source: { cid: "QmSource" } }] },
    });

    const { shared, allReachable } = await walkManifestChain(cid);

    expect(Array.from(shared)).toEqual(["QmSource"]);
    expect(allReachable.has("QmBuffer")).toBe(false);
  });

  it("handles gzip-compressed manifests", async () => {
    const prevCid = putManifest(
      { version: 1, prev_asset_manifest_cid: null, scene: {} },
      { compress: true },
    );
    const cid = putManifest(
      { version: 2, prev_asset_manifest_cid: prevCid, scene: {} },
      { compress: true },
    );

    const { visited, assetUnique } = await walkManifestChain(cid);

    expect(Array.from(visited)).toEqual([cid, prevCid]);
    expect(Array.from(assetUnique)).toEqual([cid, prevCid]);
  });

  it("breaks cycles in prev_asset_manifest_cid", async () => {
    const a = putManifest({ version: 1, prev_asset_manifest_cid: null, scene: {} });
    const b = putManifest({ version: 2, prev_asset_manifest_cid: a, scene: {} });
    // Create a cycle: a now points back to b.
    ipfsStorage.set(a, JSON.stringify({ version: 1, prev_asset_manifest_cid: b, scene: {} }));

    const { visited } = await walkManifestChain(b);

    // Should terminate without infinite loop.
    expect(visited.size).toBe(2);
    expect(visited.has(a)).toBe(true);
    expect(visited.has(b)).toBe(true);
  });

  it("stops walking after maxDepth manifests", async () => {
    const cids = [];
    let prev = null;
    for (let i = 0; i < 5; i++) {
      const cid = putManifest({ version: i + 1, prev_asset_manifest_cid: prev, scene: {} });
      cids.push(cid);
      prev = cid;
    }

    const { visited } = await walkManifestChain(cids[cids.length - 1], {
      maxDepth: 3,
    });

    expect(visited.size).toBe(3);
  });

  it("records an error and stops when the start CID is missing", async () => {
    const { visited, assetUnique, errors } = await walkManifestChain("QmMissing");

    // The start CID is added to visited before the read is attempted.
    expect(Array.from(visited)).toEqual(["QmMissing"]);
    expect(assetUnique.size).toBe(0);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/QmMissing/);
  });

  it("records an error when a chain link is missing", async () => {
    const cid = putManifest({
      version: 1,
      prev_asset_manifest_cid: "QmMissingPrev",
      scene: {},
    });

    const { visited, errors } = await walkManifestChain(cid);

    // Both the current and the missing prev CID appear in visited.
    expect(Array.from(visited)).toEqual([cid, "QmMissingPrev"]);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/QmMissingPrev/);
  });

  it("records an error for invalid JSON but continues when possible", async () => {
    const badCid = "QmBadJson";
    ipfsStorage.set(badCid, "not json");
    const cid = putManifest({
      version: 1,
      prev_asset_manifest_cid: badCid,
      scene: {},
    });

    const { visited, errors } = await walkManifestChain(cid);

    // The unreadable prev CID is still recorded as visited.
    expect(Array.from(visited)).toEqual([cid, badCid]);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("does not duplicate CIDs across assetUnique and shared", async () => {
    const cid = putManifest({
      version: 1,
      scene: {
        nodes: [
          { node_id: "n1", source: { cid: "QmSource" } },
          { node_id: "n2", source: { cid: "QmSource" } },
        ],
      },
    });

    const { assetUnique, shared, allReachable } = await walkManifestChain(cid);

    expect(Array.from(assetUnique)).toEqual([cid]);
    expect(Array.from(shared)).toEqual(["QmSource"]);
    expect(Array.from(allReachable).sort()).toEqual(["QmSource", cid]);
  });

  it("ignores non-string source/history CIDs gracefully", async () => {
    const cid = putManifest({
      version: 1,
      scene: {
        nodes: [
          {
            node_id: "n",
            source: { cid: 123, bundleCid: null },
            history: [{ src: { cid: true, bundleCid: undefined } }],
          },
        ],
      },
    });

    const { shared } = await walkManifestChain(cid);

    expect(Array.from(shared)).toHaveLength(0);
  });
});
