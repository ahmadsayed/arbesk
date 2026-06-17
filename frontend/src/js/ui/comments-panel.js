/**
 * Arbesk Comments Panel
 *
 * Contextual comments & mentions for the selected node, shown inside the
 * right inspector. This UI-only implementation keeps comments in memory;
 * persistence is intentionally deferred to a later phase.
 */

import { on, EVENTS } from "../events/bus.js";
import { walletState } from "../state/wallet-state.js";
import { truncateAddress } from "../utils/format.js";

// ─── DOM refs ──────────────────────────────────────────────────────────────

let inspector = null;
let commentsSection = null;
let commentList = null;
let commentsEmpty = null;
let commentsCount = null;
let commentsTitle = null;
let composerInput = null;
let postBtn = null;
let autocomplete = null;
let liveRegion = null;

// ─── State ───────────────────────────────────────────────────────────────────

let activeNodeId = null;

// In-memory comments keyed by nodeId.
const commentsByNodeId = new Map();

// Seed the mock thread so the UI is demonstrable immediately.
const MOCK_COMMENTS = [
  {
    id: "c1",
    author: "0x3aF1cD4e7B8123e92c4D5a6B89C0d1E2F3a4B5C6D7E8F9a0B1C2D3E4F5A6B7",
    time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    text: "The clamp alignment looks off on this child asset.",
    system: false,
  },
  {
    id: "c2",
    author: "0x7B2c3D4e5F6a7B8c9D0E1F2a3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2",
    time: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    text: "@0x3aF1…e92c good call — I’ll rotate it 2° and republish this child.",
    system: false,
  },
  {
    id: "c3",
    author: "0x3aF1cD4e7B8123e92c4D5a6B89C0d1E2F3a4B5C6D7E8F9a0B1C2D3E4F5A6B7",
    time: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    text: "@0x7B2c…11a4 also please check the seal material before the next publish.",
    system: false,
  },
  {
    id: "c4",
    author: "system",
    time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    text: "0x7B2c…11a4 published a new version of Docking Clamp A.",
    system: true,
  },
];

// Known wallets for the autocomplete dropdown.
const KNOWN_WALLETS = [
  {
    address: "0x3aF1cD4e7B8123e92c4D5a6B89C0d1E2F3a4B5C6D7E8F9a0B1C2D3E4F5A6B7",
    role: "Owner",
  },
  {
    address: "0x7B2c3D4e5F6a7B8c9D0E1F2a3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2",
    role: "Editor",
  },
  {
    address: "0xd9E4f5A6b7C8d9E0F1a2B3c4D5e6F7a8B9c0D1E2F3a4B5C6D7E8F9a0B1C2D3",
    role: "Viewer",
  },
];

// ─── Init ────────────────────────────────────────────────────────────────────

function initCommentsPanel() {
  inspector = document.getElementById("inspector");
  commentsSection = document.getElementById("commentsSection");
  commentList = document.getElementById("commentList");
  commentsEmpty = document.getElementById("commentsEmpty");
  commentsCount = document.getElementById("commentsCount");
  commentsTitle = document.getElementById("commentsTitle");
  composerInput = document.getElementById("commentComposerInput");
  postBtn = document.getElementById("postCommentBtn");
  autocomplete = document.getElementById("commentAutocomplete");
  liveRegion = document.getElementById("commentsLiveRegion");

  if (!commentsSection || !commentList || !composerInput) return;

  // Seed mock thread for the first asset node that gets selected.
  // This lets stakeholders see the UI without a persistence layer.
  bindComposer();
  renderAutocomplete();

  on(EVENTS.NODE_SELECTED, onNodeSelected);
  on(EVENTS.OUTLINER_NODE_SELECTED, onNodeSelected);
  on(EVENTS.NODE_DESELECTED, onNodeDeselected);
  on(EVENTS.WALLET_CONNECTED, () => renderComments(activeNodeId));
  on(EVENTS.WALLET_DISCONNECTED, () => renderComments(activeNodeId));
}

// ─── Data ────────────────────────────────────────────────────────────────────

