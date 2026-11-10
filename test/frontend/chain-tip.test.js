import { describe, expect, it } from "bun:test";
import { resolveChainTip } from "../../frontend/src/js/services/asset-save/chain-tip.ts";

/** deps over an in-memory chain: cid → manifest. */
function depsFor(chain, entry) {
  const reads = [];
  return {
    reads,
    readEntryCid: async () => (entry instanceof Error ? Promise.reject(entry) : entry),
    readManifest: async (cid) => {
      reads.push(cid);
      if (!(cid in chain)) throw new Error("missing " + cid);
      return chain[cid];
    },
  };
}

const CHAIN = {
  v1: { version: 1 },
  v2: { version: 2, prev_asset_manifest_cid: "v1" },
  v3: { version: 3, prev_asset_manifest_cid: "v2" },
  fork3: { version: 3, prev_asset_manifest_cid: "v2" },
};

describe("resolveChainTip", () => {
  it("takes an entry that descends from the known tip", async () => {
    expect(await resolveChainTip("v1", depsFor(CHAIN, "v3"))).toBe("v3");
  });

  it("keeps the known tip when the entry is the same", async () => {
    const deps = depsFor(CHAIN, "v2");
    expect(await resolveChainTip("v2", deps)).toBe("v2");
    expect(deps.reads).toEqual([]);
  });

  it("keeps the known tip when the entry is older (a draft follows it), reading only the two ends", async () => {
    const deps = depsFor(CHAIN, "v1");
    expect(await resolveChainTip("v3", deps)).toBe("v3");
    expect(deps.reads).toEqual(["v3", "v1"]);
  });

  it("keeps the known tip when the entry is on another branch", async () => {
    expect(await resolveChainTip("v3", depsFor(CHAIN, "fork3"))).toBe("v3");
  });

  it("keeps the known tip when the entry or a manifest cannot be read", async () => {
    expect(await resolveChainTip("v1", depsFor(CHAIN, new Error("rpc down")))).toBe("v1");
    expect(await resolveChainTip("v1", depsFor({ v1: CHAIN.v1 }, "v3"))).toBe("v1");
  });

  it("keeps the known tip when there is no entry, and takes the entry when there is no known tip", async () => {
    expect(await resolveChainTip("v1", depsFor(CHAIN, null))).toBe("v1");
    expect(await resolveChainTip(null, depsFor(CHAIN, "v2"))).toBe("v2");
  });
});
