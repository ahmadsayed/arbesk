/**
 * Arbesk Chat Proxy
 *
 * WebSocket bridge between the Studio frontend and the private Nostr relay.
 *
 * Authentication: the browser passes the existing SIWE session token in the
 * WebSocket query string. The proxy validates it via src/api/sessions.js,
 * resolves the wallet address, then checks on-chain asset ownership or a
 * Merkle proof that the wallet holds a collaborator role (Viewer+).
 *
 * Authorization model:
 *   - ownerOf(tokenId) === address  => allowed
 *   - valid Merkle proof for the current editorRoot/version/role => allowed
 *   - otherwise => connection closed with 4403
 *
 * The proxy signs all published Nostr events with a service private key and
 * injects the verified Ethereum sender address into the event tags. The relay
 * remains a stock nostr-rs-relay instance; scoping is enforced by the proxy.
 */

import { WebSocket, WebSocketServer } from "ws";
import { finalizeEvent, getPublicKey, utils } from "nostr-tools";
import url from "url";
import { KIND_CHAT, TAG_ASSET, createRelay, safeClose } from "./nostr-relay.js";
import { authorizeAssetAccess } from "./authorization.js";
import {
  NOSTR_RELAY_URL,
  NOSTR_SERVICE_PRIVATE_KEY,
  getContractAddress,
} from "../config.js";

const { hexToBytes } = utils;

/**
 * @typedef {Object} ChatSession
 * @property {string} address
 * @property {import('ws').WebSocket} clientWs
 * @property {() => boolean} allowMessage
 * @property {() => void} dispose
 * @property {ReturnType<typeof setInterval>} [pingInterval]
 * @property {ReturnType<typeof setTimeout> | null | undefined} [pongTimeout]
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const WS_PATH = "/api/v1/chat/ws";
const TAG_SENDER = "sender";
const MAX_CONTENT_LENGTH = 2000;
const MAX_MSG_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CLIENT_PING_INTERVAL_MS = 30000;
const CLIENT_PONG_TIMEOUT_MS = 10000;

/**
 * Build the canonical asset-level Nostr tag.
 * Each asset inside a collection has its own isolated thread.
 */
/**
 * @param {string | number | null} chainId
 * @param {string | null} contractAddress
 * @param {string | number} tokenId
 * @param {string | string[] | null | undefined} [assetId]
 * @returns {string}
 */
function buildAssetTag(chainId, contractAddress, tokenId, assetId) {
  const cid = chainId ? Number(chainId) : 31415822;
  const addr = (contractAddress || getContractAddress(cid) || "unknown").toLowerCase();
  const id = assetId || "";
  return `${cid}:${addr}:${tokenId}:${id}`;
}

// Global wallet-level sliding window: address -> [timestamps within window]
const walletMessageTimestamps = new Map();

// ─── Service Key ────────────────────────────────────────────────────────────

/** @type {string | null} */
let servicePubkey = null;
/** @type {Uint8Array | null} */
let servicePrivkey = null;