function getComments(nodeId) {
  if (!nodeId) return [];
  // For this UI-only phase, show the mock thread for any selected node.
  if (!commentsByNodeId.has(nodeId)) {
    const mockCopy = MOCK_COMMENTS.map((c) => ({ ...c, id: `${c.id}-${nodeId}` }));
    commentsByNodeId.set(nodeId, mockCopy);
  }
  return commentsByNodeId.get(nodeId) || [];
}

function addComment(nodeId, text) {
  if (!nodeId || !text.trim()) return null;
  const list = getComments(nodeId);
  const address = walletState.get().walletAddress || "0x0000…0000";
  const comment = {
    id: `c-${Date.now()}`,
    author: address,
    time: new Date().toISOString(),
    text: text.trim(),
    system: false,
  };
  list.push(comment);
  commentsByNodeId.set(nodeId, list);
  return comment;
}

function getCurrentWallet() {
  return (walletState.get().walletAddress || "").toLowerCase();
}

function getKnownWallets() {
  // Merge mock entries with any collaborators already in the wallet state.
  const current = getCurrentWallet();
  const wallets = [...KNOWN_WALLETS];
  if (current) {
    const exists = wallets.some(
      (w) => w.address.toLowerCase() === current
    );
    if (!exists) {
      wallets.unshift({ address: walletState.get().walletAddress, role: "You" });
    }
  }
  return wallets;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function onNodeSelected(e) {
  const nodeId = e?.nodeId;
  if (!nodeId) return;
  activeNodeId = nodeId;
  if (commentsSection) commentsSection.hidden = false;
  if (inspector) inspector.classList.remove("collapsed");
  renderComments(nodeId);
}

function onNodeDeselected() {
  activeNodeId = null;
  if (commentsSection) commentsSection.hidden = true;
}

function renderComments(nodeId) {
  if (!commentList || !commentsEmpty || !commentsCount) return;

  const comments = getComments(nodeId);
  commentsCount.textContent = String(comments.length);

  if (comments.length === 0) {
    commentList.innerHTML = "";
    commentsEmpty.hidden = false;
    return;
  }

  commentsEmpty.hidden = true;
  commentList.innerHTML = "";
  const fragment = document.createDocumentFragment();

  const currentWallet = getCurrentWallet();
  comments.forEach((comment) => {
    const el = renderCommentItem(comment, currentWallet);
    fragment.appendChild(el);
  });

  commentList.appendChild(fragment);
  scrollToBottom();
}

function renderCommentItem(comment, currentWallet) {
  const isSystem = comment.system;
  const authorDisplay = isSystem
    ? "System"
    : truncateAddress(comment.author);
  const initials = isSystem
    ? "S"
    : getInitials(authorDisplay);

  const li = document.createElement("li");
  const mentionsCurrent = !isSystem && isMentioned(comment.text, currentWallet);

  if (mentionsCurrent) {
    li.className = "comment-mentioned-you";
    const wrapper = document.createElement("div");
    wrapper.className = "comment-item";
    wrapper.appendChild(createAvatar(initials));
    wrapper.appendChild(createCommentBody(comment, authorDisplay, true));
    li.appendChild(wrapper);
  } else {
    li.className = `comment-item${isSystem ? " comment-system" : ""}`;
    li.appendChild(createAvatar(initials));
    li.appendChild(createCommentBody(comment, authorDisplay, false));
  }

  return li;
}

function createAvatar(initials) {
  const span = document.createElement("span");
  span.className = "comment-avatar";
  span.setAttribute("aria-hidden", "true");
  span.textContent = initials;
  return span;
}

function createCommentBody(comment, authorDisplay, showMentionBadge) {
  const body = document.createElement("div");
  body.className = "comment-body";

  const meta = document.createElement("div");
  meta.className = "comment-meta";

  const author = document.createElement("span");
  author.className = "comment-author";
  author.textContent = authorDisplay;

  const time = document.createElement("span");
  time.className = "comment-time";
  time.textContent = formatRelativeTime(comment.time);

  meta.appendChild(author);
  meta.appendChild(time);

  if (showMentionBadge) {
    const badge = document.createElement("span");
    badge.className = "mention-badge";
    badge.textContent = "Mentioned you";
    meta.appendChild(badge);
  }

  const text = document.createElement("div");
  text.className = "comment-text";
  text.appendChild(renderMentionedText(comment.text));

  body.appendChild(meta);
  body.appendChild(text);
  return body;
}

function renderMentionedText(text) {
  const fragment = document.createDocumentFragment();
  const mentionPattern = /@0x[0-9a-fA-F]{4}(?:…[0-9a-fA-F]{4})?/g;
  let lastIndex = 0;
  let match;

  while ((match = mentionPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      fragment.appendChild(
        document.createTextNode(text.slice(lastIndex, match.index))
      );
    }
    const mention = document.createElement("span");
    mention.className = "comment-mention";
    mention.setAttribute("role", "button");
    mention.setAttribute("tabindex", "0");
    mention.setAttribute("aria-label", `Mention ${match[0].slice(1)}`);
    mention.textContent = match[0];
    mention.addEventListener("click", () => onMentionClick(match[0]));
    mention.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onMentionClick(match[0]);
      }
    });
    fragment.appendChild(mention);
    lastIndex = mentionPattern.lastIndex;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  return fragment;
}

