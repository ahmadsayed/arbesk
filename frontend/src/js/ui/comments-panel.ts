/**
 * Arbesk Comments Panel
 *
 * Thin view layer for the right-inspector Comments section. All transport,
 * deduplication, and ordering live in {@link CommentThread};
 * this module only renders what the thread emits.
 */

import { on, EVENTS } from "../asset-core/events/bus.ts";
import { getActiveAssetTokenId, getActiveAssetId } from "../asset-core/domain/asset.ts";
import { walletState } from "../state/wallet-state.ts";
import { CommentThread } from "../services/comment-thread.ts";
import { truncateAddress } from "../utils/format.ts";
import { escapeHtml } from "../utils/html.ts";
import { getCachedSession } from "../services/api.ts";

export interface CommentPanelElements {
  section?: HTMLElement | null;
  title?: HTMLElement | null;
  list?: HTMLElement | null;
  empty?: HTMLElement | null;
  input?: HTMLInputElement | null;
  postBtn?: HTMLButtonElement | null;
  count?: HTMLElement | null;
  live?: HTMLElement | null;
}

const elements: CommentPanelElements = {};
const thread = new CommentThread();

// ─── Init ───────────────────────────────────────────────────────────────────

export function initCommentsPanel(): void {
  cacheElements();
  bindEvents();
  bindDomEvents();
  bindThreadEvents();
  updateUI();
}

function cacheElements(): void {
  elements.section = document.getElementById("commentsSection");
  elements.title = document.getElementById("commentsTitle");
  elements.list = document.getElementById("commentList");
  elements.empty = document.getElementById("commentsEmpty");
  elements.input = document.getElementById("commentComposerInput") as HTMLInputElement | null;
  elements.postBtn = document.getElementById("postCommentBtn") as HTMLButtonElement | null;
  elements.count = document.getElementById("commentsCount");
  elements.live = document.getElementById("commentsLiveRegion");
}

function bindEvents(): void {
  on(EVENTS.SCENE_READY, onAssetContextChanged);
  on(EVENTS.ASSET_PUBLISHED, onAssetContextChanged);
  on(EVENTS.ASSET_OPEN_BY_TOKEN_ID, onAssetContextChanged);
  on(EVENTS.ASSET_DRAFT_SAVED, onAssetContextChanged);
  on(EVENTS.ASSET_CLEARED, onAssetContextChanged);
  on(EVENTS.WALLET_CONNECTED, onAuthChanged);
  on(EVENTS.USER_AUTHENTICATED, onAuthChanged);
  on(EVENTS.WALLET_DISCONNECTED, onAuthChanged);
}

function bindDomEvents(): void {
  elements.postBtn?.addEventListener("click", onPostComment);
  elements.input?.addEventListener("keydown", onComposerKeydown);
}

function bindThreadEvents(): void {
  on(EVENTS.COMMENT_THREAD_CHANGE, onThreadChange);
  on(EVENTS.COMMENT_THREAD_STATUS, onThreadStatus);
}

// ─── State Changes ──────────────────────────────────────────────────────────

async function onAssetContextChanged(e: any): Promise<void> {
  const tokenId = getActiveAssetTokenId();
  const chainId = walletState.get().chainId;
  const assetId = getActiveAssetId();
  await thread.setContext({ tokenId, chainId, assetId, manifest: e?.manifest });
}

function onAuthChanged(): void {
  updateUI();
  thread.connect();
}

function onThreadChange({ source }: { source?: string }): void {
  renderAll();
  updateUI();
  if (source === "live") {
    announce("New comment posted");
  }
}

function onThreadStatus({ error }: { error?: string } = {}): void {
  updateUI();
  if (error) showError(error);
}

// ─── Composer ───────────────────────────────────────────────────────────────

function onPostComment(): void {
  const text = elements.input?.value?.trim();
  if (!text) return;
  if (thread.post(text)) {
    (elements.input as HTMLInputElement).value = "";
    (elements.input as HTMLInputElement).focus();
  }
}

function onComposerKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    onPostComment();
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderAll(): void {
  if (!elements.list) return;
  elements.list.innerHTML = "";
  for (const event of thread.events) {
    elements.list.appendChild(renderEvent(event));
  }
  updateCount();
  scrollToBottom();
}