function initServiceKey() {
  if (servicePubkey) return true;
  if (!NOSTR_SERVICE_PRIVATE_KEY) {
    console.warn(
      "[CHAT] NOSTR_SERVICE_PRIVATE_KEY not set; chat proxy disabled. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
    return false;
  }
  servicePrivkey = hexToBytes(NOSTR_SERVICE_PRIVATE_KEY);
  servicePubkey = getPublicKey(servicePrivkey);
  console.log(`[CHAT] service pubkey ${servicePubkey.slice(0, 16)}…`);
  return true;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Attach the chat WebSocket proxy to an existing HTTP server.
 * Returns null if the service key is not configured.
 * @param {import('http').Server} httpServer
 */
export function createChatProxy(httpServer) {
  if (!initServiceKey()) return null;

  const wss = new WebSocketServer({
    server: httpServer,
    path: WS_PATH,
  });

  wss.on("connection", (ws, req) => {
    return handleConnection(ws, req).catch((err) => {
      console.error("[CHAT] unhandled connection error:", err.message);
      safeClose(ws, 1011, "Internal error");
    });
  });

  console.log(`[CHAT] proxy listening on ${WS_PATH} → ${NOSTR_RELAY_URL}`);
  return wss;
}

// ─── Connection Handler ─────────────────────────────────────────────────────

/**
 * @param {import('ws').WebSocket} clientWs
 * @param {import('http').IncomingMessage} req
 */
async function handleConnection(clientWs, req) {
  const remote = req.socket.remoteAddress || "unknown";
  const parsedUrl = url.parse(req.url || "", true);
  const { token, tokenId, chainId, proof, role, assetId } = parsedUrl.query;

  if (!token || !tokenId) {
    console.log(
      `[CHAT] rejected - missing token or tokenId | client=${remote}`,
    );
    safeClose(clientWs, 4400, "Missing token or tokenId");
    return;
  }

  if (!assetId) {
    console.log(`[CHAT] rejected - missing assetId | client=${remote}`);
    safeClose(clientWs, 4400, "Missing assetId");
    return;
  }

  // Parse optional Merkle proof from query string.
  let proofArray = null;
  if (proof) {
    try {
      const proofStr = Array.isArray(proof) ? proof[0] : proof;
      proofArray = JSON.parse(decodeURIComponent(proofStr));
      if (!Array.isArray(proofArray)) proofArray = null;
    } catch {
      proofArray = null;
    }
  }
  const requiredRole = role ? Number(role) : null;

  // 1. Validate SIWE session and check asset access in one call
  const tokenIdStr = String(tokenId);
  const authResult = await authorizeAssetAccess(
    String(token),
    tokenIdStr,
    chainId ? Number(chainId) : null,
    {
      proof: proofArray || undefined,
      requiredRole: requiredRole ?? undefined,
    },
  );
  if (!authResult) {
    console.log(`[CHAT] rejected - invalid session | client=${remote}`);
    safeClose(clientWs, 4401, "Invalid session");
    return;
  }

  if (!authResult.allowed) {
    console.log(
      `[CHAT] rejected - not authorized | tokenId=${tokenId} addr=${authResult.address} client=${remote}`,
    );
    safeClose(clientWs, 4403, "Not authorized for this asset");
    return;
  }

  const assetTag = buildAssetTag(
    authResult.chainId,
    getContractAddress(authResult.chainId),
    tokenIdStr,
    assetId,
  );

  console.log(
    `[CHAT] connected | tokenId=${tokenIdStr} assetTag=${assetTag} addr=${authResult.address} role=${authResult.role} owner=${authResult.isOwner} client=${remote}`,
  );

  // 3. Attach rate limiter and heartbeat
  const session = createSessionState(authResult.address, clientWs);
  setupClientHeartbeat(session);

  // 4. Bridge to relay
  let relay;
  try {
    relay = await openRelayBridge(assetTag, clientWs, session);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    console.error(
      `[CHAT] relay bridge failed | client=${remote}:`,
      e.message,
    );
    session.dispose();
    safeClose(clientWs, 4403, "Could not connect to relay");
    return;
  }

  // 5. Welcome / ready message
  sendClient(clientWs, {
    type: "ready",
    assetId: authResult.assetId,
    assetTag,
    tokenId,
    chainId: authResult.chainId,
    address: authResult.address,
  });

  // 6. Handle incoming chat messages from browser
  clientWs.on("message", (/** @type {import('ws').RawData} */ raw) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    try {
      const payload = JSON.parse(raw.toString());
      if (payload.type === "ping") {
        sendClient(clientWs, { type: "pong" });
        return;
      }
      if (payload.type !== "chat" || typeof payload.content !== "string") {
        sendClient(clientWs, {
          type: "error",
          message: "Invalid message format",
        });
        return;
      }

      const content = payload.content.trim();
      if (!content) return;
      if (content.length > MAX_CONTENT_LENGTH) {
        sendClient(clientWs, {
          type: "error",
          message: `Message too long (max ${MAX_CONTENT_LENGTH})`,
        });
        return;
      }

      if (!session.allowMessage()) {
        sendClient(clientWs, { type: "error", message: "Rate limit exceeded" });
        return;
      }

      const event = buildSignedEvent(content, assetTag, authResult.address);
      relay
        .publish(event)
        .then(() => {
          console.log(
            `[CHAT] published | assetTag=${assetTag} sender=${authResult.address.slice(0, 10)}… len=${content.length}`,
          );
        })
        .catch((/** @type {Error} */ err) => {
          console.warn(
            `[CHAT] publish rejected | assetTag=${assetTag}:`,
            err.message,
          );
          sendClient(clientWs, {
            type: "error",
            message: "Relay rejected message",
          });
        });
    } catch (err) {
      console.warn(
        `[CHAT] bad client message | client=${remote}:`,
        /** @type {Error} */ (err).message,
      );
      sendClient(clientWs, { type: "error", message: "Invalid JSON" });
    }
  });

  clientWs.on("close", (/** @type {number} */ code, /** @type {Buffer} */ reason) => {
    console.log(
      `[CHAT] client disconnected | tokenId=${tokenId} assetTag=${assetTag} code=${code} reason=${reason}`,
    );
    session.dispose();
    relay.close();
  });

  clientWs.on("error", (/** @type {Error} */ err) => {
    console.error(`[CHAT] client error | client=${remote}:`, err.message);
    session.dispose();
    relay.close();
  });
}

// ─── Relay Bridge ───────────────────────────────────────────────────────────

/**
 * @param {string} assetTag
 * @param {import('ws').WebSocket} clientWs
 * @param {ChatSession} session
 * @returns {Promise<import('nostr-tools').Relay>}
 */
function openRelayBridge(assetTag, clientWs, session) {
  return new Promise((resolve, reject) => {
    const relay = createRelay(NOSTR_RELAY_URL);
    let resolved = false;

    relay.onclose = () => {
      console.log("[CHAT] relay closed");
      session.dispose();
      safeClose(clientWs, 1011, "Relay connection closed");
    };

    // Timeout if connect() does not resolve quickly.
    const connectTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        relay.close();
        reject(new Error("Relay connection timeout"));
      }
    }, 10000);

    relay
      .connect()
      .then(() => {
        clearTimeout(connectTimeout);
        relay.subscribe(
          [{ kinds: [KIND_CHAT], [`#${TAG_ASSET}`]: [assetTag], limit: 100 }],
          {
            onevent(event) {
              // Defensive: only forward events that carry the expected asset tag.
              if (
                Array.isArray(event.tags) &&
                event.tags.some(
                  (t) =>
                    Array.isArray(t) && t[0] === TAG_ASSET && t[1] === assetTag,
                )
              ) {
                sendClient(clientWs, { type: "event", event });
              }
            },
            oneose() {
              sendClient(clientWs, { type: "eose", assetTag });
            },
            // @ts-ignore nostr-tools SubscriptionParams does not declare onnotice
            onnotice(message) {
              sendClient(clientWs, { type: "relayNotice", message });
            },
            eoseTimeout: 10000,
          },
        );

        if (!resolved) {
          resolved = true;
          resolve(relay);
        }
      })
      .catch((err) => {
        clearTimeout(connectTimeout);
        console.error("[CHAT] relay error:", err.message || err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
        safeClose(clientWs, 1011, "Relay error");
      });
  });
}

