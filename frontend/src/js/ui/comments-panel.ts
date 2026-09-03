/**
 * View layer for the right-inspector Comments section.
 */

import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getActiveAssetTokenId, getActiveAssetId } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../state/wallet-state.ts";
import { CommentThread } from "../services/comment-thread.ts";
import { truncateAddress } from "../utils/format.ts";
import { escapeHtml } from "../utils/html.ts";
import { getCachedSession } from "../services/api.ts";
import { Alpine, registerAlpineComponent } from "./alpine.ts";

const thread = new CommentThread();

interface CommentVm {
  id: string;
  avatar: string;
  author: string;
  authorTitle: string;
  time: string;
  mentioned: boolean;
  html: string;
}

interface CommentsStore {
  events: CommentVm[];
  sectionVisible: boolean;
  canPost: boolean;
  showEmpty: boolean;
  emptyTitle: string;
  emptySub: string;
  draft: string;
}

let _store: CommentsStore | null = null;
function store(): CommentsStore {
  if (!_store) {
    if (!Alpine.store("comments")) {
      Alpine.store("comments", {
        events: [],
        sectionVisible: false,
        canPost: false,
        showEmpty: true,
        emptyTitle: "No comments yet",
        emptySub: "Mention an editor to request a change or review.",
        draft: "",
      });
    }
    _store = Alpine.store("comments") as CommentsStore;
  }
  return _store;
}

function toVm(event: any): CommentVm {
  const tags = (event.tags || []) as any[];
  const senderTag = tags.find(
    (t) => Array.isArray(t) && t[0] === "sender"
  );
  const sender = (senderTag && senderTag[1]) || "unknown";
  const currentAddress = walletState.get().walletAddress;
  const isMe =
    currentAddress && sender.toLowerCase() === currentAddress.toLowerCase();
  const contentText = event.content || "";
  const mentioned = isMentioned(contentText, currentAddress);
  const time = event.created_at
    ? formatRelativeTime(new Date(event.created_at * 1000).toISOString())
    : "";
  return {
    id: event.id,
    avatar: getInitials(isMe ? "You" : truncateAddress(sender)),
    author: isMe ? "You" : truncateAddress(sender),
    authorTitle: sender,
    time,
    mentioned: mentioned || !!isMe,
    html: renderMentions(escapeHtml(event.content)),
  };
}

function renderMentions(html: string): string {
  return html.replace(
    /(@0x[a-fA-F0-9]{1,40})/g,
    '<span class="comment-mention" role="button" tabindex="0">$1</span>'
  );
}

function syncEvents(): void {
  store().events = thread.events.map(toVm);
  syncUI();
  scrollToBottomSoon();
}

function syncUI(): void {
  const s = store();
  const status = thread.status;
  const hasToken = !!status.tokenId;
  const isConnected = !!walletState.get().walletAddress;
  const hasSession = !!getCachedSession();
  const wsOpen = status.connected;

  s.sectionVisible = hasToken;
  s.canPost = hasToken && isConnected && hasSession && wsOpen;

  if (!isConnected) {
    s.emptyTitle = "Sign in";
    s.emptySub = "Sign in to view comments.";
    s.showEmpty = true;
  } else if (!hasSession) {
    s.emptyTitle = "Sign in";
    s.emptySub = "Sign in with your wallet to view comments.";
    s.showEmpty = true;
  } else if (s.events.length === 0) {
    s.emptyTitle = "No comments yet";
    s.emptySub = "Mention an editor to request a change or review.";
    s.showEmpty = true;
  } else {
    s.showEmpty = false;
  }
}

// Idempotence guard: a double-fired @click (or a click racing the
// Ctrl+Enter shortcut) can invoke post() twice before the draft clears,
// sending two identical "chat" frames that the relay then stores as two
// distinct Nostr events (and the thread counts twice). Suppress an identical
// re-post within a short window; the draft is still cleared so the composer
// reads empty after the (single) send.
let _lastSentText = "";
let _lastSentAt = 0;
const DUPLICATE_POST_WINDOW_MS = 1500;

function postComment(): void {
  const s = store();
  const text = s.draft.trim();
  if (!text) return;

  const now = Date.now();
  if (text === _lastSentText && now - _lastSentAt < DUPLICATE_POST_WINDOW_MS) {
    s.draft = "";
    return;
  }

  if (thread.post(text)) {
    _lastSentText = text;
    _lastSentAt = now;
    s.draft = "";
    document.getElementById("commentComposerInput")?.focus();
  }
}

function scrollToBottomSoon(): void {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    const scroller = document.querySelector(".comments-scroll");
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  });
}

function announce(text: string): void {
  const live = document.getElementById("commentsLiveRegion");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = text;
  });
}

function showError(message: string): void {
  console.warn("[COMMENTS] server error:", message);
  const s = store();
  s.emptySub = message;
  s.showEmpty = true;
}

async function onAssetContextChanged(e: any): Promise<void> {
  const tokenId = getActiveAssetTokenId();
  const chainId = walletState.get().chainId;
  const assetId = getActiveAssetId();
  await thread.setContext({ tokenId, chainId, assetId, manifest: e?.manifest });
}

function onAuthChanged(): void {
  syncUI();
  thread.connect();
}

function onThreadChange({ source }: { source?: string }): void {
  syncEvents();
  if (source === "live") announce("New comment posted");
}

function onThreadStatus({ error }: { error?: string } = {}): void {
  syncUI();
  if (error) showError(error);
}

interface CommentsPanelComponent {
  readonly comments: CommentVm[];
  readonly count: number;
  readonly sectionVisible: boolean;
  readonly canPost: boolean;
  readonly showEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptySub: string;
  draft: string;
  post(): void;
}

export function commentsPanel(): CommentsPanelComponent {
  return {
    get comments() { return store().events; },
    get count() { return store().events.length; },
    get sectionVisible() { return store().sectionVisible; },
    get canPost() { return store().canPost; },
    get showEmpty() { return store().showEmpty; },
    get emptyTitle() { return store().emptyTitle; },
    get emptySub() { return store().emptySub; },
    get draft() { return store().draft; },
    set draft(value: string) { store().draft = value; },
    post() { postComment(); },
  };
}

registerAlpineComponent("commentsPanel", commentsPanel);

export function initCommentsPanel(): void {
  on(EVENTS.SCENE_READY, onAssetContextChanged);
  on(EVENTS.ASSET_PUBLISHED, onAssetContextChanged);
  on(EVENTS.ASSET_OPEN_BY_TOKEN_ID, onAssetContextChanged);
  on(EVENTS.ASSET_DRAFT_SAVED, onAssetContextChanged);
  on(EVENTS.ASSET_CLEARED, onAssetContextChanged);
  on(EVENTS.WALLET_CONNECTED, onAuthChanged);
  on(EVENTS.USER_AUTHENTICATED, onAuthChanged);
  on(EVENTS.WALLET_DISCONNECTED, onAuthChanged);
  on(EVENTS.COMMENT_THREAD_CHANGE, onThreadChange);
  on(EVENTS.COMMENT_THREAD_STATUS, onThreadStatus);

  syncEvents();
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSeconds < 60) return "just now";
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  return days + "d ago";
}

export function getInitials(value: string): string {
  if (!value) return "?";
  const cleaned = value.toString().replace(/^0x/, "").trim();
  return cleaned.slice(0, 2).toUpperCase();
}

export function isMentioned(text: string, walletAddress: string | null): boolean {
  if (!text || !walletAddress) return false;
  const address = walletAddress.toLowerCase();
  const truncated = truncateAddress(address);
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes("@" + address) || lowerText.includes("@" + truncated)
  );
}
