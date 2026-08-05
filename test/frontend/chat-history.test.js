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
  const emit = jest.fn();
  jest.unstable_mockModule(
    "../../frontend/src/js/engine/time-travel.js",
    () => ({ walkManifestChain })
  );
  jest.unstable_mockModule("../../frontend/src/js/events/bus.js", () => ({
    emit,
    EVENTS: {
      HISTORY_VERSION_SELECTED: "asset:historyVersionSelected",
      HISTORY_VERSION_ACTIONABLE: "asset:historyVersionActionable",
    },
  }));
  const mod = await import("../../frontend/src/js/ui/chat-history.js");
  return { mod, walkManifestChain, emit };
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

test("history bubbles carry data-manifest-cid and clicking one emits HISTORY_VERSION_SELECTED", async () => {
  const { mod, walkManifestChain, emit } = await load();
  walkManifestChain.mockResolvedValue([
    {
      cid: "v1",
      sourceCid: "glb-v1",
      chat: [{ prompt: "first cabin", provider: "tripo3d", task: "model", timestamp: 1780000000 }],
    },
    { cid: "v2", sourceCid: null, chat: null },
    {
      cid: "v3",
      sourceCid: "glb-v3",
      chat: [{ prompt: "red roof", provider: "tripo3d", task: "texture", timestamp: 1780000100 }],
    },
  ]);

  await mod.renderChatProvenance("v3");

  const versionBubbles = document.querySelectorAll(".chat-bubble-version");
  expect(versionBubbles).toHaveLength(2);
  const first = /** @type {HTMLElement} */ (versionBubbles[0]);
  const second = /** @type {HTMLElement} */ (versionBubbles[1]);
  expect(first.dataset.manifestCid).toBe("v1");
  expect(first.dataset.sourceCid).toBe("glb-v1");
  expect(second.dataset.manifestCid).toBe("v3");
  expect(second.dataset.sourceCid).toBe("glb-v3");
  // Header and divider bubbles are not restore targets.
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(4);
  expect(
    document.querySelector(".chat-bubble-history:not(.chat-bubble-version)")
  ).not.toBeNull();

  first.click();
  expect(emit).toHaveBeenCalledWith("asset:historyVersionSelected", {
    cid: "v1",
    sourceCid: "glb-v1",
    name: "first cabin",
  });

  second.click();
  expect(emit).toHaveBeenCalledWith("asset:historyVersionSelected", {
    cid: "v3",
    sourceCid: "glb-v3",
    name: "red roof",
  });
});

test("a version bubble without a sourceCid omits data-source-cid and emits null", async () => {
  const { mod, walkManifestChain, emit } = await load();
  walkManifestChain.mockResolvedValue([
    {
      cid: "v1",
      sourceCid: null,
      chat: [{ prompt: "parametric tweak", provider: "parametric", task: "parametric", timestamp: 1 }],
    },
  ]);

  await mod.renderChatProvenance("v1");

  const bubble = /** @type {HTMLElement} */ (
    document.querySelector(".chat-bubble-version")
  );
  expect(bubble.dataset.manifestCid).toBe("v1");
  expect(bubble.dataset.sourceCid).toBeUndefined();

  bubble.click();
  expect(emit).toHaveBeenCalledWith("asset:historyVersionSelected", {
    cid: "v1",
    sourceCid: null,
    name: "parametric tweak",
  });
});

test("dedupes chat entries inherited verbatim by later generation manifests", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: null },
    { cid: "v2", chat: [{ prompt: "cabin", provider: "mock", task: "model", timestamp: 1780000000 }] },
    // Generation manifest that inherited v2's chat (history preservation on
    // branch/restore) — same prompt AND timestamp, rendered only once.
    { cid: "v3", chat: [{ prompt: "cabin", provider: "mock", task: "model", timestamp: 1780000000 }] },
    { cid: "v4", chat: [{ prompt: "tower", provider: "mock", task: "model", timestamp: 1780000100 }] },
  ]);

  await mod.renderChatProvenance("v4");

  const versionBubbles = document.querySelectorAll(".chat-bubble-version");
  expect(versionBubbles).toHaveLength(2); // cabin once + tower
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(4); // header + 2 prompts + divider
  // The surviving cabin bubble restores the oldest (save-anchored) version.
  const first = /** @type {HTMLElement} */ (versionBubbles[0]);
  expect(first.dataset.manifestCid).toBe("v2");
});

