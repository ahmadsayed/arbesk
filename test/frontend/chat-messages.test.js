/**
 * Chat message builder tests (Alpine store-backed).
 *
 * The reactive source of truth is Alpine.store("chat").messages; the x-for
 * template renders it. These tests assert the store mutations the imperative
 * entry points perform (the DOM rendering is covered by E2E + the Pug build).
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, beforeEach, afterEach } from "@jest/globals";

const flush = () => new Promise((r) => setTimeout(r, 0));

let chat;
let Alpine;

beforeAll(async () => {
  document.body.innerHTML = '<div id="chatHistoryList"></div>';
  global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = jest.fn();
  chat = await import("../../frontend/src/js/ui/chat-messages.js");
  ({ Alpine } = await import("../../frontend/src/js/ui/alpine.js"));
  await flush();
});

afterEach(() => {
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
});

beforeEach(() => {
  chat.clearChatMessages();
});

const msgs = () => Alpine.store("chat").messages;

test("addChatMessage pushes a reactive text message", () => {
  chat.addChatMessage("user", "make me a chair");
  expect(msgs()).toHaveLength(1);
  expect(msgs()[0].kind).toBe("text");
  expect(msgs()[0].text).toBe("make me a chair");
  expect(msgs()[0].role).toBe("user");
});

test("addChatMessage honors timestamp, extraClass, and provenance fields", () => {
  const when = new Date("2026-08-02T10:20:00Z");
  chat.addChatMessage("user", "old prompt", {
    timestamp: when,
    extraClass: "chat-bubble-history",
    manifestCid: "cid1",
    sourceCid: "glb1",
    generationId: "g1",
  });
  const m = msgs()[0];
  expect(m.extraClass).toBe("chat-bubble-history");
  expect(m.manifestCid).toBe("cid1");
  expect(m.sourceCid).toBe("glb1");
  expect(m.generationId).toBe("g1");
  expect(m.dateTime).toBe(when.toISOString());
});

test("addImageMessage single-image and multiview modes", () => {
  chat.addImageMessage("user", "data:image/png;base64,AAAA", "chair");
  expect(msgs()[0].kind).toBe("image");
  expect(msgs()[0].images).toBeNull();
  expect(msgs()[0].caption).toBe("chair");

  chat.clearChatMessages();
  chat.addImageMessage("user", "data:image/png;base64,FRONT", "views", {
    images: [
      { src: "data:image/png;base64,FRONT", caption: "Front" },
      { src: "data:image/png;base64,LEFT", caption: "Left" },
    ],
  });
  expect(msgs()[0].images).toHaveLength(2);
});

test("addChoiceMessage dispatches onPick once via the component", () => {
  const picked = [];
  chat.addChoiceMessage("Rig & animate?", [{ label: "Jump", value: ["preset:jump"] }], (v) => picked.push(v));
  const msg = msgs()[0];
  expect(msg.kind).toBe("choice");
  const component = chat.chatFeed();
  component.pickChoice(msg, { value: ["preset:jump"] });
  expect(picked).toEqual([["preset:jump"]]);
  expect(msg.picked).toBe(true);
  component.pickChoice(msg, { value: ["preset:jump"] }); // second pick ignored
  expect(picked).toHaveLength(1);
});

test("addWorkingMessage handle setText/setProgress/remove", () => {
  const working = chat.addWorkingMessage("Carving…", { onCancel: () => {} });
  expect(working).not.toBeNull();
  expect(msgs()[0].kind).toBe("working");
  expect(msgs()[0].cancel).toBe(true);

  working.setText("Almost there…");
  expect(msgs()[0].text).toBe("Almost there…");

  working.setProgress(0.5, "Sculpting");
  expect(msgs()[0].progress).toBe(0.5);
  expect(msgs()[0].text).toBe("Sculpting");

  working.remove();
  expect(msgs()).toHaveLength(0);
});

test("addAssetMessage handle markSent/markFallback/markSaved mutate the store", () => {
  const handle = chat.addAssetMessage({ prompt: "a red car", format: "glb", generationId: "g1" });
  expect(msgs()[0].kind).toBe("asset");
  expect(msgs()[0].preview).toBe("live");

  handle.markSent(new Blob(["x"], { type: "image/webp" }));
  expect(msgs()[0].preview).toBe("snapshot");
  expect(msgs()[0].sent).toBe(true);
  expect(msgs()[0].snapshotUrl).toBe("blob:mock-url");

  handle.markSaved();
  expect(msgs()[0].saved).toBe(true);
});

test("addAssetMessage markFallback sets the format-badge state", () => {
  const handle = chat.addAssetMessage({ prompt: "p", format: "3mf", generationId: "g1" });
  handle.markFallback();
  expect(msgs()[0].preview).toBe("fallback");
  expect(msgs()[0].snapshotUrl).toBeNull();
});

test("addAssetActionRow attaches followups to the message by generationId", () => {
  chat.addAssetMessage({ prompt: "a knight", format: "glb", generationId: "g1" });
  const picks = [];
  chat.addAssetActionRow("g1", [
    { id: "retexture", label: "Retexture", onPick: () => picks.push("retexture") },
  ]);
  expect(msgs()[0].followups).toEqual([{ id: "retexture", label: "Retexture" }]);

  const component = chat.chatFeed();
  component.followup(msgs()[0], "retexture");
  expect(picks).toEqual(["retexture"]);
});

test("clearChatMessages empties the store", () => {
  chat.addChatMessage("user", "a");
  chat.addAssetMessage({ prompt: "b", format: "glb", generationId: "g" });
  expect(msgs().length).toBeGreaterThan(0);
  chat.clearChatMessages();
  expect(msgs()).toHaveLength(0);
});

test("registerAssetSendHandler dispatches via showInStudio", () => {
  chat.addAssetMessage({ prompt: "a knight", format: "glb", generationId: "g1" });
  const seen = [];
  chat.registerAssetSendHandler("g1", (id) => seen.push(id));
  chat.chatFeed().showInStudio(msgs()[0]);
  expect(seen).toEqual(["g1"]);
});

