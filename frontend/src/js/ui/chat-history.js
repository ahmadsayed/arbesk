/**
 * Chat provenance history.
 *
 * Renders metadata.chat records from the asset's manifest chain as bubbles
 * in the AI Generation pane when an asset is opened. The full conversation
 * is the concatenation of each version's metadata.chat, oldest to newest;
 * live session chat is unaffected. Records are save-anchored: prompts only
 * appear once their result was saved into a manifest version. Each bubble
 * carries its version's manifest CID and restores that version on click.
 */

import { walkManifestChain } from "../engine/time-travel.js";
import { addChatMessage } from "./chat-messages.js";
import { emit, EVENTS } from "../events/bus.js";

const chatHistoryList = document.getElementById("chatHistoryList");

/** @type {string | null} CID of the manifest the history was last rendered for. */
let renderedForCid = null;

/** Remove rendered history bubbles (asset switch, new project, clear chat). */
export function clearHistoryBubbles() {
  chatHistoryList
    ?.querySelectorAll(".chat-bubble-history")
    .forEach((el) => el.remove());
  renderedForCid = null;
}

/**
 * Walk the manifest chain from `manifestCid` and render every metadata.chat
 * record as a read-only bubble, oldest first. No-op when already rendered for
 * this CID or when the chain has no records.
 * @param {string} manifestCid
 */
export async function renderChatProvenance(manifestCid) {
  if (!manifestCid || manifestCid === renderedForCid) return;
  clearHistoryBubbles();
  renderedForCid = manifestCid;

  const chain = await walkManifestChain(manifestCid).catch(
    (/** @type {any} */ err) => {
      console.warn("[CHAT-HISTORY] chain walk failed:", err?.message);
      return null;
    }
  );
  if (!chain) {
    if (renderedForCid === manifestCid) renderedForCid = null;
    return;
  }
  if (manifestCid !== renderedForCid) return; // superseded by a newer open

  /**
   * Flattened chat records, oldest first, each carrying its version's
   * identity so the rendered bubble can restore that version on click.
   * @type {Array<{prompt: string, task?: string, timestamp?: number, cid: string, sourceCid: string|null}>}
   */
  const entries = [];
  for (const item of chain) {
    for (const entry of item.chat || []) {
      if (typeof entry?.prompt === "string" && entry.prompt.length > 0) {
        entries.push({
          prompt: entry.prompt,
          task: entry.task,
          timestamp: entry.timestamp,
          cid: item.cid,
          sourceCid: item.sourceCid || null,
        });
      }
    }
  }
  if (entries.length === 0) return;

  addChatMessage("system", "Prompt history", {
    extraClass: "chat-bubble-history",
  });
  for (const entry of entries) {
    const label =
      entry.task && entry.task !== "model" ? ` (${entry.task})` : "";
    addChatMessage("user", `${entry.prompt}${label}`, {
      timestamp: new Date((entry.timestamp || 0) * 1000),
      extraClass: "chat-bubble-history chat-bubble-version",
    });
    // addChatMessage returns void — the bubble just appended is the click
    // target that restores this version via the event bus.
    const target = /** @type {HTMLElement|null} */ (
      chatHistoryList?.lastElementChild ?? null
    );
    if (target) {
      target.dataset.manifestCid = entry.cid;
      if (entry.sourceCid) target.dataset.sourceCid = entry.sourceCid;
      target.addEventListener("click", () => {
        emit(EVENTS.HISTORY_VERSION_SELECTED, {
          cid: entry.cid,
          sourceCid: entry.sourceCid,
          name: entry.prompt,
        });
      });
    }
  }
  addChatMessage("system", "— New session —", {
    extraClass: "chat-bubble-history",
  });

  // History belongs above the live session chat: move the freshly rendered
  // block before the first live bubble (addChatMessage appends at the end).
  const firstLive = chatHistoryList?.querySelector(
    ".chat-bubble:not(.chat-bubble-history)"
  );
  if (firstLive && chatHistoryList) {
    chatHistoryList
      .querySelectorAll(".chat-bubble-history")
      .forEach((el) => chatHistoryList.insertBefore(el, firstLive));
  }
}
