// @test-env dom
/**
 * create-panel.ts — Parametric CAD provider wiring.
 *
 * Pins the Task-5 behavior of the generation entry point: the "cad" provider
 * routes through generateCadAsset (no BYOK key, stoppable task wiring), the
 * CAD_* error-code → user-copy mapping, the retry-with-Tripo-3D choice bubble
 * on CAD_REQUEST_UNSUITABLE, the indeterminate-progress guard for cad polls
 * (progress 0 = "no data"), and the cadGeneration config gate on the provider
 * select (default visible, hidden only on explicit false).
 *
 * Same harness shape as create-panel-generate.test.js: the real module runs
 * against a DOM fragment mirroring studio-sidebar.pug's ids; heavy siblings
 * (scene-graph, chat-messages, api, chat-preview, …) are mocked; ApiError is
 * re-created in the api mock (with `details`) so instanceof checks behave as
 * in production.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, jest, mock, test } from "bun:test";
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

// ─── DOM fragment (mirrors the studio-sidebar.pug ids create-panel.ts binds) ───

const FRAGMENT = `
  <div id="chatHistoryList" class="chat-history-list"></div>
  <textarea id="promptInput" class="messagebar-input" rows="3"></textarea>
  <button id="generateBtn" class="messagebar-submit" aria-label="Generate asset"></button>
  <p id="generateHint" class="messagebar-hint" hidden></p>
  <button id="clearChatBtn" type="button"></button>
  <div id="assetNameDisplay" class="form-input">Untitled Asset</div>
  <details id="composerSettings" class="composer-settings" open>
    <summary class="composer-settings-summary">Provider &amp; Quality</summary>
  </details>
  <select id="providerSelect" class="form-select">
    <option value="mock">Mock (Local)</option>
    <option value="tripo3d">Tripo 3D</option>
    <option value="cad">Parametric CAD</option>
  </select>
  <button id="providerKeyBtn" class="provider-key-btn" type="button" hidden></button>
  <p id="providerKeyHint" class="provider-key-hint" hidden></p>
  <p id="providerBalance" class="provider-balance" hidden></p>
  <div id="textureQualityRow" class="form-group" hidden>
    <select id="textureQualitySelect" class="form-select">
      <option value="standard">Standard</option>
      <option value="detailed">Detailed (slower, more credits)</option>
      <option value="extreme">Extreme 8K (most credits)</option>
    </select>
  </div>
  <button id="imageAttachBtn" class="messagebar-attach" type="button" hidden></button>
  <input id="imageAttachInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden />
  <div id="imageAttachChips" class="image-attach-chips" hidden></div>
  <p id="multiviewHint" class="messagebar-hint" hidden></p>
  <div id="refineIndicator" class="refine-indicator" hidden>
    <span id="refineIndicatorText" class="refine-indicator-text"></span>
    <button id="refineIndicatorDetach" class="refine-indicator-detach" type="button">&times;</button>
  </div>
  <select id="tierSelect" class="form-select">
    <option value="0" selected>Free — ~$0.0001 gas</option>
  </select>
  <select id="collectionSelect" class="form-select">
    <option value="">Default</option>
  </select>
  <span id="bottomBarProvider"></span>`;

const flush = () => new Promise((r) => setTimeout(r, 0));

/** @type {typeof import("../../frontend/src/js/services/api.js")} */
let api;
let panel;
let walletState;
let pendingGens;
let promptInput;
let generateBtn;
let providerSelect;
let providerKeyBtn;
let providerKeyHint;
let bottomBarProvider;

const CAD_RESULT = {
  assetManifestCid: "bafyCadManifest",
  sourceAssetCid: "bafyCadSource",
  format: "3mf",
  path: "asset.3mf",
  taskId: "cad-task-1",
  providerTaskId: "cad-provider-task-1",
};

