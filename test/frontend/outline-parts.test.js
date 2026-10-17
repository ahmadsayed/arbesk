// @test-env dom
/**
 * Outline part listing (ui/outline-parts.ts + ui/outliner.ts): a loaded
 * multi-mesh model — a mock sample or a Tripo split result — lists its parts
 * under its row; tiny fragments fold into a "small pieces" group; clicking a
 * part asks the engine to select it (OUTLINER_PART_SELECTED).
 */
import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";

mock.module("../../frontend/src/js/ui/sidebar.js", () => ({ switchView: () => {} }));
mock.module("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({ getFromRemoteIPFS: async () => null }));

let parts, outliner, state, bus, asset;

beforeAll(async () => {
  // The test DOM has no CSS.escape; the Outline's row lookup uses it.
  globalThis.CSS ??= { escape: (v) => String(v).replace(/["\\]/g, "\\$&") };
  document.body.innerHTML = '<div class="outliner-tree"></div><div class="outliner-footer"></div>';
  parts = await import("../../frontend/src/js/ui/outline-parts.js");
  outliner = await import("../../frontend/src/js/ui/outliner.js");
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
  bus = await import("@arbesk/asset-core/events/bus.js");
  asset = await import("@arbesk/asset-core/domain/asset.js");
  outliner.initOutliner();
});

/** A stand-in Babylon mesh. */
const mesh = (name, vertices) => ({ name, getTotalVertices: () => vertices, isDisposed: () => false });

/** The split goat: big parts, two horns, and tiny connectivity slivers. */
const GOAT_MESHES = [
  mesh("__root__", 0),
  mesh("tripo_part_0", 3600),
  mesh("tripo_part_1", 1300),
  mesh("tripo_part_9", 200),
  mesh("tripo_part_14", 199),
  mesh("tripo_part_30", 10),
  mesh("tripo_part_31", 9),
];

beforeEach(() => {
  state.nodeMeshes.clear();
  state.highlightedNodeId = null;
  state.highlightedSubMeshName = null;
});

afterEach(() => {
  bus.emit(bus.EVENTS.SCENE_CLEARED, {});
});

test("partLabel names Tripo parts and drops primitive suffixes", () => {
  expect(parts.partLabel("tripo_part_9")).toBe("Part 9");
  expect(parts.partLabel("tripo_part_9_primitive0")).toBe("Part 9");
  expect(parts.partLabel("hat")).toBe("hat");
});

test("listNodeParts sorts by size and splits off tiny fragments", () => {
  state.nodeMeshes.set("goat", GOAT_MESHES);
  const listed = parts.listNodeParts("goat");
  expect(listed.main.map((p) => p.label)).toEqual(["Part 0", "Part 1", "Part 9", "Part 14"]);
  expect(listed.fragments.map((p) => p.name)).toEqual(["tripo_part_30", "tripo_part_31"]);
});

test("listNodeParts lists nothing for a single-mesh model", () => {
  state.nodeMeshes.set("rock", [mesh("__root__", 0), mesh("rock", 500)]);
  expect(parts.listNodeParts("rock")).toBeNull();
});

/** Activates a one-node manifest and lets the Outline render it. */
async function showModel(nodeId, meshes) {
  state.nodeMeshes.set(nodeId, meshes);
  const manifest = { scene: { nodes: [{ node_id: nodeId, name: "baby-goat", source: { cid: "bafyX" } }] } };
  asset.activateAssetManifest("bafyManifest", manifest);
  bus.emit(bus.EVENTS.SCENE_READY, { manifest, manifestCid: "bafyManifest" });
  await new Promise((r) => setTimeout(r, 0));
}

const rows = (selector) => [...document.querySelectorAll(selector)];

test("the Outline lists a model's parts under it, with fragments folded away", async () => {
  await showModel("goat", GOAT_MESHES);
  expect(rows(".outliner-part").map((r) => r.textContent)).toEqual(
    expect.arrayContaining(["◆Part 0", "◆Part 9", "◆Part 14"]),
  );
  expect(rows(".outliner-part")).toHaveLength(4);
  const group = document.querySelector(".outliner-part-group");
  expect(group.textContent).toContain("2 small pieces");

  group.click();
  expect(rows(".outliner-part")).toHaveLength(6);
});

test("clicking a part row asks the engine to select that part, and the row lights up", async () => {
  await showModel("goat", GOAT_MESHES);
  const picked = [];
  const off = bus.on(bus.EVENTS.OUTLINER_PART_SELECTED, (e) => picked.push(e));
  const horn = rows(".outliner-part").find((r) => r.textContent.includes("Part 9"));
  horn.click();
  expect(picked).toEqual([{ nodeId: "goat", meshName: "tripo_part_9" }]);
  off?.();

  // The engine selects it and reports back.
  state.highlightedNodeId = "goat";
  state.highlightedSubMeshName = "tripo_part_9";
  bus.emit(bus.EVENTS.SELECTION_CHANGED, { nodeIds: ["goat"] });
  bus.emit(bus.EVENTS.SUBMESH_SELECTED, { nodeId: "goat", meshName: "tripo_part_9" });
  const selectedParts = rows(".outliner-part.selected").map((r) => r.dataset.partName);
  expect(selectedParts).toEqual(["tripo_part_9"]);
});

test("a single-mesh model gets no part rows", async () => {
  await showModel("rock", [mesh("rock", 500)]);
  expect(rows(".outliner-part")).toHaveLength(0);
  expect(document.querySelector('.outliner-node[data-node-id="rock"] button.outliner-node-toggle')).toBeNull();
});
