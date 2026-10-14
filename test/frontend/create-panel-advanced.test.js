// @test-env dom
/**
 * create-panel.ts — Advanced generator settings: closed-by-default disclosure,
 * plain provider names, localhost-only mock option and the key status line.
 */

import { beforeEach, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
const ADDRESS = "0x1111111111111111111111111111111111111111";

// ─── Mock handles ───

const mockLoadAssetManifest = jest.fn();
const mockClearScene = jest.fn();
const mockDismissCreatePulse = jest.fn();

const mockShowToast = jest.fn();
const mockShowCustomDialog = jest.fn();
const mockShowCheckboxDialog = jest.fn();

const mockAddChatMessage = jest.fn();
const mockAddAssetMessage = jest.fn();
const mockAddWorkingMessage = jest.fn();
const mockAddImageMessage = jest.fn();
const mockClearChatMessages = jest.fn();
const mockAddAssetActionRow = jest.fn();
const mockAddChoiceMessage = jest.fn();
const mockRegisterAssetSendHandler = jest.fn();

const mockRenderChatProvenance = jest.fn();
const mockClearHistoryBubbles = jest.fn();

const mockGenerateAsset = jest.fn();
const mockGenerateCadAsset = jest.fn();
const mockCancelGenerationTask = jest.fn();
const mockGetOrCreateSession = jest.fn();
const mockGetProviderBalance = jest.fn();

const mockCreateChatPreview = jest.fn();
const mockDisposeChatPreview = jest.fn();
const mockDisposeAllChatPreviews = jest.fn();

const mockOnSaveAssetDraft = jest.fn();
const mockSelectCollection = jest.fn();

// Deployment config returned by the app-config mock; mutated per test.
let configValue = { cadGeneration: true };
const mockGetConfig = jest.fn(async () => configValue);

// domain/asset.js state, controllable per test
const assetDomainState = {
  name: null,
  activeCid: null,
  latestCid: null,
  tokenId: null,
};

mock.module("../../frontend/src/js/engine/scene-graph.js", () => ({
  loadAssetManifest: mockLoadAssetManifest,
  clearScene: mockClearScene,
  dismissCreatePulse: mockDismissCreatePulse,
}));
mock.module("../../frontend/src/js/ui/toasts.js", () => ({
  showToast: mockShowToast,
}));
mock.module("../../frontend/src/js/ui/dialog.js", () => ({
  showCustomDialog: mockShowCustomDialog,
  showCheckboxDialog: mockShowCheckboxDialog,
}));
mock.module("../../frontend/src/js/ui/chat-messages.js", () => ({
  addChatMessage: mockAddChatMessage,
  addAssetMessage: mockAddAssetMessage,
  addWorkingMessage: mockAddWorkingMessage,
  addImageMessage: mockAddImageMessage,
  clearChatMessages: mockClearChatMessages,
  addAssetActionRow: mockAddAssetActionRow,
  addChoiceMessage: mockAddChoiceMessage,
  registerAssetSendHandler: mockRegisterAssetSendHandler,
}));
mock.module("../../frontend/src/js/ui/alpine.js", () => ({
  Alpine: { nextTick: async () => {}, store: () => ({}) },
}));
mock.module("../../frontend/src/js/ui/chat-history.js", () => ({
  renderChatProvenance: mockRenderChatProvenance,
  clearHistoryBubbles: mockClearHistoryBubbles,
}));
mock.module("../../frontend/src/js/services/api.js", () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, code = null, details = null) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
      this.name = "ApiError";
    }
  },
  generateAsset: mockGenerateAsset,
  generateCadAsset: mockGenerateCadAsset,
  cancelGenerationTask: mockCancelGenerationTask,
  getOrCreateSession: mockGetOrCreateSession,
  getProviderBalance: mockGetProviderBalance,
}));
const mockResolveCadDesign = jest.fn();
mock.module("../../frontend/src/js/services/cad-design-source.js", () => ({
  resolveCadDesign: mockResolveCadDesign,
}));
mock.module("../../frontend/src/js/services/app-config.js", () => ({
  getConfig: mockGetConfig,
}));
mock.module("../../frontend/src/js/services/chat-preview.js", () => ({
  createChatPreview: mockCreateChatPreview,
  disposeChatPreview: mockDisposeChatPreview,
  disposeAllChatPreviews: mockDisposeAllChatPreviews,
}));
mock.module("../../frontend/src/js/ui/asset-save.js", () => ({
  onSaveAssetDraft: mockOnSaveAssetDraft,
}));
mock.module("@arbesk/asset-core/domain/asset.js", () => ({
  adoptManifestName: jest.fn(),
  adoptOpenedAsset: jest.fn(),
  setActiveManifestCid: jest.fn((cid) => { assetDomainState.activeCid = cid; }),
  setLatestManifestCid: jest.fn((cid) => { assetDomainState.latestCid = cid; }),
  getActiveAssetManifestCid: () => assetDomainState.activeCid,
  getLatestAssetManifestCid: () => assetDomainState.latestCid,
  getActiveAssetTokenId: () => assetDomainState.tokenId,
  getActiveAssetName: () => assetDomainState.name,
}));
mock.module("@arbesk/asset-core/domain/collection.js", () => ({
  selectCollection: mockSelectCollection,
}));

