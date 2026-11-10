// @test-env dom
/**
 * Library Rename writes the asset's next manifest from the current one
 * (`{ ...manifest, name }`): it must keep the asset's representations
 * (spec R3, docs/superpowers/specs/2026-11-10-asset-representations-design.md).
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
const writeJSONToIPFS = jest.fn(async () => "bafyRenamed");
const updateCollectionManifest = jest.fn(async (_tokenId, mutate) => {
  mutate({ assets: { "asset-a": "bafyA" } });
  return "bafyCollection2";
});

// Spread the real modules: a mock must cover their whole link-time surface.
const realRemote = await import("../frontend/src/js/ipfs/remote-ipfs.ts");
const realWrite = await import("../frontend/src/js/ipfs/write-to-ipfs.ts");
const realDelete = await import("../frontend/src/js/services/asset-delete.ts");
mock.module("../frontend/src/js/ipfs/remote-ipfs.ts", () => ({
  ...realRemote,
  getFromRemoteIPFS: jest.fn(async () => ({
    type: "asset", name: "a", version: 2,
    scene: { nodes: [{ node_id: "n", source: { cid: "bafySrc" } }] },
    representations,
  })),
}));
mock.module("../frontend/src/js/ipfs/write-to-ipfs.ts", () => ({ ...realWrite, writeJSONToIPFS }));
mock.module("../frontend/src/js/services/asset-delete.ts", () => ({ ...realDelete, updateCollectionManifest }));

const { requestRename } = await import("../frontend/src/js/ui/library-context-menu.ts");

beforeEach(() => {
  _resetForTesting();
  window.focusTrap = {
    createFocusTrap: () => ({ activate() { return this; }, deactivate() { return this; } }),
  };
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

test("renaming an asset keeps its representations", async () => {
  const done = requestRename("asset-1-asset-a");
  await flushDialog();
  document.querySelector(".dialog-input").value = "bracket";
  document.querySelector(".dialog-confirm-btn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushDialog();
  await done;

  expect(writeJSONToIPFS).toHaveBeenCalledTimes(1);
  const written = writeJSONToIPFS.mock.calls[0][0];
  expect(written.name).toBe("bracket");
  expect(written.representations).toEqual(representations);
});
