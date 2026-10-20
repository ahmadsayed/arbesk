// @test-env dom
/**
 * Characterization tests for onGenerate (ui/create-panel.ts).
 *
 * These pin the CURRENT behavior of the generation entry point (CC 41, the
 * repo's highest-CRAP function) so it can be refactored safely: prompt/image
 * payload shaping, wallet + session gates, BYOK key gate, stoppable wiring,
 * typed-follow-up retexture, and the ApiError → user-message mapping.
 *
 * The real module runs against a DOM fragment mirroring app.pug's ids.
 * Heavy siblings (scene-graph, chat-messages, api, chat-preview, …) are
 * mocked; ApiError is re-created in the api mock so instanceof checks in the
 * module under test behave exactly as in production.
 *
 */


import { afterEach, beforeAll, beforeEach, expect, jest, mock, test } from "bun:test";
// The Animate dialog's preset catalog, as GET /config serves it.
import { ANIMATION_PRESETS } from "../../src/api/animation-presets.ts";
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
const mockJudgeFollowupIntent = jest.fn();

const mockFetchGenerationAdvice = jest.fn();
const mockDecideGenerationPlan = jest.fn(() => ({ kind: "fallback" }));

const mockCreateChatPreview = jest.fn();
const mockDisposeChatPreview = jest.fn();
const mockDisposeAllChatPreviews = jest.fn();

const mockOnSaveAssetDraft = jest.fn();
const mockSelectCollection = jest.fn();

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
const mockKeepCreateView = jest.fn();
mock.module("../../frontend/src/js/ui/sidebar.js", () => ({
  keepCreateView: mockKeepCreateView,
  switchView: jest.fn(),
  getActiveView: jest.fn(() => "chat"),
  initSidebar: jest.fn(),
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
    constructor(message, status, code = null) {
      super(message);
      this.status = status;
      this.code = code;
      this.name = "ApiError";
    }
  },
  generateAsset: mockGenerateAsset,
  generateCadAsset: mockGenerateCadAsset,
  cancelGenerationTask: mockCancelGenerationTask,
  getOrCreateSession: mockGetOrCreateSession,
  getProviderBalance: mockGetProviderBalance,
  judgeFollowupIntent: mockJudgeFollowupIntent,
}));
// The advisor policy is mocked: fetchGenerationAdvice resolves null (no Jev
// key, an outage) by default so decideGenerationPlan sees no advice.
// CONFIG_BUNDLES is a copy of the real mapping (pinned by
// generation-advice.test.js) so the panel's pick→fields wiring is exercised.
mock.module("../../frontend/src/js/ui/generation-advice.js", () => ({
  CONFIG_BUNDLES: {
    "fast-draft": {
      id: "fast-draft",
      label: "Fast draft",
      blurb: "Tripo v3.1 · fast textures",
      fields: { tripoModel: "v3.1-20260211", textureQuality: "fast", textureVersion: "v3.5-20260815", delight: true },
    },
    balanced: {
      id: "balanced",
      label: "Balanced",
      blurb: "Tripo v3.1 · standard quality",
      fields: { tripoModel: "v3.1-20260211", textureQuality: "standard" },
    },
    "hero-detail": {
      id: "hero-detail",
      label: "Hero detail",
      blurb: "Tripo v3.1 · detailed textures",
      fields: { tripoModel: "v3.1-20260211", textureQuality: "detailed" },
    },
    "game-ready": {
      id: "game-ready",
      label: "Game-ready (low poly)",
      blurb: "Tripo P1 · 5K faces",
      fields: { tripoModel: "P1-20260311", textureQuality: "standard", faceLimit: 5000 },
    },
    "clean-topo": {
      id: "clean-topo",
      label: "Clean topology (P2)",
      blurb: "Tripo P2 · clean topology",
      fields: { tripoModel: "P2-20260801", textureQuality: "standard" },
    },
  },
  decideGenerationPlan: mockDecideGenerationPlan,
  fetchGenerationAdvice: mockFetchGenerationAdvice,
}));
mock.module("../../frontend/src/js/services/app-config.js", () => ({
  getConfig: jest.fn(async () => ({ cadGeneration: true, animationPresets: ANIMATION_PRESETS })),
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
  getCurrentManifest: () => null,
}));
mock.module("@arbesk/asset-core/domain/collection.js", () => ({
  selectCollection: mockSelectCollection,
}));

// ─── DOM fragment (mirrors the app.pug ids create-panel.ts binds) ───

