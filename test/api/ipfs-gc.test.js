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

const fakeClient = {
  getBlockNumber: jest.fn(async () => 10n),
  getLogs: jest.fn(async ({ address }) =>
    Object.keys(chain[address] || {}).map((id) => ({ args: { tokenId: BigInt(id) } })),
  ),
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
      listPinned: jest.fn(async () => Array.from(pinned)),
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
