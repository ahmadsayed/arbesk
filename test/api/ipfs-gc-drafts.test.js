import { afterEach, describe, expect, it } from "bun:test";
import { isAssetManifest, resolveDraftRetentionMs, trackDrafts } from "../../src/api/ipfs-gc-drafts.ts";

const DAY = 24 * 3600000;

describe("isAssetManifest", () => {
  it("accepts an asset manifest, including a CAD generation v1", () => {
    expect(isAssetManifest({ asset_id: "a", version: 1, scene: { nodes: [] } })).toBe(true);
    expect(isAssetManifest({ type: "asset", scene: { nodes: [{ node_id: "n" }] } })).toBe(true);
  });

  it("rejects look-alikes that are not drafts", () => {
    expect(isAssetManifest({ type: "collection", scene: { nodes: [] }, assets: {} })).toBe(false);
    expect(isAssetManifest({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }] })).toBe(false); // composite glTF
    expect(isAssetManifest({ arbesk_format: "composite-3mf", parts: {} })).toBe(false);
    expect(isAssetManifest({ arbesk_cad: 1, code: "" })).toBe(false);
    expect(isAssetManifest(null)).toBe(false);
    expect(isAssetManifest([1])).toBe(false);
  });
});

describe("trackDrafts", () => {
  const T0 = 1_000 * DAY;

  it("keeps a clock from the first run and reports one tip per branch", () => {
    const roots = [
      { cid: "v1", prev: null },
      { cid: "v2", prev: "v1" },
      { cid: "v2b", prev: "v1" },
    ];
    const { draftSince, kept, tips } = trackDrafts(roots, { v1: T0 - 10 * DAY }, T0, 90 * DAY);

    expect(draftSince).toEqual({ v1: T0 - 10 * DAY, v2: T0, v2b: T0 });
    expect(kept.sort()).toEqual(["v1", "v2", "v2b"]);
    expect(tips.sort()).toEqual(["v2", "v2b"]);
  });

  it("drops expired roots and forgets roots that are gone", () => {
    const { draftSince, kept } = trackDrafts([{ cid: "old", prev: null }], { old: T0 - 91 * DAY, published: T0 }, T0, 90 * DAY);

    expect(kept).toEqual([]);
    expect(draftSince).toEqual({ old: T0 - 91 * DAY });
  });
});

describe("resolveDraftRetentionMs", () => {
  const saved = process.env.IPFS_GC_DRAFT_RETENTION_DAYS;
  afterEach(() => {
    if (saved === undefined) delete process.env.IPFS_GC_DRAFT_RETENTION_DAYS;
    else process.env.IPFS_GC_DRAFT_RETENTION_DAYS = saved;
  });

  it("defaults to 90 days, reads the env, and lets 0 turn drafts off", () => {
    delete process.env.IPFS_GC_DRAFT_RETENTION_DAYS;
    expect(resolveDraftRetentionMs(undefined)).toBe(90 * DAY);
    process.env.IPFS_GC_DRAFT_RETENTION_DAYS = "30";
    expect(resolveDraftRetentionMs(undefined)).toBe(30 * DAY);
    process.env.IPFS_GC_DRAFT_RETENTION_DAYS = "0";
    expect(resolveDraftRetentionMs(undefined)).toBe(0);
    process.env.IPFS_GC_DRAFT_RETENTION_DAYS = "";
    expect(resolveDraftRetentionMs(undefined)).toBe(90 * DAY); // a blank .env line is unset
    process.env.IPFS_GC_DRAFT_RETENTION_DAYS = "  ";
    expect(resolveDraftRetentionMs(undefined)).toBe(90 * DAY);
    process.env.IPFS_GC_DRAFT_RETENTION_DAYS = "nonsense";
    expect(resolveDraftRetentionMs(undefined)).toBe(90 * DAY);
    expect(resolveDraftRetentionMs(5)).toBe(5);
  });
});