const FRAGMENT = `
  <div id="chatHistoryList"></div>
  <textarea id="promptInput"></textarea>
  <button id="generateBtn" type="button"></button>
  <div id="generateHint"></div>
  <button id="clearChatBtn" type="button"></button>
  <button id="imageAttachBtn" type="button"></button>
  <input id="imageAttachInput" type="file" />
  <div id="imageAttachChips"></div>
  <div id="multiviewHint"></div>
  <span id="assetNameDisplay"></span>
  <select id="providerSelect">
    <option value="auto">Auto (recommended)</option>
    <option value="mock">Mock</option>
    <option value="tripo3d">Tripo 3D</option>
    <option value="cad">Parametric CAD</option>
  </select>
  <select id="tierSelect">
    <option value="">Auto</option>
    <option value="0">Free</option>
    <option value="1">Paid</option>
  </select>
  <select id="collectionSelect"></select>
  <span id="providerKeyStatusText"></span><button id="providerKeyLink" type="button"></button>
  <span id="bottomBarProvider"></span>
  <div id="providerBalance"></div>
  <details id="composerAdvanced"></details>
  <div id="refineIndicator">
    <span id="refineIndicatorText"></span>
    <button id="refineIndicatorDetach" type="button"></button>
  </div>`;

const flush = () => new Promise((r) => setTimeout(r, 0));

/** @type {typeof import("../../frontend/src/js/ui/create-panel.js")} */
let panel;
/** @type {typeof import("../../frontend/src/js/services/api.js")} */
let api;
let walletState;
let pendingGens;
let promptInput;
let generateBtn;
let providerSelect;

const GENERATION_RESULT = {
  assetManifestCid: "bafyAssetCid",
  sourceAssetCid: "bafySourceCid",
  format: "glb",
};

beforeAll(async () => {
  document.body.innerHTML = FRAGMENT;
  panel = await import("../../frontend/src/js/ui/create-panel.js");
  api = await import("../../frontend/src/js/services/api.js");
  ({ walletState } = await import("../../frontend/src/js/state/wallet-state.js"));
  pendingGens = await import("../../frontend/src/js/state/pending-generations.js");
  promptInput = document.getElementById("promptInput");
  generateBtn = document.getElementById("generateBtn");
  providerSelect = document.getElementById("providerSelect");
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  walletState.reset();
  pendingGens._resetPendingGenerations();
  panel._resetAdvisorDispatch();
  assetDomainState.name = null;
  assetDomainState.activeCid = null;
  assetDomainState.latestCid = null;
  assetDomainState.tokenId = null;

  promptInput.value = "";
  // No Jev advice by default: the advisor falls back to the plain route.
  mockFetchGenerationAdvice.mockResolvedValue(null);
  mockDecideGenerationPlan.mockReturnValue({ kind: "fallback" });
  // Switching back to the mock provider discards attached images (module
  // behavior) — resets the image state leaked from a previous test.
  providerSelect.value = "mock";
  providerSelect.dispatchEvent(new Event("change"));
  // The button starts disabled until a wallet connects (updateGenerateHint);
  // tests drive the click path directly, so pin the enabled precondition.
  generateBtn.disabled = false;
  generateBtn.classList.remove("generating");
  // No Jev reading by default: typed follow-ups keep the retexture route.
  mockJudgeFollowupIntent.mockResolvedValue(null);
  // Break any refine chain leaked by a previous test's tripo3d generation.
  document.getElementById("refineIndicatorDetach").click();

  mockGetOrCreateSession.mockResolvedValue("session-token");
  mockGenerateAsset.mockResolvedValue({ ...GENERATION_RESULT });
  mockGenerateCadAsset.mockResolvedValue({
    assetManifestCid: "bafyCadManifest",
    sourceAssetCid: "bafyCadSource",
    format: "3mf",
    path: "asset.3mf",
    design: { nodes: [] },
  });
  mockGetProviderBalance.mockResolvedValue({ balance: 5 });
  mockShowCustomDialog.mockResolvedValue(null);
  // No asset bubble handle: skips preview wiring, keeps the flow linear.
  mockAddAssetMessage.mockReturnValue(null);
  mockAddWorkingMessage.mockReturnValue({ remove: jest.fn(), setProgress: jest.fn() });
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

/** Attach image files through the real attach input change path. */
async function attachImages(files) {
  const input = document.getElementById("imageAttachInput");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
  await flush(); // FileReader onload
  await flush();
}


/**
 * Make the mocked showCustomDialog behave like the real one: it hands the body
 * a closeDialog(value) that resolves the dialog's promise. Returns a handle to
 * the opened body.
 */
function openKeyDialogHandle() {
  const handle = { wrap: null, title: null, close: null };
  mockShowCustomDialog.mockImplementation((title, wrap) => {
    handle.title = title;
    handle.wrap = wrap;
    return new Promise((resolve) => {
      wrap.closeDialog = resolve;
      handle.close = resolve;
    });
  });
  return handle;
}

// ─── Tests ───

test("ignores an empty prompt with no attached images", async () => {
  connectWallet();
  promptInput.value = "   ";
  await clickGenerate();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(mockAddChatMessage).not.toHaveBeenCalled();
  expect(mockGetOrCreateSession).not.toHaveBeenCalled();
});

test("alerts and stops when no wallet is connected", async () => {
  const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  promptInput.value = "a rock";
  await clickGenerate();
  expect(alertSpy).toHaveBeenCalledWith("Please log in or sign up first.");
  expect(mockGetOrCreateSession).not.toHaveBeenCalled();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("shows a sign-in toast and stops when session creation fails", async () => {
  connectWallet();
  mockGetOrCreateSession.mockRejectedValue(new Error("user rejected"));
  promptInput.value = "a rock";
  await clickGenerate();
  expect(mockShowToast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "warning", title: "Sign In Required" })
  );
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("happy path (mock provider): user message, payload shape, cleanup", async () => {
  connectWallet();
  promptInput.value = "a rock";
  await clickGenerate();

  expect(mockAddChatMessage).toHaveBeenCalledWith("user", "a rock");
  expect(promptInput.value).toBe("");

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args).toMatchObject({
    prompt: "a rock",
    provider: "mock",
    tier: 0,
    txHash: null,
    prevAssetManifestCid: undefined,
  });
  expect(args.nodeId).toMatch(/^untitled_asset_\d+$/);
  expect(args.transformMatrix).toHaveLength(16);
  // Mock provider: no BYOK key, no texture quality, no stoppable wiring, and
  // the advisor is never consulted.
  expect(args.providerKey).toBeUndefined();
  expect(args.textureQuality).toBeUndefined();
  expect(args.signal).toBeUndefined();
  expect(mockFetchGenerationAdvice).not.toHaveBeenCalled();

  // Result registered as a pending generation + create pulse dismissed.
  const records = pendingGens.listPendingGenerations();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    assetManifestCid: GENERATION_RESULT.assetManifestCid,
    sourceAssetCid: GENERATION_RESULT.sourceAssetCid,
    prompt: "a rock",
    provider: "mock",
    task: "model",
  });
  expect(mockDismissCreatePulse).toHaveBeenCalled();

  // finally: generate button re-enabled, generating class removed.
  expect(generateBtn.disabled).toBe(false);
  expect(generateBtn.classList.contains("generating")).toBe(false);
});

test("uses the active asset name for the nodeId slug", async () => {
  connectWallet();
  assetDomainState.name = "My Cool Robot!";
  promptInput.value = "a rock";
  await clickGenerate();
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args.nodeId).toMatch(/^my_cool_robot__\d+$/);
});

