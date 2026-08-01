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

test("a superseded walk does not render into the newer asset's view", async () => {
  const { mod, walkManifestChain } = await load();
  /** @type {(value: any) => void} */
  let resolveA;
  const walkA = new Promise((resolve) => {
    resolveA = resolve;
  });
  walkManifestChain.mockImplementation((cid) =>
    cid === "A"
      ? walkA
      : Promise.resolve([
          { cid: "B", chat: [{ prompt: "B prompt", provider: "mock", task: "model", timestamp: 1 }] },
        ])
  );

  const renderA = mod.renderChatProvenance("A");
  await mod.renderChatProvenance("B");
  resolveA([
    { cid: "A", chat: [{ prompt: "A prompt", provider: "mock", task: "model", timestamp: 1 }] },
  ]);
  await renderA;

  const text = document.getElementById("chatHistoryList").textContent;
  expect(text).toContain("B prompt");
  expect(text).not.toContain("A prompt");
});

test("a failed walk renders nothing and recovers on the next call", async () => {
  const { mod, walkManifestChain } = await load();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  walkManifestChain.mockRejectedValueOnce(new Error("ipfs down"));

  await mod.renderChatProvenance("v1");
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(0);

  walkManifestChain.mockResolvedValueOnce([
    { cid: "v1", chat: [{ prompt: "recovered", provider: "mock", task: "model", timestamp: 1 }] },
  ]);
  await mod.renderChatProvenance("v1");
  expect(document.getElementById("chatHistoryList").textContent).toContain("recovered");
  warn.mockRestore();
});

test("history renders above pre-existing live chat", async () => {
  const { mod, walkManifestChain } = await load();
  const list = document.getElementById("chatHistoryList");
  const live = document.createElement("div");
  live.className = "chat-bubble chat-bubble-user";
  live.textContent = "live message";
  list.appendChild(live);

  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "saved prompt", provider: "mock", task: "model", timestamp: 1 }] },
  ]);
  await mod.renderChatProvenance("v1");

  const bubbles = [...list.querySelectorAll(".chat-bubble")];
  const liveIndex = bubbles.findIndex((b) => b.textContent.includes("live message"));
  const historyIndexes = bubbles
    .map((b, i) => (b.classList.contains("chat-bubble-history") ? i : -1))
    .filter((i) => i >= 0);
  expect(historyIndexes.length).toBeGreaterThan(0);
  expect(Math.max(...historyIndexes)).toBeLessThan(liveIndex);
});

test("malformed metadata.chat entries are skipped", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([
    {
      cid: "v1",
      chat: [
        { prompt: "" },
        { task: "model" },
        null,
        { prompt: "ok", task: "model", timestamp: 1 },
      ],
    },
  ]);
  await mod.renderChatProvenance("v1");

  const bubbles = document.querySelectorAll(".chat-bubble-history");
  expect(bubbles).toHaveLength(3); // header + 1 prompt + divider
  expect(bubbles[1].textContent).toContain("ok");
});

test("a failed stale walk does not suppress a newer in-flight render", async () => {
  const { mod, walkManifestChain } = await load();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  /** @type {(reason?: any) => void} */
  let rejectA;
  const walkA = new Promise((_, reject) => {
    rejectA = reject;
  });
  // B's walk is deferred too so A's rejection lands BEFORE B resolves —
  // reproducing the interleaving where an unconditional reset of
  // renderedForCid would make B's staleness check fail.
  /** @type {(value: any) => void} */
  let resolveB;
  const walkB = new Promise((resolve) => {
    resolveB = resolve;
  });
  walkManifestChain.mockImplementation((cid) => (cid === "A" ? walkA : walkB));

  const renderA = mod.renderChatProvenance("A");
  const renderB = mod.renderChatProvenance("B");
  rejectA(new Error("ipfs down"));
  await renderA;
  resolveB([
    { cid: "B", chat: [{ prompt: "B prompt", provider: "mock", task: "model", timestamp: 1 }] },
  ]);
  await renderB;

  expect(document.getElementById("chatHistoryList").textContent).toContain("B prompt");
  warn.mockRestore();
});
