/**
 * Arbesk Chat Proxy
 *
 * WebSocket bridge between the Studio frontend and the private Nostr relay.
 *
 * Authentication: the browser passes the existing SIWE session token in the
 * WebSocket query string. The proxy validates it via src/api/sessions.js,
 * resolves the wallet address, then checks on-chain asset ownership or
 * collaborator role (Viewer+).
 *
 * Authorization model:
 *   - ownerOf(tokenId) === address  => allowed
 *   - getCollaboratorRole(tokenId, address) >= Viewer (1) => allowed
 *   - otherwise => connection closed with 4401
 *
 * The proxy signs all published Nostr events with a service private key and
 * injects the verified Ethereum sender address into the event tags. The relay
 * remains a stock nostr-rs-relay instance; scoping is enforced by the proxy.
 */

import { WebSocketServer } from "ws";
import { finalizeEvent, getPublicKey, utils } from "nostr-tools";
import url from "url";
import { validateSession } from "./sessions.js";
import { KIND_CHAT, TAG_ASSET, createRelay, safeClose } from "./nostr-relay.js";
import {
  getWeb3,
  getContractAddress,
  NOSTR_RELAY_URL,
  NOSTR_SERVICE_PRIVATE_KEY,
} from "../config.js";

const { hexToBytes } = utils;

// ─── Constants ──────────────────────────────────────────────────────────────

const WS_PATH = "/api/v1/chat/ws";
const TAG_SENDER = "sender";
const MAX_CONTENT_LENGTH = 2000;
const MAX_MSG_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CLIENT_PING_INTERVAL_MS = 30000;
const CLIENT_PONG_TIMEOUT_MS = 10000;

// Global wallet-level sliding window: address -> [timestamps within window]
const walletMessageTimestamps = new Map();

const MINIMAL_COLLAB_ABI = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "collaborator", type: "address" },
    ],
    name: "getCollaboratorRole",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
];

// ─── Service Key ────────────────────────────────────────────────────────────

let servicePubkey = null;
let servicePrivkey = null;

function initServiceKey() {
  if (servicePubkey) return true;
  if (!NOSTR_SERVICE_PRIVATE_KEY) {
    console.warn(
      "[CHAT] NOSTR_SERVICE_PRIVATE_KEY not set; chat proxy disabled. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
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
    handleConnection(ws, req).catch((err) => {
      console.error("[CHAT] unhandled connection error:", err.message);
      safeClose(ws, 1011, "Internal error");
    });
  });

  console.log(`[CHAT] proxy listening on ${WS_PATH} → ${NOSTR_RELAY_URL}`);
  return wss;
}

// ─── Connection Handler ─────────────────────────────────────────────────────

async function handleConnection(clientWs, req) {
  const remote = req.socket.remoteAddress || "unknown";
  const parsedUrl = url.parse(req.url, true);
  const { token, tokenId, chainId } = parsedUrl.query;

  if (!token || !tokenId) {
    console.log(`[CHAT] rejected — missing token or tokenId | client=${remote}`);
    safeClose(clientWs, 4400, "Missing token or tokenId");
    return;
  }

  // 1. Validate SIWE session
  const address = validateSession(token);
  if (!address) {
    console.log(`[CHAT] rejected — invalid session | client=${remote}`);
    safeClose(clientWs, 4401, "Invalid session");
    return;
  }

  // 2. Check asset access
  let access;
  try {
    access = await checkAssetAccess(tokenId, chainId, address);
  } catch (err) {
    console.error(`[CHAT] access check failed | client=${remote}:`, err.message);
    safeClose(clientWs, 4403, "Access check failed");
    return;
  }

  if (!access.allowed) {
    console.log(
      `[CHAT] rejected — not viewer/owner | tokenId=${tokenId} addr=${address} client=${remote}`
    );
    safeClose(clientWs, 4403, "Not authorized for this asset");
    return;
  }

  console.log(
    `[CHAT] connected | tokenId=${tokenId} asset=${access.assetId} addr=${address} client=${remote}`
  );

  // 3. Attach rate limiter and heartbeat
  const session = createSessionState(address, clientWs);
  setupClientHeartbeat(session);

  // 4. Bridge to relay
  let relay;
  try {
    relay = await openRelayBridge(access.assetId, clientWs, session);
  } catch (err) {
    console.error(`[CHAT] relay bridge failed | client=${remote}:`, err.message);
    safeClose(clientWs, 4403, "Could not connect to relay");
    return;
  }

  // 5. Welcome / ready message
  sendClient(clientWs, {
    type: "ready",
    assetId: access.assetId,
    tokenId,
    chainId: access.chainId,
    address,
  });

  // 6. Handle incoming chat messages from browser
  clientWs.on("message", (raw) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    try {
      const payload = JSON.parse(raw.toString());
      if (payload.type === "ping") {
        sendClient(clientWs, { type: "pong" });
        return;
      }
      if (payload.type !== "chat" || typeof payload.content !== "string") {
        sendClient(clientWs, { type: "error", message: "Invalid message format" });
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

      const event = buildSignedEvent(content, access.assetId, address);
      relay
        .publish(event)
        .then(() => {
          console.log(
            `[CHAT] published | asset=${access.assetId} sender=${address.slice(0, 10)}… len=${content.length}`
          );
        })
        .catch((err) => {
          console.warn(`[CHAT] publish rejected | asset=${access.assetId}:`, err.message);
          sendClient(clientWs, { type: "error", message: "Relay rejected message" });
        });
    } catch (err) {
      console.warn(`[CHAT] bad client message | client=${remote}:`, err.message);
      sendClient(clientWs, { type: "error", message: "Invalid JSON" });
    }
  });

  clientWs.on("close", (code, reason) => {
    console.log(
      `[CHAT] client disconnected | tokenId=${tokenId} code=${code} reason=${reason}`
    );
    session.dispose();
    relay.close();
  });

  clientWs.on("error", (err) => {
    console.error(`[CHAT] client error | client=${remote}:`, err.message);
    session.dispose();
    relay.close();
  });
}

