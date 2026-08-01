/**
 * Chat provenance history view tests (jsdom).
 *
 * chat-history.js and chat-messages.js resolve #chatHistoryList at module
 * load, so the DOM is seeded before the dynamic imports.
 *
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

async function load() {
  jest.resetModules();
  document.body.innerHTML =
    '<div id="chatHistoryList"><div class="chat-welcome" hidden></div></div>';
  const walkManifestChain = jest.fn();
  jest.unstable_mockModule(
    "../../frontend/src/js/engine/time-travel.js",
    () => ({ walkManifestChain })
  );
  const mod = await import("../../frontend/src/js/ui/chat-history.js");
  return { mod, walkManifestChain };
}

test("renders chain metadata.chat entries oldest-first as history bubbles", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "first cabin", provider: "mock", task: "model", timestamp: 1780000000 }] },
    { cid: "v2", chat: null },
    { cid: "v3", chat: [{ prompt: "red roof", provider: "parametric", task: "parametric", timestamp: 1780000100 }] },
  ]);

  await mod.renderChatProvenance("v3");

  const bubbles = document.querySelectorAll(".chat-bubble-history");
  expect(bubbles).toHaveLength(4); // header + 2 prompts + divider
  const texts = [...bubbles].map((b) => b.textContent);
  expect(texts[0]).toContain("Prompt history");
  expect(texts[1]).toContain("first cabin");
  expect(texts[2]).toContain("red roof");
});

test("is a no-op for the same CID and clears on clearHistoryBubbles", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "p", provider: "mock", task: "model", timestamp: 1 }] },
  ]);

  await mod.renderChatProvenance("v1");
  await mod.renderChatProvenance("v1");
  expect(walkManifestChain).toHaveBeenCalledTimes(1);

  mod.clearHistoryBubbles();
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(0);
});

test("renders nothing when the chain has no chat records", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([{ cid: "v1", chat: null }]);
  await mod.renderChatProvenance("v1");
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(0);
});
