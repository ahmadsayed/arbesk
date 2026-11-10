// @test-env dom
/**
 * Library Rename writes the asset's next version from its current collection
 * entry: it must keep the asset's representations (spec R3,
 * docs/superpowers/specs/2026-11-10-asset-representations-design.md), build
 * on what another client wrote since the Library listed it, and never replace
 * an entry that moved while it was writing.
 */
import { beforeEach, expect, jest, mock, test } from "bun:test";
import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";
import { DIALOG_HOST_FRAGMENT, flushDialog } from "./helpers/dialog-host.js";

const representations = [
  {
    id: "stl", role: "mesh", format: "stl", name: "a.stl", cid: "bafyStl",
    bytes: 9, encoding: "raw", created_at: 1, derived_from: { ref: "primary", cid: "bafySrc" },
  },
];
const MANIFESTS = {
  // What the Library listed (before a `besk attach`).
  bafyA: { type: "asset", name: "a", version: 2, scene: { nodes: [{ node_id: "n", source: { cid: "bafySrc" } }] } },
  // The attach version, now the collection entry.
  bafyB: {
    type: "asset", name: "a", version: 3, prev_asset_manifest_cid: "bafyA",
    scene: { nodes: [{ node_id: "n", source: { cid: "bafySrc" } }] },
    representations,
  },
};
/** The collection entry the token read and the write-time mutator see. */
const entry = { read: "bafyB", atWrite: "bafyB" };

const writeJSONToIPFS = jest.fn(async () => "bafyRenamed");
const written = [];
const updateCollectionManifest = jest.fn(async (_tokenId, mutate) => {
  written.push(mutate({ assets: { "asset-a": entry.atWrite } }));
  return "bafyCollection2";
});

// Spread the real modules: a mock must cover their whole link-time surface.
const realRemote = await import("../frontend/src/js/ipfs/remote-ipfs.ts");
const realWrite = await import("../frontend/src/js/ipfs/write-to-ipfs.ts");
const realDelete = await import("../frontend/src/js/services/asset-delete.ts");
const realToken = await import("../frontend/src/js/services/token.ts");
mock.module("../frontend/src/js/ipfs/remote-ipfs.ts", () => ({
  ...realRemote,
  getFromRemoteIPFS: jest.fn(async (cid) => structuredClone(MANIFESTS[cid])),
}));
mock.module("../frontend/src/js/ipfs/write-to-ipfs.ts", () => ({ ...realWrite, writeJSONToIPFS }));
mock.module("../frontend/src/js/services/asset-delete.ts", () => ({ ...realDelete, updateCollectionManifest }));
mock.module("../frontend/src/js/services/token.ts", () => ({
  ...realToken,
  getCollectionManifest: jest.fn(async () => ({ assets: { "asset-a": entry.read } })),
}));

const { requestRename, renamedVersion } = await import("../frontend/src/js/ui/library-context-menu.ts");

beforeEach(() => {
  _resetForTesting();
  writeJSONToIPFS.mockClear();
  written.length = 0;
  entry.read = "bafyB";
  entry.atWrite = "bafyB";
  window.focusTrap = {
    createFocusTrap: () => ({ activate() { return this; }, deactivate() { return this; } }),
  };
  window.Notyf = jest.fn().mockImplementation(() => ({
    open: jest.fn(() => ({ on: jest.fn() })),
    dismiss: jest.fn(),
  }));
  document.body.innerHTML = `
    <div id="libraryItems"></div>
    <div id="libraryLiveRegion"></div>
    ${DIALOG_HOST_FRAGMENT}
  `;
  libraryState.set({
    assets: [{
      id: "asset-1-asset-a", type: "asset", tokenId: "1", assetId: "asset-a",
      name: "a", status: "besked", manifestCid: "bafyA",
    }],
  });
});

async function renameTo(name) {
  const done = requestRename("asset-1-asset-a");
  await flushDialog();
  document.querySelector(".dialog-input").value = name;
  document.querySelector(".dialog-confirm-btn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushDialog();
  await done;
}

test("renaming builds the next version from the current entry and keeps its representations", async () => {
  await renameTo("bracket");

  expect(writeJSONToIPFS).toHaveBeenCalledTimes(1);
  const manifest = writeJSONToIPFS.mock.calls[0][0];
  expect(manifest.name).toBe("bracket");
  expect(manifest.representations).toEqual(representations);
  expect(manifest.version).toBe(4);
  expect(manifest.prev_asset_manifest_cid).toBe("bafyB");
  expect(written[0].assets["asset-a"]).toBe("bafyRenamed");
});

test("renaming refuses to replace an entry that moved while it was writing", async () => {
  entry.atWrite = "bafyC";

  await renameTo("bracket");

  expect(written).toEqual([]);
  expect(libraryState.get().assets[0].name).toBe("a");
  expect(window.Notyf).toHaveBeenCalled();
});

test("a bare composite is only renamed", () => {
  expect(renamedVersion({ asset: { version: "2.0" }, buffers: [] }, "b", "bafyX")).toEqual({
    asset: { version: "2.0" }, buffers: [], name: "b",
  });
});