// ─── DOM fragment (mirrors studio-sidebar.pug) ───

const FRAGMENT = `
  <div id="chatHistoryList"></div>
  <textarea id="promptInput"></textarea>
  <button id="generateBtn" type="button">Generate</button>
  <p id="generateHint" hidden></p>
  <button id="clearChatBtn" type="button"></button>
  <div id="assetNameDisplay">Untitled Asset</div>
  <details id="composerAdvanced"><summary>Advanced</summary></details>
  <select id="providerSelect">
    <option value="auto">Choose for me</option>
    <option value="tripo3d">AI model (Tripo 3D)</option>
    <option value="cad">Parametric CAD</option>
  </select>
  <p id="providerKeyStatus"><span id="providerKeyStatusText"></span><button id="providerKeyLink" type="button"></button></p>
  <p id="providerBalance" hidden></p>
  <button id="imageAttachBtn" type="button" hidden></button>
  <input id="imageAttachInput" type="file" hidden />
  <div id="imageAttachChips" hidden></div>
  <p id="multiviewHint" hidden></p>
  <div id="refineIndicator" hidden>
    <span id="refineIndicatorText"></span>
    <button id="refineIndicatorDetach" type="button"></button>
  </div>
  <select id="tierSelect"><option value="0" selected>Free</option></select>
  <select id="collectionSelect"><option value="">Default</option></select>
  <span id="bottomBarProvider"></span>`;

const realLocation = globalThis.location;

/** Fresh module graph against a DOM fragment, on the given host. */
async function load({ hostname = "localhost", stored = {}, search = "" } = {}) {
  localStorage.clear();
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  document.body.innerHTML = FRAGMENT;
  Object.defineProperty(globalThis, "location", {
    value: { hostname, search },
    configurable: true,
    writable: true,
  });
  resetModules();
  await import("../../frontend/src/js/ui/create-panel.js");
  const $ = (id) => document.getElementById(id);
  return { $, select: $("providerSelect") };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProviderBalance.mockResolvedValue({ balance: 5 });
  mockGetConfig.mockResolvedValue(configValue);
  mockShowCustomDialog.mockResolvedValue(null);
});

const values = (select) => Array.from(select.options).map((o) => o.value);

test("Advanced is closed by default and remembers being opened", async () => {
  let { $ } = await load();
  const adv = $("composerAdvanced");
  expect(adv.open).toBe(false);
  adv.open = true;
  adv.dispatchEvent(new Event("toggle"));
  expect(localStorage.getItem("arbesk-create-advanced")).toBe("1");

  ({ $ } = await load({ stored: { "arbesk-create-advanced": "1" } }));
  expect($("composerAdvanced").open).toBe(true);
});

test("mock option exists only on localhost", async () => {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const { select } = await load({ hostname });
    expect(values(select)).toContain("mock");
  }
  const { select } = await load({ hostname: "arbesk.com" });
  expect(values(select)).not.toContain("mock");
});

test("key status reads 'not added · Add key' then 'added · Change'", async () => {
  const { $ } = await load();
  const text = () => $("providerKeyStatus").textContent.replace(/\s+/g, " ").trim();
  expect(text()).toBe("Tripo 3D API key: not added · Add key");
  localStorage.setItem("arbesk-byok-key", "tk_123");
  $("providerSelect").value = "tripo3d";
  $("providerSelect").dispatchEvent(new Event("change"));
  expect(text()).toBe("Tripo 3D API key: added · Change");
});

test("Add key opens the key dialog", async () => {
  const { $ } = await load();
  $("providerKeyLink").click();
  expect(mockShowCustomDialog).toHaveBeenCalledTimes(1);
});

test("a stored 'mock' provider off localhost falls back to auto", async () => {
  const { select } = await load({
    hostname: "arbesk.com",
    stored: { "arbesk-provider": "mock" },
  });
  expect(select.value).toBe("auto");
  const url = await load({ hostname: "arbesk.com", search: "?provider=mock" });
  expect(url.select.value).toBe("auto");
});

test("a stored 'mock' provider on localhost still restores", async () => {
  const { select } = await load({ stored: { "arbesk-provider": "mock" } });
  expect(select.value).toBe("mock");
});
