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

beforeAll(async () => {
  const mod = await import("../../src/api/chat-proxy.js");
  createChatProxy = mod.createChatProxy;
});

beforeEach(() => {
  jest.clearAllMocks();
  connectedClients.length = 0;
  createRelay.mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn(),
    publish: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    onclose: null,
  }));
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
});