// ─── Nostr Event Building ───────────────────────────────────────────────────

/**
 * @param {string} content
 * @param {string} assetTag
 * @param {string} senderAddress
 * @returns {import('nostr-tools').SignedNostrEvent}
 */
function buildSignedEvent(content, assetTag, senderAddress) {
  const eventTemplate = {
    kind: KIND_CHAT,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags: [
      [TAG_ASSET, assetTag],
      [TAG_SENDER, senderAddress.toLowerCase()],
    ],
  };

  return finalizeEvent(eventTemplate, /** @type {Uint8Array} */ (servicePrivkey));
}

// ─── Session State ──────────────────────────────────────────────────────────

/**
 * @param {string} address
 * @param {import('ws').WebSocket} clientWs
 * @returns {ChatSession}
 */
function createSessionState(address, clientWs) {
  /** @type {ChatSession} */
  const state = {
    address,
    clientWs,
    allowMessage() {
      const now = Date.now();

      // Sliding window: up to MAX_MSG_PER_MINUTE messages per wallet per minute.
      let timestamps = walletMessageTimestamps.get(address) || [];
      timestamps = timestamps.filter((/** @type {number} */ t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (timestamps.length >= MAX_MSG_PER_MINUTE) return false;

      timestamps.push(now);
      walletMessageTimestamps.set(address, timestamps);
      return true;
    },
    dispose() {
      if (state.pingInterval) clearInterval(state.pingInterval);
      if (state.pongTimeout) clearTimeout(state.pongTimeout);
    },
  };
  return state;
}

/**
 * @param {ChatSession} session
 */
function setupClientHeartbeat(session) {
  const ws = session.clientWs;

  ws.on("pong", () => {
    if (session.pongTimeout) {
      clearTimeout(session.pongTimeout);
      session.pongTimeout = null;
    }
  });

  session.pingInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      session.dispose();
      return;
    }
    ws.ping();
    session.pongTimeout = setTimeout(() => {
      console.log("[CHAT] client pong timeout - terminating");
      session.dispose();
      ws.terminate();
    }, CLIENT_PONG_TIMEOUT_MS);
  }, CLIENT_PING_INTERVAL_MS);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * @param {import('ws').WebSocket} ws
 * @param {object} payload
 */
function sendClient(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
