/**
 * @jest-environment jsdom
 *
 * Library details pane metadata row (ui/library-details.ts): flattens a
 * manifest's metadata.annotations into a "key: value · key: value" string,
 * renders "—" when there are no annotations, and toggles the collection-only
 * "Edit metadata…" affordance. IPFS, the contract, Babylon, and the
 * chat-preview service are all mocked — no network, no WebGL.
 */
import { jest, expect, test, describe, beforeEach } from "@jest/globals";

const OWNER = `0x8f3C${"0".repeat(30)}9b2E`;
const MODIFIED = new Date(2026, 7, 17, 12).getTime();

const ASSET = {
  id: "asset-7-root",
  type: "asset",
  tokenId: "7",
  assetId: "root",
  manifestCid: "bafyManifest",
  name: "Robot Scout",
  thumbnailCid: "bafyThumb",
  status: "besked",
  role: "owner",
};

const COLLECTION = {
  id: "collection-9",
  type: "collection",
  tokenId: "9",
  manifestCid: "bafyCollection",
  name: "Props Pack",
  thumbnailCid: "bafyCollThumb",
  status: "besked",
  role: "editor",
};

function buildDom() {
  document.body.innerHTML = `
    <div id="libraryView"></div>
    <button id="libraryDetailsToggleBtn" class="active" aria-pressed="true"></button>
    <aside id="libraryDetails" class="library-details" data-state="empty">
      <div id="libraryDetailsPreview" hidden>
        <span id="libraryDetailsOrbitHint" hidden>drag to orbit</span>
      </div>
      <div id="libraryDetailsBody">
        <div id="libraryDetailsTitle"></div>
        <span id="libraryDetailsBadge"></span>
        <div class="library-details-actions">
          <button id="libraryDetailsOpenBtn"></button>
        </div>
        <div class="library-details-rows">
          <div class="library-details-row"><span class="k">Version</span>
            <span class="v"><span id="libraryDetailsVersion">—</span></span></div>
          <div class="library-details-row"><span class="k">Current</span>
            <span class="v"><span id="libraryDetailsCid">…</span>
              <button id="libraryDetailsCopyCid" hidden></button></span></div>
          <div class="library-details-row"><span class="k">Editors</span>
            <span id="libraryDetailsEditors" class="v">—</span></div>
          <div class="library-details-row"><span class="k">Modified</span>
            <span id="libraryDetailsModified" class="v">—</span></div>
        </div>
        <button id="libraryDetailsMoreBtn" aria-expanded="false"></button>
        <div id="libraryDetailsExtra" class="library-details-rows" hidden>
          <div id="libraryDetailsChildrenRow" class="library-details-row">
            <span id="libraryDetailsChildrenLabel" class="k">Children</span>
            <span id="libraryDetailsChildren" class="v">—</span></div>
          <div id="libraryDetailsFormatRow" class="library-details-row"><span class="k">Format</span>
            <span id="libraryDetailsFormat" class="v">—</span></div>
          <div class="library-details-row"><span class="k">Metadata</span>
            <span id="libraryDetailsMetadata" class="v">—</span></div>
          <div class="library-details-row">
            <button id="libraryDetailsEditMetadataBtn" class="btn btn-secondary btn-sm" hidden>Edit metadata…</button>
          </div>
          <div class="library-details-row"><span class="k">Anchor</span>
            <span id="libraryDetailsAnchor" class="v">—</span></div>
          <div class="library-details-row"><span class="k">Owner</span>
            <span class="v"><span id="libraryDetailsOwner">…</span>
              <button id="libraryDetailsCopyOwner" hidden></button></span></div>
          <div class="library-details-row"><span class="k">Role</span>
            <span id="libraryDetailsRole" class="v">—</span></div>
        </div>
      </div>
      <div id="libraryDetailsEmpty">
        <div id="libraryDetailsEmptyTitle"></div>
        <span id="libraryDetailsEmptyBadge"></span>
        <div class="library-details-rows">
          <div class="library-details-row">
            <span id="libraryDetailsEmptyLabel" class="k"></span>
            <span id="libraryDetailsEmptyCount" class="v"></span>
          </div>
        </div>
        <p class="library-details-hint">
          <span id="libraryDetailsEmptyHint"></span>
        </p>
        <p id="libraryDetailsEmptyPrompt"></p>
      </div>
    </aside>
  `;
}

