import { jest } from "@jest/globals";

// ─── Mocks for ws ────────────────────────────────────────────────────────────

const connectedClients = [];

function createMockClient() {
  const handlers = {};
  const ws = {
    readyState: 1,
    sent: [],
    handlers,
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit(event, ...args) {
      const h = handlers[event];
      if (h) h(...args);
    },
    close: jest.fn((code, reason) => {
      ws.readyState = 3;
      if (handlers.close) handlers.close(code, reason);
    }),
    terminate: jest.fn(() => {
      ws.readyState = 3;
    }),
    ping: jest.fn(),
    send: jest.fn((data) => {
      ws.sent.push(data);
    }),
  };
  connectedClients.push(ws);
  return ws;
}

function createMockWss() {
  const handlers = {};
  return {
    handlers,
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    close: jest.fn(),
    terminate: jest.fn(),
  };
}

const MockWebSocket = jest.fn(function () {
  return createMockClient();
});
MockWebSocket.OPEN = 1;
MockWebSocket.CONNECTING = 0;
MockWebSocket.CLOSED = 3;

const MockWebSocketServer = jest.fn(() => createMockWss());

jest.unstable_mockModule("ws", () => ({
  WebSocketServer: MockWebSocketServer,
  WebSocket: MockWebSocket,
}));

// ─── Mocks for nostr-tools ───────────────────────────────────────────────────

jest.unstable_mockModule("nostr-tools", () => ({
  finalizeEvent: jest.fn((eventTemplate, _privkey) => ({
    ...eventTemplate,
    id: "event-id",
    sig: "event-sig",
    pubkey: "service-pubkey",
  })),
  getPublicKey: jest.fn(() => "service-pubkey"),
  utils: {
    hexToBytes: jest.fn((hex) => Uint8Array.from(Buffer.from(hex, "hex"))),
  },
}));

// ─── Mocks for dependencies ──────────────────────────────────────────────────

const createRelay = jest.fn();
const safeClose = jest.fn((ws, code, reason) => {
  if (ws && typeof ws.close === "function") ws.close(code, reason);
});

jest.unstable_mockModule("../../src/api/nostr-relay.js", () => ({
  KIND_CHAT: 1,
  TAG_ASSET: "asset",
  createRelay,
  safeClose,
}));

const authorizeAssetAccess = jest.fn();

jest.unstable_mockModule("../../src/api/authorization.js", () => ({
  authorizeAssetAccess,
}));

jest.unstable_mockModule("../../src/config.js", () => ({
  NOSTR_SERVICE_PRIVATE_KEY: "a".repeat(64),
  NOSTR_RELAY_URL: "ws://127.0.0.1:7777",
  getContractAddress: jest.fn(() => "0xContractAddress"),
}));

// ─── Test setup ───────────────────────────────────────────────────────────────

let createChatProxy;
let lastRelay;
let lastRelayOpts;

beforeAll(async () => {
  const mod = await import("../../src/api/chat-proxy.js");
  createChatProxy = mod.createChatProxy;
});

beforeEach(() => {
  jest.clearAllMocks();
  connectedClients.length = 0;
  lastRelay = null;
  lastRelayOpts = null;
  createRelay.mockImplementation(() => {
    const relay = {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn((_filters, opts) => {
        lastRelayOpts = opts;
      }),
      publish: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
      onclose: null,
    };
    lastRelay = relay;
    return relay;
  });
  authorizeAssetAccess.mockResolvedValue({
    allowed: true,
    address: "0xOwnerAddress",
    chainId: 31415822,
    assetId: "asset-1",
    isOwner: true,
    role: 2,
  });
});