function renderEvent(event: any): HTMLLIElement {
  const tags = (event.tags || []) as any[];
  const senderTag = tags.find(
    (t) => Array.isArray(t) && t[0] === "sender"
  );
  const sender = senderTag?.[1] || "unknown";
  const currentAddress = walletState.get().walletAddress;
  const isMe =
    currentAddress && sender.toLowerCase() === currentAddress.toLowerCase();
  const contentText = event.content || "";
  const mentioned = isMentioned(contentText, currentAddress);
  const time = event.created_at
    ? formatRelativeTime(new Date(event.created_at * 1000).toISOString())
    : "";

  const li = document.createElement("li");
  li.className = `comment-item ${
    mentioned || isMe ? "comment-mentioned-you" : ""
  }`;
  li.setAttribute("data-event-id", event.id);

  const avatar = document.createElement("div");
  avatar.className = "comment-avatar";
  avatar.textContent = getInitials(isMe ? "You" : truncateAddress(sender));
  avatar.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "comment-body";

  const meta = document.createElement("div");
  meta.className = "comment-meta";

  const author = document.createElement("span");
  author.className = "comment-author";
  author.textContent = isMe ? "You" : truncateAddress(sender);
  author.title = sender;

  const timeSpan = document.createElement("span");
  timeSpan.className = "comment-time";
  timeSpan.textContent = time;

  meta.appendChild(author);
  meta.appendChild(timeSpan);

  const textEl = document.createElement("p");
  textEl.className = "comment-text";
  textEl.innerHTML = renderMentions(escapeHtml(event.content));

  body.appendChild(meta);
  body.appendChild(textEl);

  li.appendChild(avatar);
  li.appendChild(body);

  return li;
}

function renderMentions(html: string): string {
  // Highlight @0x... mentions without linking anywhere for v1.
  return html.replace(
    /(@0x[a-fA-F0-9]{1,40})/g,
    '<span class="comment-mention" role="button" tabindex="0">$1</span>'
  );
}

function updateCount(): void {
  if (elements.count) elements.count.textContent = String(thread.events.length);
}

function scrollToBottom(): void {
  elements.list?.scrollTo({
    top: elements.list.scrollHeight,
    behavior: "smooth",
  });
}

function updateUI(): void {
  const hasToken = !!thread.status.tokenId;
  const isConnected = !!walletState.get().walletAddress;
  const hasSession = !!getCachedSession();
  const wsOpen = thread.status.connected;

  // Show section only when an asset is open
  if (elements.section) elements.section.hidden = !hasToken;

  // Composer enabled only when wallet connected, session valid, and socket open
  const canPost = hasToken && isConnected && hasSession && wsOpen;
  if (elements.input) elements.input.disabled = !canPost;
  if (elements.postBtn) elements.postBtn.disabled = !canPost;

  // Empty / status state
  if (!isConnected) {
    setEmptyState("Sign in", "Sign in to view comments.");
  } else if (!hasSession) {
    setEmptyState("Sign in", "Sign in with your wallet to view comments.");
  } else if (thread.events.length === 0) {
    setEmptyState(
      "No comments yet",
      "Mention an editor to request a change or review."
    );
  } else if (elements.empty) {
    elements.empty.hidden = true;
  }
}

/**
 * Show the empty-state block with the given title/subtitle.
 */
function setEmptyState(title: string, sub: string): void {
  if (!elements.empty) return;
  const emptyTitle = elements.empty.querySelector(".comments-empty-title");
  const emptySub = elements.empty.querySelector(".comments-empty-sub");
  if (emptyTitle) emptyTitle.textContent = title;
  if (emptySub) emptySub.textContent = sub;
  elements.empty.hidden = false;
}

function announce(text: string): void {
  if (elements.live) {
    elements.live.textContent = "";
    requestAnimationFrame(() => {
      (elements.live as HTMLElement).textContent = text;
    });
  }
}

function showError(message: string): void {
  console.warn("[COMMENTS] server error:", message);
  // Surface short errors via the empty-state subtitle for v1.
  if (elements.empty) {
    const emptySub = elements.empty.querySelector(".comments-empty-sub");
    if (emptySub) emptySub.textContent = message;
    elements.empty.hidden = false;
  }
}

// ─── Helpers (also exported for unit tests) ─────────────────────────────────

/**
 * Format an ISO timestamp as a short relative string.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSeconds < 60) return "just now";
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Return uppercase initials from an address or display name.
 */
export function getInitials(value: string): string {
  if (!value) return "?";
  const cleaned = value.toString().replace(/^0x/, "").trim();
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Detect whether the given wallet address is mentioned in the text.
 * Matches both full and truncated 0x… mention forms.
 */
export function isMentioned(text: string, walletAddress: string | null): boolean {
  if (!text || !walletAddress) return false;
  const address = walletAddress.toLowerCase();
  const truncated = truncateAddress(address);
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes(`@${address}`) || lowerText.includes(`@${truncated}`)
  );
}