test("the same prompt saved at different times is not deduped", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "cabin", provider: "mock", task: "model", timestamp: 1780000000 }] },
    { cid: "v2", chat: [{ prompt: "cabin", provider: "mock", task: "model", timestamp: 1780000200 }] },
  ]);

  await mod.renderChatProvenance("v2");

  const versionBubbles = document.querySelectorAll(".chat-bubble-version");
  expect(versionBubbles).toHaveLength(2);
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(4); // header + 2 prompts + divider
});

test("a chain entry whose chat is a single object (not an array) still renders", async () => {
  const { mod, walkManifestChain, emit } = await load();
  walkManifestChain.mockResolvedValue([
    {
      cid: "v1",
      sourceCid: "glb-v1",
      chat: { prompt: "lone prompt", provider: "tripo3d", task: "model", timestamp: 1780000000 },
    },
  ]);

  await mod.renderChatProvenance("v1");

  const bubble = /** @type {HTMLElement} */ (
    document.querySelector(".chat-bubble-version")
  );
  expect(bubble).not.toBeNull();
  expect(bubble.textContent).toContain("lone prompt");
  expect(bubble.dataset.manifestCid).toBe("v1");
  expect(bubble.dataset.sourceCid).toBe("glb-v1");

  bubble.click();
  expect(emit).toHaveBeenCalledWith("asset:historyVersionSelected", {
    cid: "v1",
    sourceCid: "glb-v1",
    name: "lone prompt",
  });
});

test("tripo3d versions with a GLB become actionable: record registered, event emitted, bubble tagged", async () => {
  const { mod, walkManifestChain, emit } = await load();
  walkManifestChain.mockResolvedValue([
    {
      cid: "v1",
      sourceCid: "glb-v1",
      chat: [{ prompt: "a knight", provider: "tripo3d", task: "model", timestamp: 1780000000 }],
    },
    {
      cid: "v2",
      sourceCid: "glb-v2",
      chat: [{ prompt: "rusty bronze", provider: "tripo3d", task: "texture", timestamp: 1780000100 }],
    },
  ]);

  await mod.renderChatProvenance("v2");

  const { listPendingGenerations } = await import("../../frontend/src/js/state/pending-generations.js");
  const records = listPendingGenerations();
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({
    assetManifestCid: "v1",
    sourceAssetCid: "glb-v1",
    provider: "tripo3d",
    task: "model",
  });
  expect(records[1]).toMatchObject({
    assetManifestCid: "v2",
    sourceAssetCid: "glb-v2",
    provider: "tripo3d",
    task: "texture",
  });

  const bubbles = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll(".chat-bubble-version")
  );
  expect(bubbles[0].dataset.generationId).toBe(records[0].id);
  expect(bubbles[1].dataset.generationId).toBe(records[1].id);

  const actionableCalls = emit.mock.calls.filter(
    ([event]) => event === "asset:historyVersionActionable"
  );
  expect(actionableCalls).toHaveLength(2);
  expect(actionableCalls[0][1]).toEqual({ generationId: records[0].id });
});

test("non-tripo3d or GLB-less versions stay restore-only (no action event)", async () => {
  const { mod, walkManifestChain, emit } = await load();
  walkManifestChain.mockResolvedValue([
    {
      cid: "v1",
      sourceCid: "glb-v1",
      chat: [{ prompt: "a chair", provider: "mock", task: "model", timestamp: 1780000000 }],
    },
    {
      cid: "v2",
      sourceCid: null,
      chat: [{ prompt: "make it red", provider: "tripo3d", task: "parametric", timestamp: 1780000100 }],
    },
  ]);

  await mod.renderChatProvenance("v2");

  const { listPendingGenerations } = await import("../../frontend/src/js/state/pending-generations.js");
  expect(listPendingGenerations()).toHaveLength(0);
  expect(
    emit.mock.calls.filter(([event]) => event === "asset:historyVersionActionable")
  ).toHaveLength(0);
  expect(document.querySelector("[data-generation-id]")).toBeNull();
});
