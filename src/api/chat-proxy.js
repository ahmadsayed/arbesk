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

import { WebSocketServer, WebSocket } from "ws";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import url from "url";
import { validateSession } from "./sessions.js";
import {
  getWeb3,
  getContractAddress,
  NOSTR_RELAY_URL,
  NOSTR_SERVICE_PRIVATE_KEY,
} from "../config.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const WS_PATH = "/api/v1/chat/ws";
const KIND_CHAT = 1;
const TAG_ASSET = "asset";
const TAG_SENDER = "sender";
const MAX_CONTENT_LENGTH = 2000;
const MAX_MSG_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RELAY_RECONNECT_DELAY_MS = 2000;
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
  servicePubkey = bytesToHex(schnorr.getPublicKey(servicePrivkey));
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
  const session = createSessionState(address, access.assetId, clientWs);
  setupClientHeartbeat(session);

  // 4. Bridge to relay
  let relayWs;
  try {
    relayWs = await openRelayBridge(access.assetId, clientWs, session);
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
      if (relayWs.readyState === WebSocket.OPEN) {
        relayWs.send(JSON.stringify(["EVENT", event]));
        console.log(
          `[CHAT] published | asset=${access.assetId} sender=${address.slice(0, 10)}… len=${content.length}`
        );
      } else {
        sendClient(clientWs, { type: "error", message: "Relay not connected" });
      }
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
    safeClose(relayWs, 1000, "Client disconnected");
  });

  clientWs.on("error", (err) => {
    console.error(`[CHAT] client error | client=${remote}:`, err.message);
    session.dispose();
    safeClose(relayWs, 1011, "Client error");
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
    const relayWs = new WebSocket(NOSTR_RELAY_URL);
    const subId = `asset-${assetId.slice(-16)}-${Date.now().toString(36)}`;
    let resolved = false;
    let eoseReceived = false;

    relayWs.on("open", () => {
      relayWs.send(
        JSON.stringify([
          "REQ",
          subId,
          { kinds: [KIND_CHAT], [`#${TAG_ASSET}`]: [assetId], limit: 100 },
        ])
      );
      if (!resolved) {
        resolved = true;
        resolve(relayWs);
      }
    });

    relayWs.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!Array.isArray(msg)) return;
        const [type, ...rest] = msg;

        if (type === "EVENT" && rest[0] === subId && rest[1]) {
          const event = rest[1];
          // Defensive: only forward events that carry the expected asset tag.
          if (
            Array.isArray(event.tags) &&
            event.tags.some(
              (t) => Array.isArray(t) && t[0] === TAG_ASSET && t[1] === assetId
            )
          ) {
            sendClient(clientWs, { type: "event", event });
          }
        } else if (type === "EOSE" && rest[0] === subId && !eoseReceived) {
          eoseReceived = true;
          sendClient(clientWs, { type: "eose", assetId });
        } else if (type === "NOTICE") {
          sendClient(clientWs, { type: "relayNotice", message: rest[0] });
        }
      } catch (err) {
        console.warn("[CHAT] relay message parse error:", err.message);
      }
    });

    relayWs.on("error", (err) => {
      console.error("[CHAT] relay error:", err.message);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
      safeClose(clientWs, 1011, "Relay error");
    });

    relayWs.on("close", (code) => {
      console.log(`[CHAT] relay closed | code=${code}`);
      session.dispose();
      safeClose(clientWs, 1011, "Relay connection closed");
    });

    // Timeout if not opened quickly
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        relayWs.terminate();
        reject(new Error("Relay connection timeout"));
      }
    }, 10000);
  });
}

// ─── Nostr Event Building ───────────────────────────────────────────────────

function buildSignedEvent(content, assetId, senderAddress) {
  const createdAt = Math.floor(Date.now() / 1000);
  const event = {
    kind: KIND_CHAT,
    created_at: createdAt,
    content,
    tags: [
      [TAG_ASSET, assetId],
      [TAG_SENDER, senderAddress.toLowerCase()],
    ],
    pubkey: servicePubkey,
  };

  const id = bytesToHex(
    sha256(new TextEncoder().encode(serializeEvent(event)))
  );
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), servicePrivkey));

  return { ...event, id, sig };
}

function serializeEvent(event) {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

// ─── Session State ──────────────────────────────────────────────────────────

function createSessionState(address, assetId, clientWs) {
  const state = {
    address,
    assetId,
    clientWs,
    messages: [],
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

function safeClose(ws, code, reason) {
  if (!ws) return;
  if (
    ws.readyState === WebSocket.OPEN ||
    ws.readyState === WebSocket.CONNECTING
  ) {
    try {
      ws.close(code, reason);
    } catch {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
  }
}
