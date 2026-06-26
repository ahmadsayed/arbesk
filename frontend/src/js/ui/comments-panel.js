// @ts-nocheck
/**
 * Arbesk Comments Panel
 *
 * Thin view layer for the right-inspector Comments section. All transport,
 * deduplication, and ordering live in {@link CommentThread};
 * this module only renders what the thread emits.
 */

import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { CommentThread } from "../state/comment-thread.js";
import { truncateAddress } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";
import { getCachedSession } from "../services/api.js";

const elements = {};
const thread = new CommentThread();

// ─── Init ───────────────────────────────────────────────────────────────────

export function initCommentsPanel() {
  cacheElements();
  bindEvents();
  bindDomEvents();
  bindThreadEvents();
  updateUI();
}

function cacheElements() {
  elements.section = document.getElementById("commentsSection");
  elements.title = document.getElementById("commentsTitle");
  elements.list = document.getElementById("commentList");
  elements.empty = document.getElementById("commentsEmpty");
  elements.input = document.getElementById("commentComposerInput");
  elements.postBtn = document.getElementById("postCommentBtn");
  elements.count = document.getElementById("commentsCount");
  elements.live = document.getElementById("commentsLiveRegion");
}

function bindEvents() {
  on(EVENTS.SCENE_READY, onAssetContextChanged);
  on(EVENTS.ASSET_PUBLISHED, onAssetContextChanged);
  on(EVENTS.ASSET_OPEN_BY_TOKEN_ID, onAssetContextChanged);
  on(EVENTS.ASSET_DRAFT_SAVED, onAssetContextChanged);
  on(EVENTS.ASSET_CLEARED, onAssetContextChanged);
  on(EVENTS.WALLET_CONNECTED, onAuthChanged);
  on(EVENTS.USER_AUTHENTICATED, onAuthChanged);
  on(EVENTS.WALLET_DISCONNECTED, onAuthChanged);
}

function bindDomEvents() {
  elements.postBtn?.addEventListener("click", onPostComment);
  elements.input?.addEventListener("keydown", onComposerKeydown);
}

function bindThreadEvents() {
  on(EVENTS.COMMENT_THREAD_CHANGE, onThreadChange);
  on(EVENTS.COMMENT_THREAD_STATUS, onThreadStatus);
}

// ─── State Changes ──────────────────────────────────────────────────────────

async function onAssetContextChanged(e) {
  const tokenId = assetState.get().activeAssetTokenId;
  const chainId = walletState.get().chainId;
  const assetId = assetState.get().activeAssetId;
  await thread.setContext({ tokenId, chainId, assetId, manifest: e?.manifest });
}

function onAuthChanged() {
  updateUI();
  thread.connect();
}

function onThreadChange({ source }) {
  renderAll();
  updateUI();
  if (source === "live") {
    announce("New comment posted");
  }
}

function onThreadStatus({ error } = {}) {
  updateUI();
  if (error) showError(error);
}

// ─── Composer ───────────────────────────────────────────────────────────────

function onPostComment() {
  const text = elements.input?.value?.trim();
  if (!text) return;
  if (thread.post(text)) {
    elements.input.value = "";
    elements.input.focus();
  }
}

function onComposerKeydown(e) {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    onPostComment();
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderAll() {
  if (!elements.list) return;
  elements.list.innerHTML = "";
  for (const event of thread.events) {
    elements.list.appendChild(renderEvent(event));
  }
  updateCount();
  scrollToBottom();
}

function renderEvent(event) {
  const senderTag = (event.tags || []).find(
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

function renderMentions(html) {
  // Highlight @0x... mentions without linking anywhere for v1.
  return html.replace(
    /(@0x[a-fA-F0-9]{1,40})/g,
    '<span class="comment-mention" role="button" tabindex="0">$1</span>'
  );
}

function updateCount() {
  if (elements.count) elements.count.textContent = String(thread.events.length);
}

function scrollToBottom() {
  elements.list?.scrollTo({
    top: elements.list.scrollHeight,
    behavior: "smooth",
  });
}

function updateUI() {
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
    setEmptyState("Connect wallet", "Connect your wallet to view comments.");
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
 * @param {string} title
 * @param {string} sub
 */
function setEmptyState(title, sub) {
  if (!elements.empty) return;
  const emptyTitle = elements.empty.querySelector(".comments-empty-title");
  const emptySub = elements.empty.querySelector(".comments-empty-sub");
  if (emptyTitle) emptyTitle.textContent = title;
  if (emptySub) emptySub.textContent = sub;
  elements.empty.hidden = false;
}

function announce(text) {
  if (elements.live) {
    elements.live.textContent = "";
    requestAnimationFrame(() => {
      elements.live.textContent = text;
    });
  }
}

function showError(message) {
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
 * @param {string} iso
 * @returns {string}
 */
export function formatRelativeTime(iso) {
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
 * @param {string} value
 * @returns {string}
 */
export function getInitials(value) {
  if (!value) return "?";
  const cleaned = value.toString().replace(/^0x/, "").trim();
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Detect whether the given wallet address is mentioned in the text.
 * Matches both full and truncated @0x… forms.
 * @param {string} text
 * @param {string} walletAddress
 * @returns {boolean}
 */
export function isMentioned(text, walletAddress) {
  if (!text || !walletAddress) return false;
  const address = walletAddress.toLowerCase();
  const truncated = truncateAddress(address);
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes(`@${address}`) || lowerText.includes(`@${truncated}`)
  );
}