function buildDom() {
  document.body.innerHTML = FRAGMENT;
  promptInput = document.getElementById("promptInput");
  generateBtn = document.getElementById("generateBtn");
  providerSelect = document.getElementById("providerSelect");
  providerKeyBtn = document.getElementById("providerKeyBtn");
  providerKeyHint = document.getElementById("providerKeyHint");
  bottomBarProvider = document.getElementById("bottomBarProvider");
}

beforeAll(async () => {
  buildDom();
  panel = await import("../../frontend/src/js/ui/create-panel.js");
  api = await import("../../frontend/src/js/services/api.js");
  ({ walletState } = await import("../../frontend/src/js/state/wallet-state.js"));
  pendingGens = await import("../../frontend/src/js/state/pending-generations.js");
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  walletState.reset();
  pendingGens._resetPendingGenerations();
  assetDomainState.name = null;
  assetDomainState.activeCid = null;
  assetDomainState.latestCid = null;
  assetDomainState.tokenId = null;
  configValue = { cadGeneration: true };

  promptInput.value = "";
  providerSelect.value = "mock";
  providerSelect.dispatchEvent(new Event("change"));
  generateBtn.disabled = false;
  generateBtn.classList.remove("generating");
  document.getElementById("refineIndicatorDetach").click();

  mockGetOrCreateSession.mockResolvedValue("session-token");
  mockGenerateCadAsset.mockResolvedValue({ ...CAD_RESULT });
  mockGetProviderBalance.mockResolvedValue({ balance: 5 });
  mockShowCustomDialog.mockResolvedValue(null);
  mockAddAssetMessage.mockReturnValue(null);
  mockAddWorkingMessage.mockReturnValue({
    remove: jest.fn(),
    setProgress: jest.fn(),
    setText: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function connectWallet() {
  walletState.set({ walletAddress: ADDRESS });
}

/** Click Generate and let the async handler settle. */
async function clickGenerate() {
  generateBtn.click();
  await flush();
  await flush();
  await flush();
}

/** Select a provider the way a user would (persists + syncs UI). */
function selectProvider(value) {
  providerSelect.value = value;
  providerSelect.dispatchEvent(new Event("change"));
}

// ─── Pure decision helpers ───

test("isRealProvider is true only for the BYOK tripo3d provider", () => {
  expect(panel.isRealProvider("tripo3d")).toBe(true);
  expect(panel.isRealProvider("cad")).toBe(false);
  expect(panel.isRealProvider("mock")).toBe(false);
});

test("shouldUseStoppable is false only for the synchronous mock provider", () => {
  expect(panel.shouldUseStoppable("mock")).toBe(false);
  expect(panel.shouldUseStoppable("tripo3d")).toBe(true);
  expect(panel.shouldUseStoppable("cad")).toBe(true);
});

test("generationErrorMessage maps the CAD error codes to their copy", () => {
  const msg = (status, code, details = null, message = "x") =>
    panel.generationErrorMessage(new api.ApiError(message, status, code, details));
  expect(msg(400, "CAD_REQUEST_UNSUITABLE")).toBe(
    "Parametric CAD can't model this request — it suits mechanical/printable shapes, not organic or freeform ones. Try Tripo 3D for mesh generation."
  );
  expect(msg(400, "CAD_NOT_CONFIGURED")).toBe(
    "Parametric CAD isn't enabled on this deployment."
  );
  expect(msg(500, "CAD_PRELUDE_MISMATCH", null, "prelude hash mismatch")).toBe(
    "prelude hash mismatch"
  );
  expect(msg(500, "CAD_PRELUDE_MISMATCH", null, "")).toBe(
    "CAD runtime is out of date — refresh the page."
  );
  expect(msg(504, "CAD_RENDER_TIMEOUT")).toBe(
    "CAD rendering timed out — try a simpler request."
  );
});

// ─── CAD routing ───

test("cad provider routes through generateCadAsset with no BYOK key", async () => {
  connectWallet();
  selectProvider("cad");
  promptInput.value = "a 20-tooth spur gear, 8 mm bore";
  await clickGenerate();

  expect(mockGenerateCadAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateCadAsset.mock.calls[0][0];
  expect(args).toMatchObject({ prompt: "a 20-tooth spur gear, 8 mm bore" });
  expect(args.nodeId).toMatch(/^untitled_asset_\d+$/);
  // CAD tasks are async + cancellable: full stoppable wiring is forwarded.
  expect(args.signal).toBeInstanceOf(AbortSignal);
  expect(typeof args.onTaskId).toBe("function");
  expect(typeof args.onProgress).toBe("function");
  // The mesh path is untouched…
  expect(mockGenerateAsset).not.toHaveBeenCalled();
  // …and no BYOK key dialog opens for the server-paid provider.
  expect(mockShowCustomDialog).not.toHaveBeenCalled();
  expect(providerKeyBtn.hidden).toBe(true);
  expect(providerKeyHint.hidden).toBe(true);
  expect(bottomBarProvider.textContent).toBe("Provider: Parametric CAD");
  // Working message carries the Stop affordance.
  expect(mockAddWorkingMessage).toHaveBeenCalledWith(
    "Carving your model…",
    expect.objectContaining({ onCancel: expect.any(Function) })
  );
});

test("cad result registers a pending generation with provider cad / format 3mf", async () => {
  connectWallet();
  selectProvider("cad");
  promptInput.value = "a 20-tooth spur gear";
  await clickGenerate();

  const records = pendingGens.listPendingGenerations();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    assetManifestCid: CAD_RESULT.assetManifestCid,
    sourceAssetCid: CAD_RESULT.sourceAssetCid,
    prompt: "a 20-tooth spur gear",
    format: "3mf",
    path: "asset.3mf",
    provider: "cad",
    task: "model",
  });
  expect(mockDismissCreatePulse).toHaveBeenCalled();
  expect(generateBtn.disabled).toBe(false);
});

test("cad poll progress 0 keeps the bar indeterminate (stage text only)", async () => {
  connectWallet();
  selectProvider("cad");
  promptInput.value = "a bracket";
  await clickGenerate();

  // The stoppable wiring is forwarded into the generateCadAsset call.
  const args = mockGenerateCadAsset.mock.calls[0][0];
  const working = mockAddWorkingMessage.mock.results[0].value;
  args.onProgress({ stage: "Rendering B-rep", progress: 0 });
  expect(working.setText).toHaveBeenCalledWith("Rendering B-rep");
  expect(working.setProgress).not.toHaveBeenCalled();

  args.onProgress({ stage: "Rendering B-rep", progress: 40 });
  expect(working.setProgress).toHaveBeenCalledWith(0.4, "Rendering B-rep");
});

// ─── Rejection UX ───

test("CAD_REQUEST_UNSUITABLE with a tripo3d alternative offers a retry choice", async () => {
  connectWallet();
  selectProvider("cad");
  mockGenerateCadAsset.mockRejectedValue(
    new api.ApiError("request is not suitable for parametric CAD", 400, "CAD_REQUEST_UNSUITABLE", {
      suitability: "organic/freeform",
      alternative: { kind: "mesh", provider: "tripo3d" },
    })
  );
  promptInput.value = "a dragon";
  await clickGenerate();

  // A choice bubble, not a plain error message.
  expect(mockAddChoiceMessage).toHaveBeenCalledTimes(1);
  const [text, choices] = mockAddChoiceMessage.mock.calls[0];
  expect(text).toContain("Parametric CAD can't model this request");
  expect(choices).toEqual([
    { label: "Retry with Tripo 3D", value: "tripo3d" },
    { label: "Not now", value: "dismiss" },
  ]);
  expect(mockAddChatMessage).not.toHaveBeenCalledWith(
    "system",
    expect.stringContaining("Parametric CAD can't model")
  );
});

test("picking 'Retry with Tripo 3D' switches provider and regenerates the same prompt", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  selectProvider("cad");
  mockGenerateAsset.mockResolvedValue({
    assetManifestCid: "bafyTripoManifest",
    sourceAssetCid: "bafyTripoSource",
    format: "glb",
  });
  mockGenerateCadAsset.mockRejectedValue(
    new api.ApiError("not suitable", 400, "CAD_REQUEST_UNSUITABLE", {
      suitability: "organic",
      alternative: { kind: "mesh", provider: "tripo3d" },
    })
  );
  promptInput.value = "a dragon";
  await clickGenerate();
  const onPick = mockAddChoiceMessage.mock.calls[0][2];

  onPick("tripo3d");
  await flush();
  await flush();
  await flush();

  expect(providerSelect.value).toBe("tripo3d");
  expect(localStorage.getItem("arbesk-provider")).toBe("tripo3d");
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateAsset.mock.calls[0][0]).toMatchObject({
    prompt: "a dragon",
    provider: "tripo3d",
    providerKey: "sk-test-key",
  });
});

test("picking 'Not now' does not retry", async () => {
  connectWallet();
  selectProvider("cad");
  mockGenerateCadAsset.mockRejectedValue(
    new api.ApiError("not suitable", 400, "CAD_REQUEST_UNSUITABLE", {
      alternative: { kind: "mesh", provider: "tripo3d" },
    })
  );
  promptInput.value = "a dragon";
  await clickGenerate();
  const onPick = mockAddChoiceMessage.mock.calls[0][2];

  onPick("dismiss");
  await flush();
  await flush();

  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(providerSelect.value).toBe("cad");
});

test("CAD_REQUEST_UNSUITABLE without an alternative falls back to the explanatory message", async () => {
  connectWallet();
  selectProvider("cad");
  mockGenerateCadAsset.mockRejectedValue(
    new api.ApiError("organic shapes are not supported", 400, "CAD_REQUEST_UNSUITABLE", {
      suitability: "organic/freeform",
    })
  );
  promptInput.value = "a dragon";
  await clickGenerate();

  expect(mockAddChoiceMessage).not.toHaveBeenCalled();
  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    "Parametric CAD can't model this request — it suits mechanical/printable shapes, not organic or freeform ones. Try Tripo 3D for mesh generation."
  );
});

