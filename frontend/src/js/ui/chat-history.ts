/**
 * Chat provenance history.
 *
 * Renders metadata.chat records from the asset's manifest chain as read-only
 * history bubbles in the AI Generation pane when an asset is opened. Each
 * history bubble is a text message in the reactive chat store (kind "text",
 * extraClass chat-bubble-history) carrying its manifest CID + generation id;
 * the x-for template renders it and its click restores that version via the
 * onTextClick dispatcher in chat-messages.js.
 */

import { walkManifestChain } from "../engine/time-travel.ts";
import {
  addChatMessage,
  clearHistoryMessages,
  prependChatMessages,
} from "./chat-messages.ts";
import type { ChatMsg } from "./chat-messages.ts";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { addPendingGeneration } from "../state/pending-generations.ts";

/** CID of the manifest the history was last rendered for. */
let renderedForCid: string | null = null;

/** Remove rendered history bubbles (asset switch, new project, clear chat). */
export function clearHistoryBubbles() {
  clearHistoryMessages();
  renderedForCid = null;
}

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
    const chats = Array.isArray(item.chat)
      ? item.chat
      : item.chat
        ? [item.chat]
        : [];
    for (const entry of chats) {
      if (typeof entry?.prompt === "string" && entry.prompt.length > 0) {
        const key = entry.prompt + (entry.timestamp ?? "");
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

  const history: ChatMsg[] = [];
  history.push(
    addChatMessage("system", "Prompt history", {
      extraClass: "chat-bubble-history",
    })
  );

  const actionableCids = new Set();
  for (const entry of entries) {
    const label =
      entry.task && entry.task !== "model" ? " (" + entry.task + ")" : "";
    let generationId: string | undefined;
    if (
      entry.sourceCid &&
      entry.provider === "tripo3d" &&
      !actionableCids.has(entry.cid)
    ) {
      actionableCids.add(entry.cid);
      generationId = addPendingGeneration({
        assetManifestCid: entry.cid,
        sourceAssetCid: entry.sourceCid,
        prompt: entry.prompt,
        prevAssetManifestCid: null,
        provider: "tripo3d",
        task: entry.task,
      });
      emit(EVENTS.HISTORY_VERSION_ACTIONABLE, { generationId });
    }
    history.push(
      addChatMessage("user", entry.prompt + label, {
        timestamp: new Date((entry.timestamp || 0) * 1000),
        extraClass: "chat-bubble-history chat-bubble-version",
        manifestCid: entry.cid,
        ...(entry.sourceCid ? { sourceCid: entry.sourceCid } : {}),
        ...(generationId ? { generationId } : {}),
      })
    );
  }

  history.push(
    addChatMessage("system", "— New session —", {
      extraClass: "chat-bubble-history",
    })
  );

  // History renders above the live session chat.
  prependChatMessages(history);
}

