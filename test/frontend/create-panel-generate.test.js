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
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, beforeEach, afterEach } from "@jest/globals";

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
const mockCancelGenerationTask = jest.fn();
const mockGetOrCreateSession = jest.fn();
const mockGetProviderBalance = jest.fn();

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

jest.unstable_mockModule("../../frontend/src/js/engine/scene-graph.js", () => ({
  loadAssetManifest: mockLoadAssetManifest,
  clearScene: mockClearScene,
  dismissCreatePulse: mockDismissCreatePulse,
}));
jest.unstable_mockModule("../../frontend/src/js/ui/toasts.js", () => ({
  showToast: mockShowToast,
}));
jest.unstable_mockModule("../../frontend/src/js/ui/dialog.js", () => ({
  showCustomDialog: mockShowCustomDialog,
  showCheckboxDialog: mockShowCheckboxDialog,
}));
jest.unstable_mockModule("../../frontend/src/js/ui/chat-messages.js", () => ({
  addChatMessage: mockAddChatMessage,
  addAssetMessage: mockAddAssetMessage,
  addWorkingMessage: mockAddWorkingMessage,
  addImageMessage: mockAddImageMessage,
  clearChatMessages: mockClearChatMessages,
  addAssetActionRow: mockAddAssetActionRow,
  addChoiceMessage: mockAddChoiceMessage,
  registerAssetSendHandler: mockRegisterAssetSendHandler,
}));
jest.unstable_mockModule("../../frontend/src/js/ui/alpine.js", () => ({
  Alpine: { nextTick: async () => {}, store: () => ({}) },
}));
jest.unstable_mockModule("../../frontend/src/js/ui/chat-history.js", () => ({
  renderChatProvenance: mockRenderChatProvenance,
  clearHistoryBubbles: mockClearHistoryBubbles,
}));
jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, code = null) {
      super(message);
      this.status = status;
      this.code = code;
      this.name = "ApiError";
    }
  },
  generateAsset: mockGenerateAsset,
  cancelGenerationTask: mockCancelGenerationTask,
  getOrCreateSession: mockGetOrCreateSession,
  getProviderBalance: mockGetProviderBalance,
}));
jest.unstable_mockModule("../../frontend/src/js/services/chat-preview.js", () => ({
  createChatPreview: mockCreateChatPreview,
  disposeChatPreview: mockDisposeChatPreview,
  disposeAllChatPreviews: mockDisposeAllChatPreviews,
}));
jest.unstable_mockModule("../../frontend/src/js/ui/asset-save.js", () => ({
  onSaveAssetDraft: mockOnSaveAssetDraft,
}));
jest.unstable_mockModule("@arbesk/asset-core/domain/asset.js", () => ({
  adoptManifestName: jest.fn(),
  adoptOpenedAsset: jest.fn(),
  setActiveManifestCid: jest.fn((cid) => { assetDomainState.activeCid = cid; }),
  setLatestManifestCid: jest.fn((cid) => { assetDomainState.latestCid = cid; }),
  getActiveAssetManifestCid: () => assetDomainState.activeCid,
  getLatestAssetManifestCid: () => assetDomainState.latestCid,
  getActiveAssetTokenId: () => assetDomainState.tokenId,
  getActiveAssetName: () => assetDomainState.name,
}));
jest.unstable_mockModule("@arbesk/asset-core/domain/collection.js", () => ({
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
    <option value="mock">Mock</option>
    <option value="tripo3d">Tripo 3D</option>
  </select>
  <select id="tierSelect">
    <option value="">Auto</option>
    <option value="0">Free</option>
    <option value="1">Paid</option>
  </select>
  <select id="collectionSelect"></select>
  <button id="providerKeyBtn" type="button"></button>
  <div id="providerKeyHint"></div>
  <span id="bottomBarProvider"></span>
  <div id="providerBalance"></div>
  <div id="textureQualityRow"></div>
  <select id="textureQualitySelect">
    <option value="standard">Standard</option>
    <option value="detailed">Detailed</option>
    <option value="extreme">Extreme</option>
  </select>
  <details id="composerSettings"></details>
  <div id="refineIndicator">
    <span id="refineIndicatorText"></span>
    <button id="refineIndicatorDetach" type="button"></button>
  </div>`;

const flush = () => new Promise((r) => setTimeout(r, 0));

/** @type {typeof import("../../frontend/src/js/services/api.js")} */
let api;
let walletState;
let pendingGens;
let promptInput;
let generateBtn;
let providerSelect;
let textureQualitySelect;

const GENERATION_RESULT = {
  assetManifestCid: "bafyAssetCid",
  sourceAssetCid: "bafySourceCid",
  format: "glb",
};

beforeAll(async () => {
  document.body.innerHTML = FRAGMENT;
  await import("../../frontend/src/js/ui/create-panel.js");
  api = await import("../../frontend/src/js/services/api.js");
  ({ walletState } = await import("../../frontend/src/js/state/wallet-state.js"));
  pendingGens = await import("../../frontend/src/js/state/pending-generations.js");
  promptInput = document.getElementById("promptInput");
  generateBtn = document.getElementById("generateBtn");
  providerSelect = document.getElementById("providerSelect");
  textureQualitySelect = document.getElementById("textureQualitySelect");
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

  promptInput.value = "";
  textureQualitySelect.value = "standard";
  // Switching back to the mock provider discards attached images (module
  // behavior) — resets the image state leaked from a previous test.
  providerSelect.value = "mock";
  providerSelect.dispatchEvent(new Event("change"));
  // The button starts disabled until a wallet connects (updateGenerateHint);
  // tests drive the click path directly, so pin the enabled precondition.
  generateBtn.disabled = false;
  generateBtn.classList.remove("generating");
  // Break any refine chain leaked by a previous test's tripo3d generation.
  document.getElementById("refineIndicatorDetach").click();

  mockGetOrCreateSession.mockResolvedValue("session-token");
  mockGenerateAsset.mockResolvedValue({ ...GENERATION_RESULT });
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
  // Mock provider: no BYOK key, no texture quality, no stoppable wiring.
  expect(args.providerKey).toBeUndefined();
  expect(args.textureQuality).toBeUndefined();
  expect(args.signal).toBeUndefined();

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

test("real provider without a BYOK key opens the key dialog instead of generating", async () => {
  connectWallet();
  providerSelect.value = "tripo3d";
  promptInput.value = "a rock";
  await clickGenerate();
  expect(mockShowCustomDialog).toHaveBeenCalledWith(
    "Tripo 3D API Key",
    expect.any(HTMLElement)
  );
  expect(mockGenerateAsset).not.toHaveBeenCalled();
  expect(generateBtn.disabled).toBe(false);
});

test("tripo3d with a key sends providerKey, texture quality, and stoppable wiring", async () => {
  connectWallet();
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";
  textureQualitySelect.value = "detailed";
  promptInput.value = "a rock";
  await clickGenerate();

  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateAsset.mock.calls[0][0];
  expect(args.provider).toBe("tripo3d");
  expect(args.providerKey).toBe("sk-test-key");
  expect(args.textureQuality).toBe("detailed");
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
  ["401", { message: "unauthorized", status: 401 }, "Invalid Tripo3D API key. Check your key in the provider settings."],
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