afterEach(() => {
  for (const ws of connectedClients) {
    ws.emit("close", 1000, "test cleanup");
  }
  connectedClients.length = 0;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockReq(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return {
    url: `/api/v1/chat/ws?${params.toString()}`,
    socket: { remoteAddress: "127.0.0.1" },
  };
}

async function connect(query) {
  const httpServer = {};
  const wss = createChatProxy(httpServer);
  expect(wss).not.toBeNull();
  const handler = wss.handlers.connection;
  expect(handler).toBeDefined();

  const ws = createMockClient();
  const req = createMockReq(query);
  await handler(ws, req);
  return { wss, ws, req };
}

function getReadyMessage(ws) {
  const ready = ws.sent.find((s) => {
    try {
      return JSON.parse(s).type === "ready";
    } catch {
      return false;
    }
  });
  return ready ? JSON.parse(ready) : null;
}

function getErrorMessages(ws) {
  return ws.sent
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter((m) => m && m.type === "error");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("chat-proxy", () => {
  it("closes with 4400 when token is missing", async () => {
    const { ws } = await connect({ tokenId: "1", assetId: "asset-1" });
    expect(ws.close).toHaveBeenCalledWith(
      4400,
      expect.stringContaining("Missing token"),
    );
  });

  it("closes with 4400 when assetId is missing", async () => {
    const { ws } = await connect({ token: "session-token", tokenId: "1" });
    expect(ws.close).toHaveBeenCalledWith(
      4400,
      expect.stringContaining("Missing assetId"),
    );
  });

  it("closes with 4401 when session is invalid", async () => {
    authorizeAssetAccess.mockResolvedValue(null);
    const { ws } = await connect({
      token: "bad-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    expect(ws.close).toHaveBeenCalledWith(
      4401,
      expect.stringContaining("Invalid session"),
    );
  });

  it("closes with 4403 when address is not authorized", async () => {
    authorizeAssetAccess.mockResolvedValue({
      allowed: false,
      address: "0xRandomAddress",
      chainId: 31415822,
      assetId: "asset-1",
      isOwner: false,
      role: 0,
    });
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    expect(ws.close).toHaveBeenCalledWith(
      4403,
      expect.stringContaining("Not authorized"),
    );
  });

  it("sends ready message with correct assetTag for authorized owner", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    const ready = getReadyMessage(ws);
    expect(ready).not.toBeNull();
    expect(ready.assetTag).toBe(
      "31415822:0xcontractaddress:1:asset-1",
    );
    expect(ready.type).toBe("ready");
    expect(ready.address).toBe("0xOwnerAddress");
  });

  it("sends error but does not close on invalid JSON", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    ws.emit("message", { toString: () => "not-json" });
    const errors = getErrorMessages(ws);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/Invalid JSON/i);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("sends error when chat content exceeds MAX_CONTENT_LENGTH", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    ws.emit("message", {
      toString: () =>
        JSON.stringify({ type: "chat", content: "x".repeat(2001) }),
    });
    const errors = getErrorMessages(ws);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/too long/i);
  });

  it("sends rate-limit error after more than 10 messages per minute", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    for (let i = 0; i < 10; i += 1) {
      ws.emit("message", {
        toString: () => JSON.stringify({ type: "chat", content: `msg-${i}` }),
      });
    }
    ws.emit("message", {
      toString: () => JSON.stringify({ type: "chat", content: "overflow" }),
    });
    const errors = getErrorMessages(ws);
    expect(errors.some((e) => e.message.match(/Rate limit exceeded/i))).toBe(
      true,
    );
  });

  it("closes connection when relay connect fails", async () => {
    createRelay.mockImplementation(() => ({
      connect: jest.fn().mockRejectedValue(new Error("relay down")),
      subscribe: jest.fn(),
      publish: jest.fn(),
      close: jest.fn(),
      onclose: null,
    }));
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    expect(ws.close).toHaveBeenCalled();
    const closeArgs = ws.close.mock.calls.find(
      (c) => c[0] === 4403 || c[0] === 1011,
    );
    expect(closeArgs).toBeDefined();
  });

  it("terminates client after ping/pong timeout", async () => {
    jest.useFakeTimers();
    let ws;
    try {
      ({ ws } = await connect({
        token: "session-token",
        tokenId: "1",
        assetId: "asset-1",
      }));
      expect(ws.terminate).not.toHaveBeenCalled();

      // Trigger the 30s ping interval.
      jest.advanceTimersByTime(30000);
      expect(ws.ping).toHaveBeenCalled();

      // Pong timeout fires after 10s without a pong response.
      jest.advanceTimersByTime(10000);
      expect(ws.terminate).toHaveBeenCalled();
    } finally {
      if (ws) ws.emit("close", 1000, "test cleanup");
      jest.useRealTimers();
    }
  });

  it("keeps the connection alive when the client responds to ping with pong", async () => {
    jest.useFakeTimers();
    let ws;
    try {
      ({ ws } = await connect({
        token: "session-token",
        tokenId: "1",
        assetId: "asset-1",
      }));

      jest.advanceTimersByTime(30000);
      expect(ws.ping).toHaveBeenCalled();

      ws.emit("pong");
      jest.advanceTimersByTime(10000);
      expect(ws.terminate).not.toHaveBeenCalled();
    } finally {
      if (ws) ws.emit("close", 1000, "test cleanup");
      jest.useRealTimers();
    }
  });

  it("does not send pings once the socket leaves OPEN state", async () => {
    jest.useFakeTimers();
    let ws;
    try {
      ({ ws } = await connect({
        token: "session-token",
        tokenId: "1",
        assetId: "asset-1",
      }));

      ws.readyState = WebSocket.CLOSING;
      ws.ping.mockClear();
      jest.advanceTimersByTime(30000);
      expect(ws.ping).not.toHaveBeenCalled();
    } finally {
      if (ws) ws.emit("close", 1000, "test cleanup");
      jest.useRealTimers();
    }
  });

  it("parses a valid Merkle proof from the query string", async () => {
    const proof = encodeURIComponent(JSON.stringify(["0xabc", "0xdef"]));
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
      proof,
      role: "1",
    });
    expect(getReadyMessage(ws)).not.toBeNull();
    expect(authorizeAssetAccess).toHaveBeenCalledWith(
      "session-token",
      "1",
      null,
      expect.objectContaining({
        proof: ["0xabc", "0xdef"],
        requiredRole: 1,
      }),
    );
  });

  it("treats an invalid proof query string as no proof", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
      proof: "not-json",
    });
    expect(getReadyMessage(ws)).not.toBeNull();
    expect(authorizeAssetAccess).toHaveBeenCalledWith(
      "session-token",
      "1",
      null,
      expect.objectContaining({ proof: undefined }),
    );
  });

  it("rejects messages that are not chat events", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    ws.emit("message", { toString: () => JSON.stringify({ type: "hello" }) });
    const errors = getErrorMessages(ws);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/Invalid message format/i);
  });

  it("rejects chat messages whose content is not a string", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    ws.emit("message", {
      toString: () => JSON.stringify({ type: "chat", content: 123 }),
    });
    const errors = getErrorMessages(ws);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/Invalid message format/i);
  });

  it("sends an error when the relay rejects a published message", async () => {
    // Use a fresh wallet address so the global rate-limit map from earlier
    // tests does not block this message.
    authorizeAssetAccess.mockResolvedValue({
      allowed: true,
      address: "0xPublisher",
      chainId: 31415822,
      assetId: "asset-1",
      isOwner: true,
      role: 2,
    });
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    lastRelay.publish.mockRejectedValue(new Error("relay refused"));

    ws.emit("message", {
      toString: () => JSON.stringify({ type: "chat", content: "hello" }),
    });

    // Wait for the async publish rejection to propagate.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const errors = getErrorMessages(ws);
    expect(errors.some((e) => e.message.match(/Relay rejected message/i))).toBe(
      true,
    );
  });

  it("closes the client when the relay connection closes", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    lastRelay.onclose();
    expect(ws.close).toHaveBeenCalledWith(
      1011,
      expect.stringContaining("Relay connection closed"),
    );
  });

  it("closes the client and relay on a client socket error", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    ws.emit("error", new Error("socket exploded"));
    expect(lastRelay.close).toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled(); // error handler only disposes + relay.close
  });

  it("forwards relay events that carry the correct asset tag", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    expect(lastRelayOpts).toBeDefined();

    lastRelayOpts.onevent({
      id: "evt-1",
      tags: [["asset", "31415822:0xcontractaddress:1:asset-1"]],
    });
    const events = ws.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((m) => m && m.type === "event");
    expect(events).toHaveLength(1);
    expect(events[0].event.id).toBe("evt-1");
  });

  it("ignores relay events that do not carry the correct asset tag", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    lastRelayOpts.onevent({
      id: "evt-2",
      tags: [["asset", "wrong-tag"]],
    });
    const events = ws.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((m) => m && m.type === "event");
    expect(events).toHaveLength(0);
  });

  it("forwards relay notices and EOSE to the client", async () => {
    const { ws } = await connect({
      token: "session-token",
      tokenId: "1",
      assetId: "asset-1",
    });
    lastRelayOpts.onnotice("notice message");
    lastRelayOpts.oneose();

    const messages = ws.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    expect(messages.some((m) => m.type === "relayNotice")).toBe(true);
    expect(messages.some((m) => m.type === "eose")).toBe(true);
  });
});