async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function load({ manifest = null, manifests = null } = {}) {
  jest.resetModules();

  const getFromRemoteIPFS = jest.fn(async (cid) =>
    manifests && manifests[cid] ? manifests[cid] : manifest
  );
  const ownerOfCall = jest.fn(async () => OWNER);
  const getActiveContract = jest.fn(() => ({
    read: { ownerOf: () => ownerOfCall() },
  }));
  const ensureBabylon = jest.fn(async () => null);
  const createChatPreview = jest.fn(async () => null);
  const loadThumbnailInto = jest.fn(async (containerEl) => {
    const img = document.createElement("img");
    containerEl.textContent = "";
    containerEl.appendChild(img);
    return img;
  });
  const extractThumbnailCid = (thumbnail) => {
    if (!thumbnail) return null;
    if (typeof thumbnail === "string") return thumbnail;
    return thumbnail.cid || thumbnail.source?.cid || null;
  };
  const loadEditorList = jest.fn(async () => []);
  const openItem = jest.fn();

  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    __esModule: true,
    getFromRemoteIPFS,
  }));
  jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
    __esModule: true,
    getActiveContract,
  }));
  jest.unstable_mockModule("../../frontend/src/js/engine/babylon-loader.js", () => ({
    __esModule: true,
    ensureBabylon,
  }));
  jest.unstable_mockModule("../../frontend/src/js/services/chat-preview.js", () => ({
    __esModule: true,
    createChatPreview,
  }));
  jest.unstable_mockModule("../../frontend/src/js/utils/thumbnail.js", () => ({
    __esModule: true,
    loadThumbnailInto,
    extractThumbnailCid,
  }));
  jest.unstable_mockModule("@arbesk/asset-core/domain/editors.js", () => ({
    __esModule: true,
    loadEditorList,
  }));
  jest.unstable_mockModule("../../frontend/src/js/ui/library-grid.js", () => ({
    __esModule: true,
    openItem,
  }));

  const { libraryState } = await import(
    "../../frontend/src/js/state/library-state.js"
  );
  const mod = await import("../../frontend/src/js/ui/library-details.js");
  return { libraryState, initLibraryDetails: mod.initLibraryDetails };
}

beforeEach(() => {
  localStorage.clear();
  buildDom();
});

describe("library-details metadata row", () => {
  test("flattens manifest annotations into key: value pairs", async () => {
    const manifest = {
      timestamp: MODIFIED,
      metadata: { annotations: { material: "wood", weight: 12, tagged: true } },
    };
    const { libraryState, initLibraryDetails } = await load({ manifest });
    initLibraryDetails();
    libraryState.set({
      collections: [COLLECTION],
      selectedIds: [COLLECTION.id],
    });
    await flush();

    expect(document.getElementById("libraryDetailsMetadata").textContent).toBe(
      `material: "wood" · weight: 12 · tagged: true`
    );
  });

  test("renders an em dash when the manifest has no annotations", async () => {
    const manifest = { timestamp: MODIFIED, assets: {} };
    const { libraryState, initLibraryDetails } = await load({ manifest });
    initLibraryDetails();
    // Seed a stale value so the assertion proves renderMetadata wrote "—",
    // not just the element's initial content.
    document.getElementById("libraryDetailsMetadata").textContent = "stale";
    libraryState.set({
      collections: [COLLECTION],
      selectedIds: [COLLECTION.id],
    });
    await flush();

    expect(document.getElementById("libraryDetailsMetadata").textContent).toBe(
      "—"
    );
  });

  test("shows the edit affordance only for collections", async () => {
    const assetManifest = {
      timestamp: MODIFIED,
      metadata: { annotations: { material: "steel" } },
      scene: { nodes: [{ node_id: "root", source: { cid: "bafySrc", path: "m.glb", format: "glb" } }] },
    };
    const manifests = {
      bafyCollection: {
        timestamp: MODIFIED,
        metadata: { annotations: { category: "props" } },
      },
      bafyManifest: assetManifest,
    };
    const { libraryState, initLibraryDetails } = await load({ manifests });
    initLibraryDetails();

    // Collection → edit button visible.
    libraryState.set({
      collections: [COLLECTION],
      selectedIds: [COLLECTION.id],
    });
    await flush();
    expect(document.getElementById("libraryDetailsEditMetadataBtn").hidden).toBe(
      false
    );

    // Asset → annotations read-only (button hidden).
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();
    expect(document.getElementById("libraryDetailsEditMetadataBtn").hidden).toBe(
      true
    );
    expect(document.getElementById("libraryDetailsMetadata").textContent).toBe(
      `material: "steel"`
    );
  });
});