test("passes the active manifest cid as prevAssetManifestCid", async () => {
  connectWallet();
  assetDomainState.activeCid = "bafyPrevCid";
  promptInput.value = "a rock";
  await clickGenerate();
  expect(mockGenerateAsset.mock.calls[0][0].prevAssetManifestCid).toBe("bafyPrevCid");
});

test("Enter key (without shift) submits like the Generate button", async () => {
  connectWallet();
  promptInput.value = "a rock";
  promptInput.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
  );
  await flush();
  await flush();
  await flush();
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateAsset.mock.calls[0][0].prompt).toBe("a rock");
});

test("missing key opens the dialog; Save key and generate retries the same dispatch", async () => {
  connectWallet();
  providerSelect.value = "tripo3d";
  promptInput.value = "a rock";
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(mockAddChoiceMessage).not.toHaveBeenCalled();
  expect(dlg.title).toBe("This model needs an AI generator");
  expect(dlg.wrap.textContent).toContain("Organic shapes like this are made with Tripo 3D");
  const link = dlg.wrap.querySelector("a");
  expect(link.getAttribute("href")).toBe("https://platform.tripo3d.ai");
  expect(link.textContent).toBe("Get a key from Tripo 3D");
  expect(generateBtn.disabled).toBe(false);

  const save = dlg.wrap.querySelector("#providerKeySave");
  const field = dlg.wrap.querySelector("#providerKeyInput");
  expect(save.textContent).toBe("Save key and generate");
  expect(save.disabled).toBe(true);
  field.value = "sk-late-key";
  field.dispatchEvent(new Event("input"));
  expect(save.disabled).toBe(false);
  save.click();
  await flush();
  await flush();
  await flush();

  expect(localStorage.getItem("arbesk-byok-key")).toBe("sk-late-key");
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const retried = mockGenerateAsset.mock.calls[0][0];
  expect(retried.provider).toBe("tripo3d");
  expect(retried.prompt).toBe("a rock");
  expect(retried.providerKey).toBe("sk-late-key");
  expect(retried.textureQuality).toBe("standard");
});

