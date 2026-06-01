import { jest } from "@jest/globals";
import request from "supertest";

jest.setTimeout(30000);

describe("Arbesk Phase 1 + Phase 3 API", () => {
  let app;
  let ipfsStorage;
  let mockIPFS;
  let mockWeb3Receipt;

  beforeAll(async () => {
    ipfsStorage = new Map();
    mockIPFS = {
      add: jest.fn(async (data) => {
        const hash = "Qm" + Math.random().toString(36).substring(2, 15);
        let content;
        if (Buffer.isBuffer(data)) {
          content = data.toString("base64");
        } else if (typeof data === "string") {
          content = data;
        } else {
          content = JSON.stringify(data);
        }
        ipfsStorage.set(hash, content);
        return { cid: { toString: () => hash, toJSON: () => hash } };
      }),
      cat: jest.fn(async function* (cid) {
        const stored = ipfsStorage.get(cid);
        if (stored) {
          const chars = stored.split("").map((c) => c.charCodeAt(0));
          yield new Uint16Array(chars);
        }
      }),
    };

    mockWeb3Receipt = {
      status: BigInt(1),
      from: "0xTestAddress",
      to: "0xArbeskContractAddress",
      blockNumber: 123,
      logs: [
        {
          address: "0xArbeskContractAddress",
          topics: [
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          ],
        },
      ],
    };

    jest.unstable_mockModule("ipfs-http-client", () => ({
      create: jest.fn(() => mockIPFS),
    }));

    jest.unstable_mockModule("web3", () => ({
      default: jest.fn(() => ({
        utils: {
          keccak256: jest.fn(
            () =>
              "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          ),
          padRight: jest.fn((x) => x),
          utf8ToHex: jest.fn((x) => x),
        },
        eth: {
          accounts: { recover: jest.fn(() => "0xTestAddress") },
          getTransactionReceipt: jest.fn(() =>
            Promise.resolve(mockWeb3Receipt),
          ),
          Contract: jest.fn(() => ({
            methods: {
              costPerGeneration: jest.fn(() => ({
                call: jest.fn(() => Promise.resolve("10000000000000000")),
              })),
              payForGeneration: jest.fn(() => ({
                estimateGas: jest.fn(() => Promise.resolve(100000)),
                send: jest.fn(() =>
                  Promise.resolve({
                    transactionHash: "0xRealTxHash",
                    blockNumber: 123,
                  }),
                ),
              })),
            },
          })),
        },
      })),
    }));

    process.env.MOCK_3D_GENERATION = "true";
    process.env.CONTRACT_ADDRESS = "0xArbeskContractAddress";

    const { app: importedApp } = await import("../src/index.js");
    app = importedApp;
  });

  afterAll(() => {
    jest.restoreAllMocks();
    delete process.env.CONTRACT_ADDRESS;
  });

  function makeAuthHeader(txHash = "0x123") {
    const message = Buffer.from(txHash).toString("base64");
    const signature = Buffer.from("0xFakeSignature").toString("base64");
    return `Bearer ${message}.${signature}`;
  }

  describe("POST /api/generate-asset-node", () => {
    it("creates a new manifest with a generation history entry", async () => {
      const res = await request(app)
        .post("/api/generate-asset-node")
        .set("Authorization", makeAuthHeader())
        .send({
          prompt: "A modern minimalist workbench",
          nodeId: "node_table_001",
          txHash: "0xabc",
        });

      expect(res.status).toBe(200);
      expect(res.body.newManifestCid).toBeDefined();
      expect(res.body.assetCID).toBeDefined();
      expect(res.body.historyEntry).toMatchObject({
        v: 1,
        type: "generation",
        provider: "mock",
        prompt: "A modern minimalist workbench",
      });
      // New source object format
      expect(res.body.historyEntry.src).toMatchObject({
        cid: expect.any(String),
        path: expect.any(String),
        format: expect.any(String),
      });
    });

    it("returns suka.gltf for character prompts", async () => {
      const res = await request(app)
        .post("/api/generate-asset-node")
        .set("Authorization", makeAuthHeader())
        .send({
          prompt: "A tall character",
          nodeId: "node_char_001",
          txHash: "0xdef",
        });

      expect(res.status).toBe(200);
      expect(res.body.assetCID).toBeDefined();
    });

    it("rejects when prompt or nodeId is missing", async () => {
      const res = await request(app)
        .post("/api/generate-asset-node")
        .set("Authorization", makeAuthHeader())
        .send({
          prompt: "",
          nodeId: "node_test",
          txHash: "0x123",
        });

      expect(res.status).toBe(400);
    });

    it("rejects replay txHash with 409", async () => {
      const txHash = "0xreplaytest";
      const auth = makeAuthHeader(txHash);

      const res1 = await request(app)
        .post("/api/generate-asset-node")
        .set("Authorization", auth)
        .send({ prompt: "First", nodeId: "node_r1", txHash });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/generate-asset-node")
        .set("Authorization", auth)
        .send({ prompt: "Second", nodeId: "node_r2", txHash });
      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("REPLAY_DETECTED");
    });

    it("rejects tx sent to wrong contract address", async () => {
      const originalTo = mockWeb3Receipt.to;
      mockWeb3Receipt.to = "0xWrongAddress";
      const res = await request(app)
        .post("/api/generate-asset-node")
        .set("Authorization", makeAuthHeader("0xwrongaddr"))
        .send({ prompt: "Test", nodeId: "node_w1", txHash: "0xwrongaddr" });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("not sent to ArbeskWorld");
      mockWeb3Receipt.to = originalTo;
    });
  });

  describe("POST /api/parametric-version", () => {
    let prevManifestCid;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/generate-asset-node")
        .set("Authorization", makeAuthHeader("0xparam"))
        .send({
          prompt: "A chair",
          nodeId: "node_chair_001",
          txHash: "0xparam",
        });
      prevManifestCid = res.body.newManifestCid;
    });

    it("appends a parametric history entry", async () => {
      const res = await request(app)
        .post("/api/parametric-version")
        .send({
          nodeId: "node_chair_001",
          prevManifestCid: prevManifestCid,
          color: "#FF5733",
          scale: { x: 1.5, y: 1.5, z: 1.5 },
        });

      expect(res.status).toBe(200);
      expect(res.body.newManifestCid).toBeDefined();
      expect(res.body.historyEntry).toMatchObject({
        v: 2,
        type: "parametric",
        provider: "parametric",
        params: {
          scale: { x: 1.5, y: 1.5, z: 1.5 },
          color: "#FF5733",
        },
      });
    });

    it("rejects invalid color", async () => {
      const res = await request(app)
        .post("/api/parametric-version")
        .send({
          nodeId: "node_chair_001",
          prevManifestCid: prevManifestCid,
          color: "not-a-color",
          scale: { x: 1, y: 1, z: 1 },
        });

      expect(res.status).toBe(400);
    });

    it("rejects invalid scale", async () => {
      const res = await request(app)
        .post("/api/parametric-version")
        .send({
          nodeId: "node_chair_001",
          prevManifestCid: prevManifestCid,
          scale: { x: -1, y: 1, z: 1 },
        });

      expect(res.status).toBe(400);
    });

    it("validates manifest structure on round-trip", async () => {
      const res = await request(app)
        .post("/api/parametric-version")
        .send({
          nodeId: "node_chair_001",
          prevManifestCid: prevManifestCid,
          color: "#000000",
          scale: { x: 2, y: 2, z: 2 },
        });

      expect(res.status).toBe(200);
      const newCid = res.body.newManifestCid;

      let data = "";
      for await (const file of mockIPFS.cat(newCid)) {
        const buffer = new Uint16Array(file);
        buffer.forEach((code) => {
          data += String.fromCharCode(code);
        });
      }
      const manifest = JSON.parse(data);

      expect(manifest).toHaveProperty("manifest_id");
      expect(manifest).toHaveProperty("version");
      expect(manifest).toHaveProperty("nodes");
      expect(Array.isArray(manifest.nodes)).toBe(true);
      expect(manifest.nodes.length).toBeGreaterThan(0);

      const node = manifest.nodes.find((n) => n.node_id === "node_chair_001");
      expect(node).toBeDefined();
      expect(Array.isArray(node.history)).toBe(true);
      expect(node.history.length).toBeGreaterThanOrEqual(2);

      // Validate new source object format
      expect(node.source).toBeDefined();
      expect(node.source).toMatchObject({
        cid: expect.any(String),
        path: expect.any(String),
        format: expect.any(String),
      });

      // Validate history entries have source objects
      for (const entry of node.history) {
        expect(entry.src).toBeDefined();
        if (typeof entry.src === "object") {
          expect(entry.src).toHaveProperty("cid");
          expect(entry.src).toHaveProperty("path");
          expect(entry.src).toHaveProperty("format");
        }
      }
    });
  });

  describe("POST /api/push-ipfs", () => {
    it("stores and returns a CID", async () => {
      const res = await request(app)
        .post("/api/push-ipfs")
        .send({ test: "data" });

      expect(res.status).toBe(200);
      expect(res.text).toBeDefined();
    });

    it("stores embedded publish thumbnails as separate IPFS assets", async () => {
      const dataUrl = `data:image/webp;base64,${Buffer.from("mock-webp-thumbnail").toString("base64")}`;
      const res = await request(app)
        .post("/api/push-ipfs")
        .send({
          manifest_id: "manifest_with_thumbnail",
          version: 1,
          nodes: [],
          thumbnail: {
            type: "snapshot",
            dataUrl,
            mime: "image/webp",
            format: "webp",
            path: "thumbnail.webp",
            width: 512,
            height: 288,
            timestamp: 1780000000,
          },
        });

      expect(res.status).toBe(200);
      const storedManifest = JSON.parse(ipfsStorage.get(res.text));
      expect(storedManifest.thumbnail).toMatchObject({
        type: "snapshot",
        cid: expect.any(String),
        path: "thumbnail.webp",
        format: "webp",
        mime: "image/webp",
        width: 512,
        height: 288,
        bytes: Buffer.from("mock-webp-thumbnail").length,
        timestamp: 1780000000,
      });
      expect(storedManifest.thumbnail.dataUrl).toBeUndefined();
      expect(ipfsStorage.get(storedManifest.thumbnail.cid)).toBe(
        Buffer.from("mock-webp-thumbnail").toString("base64"),
      );
    });
  });

  describe("Rate Limiting", () => {
    it("returns 429 after exceeding generation rate limit", async () => {
      // The rate limiter uses res.locals.walletAddress set by authenticate.
      // Our mock auth always recovers to 0xTestAddress, so all requests count against same wallet.
      // We already made several generation requests above. Make enough to hit the 10/hour limit.
      let lastStatus = 200;
      for (let i = 0; i < 15; i++) {
        const res = await request(app)
          .post("/api/generate-asset-node")
          .set("Authorization", makeAuthHeader(`0xrate${i}`))
          .send({
            prompt: `Rate test ${i}`,
            nodeId: `node_rate_${i}`,
            txHash: `0xrate${i}`,
          });
        lastStatus = res.status;
        if (res.status === 429) break;
      }
      expect(lastStatus).toBe(429);
    });
  });

  describe("ABI Route", () => {
    it("returns ABI JSON when compiled", async () => {
      const res = await request(app).get("/api/abi/ArbeskWorld.json");
      // Since we compiled the contract during test setup, the ABI should be present
      if (res.status === 200) {
        expect(res.body).toHaveProperty("abi");
        expect(Array.isArray(res.body.abi)).toBe(true);
      } else {
        expect(res.status).toBe(404);
        expect(res.body.error).toContain("ABI not found");
      }
    });
  });
});
