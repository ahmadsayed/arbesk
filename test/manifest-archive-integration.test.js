/**
 * Manifest comments_archive_cid integration test.
 *
 * Verifies that POST /api/v1/manifests reads publishContext, queries the
 * Nostr relay, and embeds comments_archive_cid in the stored manifest.
 */

import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

jest.setTimeout(10000);

describe("Manifest comments archive integration", () => {
  let app;
  let ipfsStorage;
  let relayMessages;
  let actualSubId;

  beforeAll(async () => {
    ipfsStorage = new Map();
    relayMessages = [];
    actualSubId = null;

    const mockIPFS = {
      add: jest.fn(async (data) => {
        const hash = "Qm" + Buffer.from(typeof data === "string" ? data : JSON.stringify(data)).toString("hex").slice(0, 15);
        ipfsStorage.set(hash, typeof data === "string" ? data : JSON.stringify(data));
        return { cid: { toString: () => hash } };
      }),
      pin: {
        add: jest.fn(async () => {}),
        rm: jest.fn(async () => {}),
      },
    };

    jest.unstable_mockModule("ipfs-http-client", () => ({
      create: jest.fn(() => mockIPFS),
    }));

    jest.unstable_mockModule("ws", () => {
      function MockWebSocket() {
        this.readyState = 0;
        setTimeout(() => {
          this.readyState = 1;
          if (this.onopen) this.onopen();
        }, 0);
      }
      MockWebSocket.prototype.send = function (data) {
        try {
          const req = JSON.parse(data);
          if (Array.isArray(req) && req[0] === "REQ" && req[1]) {
            actualSubId = req[1];
            setTimeout(() => {
              for (const msg of relayMessages) {
                if (this.onmessage) {
                  const rewritten = [...msg];
                  if (actualSubId && rewritten.length > 1) rewritten[1] = actualSubId;
                  this.onmessage({ data: JSON.stringify(rewritten) });
                }
              }
            }, 0);
          }
        } catch {
          // ignore
        }
      };
      MockWebSocket.prototype.close = function () {
        this.readyState = 3;
        if (this.onclose) this.onclose({ message: "closed by test" });
      };
      MockWebSocket.prototype.terminate = function () {};
      MockWebSocket.prototype.ping = function () {};
      MockWebSocket.prototype.once = function (event, handler) {
        if (event === "pong") {
          setTimeout(() => handler(true), 0);
        }
      };
      MockWebSocket.OPEN = 1;
      MockWebSocket.CONNECTING = 0;
      const MockedWebSocket = jest.fn(function () {
        MockWebSocket.call(this);
      });
      MockedWebSocket.prototype = MockWebSocket.prototype;
      MockedWebSocket.OPEN = 1;
      MockedWebSocket.CONNECTING = 0;
      return {
        WebSocket: MockedWebSocket,
        WebSocketServer: jest.fn(),
      };
    });

    jest.unstable_mockModule("../src/config.js", () => ({
      CONTRACT_ADDRESS: "0xArbeskContractAddress",
      PAID_CONTRACT_ADDRESS: "0xPaidContractAddress",
      ASSETS_IPFS: null,
      IPFS_API_URL: "http://127.0.0.1:5001",
      HARDHAT_RPC_URL: "http://127.0.0.1:8545",
      NETWORK_CONFIGS: {
        31337: {
          name: "Hardhat Local",
          contractAddress: "0xArbeskContractAddress",
          paidContractAddress: "0xPaidContractAddress",
          rpcUrl: "http://127.0.0.1:8545",
        },
      },
      getNetworkConfig: jest.fn((id) => ({
        31337: {
          name: "Hardhat Local",
          contractAddress: "0xArbeskContractAddress",
          paidContractAddress: "0xPaidContractAddress",
          rpcUrl: "http://127.0.0.1:8545",
        },
      }[Number(id)] || null)),
      getContractAddress: jest.fn(() => "0xArbeskContractAddress"),
      getUsdcToken: jest.fn(() => "0xUsdcToken"),
      getRpcUrl: jest.fn(() => "http://127.0.0.1:8545"),
      getWeb3: jest.fn(() => ({})),
      web3: {},
      API_URL: "http://127.0.0.1:8545",
      NOSTR_RELAY_URL: "ws://127.0.0.1:7777",
      NOSTR_SERVICE_PRIVATE_KEY: "a".repeat(64),
    }));

    const { default: createApi } = await import("../src/api/index.js");
    app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use("/api", createApi());
  });

  beforeEach(() => {
    ipfsStorage.clear();
    relayMessages = [];
    actualSubId = null;
    jest.clearAllMocks();
  });

  test("embeds comments_archive_cid when publishContext is provided", async () => {
    const assetId = "31337:0xArbeskContractAddress:42";
    relayMessages = [
      ["EVENT", "sub", { id: "evt-1", kind: 1, content: "nice asset", created_at: 1000, tags: [["asset", assetId], ["sender", "0xaaa"]] }],
      ["EOSE", "sub"],
    ];

    const manifest = {
      name: "Archived Asset",
      asset_id: "archived_asset_001",
      version: 2,
      scene: { nodes: [] },
      publishContext: {
        tokenId: "42",
        chainId: 31337,
        contractAddress: "0xArbeskContractAddress",
      },
    };

    const res = await request(app).post("/api/v1/manifests").send(manifest);

    expect(res.status).toBe(201);
    const stored = JSON.parse(ipfsStorage.get(res.body.cid));
    expect(stored.comments_archive_cid).toMatch(/^Qm/);
    expect(stored.publishContext).toBeUndefined();

    const archive = JSON.parse(ipfsStorage.get(stored.comments_archive_cid));
    expect(archive.assetId).toBe(assetId);
    expect(archive.eventCount).toBe(1);
    expect(archive.events[0].id).toBe("evt-1");
  });

  test("does not set comments_archive_cid when publishContext is absent", async () => {
    const manifest = {
      name: "Draft Asset",
      asset_id: "draft_asset_001",
      version: 1,
      scene: { nodes: [] },
    };

    const res = await request(app).post("/api/v1/manifests").send(manifest);

    expect(res.status).toBe(201);
    const stored = JSON.parse(ipfsStorage.get(res.body.cid));
    expect(stored.comments_archive_cid).toBeUndefined();
  });

  test("still succeeds when relay query fails", async () => {
    // Make the WebSocket throw on creation by setting relayMessages to a sentinel?
    // Instead we override the mock for this test only.
    const { WebSocket } = await import("ws");
    WebSocket.mockImplementationOnce(function () {
      this.readyState = 0;
      setTimeout(() => {
        if (this.onerror) this.onerror(new Error("relay down"));
        this.readyState = 3;
        if (this.onclose) this.onclose({ message: "relay down" });
      }, 0);
    });

    const manifest = {
      name: "Relay Down Asset",
      asset_id: "relay_down_asset_001",
      version: 2,
      scene: { nodes: [] },
      publishContext: {
        tokenId: "99",
        chainId: 31337,
      },
    };

    const res = await request(app).post("/api/v1/manifests").send(manifest);

    expect(res.status).toBe(201);
    const stored = JSON.parse(ipfsStorage.get(res.body.cid));
    // Archive failure is non-fatal
    expect(stored.comments_archive_cid).toBeUndefined();
  });
});
