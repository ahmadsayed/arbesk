/**
 * Chat message builder tests (jsdom).
 *
 * chat-messages.js resolves #chatHistoryList at module load, so the DOM is
 * seeded before the dynamic import in beforeAll.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, beforeEach } from "@jest/globals";

let addChatMessage;
let addAssetMessage;
let addWorkingMessage;
let clearChatMessages;

beforeAll(async () => {
  document.body.innerHTML =
    '<div id="chatHistoryList"><div class="chat-welcome"></div></div>';
  global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = jest.fn();
  ({ addChatMessage, addAssetMessage, addWorkingMessage, clearChatMessages } =
    await import("../../frontend/src/js/ui/chat-messages.js"));
});

beforeEach(() => {
  const list = document.getElementById("chatHistoryList");
  list.innerHTML = '<div class="chat-welcome"></div>';
});

test("addChatMessage appends a text bubble and hides the welcome", () => {
  addChatMessage("user", "make me a chair");
  const list = document.getElementById("chatHistoryList");
  const bubble = list.querySelector(".chat-bubble-user");
  expect(bubble).not.toBeNull();
  expect(bubble.querySelector(".chat-bubble-content").textContent).toBe(
    "make me a chair"
  );
  expect(list.querySelector(".chat-welcome").hidden).toBe(true);
});

test("addAssetMessage builds a bubble with canvas, caption, and send button", () => {
  const handle = addAssetMessage({ prompt: "a red car", format: "glb" });
  expect(handle).not.toBeNull();
  expect(handle.bubble.classList.contains("chat-bubble-asset")).toBe(true);
  expect(handle.canvas.classList.contains("chat-asset-canvas")).toBe(true);
  expect(handle.bubble.querySelector(".chat-asset-caption").textContent).toBe(
    "a red car"
  );
  expect(handle.sendButton.textContent).toBe("Show in Studio");
  expect(handle.sendButton.disabled).toBe(false);
});

test("markSent swaps the canvas for a snapshot and disables the button", () => {
  const handle = addAssetMessage({ prompt: "p", format: "glb" });
  handle.markSent(new Blob(["x"], { type: "image/webp" }));
  expect(handle.bubble.querySelector("img.chat-asset-snapshot")).not.toBeNull();
  expect(handle.bubble.querySelector("canvas")).toBeNull();
  expect(handle.sendButton.disabled).toBe(true);
  expect(handle.sendButton.textContent).toBe("Shown in Studio");
  expect(handle.bubble.classList.contains("chat-bubble-asset-sent")).toBe(true);
});

test("collapsePreview keeps the send button active", () => {
  const handle = addAssetMessage({ prompt: "p", format: "glb" });
  handle.collapsePreview(new Blob(["x"], { type: "image/webp" }));
  expect(handle.bubble.querySelector("img.chat-asset-snapshot")).not.toBeNull();
  expect(handle.sendButton.disabled).toBe(false);
});

test("markFallback replaces the canvas with an uppercase format badge", () => {
  const handle = addAssetMessage({ prompt: "p", format: "3mf" });
  handle.markFallback();
  const badge = handle.bubble.querySelector(".chat-asset-badge");
  expect(badge).not.toBeNull();
  expect(badge.textContent).toBe("3MF");
  expect(handle.sendButton.disabled).toBe(false);
});

test("addWorkingMessage shows a spinner bubble and removes it", () => {
  const working = addWorkingMessage("Carving your model…");
  expect(working).not.toBeNull();
  const list = document.getElementById("chatHistoryList");
  const bubble = list.querySelector(".chat-bubble-working");
  expect(bubble).not.toBeNull();
  expect(bubble.querySelector(".chat-working-spinner")).not.toBeNull();
  expect(bubble.textContent).toContain("Carving your model…");

  working.setText("Almost there…");
  expect(bubble.textContent).toContain("Almost there…");

  working.remove();
  expect(list.querySelector(".chat-bubble-working")).toBeNull();
});

test("clearChatMessages removes all bubbles and restores the welcome", () => {
  const list = document.getElementById("chatHistoryList");
  addChatMessage("user", "make me a chair");
  addAssetMessage({ prompt: "p", format: "glb" });
  expect(list.querySelectorAll(".chat-bubble").length).toBeGreaterThan(0);
  expect(list.querySelector(".chat-welcome").hidden).toBe(true);

  clearChatMessages();

  expect(list.querySelectorAll(".chat-bubble").length).toBe(0);
  expect(list.querySelector(".chat-welcome")).not.toBeNull();
  expect(list.querySelector(".chat-welcome").hidden).toBe(false);
});
