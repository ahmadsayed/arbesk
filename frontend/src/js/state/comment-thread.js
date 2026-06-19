/**
 * Arbesk Comment Thread State
 *
 * Owns a single Nostr comment thread's transport, deduplication, and ordered
 * event list. Emits changes through the global mitt bus so UI layers can
 * subscribe without touching WebSocket or IPFS details.
 */

import { emit, EVENTS } from "../events/bus.js";
import { walletState } from "./wallet-state.js";
import { assetState } from "./asset-state.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { clearSession, createSession, getCachedSession } from "../services/api.js";

const RELAY_PATH = "/api/v1/chat/ws";
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export class CommentThread {
  constructor() {
    this._ws = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._isConnecting = false;
    this._isReauthenticating = false;

    this._currentTokenId = null;
    this._currentChainId = null;
    this._currentArchiveCid = null;

    this._knownEventIds = new Set();
    this._events = [];
  }

  // ─── Public read API ────────────────────────────────────────────────────────

  get events() {
    return [...this._events];
  }

  get status() {
    return {
      connected: this._ws?.readyState === WebSocket.OPEN,
      connecting: this._isConnecting,
      tokenId: this._currentTokenId,
      chainId: this._currentChainId,
    };
  }

  // ─── Context & lifecycle ────────────────────────────────────────────────────

  async setContext({ tokenId, chainId, manifest }) {
    const contextChanged =
      tokenId !== this._currentTokenId || chainId !== this._currentChainId;

    if (contextChanged) {
      this.disconnect();
      this._clearEvents();
      this._currentTokenId = tokenId;
      this._currentChainId = chainId;
      this._currentArchiveCid = null;
    }

    // Always reload the archive: the manifest may have been republished even when
    // the token/chain context is unchanged. loadArchiveForCurrentManifest no-ops
    // when the archive CID hasn't changed.
    await this._loadArchiveForCurrentManifest(manifest);

    if (contextChanged) {
      this._emitStatus();
      this.connect();
    }
  }

  async loadArchive(cid) {
    await this._loadArchive(cid);
  }

  ingest(event, { source = "live" } = {}) {
    if (!event?.id || this._knownEventIds.has(event.id)) return false;
    this._knownEventIds.add(event.id);
    this._events.push(event);
    this._sortEvents();
    this._emitChange({ source, event });
    return true;
  }

  connect() {
    if (this._ws || this._isConnecting) return;

    const tokenId = this._currentTokenId;
    const chainId = this._currentChainId;
    const address = walletState.get().walletAddress;
    if (!tokenId || !address) return;

    const session = getCachedSession();
    if (!session) return;

    this._isConnecting = true;
    this._reconnectAttempts = 0;
    this._emitStatus();

    const token = encodeURIComponent(session.token);
    const encTokenId = encodeURIComponent(tokenId);
    const encChainId = chainId ? encodeURIComponent(chainId) : "";
    const url = `${this._getWsBase()}${RELAY_PATH}?token=${token}&tokenId=${encTokenId}&chainId=${encChainId}`;

    try {
      this._ws = new WebSocket(url);
    } catch (err) {
      console.error("[COMMENT_THREAD] WebSocket creation failed:", err);
      this._isConnecting = false;
      this._emitStatus();
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      this._isConnecting = false;
      this._reconnectAttempts = 0;
      console.log("[COMMENT_THREAD] connected");
      this._emitStatus();
    };

    this._ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handleMessage(msg);
    };

    this._ws.onclose = (event) => {
      this._ws = null;
      this._isConnecting = false;
      this._emitStatus();

      // 4401 = invalid session (server restarted, in-memory store cleared, etc.)
      if (event.code === 4401 && !this._isReauthenticating) {
        this._isReauthenticating = true;
        console.log("[COMMENT_THREAD] session rejected by proxy — re-authenticating…");
        clearSession();
        createSession()
          .then(() => {
            this._isReauthenticating = false;
            this.connect();
          })
          .catch((err) => {
            this._isReauthenticating = false;
            console.warn("[COMMENT_THREAD] re-auth failed:", err.message);
            this._scheduleReconnect();
          });
        return;
      }

      this._scheduleReconnect();
    };

    this._ws.onerror = (err) => {
      console.warn("[COMMENT_THREAD] WebSocket error:", err);
      this._isConnecting = false;
      this._emitStatus();
    };
  }

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      const s = this._ws;
      this._ws = null;
      try {
        s.close(1000, "Panel closed");
      } catch {
        // ignore
      }
    }
    this._isConnecting = false;
    this._reconnectAttempts = 0;
    this._emitStatus();
  }

  post(text) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return false;
    this._ws.send(JSON.stringify({ type: "chat", content: text }));
    return true;
  }

  // ─── Message handling ───────────────────────────────────────────────────────

  _handleMessage(msg) {
    switch (msg.type) {
      case "ready":
        this._emitStatus();
        break;
      case "event":
        this.ingest(msg.event, { source: "live" });
        break;
      case "error":
        this._emitStatus({ error: msg.message });
        break;
      case "eose":
        // Historical backlog finished loading
        break;
      default:
        break;
    }
  }

  // ─── Archive loading ────────────────────────────────────────────────────────

  async _loadArchiveForCurrentManifest(manifest) {
    let archiveCid = manifest?.comments_archive_cid;

    // If no manifest was passed in the event, try to fetch the currently loaded
    // manifest from IPFS so we can read its comments_archive_cid.
    if (!archiveCid && this._currentTokenId) {
      const activeCid = assetState.get().activeAssetManifestCid;
      const cachedManifest = assetState.get().currentManifest;
      if (cachedManifest?.comments_archive_cid) {
        archiveCid = cachedManifest.comments_archive_cid;
      } else if (activeCid) {
        try {
          const fetched = await getFromRemoteIPFS(activeCid);
          archiveCid = fetched?.comments_archive_cid;
        } catch (err) {
          console.warn(
            "[COMMENT_THREAD] failed to fetch manifest for archive CID:",
            err.message
          );
        }
      }
    }

    if (archiveCid) {
      await this._loadArchive(archiveCid);
    }
  }

  async _loadArchive(cid) {
    if (!cid || cid === this._currentArchiveCid) return;

    const tokenIdWhenStarted = this._currentTokenId;
    try {
      const archive = await getFromRemoteIPFS(cid);
      // Drop stale results if the user switched assets while the archive was loading.
      if (this._currentTokenId !== tokenIdWhenStarted) return;
      this._currentArchiveCid = cid;
      const events = Array.isArray(archive?.events) ? archive.events : [];
      // Render oldest first so the thread reads top-to-bottom.
      const sorted = [...events].sort(
        (a, b) => (a.created_at || 0) - (b.created_at || 0)
      );
      for (const event of sorted) {
        this.ingest(event, { source: "archive" });
      }
      console.log(
        `[COMMENT_THREAD] loaded ${sorted.length} archived event(s) from ${cid}`
      );
    } catch (err) {
      console.warn(`[COMMENT_THREAD] failed to load archive ${cid}:`, err.message);
    }
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  _clearEvents() {
    this._knownEventIds.clear();
    this._events = [];
    this._emitChange({ source: "clear" });
  }

  _sortEvents() {
    this._events.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this._currentTokenId) return;
    const address = walletState.get().walletAddress;
    if (!address) return;
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn("[COMMENT_THREAD] max reconnect attempts reached");
      return;
    }
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  _getWsBase() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  _emitChange({ source = "live", event } = {}) {
    emit(EVENTS.COMMENT_THREAD_CHANGE, { events: this.events, source, event });
  }

  _emitStatus(extra = {}) {
    emit(EVENTS.COMMENT_THREAD_STATUS, { status: this.status, ...extra });
  }
}

export const COMMENT_THREAD_EVENTS = {
  CHANGE: EVENTS.COMMENT_THREAD_CHANGE,
  STATUS: EVENTS.COMMENT_THREAD_STATUS,
};
