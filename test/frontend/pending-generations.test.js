/**
 * Pending-generation store tests.
 */

import { expect, test, beforeEach } from "@jest/globals";
import {
  addPendingGeneration,
  getPendingGeneration,
  updatePendingGeneration,
  listPendingGenerations,
  _resetPendingGenerations,
} from "../../frontend/src/js/state/pending-generations.js";

beforeEach(() => {
  _resetPendingGenerations();
});

test("add assigns sequential ids and pending status", () => {
  const a = addPendingGeneration({
    assetManifestCid: "cid-a",
    sourceAssetCid: "src-a",
    prompt: "a chair",
    prevAssetManifestCid: null,
  });
  const b = addPendingGeneration({
    assetManifestCid: "cid-b",
    sourceAssetCid: "src-b",
    prompt: "a table",
    prevAssetManifestCid: null,
  });
  expect(a).toBe("gen_1");
  expect(b).toBe("gen_2");
  expect(getPendingGeneration(a).status).toBe("pending");
  expect(getPendingGeneration(b).prompt).toBe("a table");
});

test("get returns null for unknown ids", () => {
  expect(getPendingGeneration("gen_999")).toBeNull();
});

test("update patches a record in place and ignores unknown ids", () => {
  const id = addPendingGeneration({
    assetManifestCid: "cid",
    sourceAssetCid: "src",
    prompt: "p",
    prevAssetManifestCid: null,
  });
  updatePendingGeneration(id, { status: "sent" });
  expect(getPendingGeneration(id).status).toBe("sent");
  updatePendingGeneration("gen_999", { status: "sent" }); // no throw
});

test("list returns records in insertion order", () => {
  addPendingGeneration({ assetManifestCid: "1", sourceAssetCid: "1", prompt: "one", prevAssetManifestCid: null });
  addPendingGeneration({ assetManifestCid: "2", sourceAssetCid: "2", prompt: "two", prevAssetManifestCid: null });
  expect(listPendingGenerations().map((r) => r.prompt)).toEqual(["one", "two"]);
});

test("reset clears records and id sequence", () => {
  addPendingGeneration({ assetManifestCid: "1", sourceAssetCid: "1", prompt: "one", prevAssetManifestCid: null });
  _resetPendingGenerations();
  expect(listPendingGenerations()).toEqual([]);
  expect(addPendingGeneration({ assetManifestCid: "2", sourceAssetCid: "2", prompt: "two", prevAssetManifestCid: null })).toBe("gen_1");
});