describe("chat-proxy service key", () => {
  it("returns null and warns when the service private key is missing", async () => {
    jest.resetModules();

    jest.unstable_mockModule("ws", () => ({
      WebSocketServer: jest.fn(() => ({ on: jest.fn() })),
      WebSocket: jest.fn(),
    }));

    jest.unstable_mockModule("nostr-tools", () => ({
      finalizeEvent: jest.fn(),
      getPublicKey: jest.fn(),
      utils: { hexToBytes: jest.fn() },
    }));

    jest.unstable_mockModule("../../src/api/nostr-relay.js", () => ({
      KIND_CHAT: 1,
      TAG_ASSET: "asset",
      createRelay: jest.fn(),
      safeClose: jest.fn(),
    }));

    jest.unstable_mockModule("../../src/api/authorization.js", () => ({
      authorizeAssetAccess: jest.fn(),
    }));

    jest.unstable_mockModule("../../src/config.js", () => ({
      NOSTR_SERVICE_PRIVATE_KEY: undefined,
      NOSTR_RELAY_URL: "ws://127.0.0.1:7777",
      getContractAddress: jest.fn(),
    }));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../../src/api/chat-proxy.js");
    const wss = mod.createChatProxy({});

    expect(wss).toBeNull();
    warnSpy.mockRestore();
  });
});