test("Use Parametric CAD re-runs the prompt with cad", async () => {
  connectWallet();
  providerSelect.value = "tripo3d";
  providerSelect.dispatchEvent(new Event("change"));
  promptInput.value = "a rock";
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  const cad = dlg.wrap.querySelector("#providerKeyUseCad");
  expect(cad.textContent).toBe("Use Parametric CAD");
  cad.click();
  await flush();
  await flush();
  await flush();

  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(mockGenerateCadAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateCadAsset.mock.calls[0][0].prompt).toBe("a rock");
  // One-off (spec 3.2): the Tripo 3D selection is not replaced by cad.
  expect(localStorage.getItem("arbesk-provider")).toBe("tripo3d");
  document.getElementById("refineIndicatorDetach").click();
  expect(providerSelect.value).toBe("tripo3d");
});

test("Use Parametric CAD is a one-off: the Choose for me selection stays and the next prompt asks again", async () => {
  connectWallet();
  providerSelect.value = "auto";
  providerSelect.dispatchEvent(new Event("change"));
  expect(localStorage.getItem("arbesk-provider")).toBe("auto");
  promptInput.value = "a dragon";
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  dlg.wrap.querySelector("#providerKeyUseCad").click();
  await flush();
  await flush();
  await flush();

  expect(mockGenerateCadAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateCadAsset.mock.calls[0][0].prompt).toBe("a dragon");
  expect(localStorage.getItem("arbesk-provider")).toBe("auto");
  // A result chip may lock the selector while attached; detaching shows the
  // user's own selection, which never changed.
  document.getElementById("refineIndicatorDetach").click();
  expect(providerSelect.value).toBe("auto");

  // The next keyless organic prompt routes to Tripo again and asks for a key.
  const again = openKeyDialogHandle();
  promptInput.value = "a sleeping cat";
  await clickGenerate();
  expect(again.title).toBe("This model needs an AI generator");
  expect(mockGenerateCadAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("with photos attached the CAD button is absent", async () => {
  connectWallet();
  providerSelect.value = "tripo3d";
  await attachImages([new File(["px"], "front.png", { type: "image/png" })]);
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  expect(dlg.wrap).not.toBeNull();
  expect(dlg.wrap.querySelector("#providerKeyUseCad")).toBeNull();
  expect(dlg.wrap.querySelector("#providerKeySave")).not.toBeNull();
});

test("Escape closes the dialog, nothing generates, prompt kept", async () => {
  connectWallet();
  providerSelect.value = "tripo3d";
  promptInput.value = "a rock";
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  dlg.close(null); // Escape / backdrop / close resolve null
  await flush();
  await flush();

  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(promptInput.value).toBe("a rock");
  expect(generateBtn.disabled).toBe(false);

  // The pending dispatch was cleared: a later keyless submit asks again
  // instead of silently replaying the stale route.
  mockShowCustomDialog.mockClear();
  const again = openKeyDialogHandle();
  await clickGenerate();
  expect(again.wrap).not.toBeNull();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("Save key and generate with photos replays the image payload", async () => {
  connectWallet();
  providerSelect.value = "tripo3d";
  await attachImages([new File(["px"], "front.png", { type: "image/png" })]);
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  const field = dlg.wrap.querySelector("#providerKeyInput");
  field.value = "sk-late-key";
  field.dispatchEvent(new Event("input"));
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flush();
  await flush();
  await flush();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args.imageMime).toBe("image/png");
  expect(args.imageName).toBe("front.png");
  expect(args.imageData.length).toBeGreaterThan(0);
});

test("cancelling the key dialog with photos restores prompt and photo chips", async () => {
  connectWallet();
  providerSelect.value = "tripo3d";
  promptInput.value = "a rock";
  await attachImages([new File(["px"], "front.png", { type: "image/png" })]);
  const dlg = openKeyDialogHandle();
  await clickGenerate();
  expect(document.querySelectorAll(".image-attach-chip").length).toBe(0);

  dlg.close(null);
  await flush();
  await flush();

  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(promptInput.value).toBe("a rock");
  expect(document.querySelectorAll(".image-attach-chip").length).toBe(1);
});

test("an invalid-key failure reopens the key dialog with the message; a new key retries", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-bad");
  providerSelect.value = "tripo3d";
  promptInput.value = "a rock";
  mockGenerateAsset.mockRejectedValueOnce(new api.ApiError("unauthorized", 401, "PROVIDER_AUTH_FAILED"));
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  expect(dlg.wrap).not.toBeNull();
  const alertEl = dlg.wrap.querySelector('[role="alert"]');
  expect(alertEl.textContent).toBe(
    "Invalid Tripo3D API key. Check your key in the provider settings.",
  );
  expect(mockAddChatMessage).not.toHaveBeenCalledWith(
    "system",
    expect.stringContaining("Invalid Tripo3D"),
  );

  const field = dlg.wrap.querySelector("#providerKeyInput");
  field.value = "sk-good";
  field.dispatchEvent(new Event("input"));
  dlg.wrap.querySelector("#providerKeySave").click();
  await flush();
  await flush();
  await flush();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(2);
  const retried = mockGenerateAsset.mock.calls[1][0];
  expect(retried.providerKey).toBe("sk-good");
  expect(retried.prompt).toBe("a rock");
});

test("a session 401 posts a chat error and does not open the key dialog", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-fine");
  providerSelect.value = "tripo3d";
  promptInput.value = "a rock";
  mockGenerateAsset.mockRejectedValueOnce(new api.ApiError("bad session", 401, "INVALID_SESSION"));
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  expect(dlg.wrap).toBeNull();
  expect(mockShowCustomDialog).not.toHaveBeenCalled();
  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    "Your sign-in expired. Sign in again and retry.",
  );
});

test("tripo3d with a key sends providerKey, standard quality, and stoppable wiring", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";
  promptInput.value = "a rock";
  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args.provider).toBe("tripo3d");
  expect(args.providerKey).toBe("sk-test-key");
  // No advice, no bundle: the old selector's default survives.
  expect(args.textureQuality).toBe("standard");
  expect(args.tripoModel).toBeUndefined();
  expect(args.signal).toBeInstanceOf(AbortSignal);
  expect(typeof args.onTaskId).toBe("function");
  expect(typeof args.onProgress).toBe("function");

  // Working message carries a cancel (Stop) affordance.
  expect(mockAddWorkingMessage).toHaveBeenCalledWith(
    "Carving your model…",
    expect.objectContaining({ onCancel: expect.any(Function) })
  );
});

