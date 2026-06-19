/**
 * Arbesk Comments Panel
 *
 * Powers the right-inspector Comments section using the backend Nostr chat proxy.
 * Each published asset gets its own comment thread; only the owner and
 * collaborators with role >= Viewer may read or post.
 */

import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { truncateAddress } from "../utils/format.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { clearSession, createSession, getCachedSession } from "../services/api.js";

let isReauthenticating = false;

const RELAY_PATH = "/api/v1/chat/ws";
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

const elements = {};
let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let isConnecting = false;
let currentTokenId = null;
let currentChainId = null;
let currentAddress = null;
let currentArchiveCid = null;
let knownEventIds = new Set();

// ─── Init ───────────────────────────────────────────────────────────────────

export function initCommentsPanel() {
  cacheElements();
  bindEvents();
  bindDomEvents();
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

// ─── State Changes ──────────────────────────────────────────────────────────

async function onAssetContextChanged(e) {
  const tokenId = assetState.get().activeAssetTokenId;
  const chainId = walletState.get().chainId;

  const contextChanged = tokenId !== currentTokenId || chainId !== currentChainId;
  if (contextChanged) {
    disconnect();
    clearComments();
    currentTokenId = tokenId;
    currentChainId = chainId;
  }

  // Always reload the archive: the manifest may have been republished even when
  // the token/chain context is unchanged. loadArchiveForCurrentManifest no-ops
  // when the archive CID hasn't changed.
  await loadArchiveForCurrentManifest(e?.manifest);

  if (contextChanged) {
    updateUI();
    tryConnect();
  }
}

function onAuthChanged() {
  currentAddress = walletState.get().walletAddress;
  updateUI();
  tryConnect();
}

function tryConnect() {
  if (currentTokenId && currentAddress && getCachedSession()) {
    connect();
  }
}

// ─── WebSocket Lifecycle ────────────────────────────────────────────────────

function connect() {
  if (ws || isConnecting || !currentTokenId || !currentAddress) return;

  const session = getCachedSession();
  if (!session) return;

  isConnecting = true;
  reconnectAttempts = 0;

  const token = encodeURIComponent(session.token);
  const tokenId = encodeURIComponent(currentTokenId);
  const chainId = currentChainId ? encodeURIComponent(currentChainId) : "";
  const url = `${getWsBase()}${RELAY_PATH}?token=${token}&tokenId=${tokenId}&chainId=${chainId}`;

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error("[COMMENTS] WebSocket creation failed:", err);
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    isConnecting = false;
    reconnectAttempts = 0;
    console.log("[COMMENTS] connected");
    updateUI();
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = (event) => {
    ws = null;
    isConnecting = false;
    updateUI();

    // 4401 = invalid session (server restarted, in-memory store cleared, etc.)
    if (event.code === 4401 && !isReauthenticating) {
      isReauthenticating = true;
      console.log("[COMMENTS] session rejected by proxy — re-authenticating…");
      clearSession();
      createSession()
        .then(() => {
          isReauthenticating = false;
          connect();
        })
        .catch((err) => {
          isReauthenticating = false;
          console.warn("[COMMENTS] re-auth failed:", err.message);
          scheduleReconnect();
        });
      return;
    }

    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.warn("[COMMENTS] WebSocket error:", err);
    isConnecting = false;
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    const s = ws;
    ws = null;
    try {
      s.close(1000, "Panel closed");
    } catch {
      // ignore
    }
  }
  isConnecting = false;
}

function scheduleReconnect() {
  if (reconnectTimer || !currentTokenId || !currentAddress) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn("[COMMENTS] max reconnect attempts reached");
    return;
  }
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function getWsBase() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

// ─── Message Handling ───────────────────────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case "ready":
      updateUI();
      break;
    case "event":
      renderEvent(msg.event);
      break;
    case "error":
      showError(msg.message);
      break;
    case "eose":
      // Historical backlog finished loading
      break;
    default:
      break;
  }
}

function onPostComment() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const text = elements.input?.value?.trim();
  if (!text) return;

  ws.send(JSON.stringify({ type: "chat", content: text }));
  elements.input.value = "";
  elements.input.focus();
}

