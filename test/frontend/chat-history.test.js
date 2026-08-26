/**
 * Chat provenance history view tests (Alpine store-backed).
 *
 * chat-history.js renders manifest-chain metadata.chat records as history
 * messages in the reactive chat store, prepended above live messages.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, afterEach } from "@jest/globals";

const flush = () => new Promise((r) => setTimeout(r, 0));

const walkManifestChain = jest.fn();
const emit = jest.fn();
const addPendingGeneration = jest.fn(() => "gen-1");

jest.unstable_mockModule("../../frontend/src/js/engine/time-travel.js", () => ({
  walkManifestChain,
}));
jest.unstable_mockModule("../../frontend/src/js/state/pending-generations.js", () => ({
  addPendingGeneration,
}));
jest.unstable_mockModule("@arbesk/asset-core/events/bus.js", () => ({
  emit,
  EVENTS: {
    HISTORY_VERSION_SELECTED: "asset:historyVersionSelected",
    HISTORY_VERSION_ACTIONABLE: "asset:historyVersionActionable",
  },
}));

let mod;
let chat;
let Alpine;

beforeAll(async () => {
  document.body.innerHTML = '<div id="chatHistoryList"></div>';
  mod = await import("../../frontend/src/js/ui/chat-history.js");
  chat = await import("../../frontend/src/js/ui/chat-messages.js");
  ({ Alpine } = await import("../../frontend/src/js/ui/alpine.js"));
  await flush();
});

afterEach(() => {
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
  mod.clearHistoryBubbles();
  chat.clearChatMessages();
  jest.clearAllMocks();
  addPendingGeneration.mockReturnValue("gen-1");
});

const msgs = () => Alpine.store("chat").messages;
const history = () =>
  msgs().filter((m) => m.kind === "text" && m.extraClass.includes("chat-bubble-history"));
const versions = () =>
  msgs().filter((m) => m.kind === "text" && m.extraClass.includes("chat-bubble-version"));

test("renders chain metadata.chat entries oldest-first as history bubbles, prepended", async () => {
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "first cabin", provider: "mock", task: "model", timestamp: 1780000000 }] },
    { cid: "v2", chat: null },
    { cid: "v3", chat: [{ prompt: "red roof", provider: "parametric", task: "parametric", timestamp: 1780000100 }] },
  ]);
  await mod.renderChatProvenance("v3");

  const h = history();
  expect(h).toHaveLength(4); // header + 2 prompts + divider
  expect(h[0].text).toBe("Prompt history");
  expect(h[1].text).toContain("first cabin");
  expect(h[2].text).toContain("red roof (parametric)");
  expect(h[3].text).toBe("— New session —");

  // prepended above live messages
  chat.addChatMessage("user", "live message");
  expect(msgs()[0].text).toBe("Prompt history");
  expect(msgs().some((m) => m.text === "live message")).toBe(true);
});

test("clearHistoryBubbles removes only history messages", async () => {
  chat.addChatMessage("user", "live message");
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "h", provider: "mock", task: "model", timestamp: 1 }] },
  ]);
  await mod.renderChatProvenance("v1");
  expect(history().length).toBeGreaterThan(0);

  mod.clearHistoryBubbles();
  expect(history()).toHaveLength(0);
  expect(msgs().some((m) => m.text === "live message")).toBe(true);
});

test("dedups repeated prompts across the chain", async () => {
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "A", provider: "mock", timestamp: 1 }] },
    { cid: "v2", chat: [{ prompt: "A", provider: "mock", timestamp: 1 }] },
  ]);
  await mod.renderChatProvenance("v2");
  expect(versions()).toHaveLength(1);
});

test("a chain entry whose chat is a single object still renders", async () => {
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: { prompt: "lone prompt", provider: "mock", task: "model", timestamp: 1 } },
  ]);
  await mod.renderChatProvenance("v1");
  const v = versions()[0];
  expect(v).toBeDefined();
  expect(v.text).toContain("lone prompt");
  expect(v.manifestCid).toBe("v1");
});

test("tripo3d versions with a GLB become actionable: record + event + generationId", async () => {
  addPendingGeneration.mockReturnValue("gen-1");
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "knight", provider: "tripo3d", task: "model", timestamp: 1 }], sourceCid: "glb-v1" },
  ]);
  await mod.renderChatProvenance("v1");

  expect(addPendingGeneration).toHaveBeenCalledWith(
    expect.objectContaining({ sourceAssetCid: "glb-v1", prompt: "knight", provider: "tripo3d" })
  );
  expect(emit).toHaveBeenCalledWith("asset:historyVersionActionable", {
    generationId: "gen-1",
  });
  expect(versions()[0].generationId).toBe("gen-1");
});