test("typed follow-up after a tripo3d generation retextures the active version", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";

  promptInput.value = "a robot";
  await clickGenerate();
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateAsset.mock.calls[0][0].retexture).toBeUndefined();

  promptInput.value = "make it metallic";
  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(2);
  const followup = mockGenerateAsset.mock.calls[1][0];
  expect(followup.prompt).toBe("make it metallic");
  expect(followup.sourceAssetCid).toBe(GENERATION_RESULT.sourceAssetCid);
  expect(followup.retexture).toBe(true);
  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    expect.stringContaining('Refining "a robot"')
  );
  expect(mockJudgeFollowupIntent).toHaveBeenCalledWith({
    prompt: "make it metallic",
    modelName: "a robot",
    actions: ["retexture", "retopo", "split", "auto-rig", "animate"],
  });
});

/** A Jev reading as the follow-up-intent route returns it. */
function reading(action, confidence, extra = {}) {
  return { action, confidence, probabilities: { [action]: confidence }, animations: [], inPlace: true, ...extra };
}

/** Generates "a robot" with tripo3d, leaving its mesh chip attached. */
async function generateRobot() {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";
  promptInput.value = "a robot";
  await clickGenerate();
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
}

test("typed animate follow-up opens the Animate dialog with Jev's motions checked", async () => {
  await generateRobot();
  mockJudgeFollowupIntent.mockResolvedValue(
    reading("animate", 1, { animations: ["preset:run"], inPlace: false }),
  );
  mockShowCustomDialog.mockResolvedValue(undefined); // the user cancels

  promptInput.value = "run across the room";
  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1); // nothing retextured
  const [title, wrap] = mockShowCustomDialog.mock.calls[0];
  expect(title).toBe("Rig & Animate");
  const box = (v) => wrap.querySelector(`input[value="${v}"]`).checked;
  expect(box("preset:run")).toBe(true);
  expect(box("preset:walk")).toBe(false); // a row default, overridden
  expect(box("option:in-place")).toBe(false);
});

test("typed part removal confirms, then splits the model", async () => {
  await generateRobot();
  mockJudgeFollowupIntent.mockResolvedValue(reading("split", 0.9));

  promptInput.value = "remove the horn";
  await clickGenerate();

  // Nothing generated yet - the split costs credits, so it asks first.
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const [message, choices, onPick] = mockAddChoiceMessage.mock.calls[0];
  expect(message).toContain("separate parts");
  expect(choices.map((c) => c.value)).toEqual(["split", "cancel"]);

  onPick("split");
  await flush(); await flush(); await flush();
  expect(mockGenerateAsset).toHaveBeenCalledTimes(2);
  expect(mockGenerateAsset.mock.calls[1][0]).toMatchObject({ split: true, sourceAssetCid: GENERATION_RESULT.sourceAssetCid });
});

test("typed part removal does nothing when the split is cancelled", async () => {
  await generateRobot();
  mockJudgeFollowupIntent.mockResolvedValue(reading("split", 0.9));
  promptInput.value = "remove the horn";
  await clickGenerate();
  mockAddChoiceMessage.mock.calls[0][2]("cancel");
  await flush(); await flush();
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
});

