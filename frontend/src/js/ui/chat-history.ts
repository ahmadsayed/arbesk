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

import { walkManifestChain } from "../engine/time-travel.ts";
import { addChatMessage } from "./chat-messages.ts";
import { emit, EVENTS } from "../events/bus.ts";
import { addPendingGeneration } from "../state/pending-generations.ts";

const chatHistoryList = document.getElementById("chatHistoryList");

/** CID of the manifest the history was last rendered for. */
let renderedForCid: string | null = null;

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
 */
export async function renderChatProvenance(manifestCid: string) {
  if (!manifestCid || manifestCid === renderedForCid) return;
  clearHistoryBubbles();
  renderedForCid = manifestCid;

  const chain = await walkManifestChain(manifestCid).catch((err: any) => {
    console.warn("[CHAT-HISTORY] chain walk failed:", err?.message);
    return null;
  });
  if (!chain) {
    if (renderedForCid === manifestCid) renderedForCid = null;
    return;
  }
  if (manifestCid !== renderedForCid) return; // superseded by a newer open

  /**
   * Flattened chat records, oldest first, each carrying its version's
   * identity so the rendered bubble can restore that version on click.
   * Generation manifests inherit the previous version's metadata.chat
   * (history preservation on branch/restore), so the same entry can appear
   * in several chain manifests verbatim — dedupe by prompt+timestamp,
   * keeping the oldest (save-anchored) occurrence.
   */
  const entries: Array<{
    prompt: string;
    task?: string;
    provider?: string;
    timestamp?: number;
    cid: string;
    sourceCid: string | null;
  }> = [];
  const seen = new Set();
  for (const item of chain) {
    // metadata.chat is version-scoped and normally an array, but tolerate a
    // single-object shape instead of throwing on a non-iterable.
    const chats = Array.isArray(item.chat) ? item.chat : item.chat ? [item.chat] : [];
    for (const entry of chats) {
      if (typeof entry?.prompt === "string" && entry.prompt.length > 0) {
        const key = `${entry.prompt}${entry.timestamp ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          prompt: entry.prompt,
          task: entry.task,
          provider: entry.provider,
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
  // One action row per version, on the first bubble that carries it — a
  // version with several prompts should not sprout duplicate rows.
  const actionableCids = new Set();
  for (const entry of entries) {
    const label =
      entry.task && entry.task !== "model" ? ` (${entry.task})` : "";
    addChatMessage("user", `${entry.prompt}${label}`, {
      timestamp: new Date((entry.timestamp || 0) * 1000),
      extraClass: "chat-bubble-history chat-bubble-version",
    });
    // addChatMessage returns void — the bubble just appended is the click
    // target that restores this version via the event bus.
    const target: HTMLElement | null =
      (chatHistoryList?.lastElementChild as HTMLElement | null) ?? null;
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

      // Tripo3D versions with a GLB are fully actionable: register a
      // pending-generation record (sourceAssetCid is the durable reference)
      // and let the create panel attach the follow-up action row. No
      // backendTaskId exists for history — animate takes the full GLB chain.
      if (
        entry.sourceCid &&
        entry.provider === "tripo3d" &&
        !actionableCids.has(entry.cid)
      ) {
        actionableCids.add(entry.cid);
        const generationId = addPendingGeneration({
          assetManifestCid: entry.cid,
          sourceAssetCid: entry.sourceCid,
          prompt: entry.prompt,
          prevAssetManifestCid: null,
          provider: "tripo3d",
          task: entry.task,
        });
        target.dataset.generationId = generationId;
        emit(EVENTS.HISTORY_VERSION_ACTIONABLE, { generationId });
      }
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