// ─── Asset Access Check ─────────────────────────────────────────────────────

async function checkAssetAccess(tokenId, chainId, address) {
  const id = Number(tokenId);
  if (!Number.isFinite(id) || id < 0) {
    throw new Error("Invalid tokenId");
  }

  const cid = chainId ? Number(chainId) : null;
  const contractAddr = getContractAddress(cid);
  if (!contractAddr) {
    throw new Error(`No contract address for chain ${chainId || "default"}`);
  }

  const w3 = getWeb3(cid);
  const contract = new w3.eth.Contract(MINIMAL_COLLAB_ABI, contractAddr);

  const [owner, role] = await Promise.all([
    contract.methods.ownerOf(id).call(),
    contract.methods.getCollaboratorRole(id, address).call(),
  ]);

  const normalizedAddress = address.toLowerCase();
  const isOwner = owner.toLowerCase() === normalizedAddress;
  const roleNum = Number(role);
  const isViewerOrHigher = roleNum >= 1;

  return {
    allowed: isOwner || isViewerOrHigher,
    assetId: `${cid || defaultChainId()}:${contractAddr}:${id}`,
    chainId: cid,
    isOwner,
    role: roleNum,
  };
}

function defaultChainId() {
  // Matches CHAIN_IDS.HARDHAT_LOCAL for local dev when chainId not supplied.
  return 31337;
}

// ─── Relay Bridge ───────────────────────────────────────────────────────────

function openRelayBridge(assetId, clientWs, session) {
  return new Promise((resolve, reject) => {
    const relay = createRelay(NOSTR_RELAY_URL);
    let resolved = false;

    relay.onclose = () => {
      console.log("[CHAT] relay closed");
      session.dispose();
      safeClose(clientWs, 1011, "Relay connection closed");
    };

    relay
      .connect()
      .then(() => {
        relay.subscribe(
          [{ kinds: [KIND_CHAT], [`#${TAG_ASSET}`]: [assetId], limit: 100 }],
          {
            onevent(event) {
              // Defensive: only forward events that carry the expected asset tag.
              if (
                Array.isArray(event.tags) &&
                event.tags.some(
                  (t) => Array.isArray(t) && t[0] === TAG_ASSET && t[1] === assetId
                )
              ) {
                sendClient(clientWs, { type: "event", event });
              }
            },
            oneose() {
              sendClient(clientWs, { type: "eose", assetId });
            },
            onnotice(message) {
              sendClient(clientWs, { type: "relayNotice", message });
            },
            eoseTimeout: 10000,
          }
        );

        if (!resolved) {
          resolved = true;
          resolve(relay);
        }
      })
      .catch((err) => {
        console.error("[CHAT] relay error:", err.message || err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
        safeClose(clientWs, 1011, "Relay error");
      });

    // Timeout if connect() does not resolve quickly.
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        relay.close();
        reject(new Error("Relay connection timeout"));
      }
    }, 10000);
  });
}

// ─── Nostr Event Building ───────────────────────────────────────────────────

function buildSignedEvent(content, assetId, senderAddress) {
  const eventTemplate = {
    kind: KIND_CHAT,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags: [
      [TAG_ASSET, assetId],
      [TAG_SENDER, senderAddress.toLowerCase()],
    ],
  };

  return finalizeEvent(eventTemplate, servicePrivkey);
}

// ─── Session State ──────────────────────────────────────────────────────────

function createSessionState(address, clientWs) {
  const state = {
    address,
    clientWs,
    allowMessage() {
      const now = Date.now();

      // Sliding window: up to MAX_MSG_PER_MINUTE messages per wallet per minute.
      let timestamps = walletMessageTimestamps.get(address) || [];
      timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
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
      console.log("[CHAT] client pong timeout — terminating");
      session.dispose();
      ws.terminate();
    }, CLIENT_PONG_TIMEOUT_MS);
  }, CLIENT_PING_INTERVAL_MS);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendClient(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