test("typed shape change offers a new model, which starts fresh", async () => {
  await generateRobot();
  mockJudgeFollowupIntent.mockResolvedValue(reading("new_model", 0.95));

  promptInput.value = "give it wings";
  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const [, choices, onPick] = mockAddChoiceMessage.mock.calls[0];
  expect(choices.map((c) => c.value)).toEqual(["new-model", "retexture"]);

  const echoes = mockAddChatMessage.mock.calls.filter(([role]) => role === "user").length;
  onPick("new-model");
  await flush(); await flush(); await flush();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(2);
  const fresh = mockGenerateAsset.mock.calls[1][0];
  expect(fresh.prompt).toBe("give it wings");
  expect(fresh.retexture).toBeUndefined();
  // The prompt was echoed once, when typed - not again on the pick.
  expect(mockAddChatMessage.mock.calls.filter(([role]) => role === "user").length).toBe(echoes);
});

test("an uncertain reading asks, and Retexture runs the old route", async () => {
  await generateRobot();
  mockJudgeFollowupIntent.mockResolvedValue({
    action: "retexture", confidence: 0.36, animations: [], inPlace: true,
    probabilities: { retexture: 0.45, new_model: 0.4, animate: 0.1, unclear: 0.05 },
  });

  promptInput.value = "make it look scary";
  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const [, choices, onPick] = mockAddChoiceMessage.mock.calls[0];
  expect(choices.map((c) => c.label)).toEqual(["Retexture", "New model"]);

  onPick("retexture");
  await flush(); await flush(); await flush();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(2);
  const followup = mockGenerateAsset.mock.calls[1][0];
  expect(followup.retexture).toBe(true);
  expect(followup.prompt).toBe("make it look scary");
});

test("an uncertain animate reading asks, and Animate opens with Jev's motions checked", async () => {
  await generateRobot();
  mockJudgeFollowupIntent.mockResolvedValue({
    action: "animate", confidence: 0.52, animations: ["preset:run"], inPlace: false,
    probabilities: { animate: 0.52, retexture: 0.3, new_model: 0.1, unclear: 0.08 },
  });
  mockShowCustomDialog.mockResolvedValue(undefined); // the user cancels

  promptInput.value = "make it go";
  await clickGenerate();

  const [, choices, onPick] = mockAddChoiceMessage.mock.calls[0];
  expect(choices.map((c) => c.value)).toEqual(["animate", "retexture"]);

  onPick("animate");
  await flush(); await flush(); await flush();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1); // nothing retextured
  const [title, wrap] = mockShowCustomDialog.mock.calls[0];
  expect(title).toBe("Rig & Animate");
  const box = (v) => wrap.querySelector(`input[value="${v}"]`).checked;
  expect(box("preset:run")).toBe(true);
  expect(box("preset:walk")).toBe(false);
  expect(box("option:in-place")).toBe(false);
});

test("single attached image goes out as legacy imageData/imageMime with a synthesized prompt", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";
  await attachImages([new File(["px"], "front.png", { type: "image/png" })]);

  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args.prompt).toBe("Image: front.png");
  expect(args.imageMime).toBe("image/png");
  expect(args.imageName).toBe("front.png");
  expect(typeof args.imageData).toBe("string");
  expect(args.imageData.length).toBeGreaterThan(0);
  expect(args.images).toBeUndefined();
  // The reference image is shown in chat, not a text bubble.
  expect(mockAddImageMessage).toHaveBeenCalledWith(
    "user",
    expect.stringMatching(/^data:image\/png;base64,/),
    "Image: front.png"
  );
});

test("multiple attached images go out as a canonical images[] array", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";
  await attachImages([
    new File(["px1"], "front.png", { type: "image/png" }),
    new File(["px2"], "side.png", { type: "image/png" }),
  ]);

  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args.prompt).toBe("Images: front.png + 1 views");
  expect(args.imageData).toBeUndefined();
  expect(args.images).toHaveLength(2);
  expect(args.images[0]).toMatchObject({ view: "front", imageMime: "image/png", imageName: "front.png" });
  expect(args.images[1]).toMatchObject({ view: "left", imageMime: "image/png", imageName: "side.png" });
  // Multiview chat bubble carries per-view captions.
  expect(mockAddImageMessage).toHaveBeenCalledWith(
    "user",
    expect.any(String),
    "Images: front.png + 1 views",
    expect.objectContaining({
      images: [
        expect.objectContaining({ caption: "Front" }),
        expect.objectContaining({ caption: "Left" }),
      ],
    })
  );
});

test("attaching an image suppresses the typed-follow-up retexture path", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";

  promptInput.value = "a robot";
  await clickGenerate();

  await attachImages([new File(["px"], "ref.png", { type: "image/png" })]);
  promptInput.value = "make it metallic";
  await clickGenerate();

  const followup = mockGenerateAsset.mock.calls[1][0];
  expect(followup.retexture).toBeUndefined();
  expect(followup.sourceAssetCid).toBeUndefined();
  expect(followup.imageMime).toBe("image/png");
});

