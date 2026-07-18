/**
 * Manifest comments_archive_cid integration test.
 *
 * Verifies that POST /api/v1/assets/snapshot-comments queries the
 * Nostr relay, builds a content-addressed archive, stores it on IPFS,
 * and returns the archive CID + event count.
 *
 * Manifests are now written directly to IPFS by the browser;
 * the comments archive is a standalone server-side operation.
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
  let _resetStorage;

  beforeAll(async () => {
    ipfsStorage = new Map();
    relayMessages = [];
    actualSubId = null;

    const mockIPFS = {
      add: jest.fn(async (data) => {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        const hash = "bafy" + Buffer.from(payload).toString("hex").slice(0, 15);
        ipfsStorage.set(hash, payload);
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
                  if (actualSubId && rewritten.length > 1)
                    rewritten[1] = actualSubId;
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

    jest.unstable_mockModule("../src/api/sessions.js", () => ({
      default: jest.fn(() => express.Router()),
      validateSession: jest.fn(() => "0xTestAddress"),
    }));

    jest.unstable_mockModule("../src/config.js", () => ({
      CONTRACT_ADDRESS: "0xArbeskContractAddress",
      PAID_CONTRACT_ADDRESS: "0xPaidContractAddress",
      HARDHAT_RPC_URL: "http://127.0.0.1:8545",
      NETWORK_CONFIGS: {
        31337: {
          name: "Hardhat Local",
          contractAddress: "0xArbeskContractAddress",
          paidContractAddress: "0xPaidContractAddress",
          rpcUrl: "http://127.0.0.1:8545",
        },
      },
      getNetworkConfig: jest.fn(
        (id) =>
          ({
            31337: {
              name: "Hardhat Local",
              contractAddress: "0xArbeskContractAddress",
              paidContractAddress: "0xPaidContractAddress",
              rpcUrl: "http://127.0.0.1:8545",
            },
          })[Number(id)] || null,
      ),
      getContractAddress: jest.fn(() => "0xArbeskContractAddress"),
      getConfiguredContracts: jest.fn(() => [
        "0xArbeskContractAddress",
        "0xPaidContractAddress",
      ]),
      getRpcUrl: jest.fn(() => "http://127.0.0.1:8545"),
      getWeb3: jest.fn(() => ({})),
      web3: {},
      API_URL: "http://127.0.0.1:8545",
      NOSTR_RELAY_URL: "ws://127.0.0.1:7777",
      NOSTR_SERVICE_PRIVATE_KEY: "a".repeat(64),
    }));

    const { default: createApi } = await import("../src/api/index.js");
    const storageMod = await import("../src/api/storage/index.js");
    _resetStorage = storageMod._resetStorage;
    app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use("/api", createApi());
  });

  beforeEach(() => {
    ipfsStorage.clear();
    relayMessages = [];
    actualSubId = null;
    jest.clearAllMocks();
    // Reset storage cache so the mock is fresh for each test.
    _resetStorage();
  });

  test("archives comments and returns CID when relay has events", async () => {
    const contractAddress = "0x1234567890123456789012345678901234567890";
    const assetTag = `31337:${contractAddress.toLowerCase()}:42:asset_42`;
    relayMessages = [
      [
        "EVENT",
        "sub",
        {
          id: "evt-1",
          kind: 1,
          content: "nice asset",
          created_at: 1000,
          tags: [
            ["asset", assetTag],
            ["sender", "0xaaa"],
          ],
        },
      ],
      ["EOSE", "sub"],
    ];

    const res = await request(app)
      .post("/api/v1/assets/snapshot-comments")
      .set("Authorization", "Session test-token")
      .send({
        tokenId: "42",
        chainId: 31337,
        contractAddress,
        assetId: "asset_42",
      });

    expect(res.status).toBe(200);
    expect(res.body.cid).toMatch(/^bafy/);
    expect(res.body.eventCount).toBe(1);

    // Verify the archive was stored in IPFS with correct content
    const archive = JSON.parse(ipfsStorage.get(res.body.cid));
    expect(archive.assetTag).toBe(assetTag);
    expect(archive.eventCount).toBe(1);
    expect(archive.events[0].id).toBe("evt-1");
  });

  test("archives zero events when relay has no matching comments", async () => {
    relayMessages = [["EOSE", "sub"]];

    const res = await request(app)
      .post("/api/v1/assets/snapshot-comments")
      .set("Authorization", "Session test-token")
      .send({
        tokenId: "99",
        chainId: 31337,
        assetId: "asset_99",
      });

    expect(res.status).toBe(200);
    expect(res.body.cid).toMatch(/^bafy/);
    expect(res.body.eventCount).toBe(0);

    const archive = JSON.parse(ipfsStorage.get(res.body.cid));
    expect(archive.events).toEqual([]);
  });

  test("returns 400 when tokenId is missing", async () => {
    const res = await request(app)
      .post("/api/v1/assets/snapshot-comments")
      .set("Authorization", "Session test-token")
      .send({ chainId: 31337, assetId: "asset_x" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error.details.issues)).toMatch(/tokenId/i);
  });

  test("returns 400 when assetId is missing", async () => {
    const res = await request(app)
      .post("/api/v1/assets/snapshot-comments")
      .set("Authorization", "Session test-token")
      .send({ tokenId: "99", chainId: 31337 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error.details.issues)).toMatch(/assetId/i);
  });

  test("returns empty archive when relay query fails", async () => {
    const { WebSocket } = await import("ws");
    WebSocket.mockImplementationOnce(function () {
      this.readyState = 0;
      setTimeout(() => {
        if (this.onerror) this.onerror(new Error("relay down"));
        this.readyState = 3;
        if (this.onclose) this.onclose({ message: "relay down" });
      }, 0);
    });

    const res = await request(app)
      .post("/api/v1/assets/snapshot-comments")
      .set("Authorization", "Session test-token")
      .send({
        tokenId: "99",
        chainId: 31337,
        assetId: "asset_99",
      });

    expect(res.status).toBe(200);
    expect(res.body.cid).toBeDefined();
    expect(res.body.eventCount).toBe(0);
  });
});