function renderAutocomplete() {
  if (!autocomplete) return;
  autocomplete.innerHTML = "";
  const wallets = getKnownWallets();
  const fragment = document.createDocumentFragment();

  wallets.forEach((wallet) => {
    const item = document.createElement("div");
    item.className = "autocomplete-item";
    item.setAttribute("role", "option");
    item.dataset.address = wallet.address;
    item.dataset.display = truncateAddress(wallet.address);
    item.textContent = truncateAddress(wallet.address);

    const role = document.createElement("span");
    role.textContent = wallet.role;
    item.appendChild(role);

    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      insertMention(wallet.address);
      hideAutocomplete();
      composerInput.focus();
    });

    fragment.appendChild(item);
  });

  autocomplete.appendChild(fragment);
}

// ─── Composer behavior ───────────────────────────────────────────────────────

function bindComposer() {
  if (!composerInput || !postBtn) return;

  composerInput.addEventListener("focus", () => {
    updateAutocompleteVisibility();
  });

  composerInput.addEventListener("blur", () => {
    setTimeout(hideAutocomplete, 150);
  });

  composerInput.addEventListener("input", () => {
    updateAutocompleteVisibility();
  });

  composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      postComment();
    }
  });

  postBtn.addEventListener("click", postComment);
}

function updateAutocompleteVisibility() {
  if (!autocomplete || !composerInput) return;
  const value = composerInput.value;
  const shouldShow = document.activeElement === composerInput && value.includes("@");
  autocomplete.hidden = !shouldShow;
}

function hideAutocomplete() {
  if (autocomplete) autocomplete.hidden = true;
}

function insertMention(address) {
  if (!composerInput) return;
  const value = composerInput.value;
  const truncated = truncateAddress(address);
  // Replace a trailing @ with the full mention, or append one.
  const updated = value.replace(/@$/, "").trim();
  composerInput.value = updated ? `${updated} @${truncated} ` : `@${truncated} `;
}

function postComment() {
  if (!composerInput || !activeNodeId) return;
  const text = composerInput.value.trim();
  if (!text) {
    announce("Cannot post an empty comment.");
    return;
  }

  addComment(activeNodeId, text);
  composerInput.value = "";
  renderComments(activeNodeId);
  announce("Comment posted.");
}

function onMentionClick(mentionText) {
  // Copy the full-ish address to the clipboard if it looks like one.
  const address = mentionText.slice(1);
  if (navigator.clipboard && address.startsWith("0x")) {
    navigator.clipboard.writeText(address).catch(() => {});
  }
}

function announce(message) {
  if (liveRegion) liveRegion.textContent = message;
}

function scrollToBottom() {
  if (commentList?.parentElement) {
    commentList.parentElement.scrollTop = commentList.parentElement.scrollHeight;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(addressDisplay) {
  if (!addressDisplay) return "?";
  const clean = addressDisplay.replace(/^0x/, "");
  return clean.slice(0, 2).toUpperCase();
}

function isMentioned(text, currentWallet) {
  if (!currentWallet) return false;
  const display = truncateAddress(currentWallet);
  // Match either the full address or the truncated display form.
  const pattern = new RegExp(`@${escapeRegex(display)}`, "i");
  return pattern.test(text);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatRelativeTime(iso) {
  const date = new Date(iso);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export {
  initCommentsPanel,
  formatRelativeTime,
  getInitials,
  isMentioned,
};