const ERROR_CASES = [
  ["400 with message", { message: "prompt is required", status: 400 }, "prompt is required"],
  ["400 without message", { message: "", status: 400 }, "Missing required generation parameter."],
  ["401 provider auth", { message: "unauthorized", status: 401, code: "PROVIDER_AUTH_FAILED" }, "Invalid Tripo3D API key. Check your key in the provider settings."],
  ["401 session", { message: "bad session", status: 401, code: "INVALID_SESSION" }, "Your sign-in expired. Sign in again and retry."],
  ["402", { message: "no credits", status: 402 }, "Tripo3D account has insufficient credits."],
  ["429", { message: "slow down", status: 429 }, "Rate limit reached. Please wait before generating again."],
  ["504", { message: "gateway timeout", status: 504 }, "Generation timed out. Try again later."],
  ["timeout code", { message: "x", status: 500, code: "GENERATION_TIMEOUT" }, "Generation timed out. Try again later."],
  ["unknown status falls back to the message", { message: "backend exploded", status: 500 }, "backend exploded"],
];

for (const [label, errDef, expected] of ERROR_CASES) {
  test(`maps ApiError ${label} to a user message`, async () => {
    connectWallet();
    promptInput.value = "a rock";
    mockGenerateAsset.mockRejectedValue(
      new api.ApiError(errDef.message, errDef.status, errDef.code ?? null)
    );
    await clickGenerate();
    expect(mockAddChatMessage).toHaveBeenCalledWith("system", expected);
    expect(generateBtn.disabled).toBe(false);
  });
}

test("user cancellation surfaces a neutral message, not an error", async () => {
  connectWallet();
  promptInput.value = "a rock";
  mockGenerateAsset.mockRejectedValue(
    new api.ApiError("cancelled", 0, "GENERATION_CANCELLED")
  );
  await clickGenerate();
  expect(mockAddChatMessage).toHaveBeenCalledWith("system", "Generation stopped.");
});

test("non-ApiError rejections fall back to err.message", async () => {
  connectWallet();
  promptInput.value = "a rock";
  mockGenerateAsset.mockRejectedValue(new Error("network down"));
  await clickGenerate();
  expect(mockAddChatMessage).toHaveBeenCalledWith("system", "network down");
});

test("the working message is removed in finally, success or failure", async () => {
  connectWallet();
  const working = { remove: jest.fn(), setProgress: jest.fn() };
  mockAddWorkingMessage.mockReturnValue(working);

  promptInput.value = "a rock";
  await clickGenerate();
  expect(working.remove).toHaveBeenCalledTimes(1);

  mockAddWorkingMessage.mockReturnValue(working);
  promptInput.value = "another rock";
  mockGenerateAsset.mockRejectedValue(new Error("boom"));
  await clickGenerate();
  expect(working.remove).toHaveBeenCalledTimes(2);
});

// ─── Generation advisor (Jev) ───

const ADVICE = {
  provider: "tripo3d",
  providerConfidence: 0.9,
  providerProbabilities: { tripo3d: 0.9 },
  config: "balanced",
  configConfidence: 0.9,
  configProbabilities: { balanced: 0.9 },
};

test("advisor auto-pick threads the config bundle fields into the dispatch", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "auto";
  mockFetchGenerationAdvice.mockResolvedValue(ADVICE);
  mockDecideGenerationPlan.mockReturnValue({
    kind: "auto",
    provider: "tripo3d",
    configId: "game-ready",
  });
  promptInput.value = "a low-poly treasure chest";
  await clickGenerate();

  expect(mockFetchGenerationAdvice).toHaveBeenCalledWith("a low-poly treasure chest", {
    hasImage: false,
    cadAvailable: true,
  });
  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    "Using Game-ready (low poly) — Tripo P1 · 5K faces.",
  );
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args).toMatchObject({
    provider: "tripo3d",
    providerKey: "sk-test-key",
    tripoModel: "P1-20260311",
    textureQuality: "standard",
    faceLimit: 5000,
  });
});

test("advisor auto-pick of CAD runs the CAD flow once; Choose for me stays selected", async () => {
  connectWallet();
  providerSelect.value = "auto";
  providerSelect.dispatchEvent(new Event("change"));
  mockFetchGenerationAdvice.mockResolvedValue(ADVICE);
  mockDecideGenerationPlan.mockReturnValue({ kind: "auto", provider: "cad" });
  promptInput.value = "a 40 by 30 by 20 mm bracket";
  await clickGenerate();

  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    "Routing to Parametric CAD — this looks like an engineering part.",
  );
  expect(localStorage.getItem("arbesk-provider")).toBe("auto");
  expect(mockGenerateCadAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateAsset).not.toHaveBeenCalled();
  document.getElementById("refineIndicatorDetach").click();
  expect(providerSelect.value).toBe("auto");
});

