/**
 * Characterization tests for the follow-up action cluster in
 * ui/create-panel.ts: onRetexture / onRetopo / onAutoRig / onAnimate /
 * retryRig / retryAnimate. These share one skeleton (record guard → dialog →
 * wallet/session gates → stoppable working message → generateAsset →
 * presentGenerationResult → error mapping) and are the file's remaining
 * high-CRAP functions — these tests pin their behavior for refactoring.
 *
 * Actions are reached through the real wiring: a seeded tripo3d generation
 * produces a pending record + action row (captured from the addAssetActionRow
 * mock), and tests invoke the action's onPick. Dialogs are driven through
 * their real DOM (the showCustomDialog mock only wires closeDialog).
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

const assetDomainState = { name: null, activeCid: null, latestCid: null, tokenId: null };

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

// ─── DOM fragment (same ids as app.pug / the onGenerate suite) ───

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
const settle = async () => { await flush(); await flush(); await flush(); };

/** @type {typeof import("../../frontend/src/js/services/api.js")} */
let api;
let walletState;
let pendingGens;
let promptInput;
let generateBtn;
let providerSelect;

const SEED_RESULT = {
  assetManifestCid: "bafyAssetCid",
  sourceAssetCid: "bafySourceCid",
  format: "glb",
  taskId: "backend-task-1",
};

/** Dialogs opened via showCustomDialog, in order. */
let openDialogs = [];