function onComposerKeydown(e) {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    onPostComment();
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function clearComments() {
  if (elements.list) elements.list.innerHTML = "";
  knownEventIds.clear();
  currentArchiveCid = null;
  updateCount();
}

async function loadArchiveForCurrentManifest(manifest) {
  let archiveCid = manifest?.comments_archive_cid;

  // If no manifest was passed in the event, try to fetch the currently loaded
  // manifest from IPFS so we can read its comments_archive_cid.
  if (!archiveCid && currentTokenId) {
    const activeCid = assetState.get().activeAssetManifestCid;
    const cachedManifest = assetState.get().currentManifest;
    if (cachedManifest?.comments_archive_cid) {
      archiveCid = cachedManifest.comments_archive_cid;
    } else if (activeCid) {
      try {
        const fetched = await getFromRemoteIPFS(activeCid);
        archiveCid = fetched?.comments_archive_cid;
      } catch (err) {
        console.warn("[COMMENTS] failed to fetch manifest for archive CID:", err.message);
      }
    }
  }

  if (!archiveCid || archiveCid === currentArchiveCid) return;

  const tokenIdWhenStarted = currentTokenId;
  try {
    const archive = await getFromRemoteIPFS(archiveCid);
    // Drop stale results if the user switched assets while the archive was loading.
    if (currentTokenId !== tokenIdWhenStarted) return;
    currentArchiveCid = archiveCid;
    const events = Array.isArray(archive?.events) ? archive.events : [];
    // Render oldest first so the thread reads top-to-bottom.
    const sorted = [...events].sort(
      (a, b) => (a.created_at || 0) - (b.created_at || 0)
    );
    for (const event of sorted) {
      renderEvent(event, { fromArchive: true });
    }
    console.log(`[COMMENTS] loaded ${sorted.length} archived event(s) from ${archiveCid}`);
  } catch (err) {
    console.warn(`[COMMENTS] failed to load archive ${archiveCid}:`, err.message);
  }
}

function renderEvent(event, { fromArchive = false } = {}) {
  if (!event?.id || knownEventIds.has(event.id)) return;
  knownEventIds.add(event.id);

  const senderTag = (event.tags || []).find(
    (t) => Array.isArray(t) && t[0] === "sender"
  );
  const sender = senderTag?.[1] || "unknown";
  const isMe =
    currentAddress && sender.toLowerCase() === currentAddress.toLowerCase();
  const contentText = event.content || "";
  const mentioned = isMentioned(contentText, currentAddress);
  const time = event.created_at
    ? formatRelativeTime(new Date(event.created_at * 1000).toISOString())
    : "";

  const li = document.createElement("li");
  li.className = `comment-item ${mentioned || isMe ? "comment-mentioned-you" : ""}`;
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

  elements.list?.appendChild(li);
  elements.list?.scrollTo({ top: elements.list.scrollHeight, behavior: "smooth" });
  updateCount();
  updateUI();
  if (!fromArchive) {
    announce("New comment posted");
  }
}

function renderMentions(html) {
  // Highlight @0x... mentions without linking anywhere for v1.
  return html.replace(
    /(@0x[a-fA-F0-9]{1,40})/g,
    '<span class="comment-mention" role="button" tabindex="0">$1</span>'
  );
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function updateCount() {
  const count = knownEventIds.size;
  if (elements.count) elements.count.textContent = String(count);
}

function updateUI() {
  const hasToken = !!currentTokenId;
  const isConnected = !!currentAddress;
  const hasSession = !!getCachedSession();
  const wsOpen = ws?.readyState === WebSocket.OPEN;

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
  } else if (knownEventIds.size === 0) {
    setEmptyState("No comments yet", "Mention an editor to request a change or review.");
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

function showError(message) {
  console.warn("[COMMENTS] server error:", message);
  // Surface short errors via the empty-state subtitle for v1.
  if (elements.empty) {
    const emptySub = elements.empty.querySelector(".comments-empty-sub");
    if (emptySub) emptySub.textContent = message;
    elements.empty.hidden = false;
  }
}

function announce(text) {
  if (elements.live) {
    elements.live.textContent = "";
    requestAnimationFrame(() => {
      elements.live.textContent = text;
    });
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
  const truncated = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes(`@${address}`) || lowerText.includes(`@${truncated}`)
  );
}