test("an unsure advisor asks; the Tripo pick dispatches with that config", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "auto";
  mockFetchGenerationAdvice.mockResolvedValue(ADVICE);
  mockDecideGenerationPlan.mockReturnValue({
    kind: "ask",
    options: [
      { value: "tripo3d:hero-detail", label: "Hero detail", recommended: true },
      { value: "cad", label: "Parametric CAD", recommended: false },
    ],
  });
  promptInput.value = "something ambiguous";
  await clickGenerate();

  expect(mockGenerateAsset).not.toHaveBeenCalled();
  const [text, choices, onPick] = mockAddChoiceMessage.mock.calls[0];
  expect(text).toContain("my recommendation");
  expect(choices).toEqual([
    { value: "tripo3d:hero-detail", label: "Hero detail (Recommended)" },
    { value: "cad", label: "Parametric CAD" },
  ]);

  onPick("tripo3d:hero-detail");
  await flush();
  await flush();
  await flush();
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args).toMatchObject({
    provider: "tripo3d",
    tripoModel: "v3.1-20260211",
    textureQuality: "detailed",
  });
  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    "Using Hero detail — Tripo v3.1 · detailed textures.",
  );
});

test("an unsure advisor asks; the CAD pick dispatches CAD once under Choose for me", async () => {
  connectWallet();
  providerSelect.value = "auto";
  providerSelect.dispatchEvent(new Event("change"));
  mockFetchGenerationAdvice.mockResolvedValue(ADVICE);
  mockDecideGenerationPlan.mockReturnValue({
    kind: "ask",
    options: [
      { value: "cad", label: "Parametric CAD", recommended: true },
      { value: "tripo3d:balanced", label: "Balanced", recommended: false },
    ],
  });
  promptInput.value = "maybe a gear?";
  await clickGenerate();

  const [, , onPick] = mockAddChoiceMessage.mock.calls[0];
  onPick("cad");
  await flush();
  await flush();
  await flush();
  expect(localStorage.getItem("arbesk-provider")).toBe("auto");
  expect(mockGenerateCadAsset).toHaveBeenCalledTimes(1);
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("advice failure (null) falls back to Tripo with the balanced defaults", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "auto";
  mockFetchGenerationAdvice.mockResolvedValue(null); // 503 / network failure
  promptInput.value = "a rock";
  await clickGenerate();

  expect(mockDecideGenerationPlan).toHaveBeenCalledWith(null, {
    cadAvailable: true,
    provider: "auto",
  });
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args).toMatchObject({
    provider: "tripo3d",
    tripoModel: "v3.1-20260211",
    textureQuality: "standard",
  });
});

test("auto without a BYOK key opens the dialog and retries with the same bundle", async () => {
  connectWallet();
  providerSelect.value = "auto";
  mockFetchGenerationAdvice.mockResolvedValue(ADVICE);
  mockDecideGenerationPlan.mockReturnValue({
    kind: "auto",
    provider: "tripo3d",
    configId: "game-ready",
  });
  promptInput.value = "a low-poly treasure chest";
  const dlg = openKeyDialogHandle();
  await clickGenerate();

  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(dlg.title).toBe("This model needs an AI generator");

  const field = dlg.wrap.querySelector("#providerKeyInput");
  field.value = "sk-late-key";
  field.dispatchEvent(new Event("input"));
  dlg.wrap.querySelector("#providerKeySave").click();
  await flush();
  await flush();
  await flush();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  // The retry keeps the advisor's route — no second Jev round-trip.
  expect(mockFetchGenerationAdvice).toHaveBeenCalledTimes(1);
  expect(args).toMatchObject({
    provider: "tripo3d",
    tripoModel: "P1-20260311",
    textureQuality: "standard",
    faceLimit: 5000,
  });
});

test("Show in Studio keeps the sidebar on Create (the panel opened it itself)", async () => {
  connectWallet();
  const handle = {
    canvas: null,
    markFallback: jest.fn(),
    collapsePreview: jest.fn(),
    setSendDisabled: jest.fn(),
    markSent: jest.fn(),
  };
  mockAddAssetMessage.mockReturnValue(handle);
  mockDisposeChatPreview.mockResolvedValue(null);
  mockLoadAssetManifest.mockResolvedValue({});
  promptInput.value = "a chair";
  await clickGenerate();
  const [generationId, send] = mockRegisterAssetSendHandler.mock.calls.at(-1);
  send(generationId);
  await flush();
  await flush();
  expect(mockKeepCreateView).toHaveBeenCalled();
  expect(mockLoadAssetManifest).toHaveBeenCalled();
  expect(mockKeepCreateView.mock.invocationCallOrder[0]).toBeLessThan(
    mockLoadAssetManifest.mock.invocationCallOrder[0],
  );
});