test("CAD_NOT_CONFIGURED surfaces the deployment-gate copy", async () => {
  connectWallet();
  selectProvider("cad");
  mockGenerateCadAsset.mockRejectedValue(
    new api.ApiError("no CAD runtime configured", 503, "CAD_NOT_CONFIGURED", {
      reason: "missing CAD_MOCK_GENERATION/DEEPSEEK_API_KEY",
    })
  );
  promptInput.value = "a gear";
  await clickGenerate();

  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    "Parametric CAD isn't enabled on this deployment."
  );
});

// ─── Provider availability gating (needs a fresh module load per config) ───

describe("cad option availability gating", () => {
  test("hides the cad option when the deployment reports cadGeneration: false", async () => {
    configValue = { cadGeneration: false };
    // A returning user whose deployment no longer serves CAD.
    localStorage.setItem("arbesk-provider", "cad");
    resetModules();
    buildDom();
    await import("../../frontend/src/js/ui/create-panel.js");
    await flush();
    await flush();

    expect(document.querySelector('option[value="cad"]')).toBeNull();
    // The select falls back to a known provider rather than a dead value.
    expect(document.getElementById("providerSelect").value).toBe("mock");
  });

  test("keeps the cad option when the config fetch fails (default visible)", async () => {
    configValue = null;
    resetModules();
    buildDom();
    await import("../../frontend/src/js/ui/create-panel.js");
    await flush();
    await flush();

    expect(document.querySelector('option[value="cad"]')).not.toBeNull();
  });
});