beforeAll(async () => {
  document.body.innerHTML = FRAGMENT;
  await import("../../frontend/src/js/ui/create-panel.js");
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
  assetDomainState.name = null;
  assetDomainState.activeCid = null;
  assetDomainState.latestCid = null;
  assetDomainState.tokenId = null;
  openDialogs = [];

  promptInput.value = "";
  providerSelect.value = "mock";
  providerSelect.dispatchEvent(new Event("change"));
  generateBtn.disabled = false;
  generateBtn.classList.remove("generating");
  document.getElementById("refineIndicatorDetach").click();

  mockGetOrCreateSession.mockResolvedValue("session-token");
  mockGenerateAsset.mockResolvedValue({ ...SEED_RESULT });
  mockGetProviderBalance.mockResolvedValue({ balance: 5 });
  // Minimal dialog shell: wire closeDialog so the module's own buttons drive
  // the resolution; tests find the dialog in openDialogs and click through.
  mockShowCustomDialog.mockImplementation((title, wrap) => {
    return new Promise((resolve) => {
      wrap.closeDialog = resolve;
      openDialogs.push({ title, wrap });
    });
  });
  mockShowCheckboxDialog.mockResolvedValue(null);
  // Non-null handle so the action row gets wired; canvas null → fallback path.
  mockAddAssetMessage.mockReturnValue({
    canvas: null,
    markFallback: jest.fn(),
    collapsePreview: jest.fn(),
  });
  mockAddWorkingMessage.mockReturnValue({ remove: jest.fn(), setProgress: jest.fn() });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * Seed a tripo3d generation bubble and return its pending-generation id plus
 * the captured action row ({id, label, onPick}).
 */
async function seedBubble() {
  walletState.set({ walletAddress: ADDRESS });
  localStorage.setItem("arbesk-byok-key", "sk-test-key");
  providerSelect.value = "tripo3d";
  promptInput.value = "a robot";
  generateBtn.click();
  await settle();

  const record = pendingGens.listPendingGenerations()[0];
  const actionRowCalls = mockAddAssetActionRow.mock.calls;
  const actions = actionRowCalls[actionRowCalls.length - 1][1];

  // Reset call history so assertions only see the follow-up call.
  mockGenerateAsset.mockClear();
  mockAddChatMessage.mockClear();
  mockAddWorkingMessage.mockClear();
  mockDismissCreatePulse.mockClear();
  mockAddChoiceMessage.mockClear();
  return { generationId: record.id, actions };
}

function pickAction(actions, label) {
  const action = actions.find((a) => a.label === label);
  if (!action) throw new Error(`action "${label}" not offered: ${actions.map((a) => a.label).join(", ")}`);
  action.onPick();
}

function lastDialog() {
  if (openDialogs.length === 0) throw new Error("expected a dialog to be open");
  return openDialogs[openDialogs.length - 1];
}

function lastGenerateArgs() {
  expect(mockGenerateAsset).toHaveBeenCalledTimes(1);
  return mockGenerateAsset.mock.calls[0][0];
}

// ─── onRetopo ───

test("retopo: cancelled polygon-budget dialog aborts before any gate", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Retopo");
  await settle();
  lastDialog().wrap.closeDialog(null);
  await settle();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("retopo: adaptive (empty budget) sends retopo:true without faceLimit", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Retopo");
  await settle();
  const dlg = lastDialog();
  expect(dlg.title).toBe("Retopo — polygon budget");
  dlg.wrap.querySelector("#faceLimitInput").value = "";
  dlg.wrap.querySelector("#faceLimitGo").click();
  await settle();

  const args = lastGenerateArgs();
  expect(args).toMatchObject({
    prompt: "Retopo for animation",
    provider: "tripo3d",
    providerKey: "sk-test-key",
    sourceAssetCid: SEED_RESULT.sourceAssetCid,
    retopo: true,
    tier: 0,
  });
  expect(args.faceLimit).toBeUndefined();
  expect(args.nodeId).toMatch(/^untitled_asset_retopo_\d+$/);
  expect(args.signal).toBeInstanceOf(AbortSignal);
  expect(mockAddChatMessage).toHaveBeenCalledWith("user", "Retopo for animation");
  // Result lands as a retopo bubble.
  const records = pendingGens.listPendingGenerations();
  expect(records[records.length - 1]).toMatchObject({ task: "retopo", provider: "tripo3d" });
  expect(mockDismissCreatePulse).toHaveBeenCalled();
});

test("retopo: explicit budget is passed as faceLimit", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Retopo");
  await settle();
  const dlg = lastDialog();
  dlg.wrap.querySelector("#faceLimitInput").value = "5000";
  dlg.wrap.querySelector("#faceLimitGo").click();
  await settle();
  expect(lastGenerateArgs().faceLimit).toBe(5000);
});

test("retopo: requires a wallet after the dialog confirms", async () => {
  const { actions } = await seedBubble();
  walletState.reset();
  const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  pickAction(actions, "Retopo");
  await settle();
  lastDialog().wrap.querySelector("#faceLimitGo").click();
  await settle();
  expect(alertSpy).toHaveBeenCalledWith("Please log in or sign up first.");
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("retopo: session failure shows the retopo sign-in toast", async () => {
  const { actions } = await seedBubble();
  mockGetOrCreateSession.mockRejectedValue(new Error("rejected"));
  pickAction(actions, "Retopo");
  await settle();
  lastDialog().wrap.querySelector("#faceLimitGo").click();
  await settle();
  expect(mockShowToast).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Sign in to retopo assets." })
  );
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("retopo: maps timeout/cancel/auth errors and always removes the working message", async () => {
  const { actions } = await seedBubble();
  const working = { remove: jest.fn(), setProgress: jest.fn() };
  mockAddWorkingMessage.mockReturnValue(working);

  const cases = [
    [new api.ApiError("x", 500, "GENERATION_TIMEOUT"), "Retopo timed out. Try again later."],
    [new api.ApiError("x", 401), "Invalid Tripo3D API key. Check your key in the provider settings."],
    [new api.ApiError("x", 402), "Tripo3D account has insufficient credits."],
    [new api.ApiError("cancelled", 0, "GENERATION_CANCELLED"), "Retopo stopped."],
    [new Error("boom"), "boom"],
  ];
  for (const [err, expected] of cases) {
    mockGenerateAsset.mockRejectedValueOnce(err);
    mockAddChatMessage.mockClear();
    pickAction(actions, "Retopo");
    await settle();
    lastDialog().wrap.querySelector("#faceLimitGo").click();
    await settle();
    expect(mockAddChatMessage).toHaveBeenCalledWith("system", expected);
    // A cancelled dialog from the previous iteration never resolves twice:
    // each pick opens a fresh dialog, so the working handle churns per run.
  }
  expect(working.remove.mock.calls.length).toBeGreaterThanOrEqual(cases.length);
});

// ─── onAutoRig ───

test("auto-rig: auto model sends rigOnly without rigModel and offers retry chips", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Auto-rig");
  await settle();
  const dlg = lastDialog();
  expect(dlg.title).toBe("Auto-rig — rig model");
  // Leave "Auto (recommended)" selected.
  dlg.wrap.querySelector("button.btn-primary").click();
  await settle();

  const args = lastGenerateArgs();
  expect(args).toMatchObject({
    prompt: "Auto-rig",
    animate: true,
    rigOnly: true,
    sourceAssetCid: SEED_RESULT.sourceAssetCid,
  });
  expect(args.rigModel).toBeUndefined();
  expect(args.nodeId).toMatch(/_rig_\d+$/);
  const records = pendingGens.listPendingGenerations();
  expect(records[records.length - 1]).toMatchObject({ task: "rig" });
  // No explicit rig choice → retry chips with the other skeletons.
  expect(mockAddChoiceMessage).toHaveBeenCalledWith(
    "Rig didn't come out as expected? Try a different skeleton:",
    expect.arrayContaining([
      expect.objectContaining({ value: "v1.0-20240301" }),
      expect.objectContaining({ value: "v2.5-20260210" }),
    ]),
    expect.any(Function)
  );
});

test("auto-rig: explicit v1.0 choice passes rigModel and skips retry chips", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Auto-rig");
  await settle();
  const dlg = lastDialog();
  const radio = dlg.wrap.querySelector('input[value="v1.0-20240301"]');
  radio.checked = true;
  radio.dispatchEvent(new Event("change"));
  dlg.wrap.querySelector("button.btn-primary").click();
  await settle();

  expect(lastGenerateArgs().rigModel).toBe("v1.0-20240301");
  const records = pendingGens.listPendingGenerations();
  expect(records[records.length - 1].rigModel).toBe("v1.0-20240301");
  expect(mockAddChoiceMessage).not.toHaveBeenCalled();
});

test("auto-rig: cancelled rig-model dialog aborts", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Auto-rig");
  await settle();
  lastDialog().wrap.closeDialog(null);
  await settle();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("auto-rig: MODEL_NOT_RIGGABLE gets the humanoid guidance message", async () => {
  const { actions } = await seedBubble();
  mockGenerateAsset.mockRejectedValue(new api.ApiError("not riggable", 400, "MODEL_NOT_RIGGABLE"));
  pickAction(actions, "Auto-rig");
  await settle();
  lastDialog().wrap.querySelector("button.btn-primary").click();
  await settle();
  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    expect.stringContaining("isn't riggable")
  );
});

// ─── onAnimate ───

test("animate: default dialog state chains idle+walk in place off the source task", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Animate…");
  await settle();
  const dlg = lastDialog();
  expect(dlg.title).toBe("Rig & Animate");
  dlg.wrap.querySelector("button.btn-primary").click();
  await settle();

  const args = lastGenerateArgs();
  expect(args).toMatchObject({
    prompt: "Animate: idle, walk",
    animate: true,
    animations: ["preset:idle", "preset:walk"],
    animateInPlace: true,
    sourceAssetCid: SEED_RESULT.sourceAssetCid,
    sourceTaskId: "backend-task-1",
  });
  expect(args.rigModel).toBeUndefined();
  expect(args.nodeId).toMatch(/_anim_\d+$/);
  expect(mockAddChatMessage).toHaveBeenCalledWith("user", "Animate: idle, walk");
  const records = pendingGens.listPendingGenerations();
  expect(records[records.length - 1]).toMatchObject({ task: "animate" });
  expect(mockAddChoiceMessage).toHaveBeenCalledWith(
    "Animation deformed? Try the other rig model:",
    expect.any(Array),
    expect.any(Function)
  );
});

test("animate: no presets selected aborts after the dialog", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Animate…");
  await settle();
  const dlg = lastDialog();
  for (const value of ["preset:idle", "preset:walk"]) {
    const box = dlg.wrap.querySelector(`input[value="${value}"]`);
    box.checked = false;
  }
  dlg.wrap.querySelector("button.btn-primary").click();
  await settle();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("animate: cancelled dialog aborts", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Animate…");
  await settle();
  lastDialog().wrap.closeDialog(undefined);
  await settle();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("animate: maps not-riggable, timeout, and cancel errors", async () => {
  const { actions } = await seedBubble();
  const cases = [
    [new api.ApiError("x", 400, "MODEL_NOT_RIGGABLE"), "This model isn't riggable. Generate a full-body humanoid or creature (T-pose works best) and try again."],
    [new api.ApiError("x", 500, "GENERATION_TIMEOUT"), "Animation timed out. Try again later."],
    [new api.ApiError("cancelled", 0, "GENERATION_CANCELLED"), "Animation stopped."],
    [new Error("kaboom"), "kaboom"],
  ];
  for (const [err, expected] of cases) {
    mockGenerateAsset.mockRejectedValueOnce(err);
    mockAddChatMessage.mockClear();
    pickAction(actions, "Animate…");
    await settle();
    lastDialog().wrap.querySelector("button.btn-primary").click();
    await settle();
    expect(mockAddChatMessage).toHaveBeenCalledWith("system", expected);
  }
});

// ─── retryRig / retryAnimate (via the rig retry chips) ───

/** Seed, run auto-rig with Auto model, and capture the retry-chip callback. */
async function seedRigRetryChip() {
  const seeded = await seedBubble();
  pickAction(seeded.actions, "Auto-rig");
  await settle();
  lastDialog().wrap.querySelector("button.btn-primary").click();
  await settle();
  const call = mockAddChoiceMessage.mock.calls[0];
  mockGenerateAsset.mockClear();
  mockAddChatMessage.mockClear();
  return { ...seeded, chipOnPick: call[2] };
}

test("retryRig: chip re-runs the rig with the chosen skeleton forced", async () => {
  const { chipOnPick } = await seedRigRetryChip();
  chipOnPick("v1.0-20240301");
  await settle();

  const args = lastGenerateArgs();
  expect(args).toMatchObject({
    prompt: "Auto-rig",
    animate: true,
    rigOnly: true,
    rigModel: "v1.0-20240301",
  });
  expect(mockAddChatMessage).toHaveBeenCalledWith("user", "Auto-rig (v1.0 Humanoid)");
  // Explicit model on the retry → no further retry chips.
  expect(mockAddChoiceMessage).toHaveBeenCalledTimes(1);
});

test("retryRig: not-riggable error uses the short message", async () => {
  const { chipOnPick } = await seedRigRetryChip();
  mockGenerateAsset.mockRejectedValue(new api.ApiError("x", 400, "MODEL_NOT_RIGGABLE"));
  chipOnPick("v2.5-20260210");
  await settle();
  expect(mockAddChatMessage).toHaveBeenCalledWith("system", "This model isn't riggable.");
});

/** Seed, run animate with Auto model, and capture the retry-chip callback. */
async function seedAnimateRetryChip() {
  const seeded = await seedBubble();
  pickAction(seeded.actions, "Animate…");
  await settle();
  lastDialog().wrap.querySelector("button.btn-primary").click();
  await settle();
  const call = mockAddChoiceMessage.mock.calls[0];
  mockGenerateAsset.mockClear();
  mockAddChatMessage.mockClear();
  return { ...seeded, chipOnPick: call[2] };
}

test("retryAnimate: chip prompts for presets, then animates with the forced skeleton", async () => {
  const { chipOnPick } = await seedAnimateRetryChip();
  mockShowCheckboxDialog.mockResolvedValue(["preset:run", "option:in-place"]);
  chipOnPick("v2.5-20260210");
  await settle();

  expect(mockShowCheckboxDialog).toHaveBeenCalledWith(
    "Retry Animate",
    expect.stringContaining("v2.5 Generic"),
    expect.any(Array),
    { max: 5 }
  );
  const args = lastGenerateArgs();
  expect(args).toMatchObject({
    prompt: "Animate: run",
    animate: true,
    animations: ["preset:run"],
    animateInPlace: true,
    rigModel: "v2.5-20260210",
  });
  expect(mockAddChatMessage).toHaveBeenCalledWith("user", "Animate: run (v2.5)");
});

test("retryAnimate: cancelled preset picker aborts", async () => {
  const { chipOnPick } = await seedAnimateRetryChip();
  mockShowCheckboxDialog.mockResolvedValue(null);
  chipOnPick("v2.5-20260210");
  await settle();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("retryAnimate: not-riggable error mentions the chosen skeleton", async () => {
  const { chipOnPick } = await seedAnimateRetryChip();
  mockShowCheckboxDialog.mockResolvedValue(["preset:run"]);
  mockGenerateAsset.mockRejectedValue(new api.ApiError("x", 400, "MODEL_NOT_RIGGABLE"));
  chipOnPick("v2.5-20260210");
  await settle();
  expect(mockAddChatMessage).toHaveBeenCalledWith(
    "system",
    "This model isn't riggable with the chosen skeleton."
  );
});

// ─── onRetexture ───

test("retexture: texture prompt dialog drives a texture-only refine", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Retexture");
  await settle();
  const dlg = lastDialog();
  expect(dlg.title).toBe("Retexture — texture prompt");
  dlg.wrap.querySelector("#texturePromptInput").value = "weathered bronze";
  dlg.wrap.querySelector("#texturePromptGo").click();
  await settle();

  const args = lastGenerateArgs();
  expect(args).toMatchObject({
    prompt: "weathered bronze",
    retexture: true,
    textureQuality: "standard",
    sourceAssetCid: SEED_RESULT.sourceAssetCid,
  });
  expect(args.nodeId).toMatch(/_retex_\d+$/);
  expect(mockAddChatMessage).toHaveBeenCalledWith("user", "Retexture: weathered bronze");
  const records = pendingGens.listPendingGenerations();
  expect(records[records.length - 1]).toMatchObject({ task: "texture" });
});

test("retexture: empty prompt aborts", async () => {
  const { actions } = await seedBubble();
  pickAction(actions, "Retexture");
  await settle();
  const dlg = lastDialog();
  dlg.wrap.querySelector("#texturePromptInput").value = "   ";
  dlg.wrap.querySelector("#texturePromptGo").click();
  await settle();
  expect(mockGenerateAsset).not.toHaveBeenCalled();
});

test("retexture: cancel and failure messages", async () => {
  const { actions } = await seedBubble();
  // cancel
  mockGenerateAsset.mockRejectedValueOnce(new api.ApiError("c", 0, "GENERATION_CANCELLED"));
  pickAction(actions, "Retexture");
  await settle();
  let dlg = lastDialog();
  dlg.wrap.querySelector("#texturePromptInput").value = "bronze";
  dlg.wrap.querySelector("#texturePromptGo").click();
  await settle();
  expect(mockAddChatMessage).toHaveBeenCalledWith("system", "Retexture stopped.");

  // generic ApiError falls back to err.message; non-ApiError to the canned line
  mockGenerateAsset.mockRejectedValueOnce(new api.ApiError("provider said no", 500));
  mockAddChatMessage.mockClear();
  pickAction(actions, "Retexture");
  await settle();
  dlg = lastDialog();
  dlg.wrap.querySelector("#texturePromptInput").value = "bronze";
  dlg.wrap.querySelector("#texturePromptGo").click();
  await settle();
  expect(mockAddChatMessage).toHaveBeenCalledWith("system", "provider said no");
});
