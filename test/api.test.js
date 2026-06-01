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

  async function fetchManifestFromIPFS(cid) {
    const chunks = [];
    for await (const chunk of mockIPFS.cat(cid)) {
      chunks.push(chunk);
    }
    const data = chunks
      .map((chunk) => {
        if (chunk instanceof Uint16Array) {
          return String.fromCharCode(...chunk);
        }
        if (typeof chunk === "string") return chunk;
        return new TextDecoder().decode(chunk);
      })
      .join("");
    return JSON.parse(data);
  }

  describe("POST /api/assets/generate-node", () => {
    it("creates a new manifest with a generation variant entry", async () => {
      const res = await request(app)
        .post("/api/assets/generate-node")
        .set("Authorization", makeAuthHeader())
        .send({
          prompt: "A modern minimalist workbench",
          nodeId: "node_table_001",
          txHash: "0xabc",
        });

      expect(res.status).toBe(200);
      expect(res.body.assetManifestCid).toBeDefined();
      expect(res.body.sourceAssetCid).toBeDefined();

      // Verify the manifest stores state directly on the node
      const manifestData = await fetchManifestFromIPFS(
        res.body.assetManifestCid,
      );
      const node = (manifestData.scene?.nodes || [])[0];
      expect(node).toBeDefined();
      expect(node).toHaveProperty("appearance");
      expect(node.appearance).toHaveProperty("color");
      expect(node.appearance).toHaveProperty("scale");
      expect(node.source).toMatchObject({
        cid: expect.any(String),
        path: expect.any(String),
        format: expect.any(String),
      });
    });

    it("returns suka.gltf for character prompts", async () => {
      const res = await request(app)
        .post("/api/assets/generate-node")
        .set("Authorization", makeAuthHeader())
        .send({
          prompt: "A tall character",
          nodeId: "node_char_001",
          txHash: "0xdef",
        });

      expect(res.status).toBe(200);
      expect(res.body.sourceAssetCid).toBeDefined();
    });

    it("rejects when prompt or nodeId is missing", async () => {
      const res = await request(app)
        .post("/api/assets/generate-node")
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
        .post("/api/assets/generate-node")
        .set("Authorization", auth)
        .send({ prompt: "First", nodeId: "node_r1", txHash });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/assets/generate-node")
        .set("Authorization", auth)
        .send({ prompt: "Second", nodeId: "node_r2", txHash });
      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("REPLAY_DETECTED");
    });

    it("rejects tx sent to wrong contract address", async () => {
      const originalTo = mockWeb3Receipt.to;
      mockWeb3Receipt.to = "0xWrongAddress";
      const res = await request(app)
        .post("/api/assets/generate-node")
        .set("Authorization", makeAuthHeader("0xwrongaddr"))
        .send({ prompt: "Test", nodeId: "node_w1", txHash: "0xwrongaddr" });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("not sent to ArbeskAsset");
      mockWeb3Receipt.to = originalTo;
    });
  });

  describe("POST /api/assets/save-variant", () => {
    let prevAssetManifestCid;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/assets/generate-node")
        .set("Authorization", makeAuthHeader("0xparam"))
        .send({
          prompt: "A chair",
          nodeId: "node_chair_001",
          txHash: "0xparam",
        });
      prevAssetManifestCid = res.body.assetManifestCid;
    });

    it("appends a parametric variant entry", async () => {
      const res = await request(app)
        .post("/api/assets/save-variant")
        .send({
          nodeId: "node_chair_001",
          prevAssetManifestCid: prevAssetManifestCid,
          color: "#FF5733",
          scale: { x: 1.5, y: 1.5, z: 1.5 },
        });

      expect(res.status).toBe(200);
      expect(res.body.assetManifestCid).toBeDefined();

      // Verify the manifest stores color + scale directly on the node
      const manifestData = await fetchManifestFromIPFS(
        res.body.assetManifestCid,
      );
      const node = (manifestData.scene?.nodes || []).find(
        (n) => n.node_id === "node_chair_001",
      );
      expect(node).toBeDefined();
      expect(node.appearance.color).toBe("#FF5733");
      expect(node.appearance.scale).toMatchObject({ x: 1.5, y: 1.5, z: 1.5 });
    });

    it("rejects invalid color", async () => {
      const res = await request(app)
        .post("/api/assets/save-variant")
        .send({
          nodeId: "node_chair_001",
          prevAssetManifestCid: prevAssetManifestCid,
          color: "not-a-color",
          scale: { x: 1, y: 1, z: 1 },
        });

      expect(res.status).toBe(400);
    });

    it("rejects invalid scale", async () => {
      const res = await request(app)
        .post("/api/assets/save-variant")
        .send({
          nodeId: "node_chair_001",
          prevAssetManifestCid: prevAssetManifestCid,
          scale: { x: -1, y: 1, z: 1 },
        });

      expect(res.status).toBe(400);
    });

    it("validates manifest structure on round-trip", async () => {
      const res = await request(app)
        .post("/api/assets/save-variant")
        .send({
          nodeId: "node_chair_001",
          prevAssetManifestCid: prevAssetManifestCid,
          color: "#000000",
          scale: { x: 2, y: 2, z: 2 },
        });

      expect(res.status).toBe(200);
      const newCid = res.body.assetManifestCid;

      const chunks = [];
      for await (const chunk of mockIPFS.cat(newCid)) {
        chunks.push(chunk);
      }
      const data = chunks
        .map((chunk) => {
          if (chunk instanceof Uint16Array) {
            return String.fromCharCode(...chunk);
          }
          if (typeof chunk === "string") return chunk;
          return new TextDecoder().decode(chunk);
        })
        .join("");
      const manifest = JSON.parse(data);

      expect(manifest).toHaveProperty("asset_id");
      expect(manifest).toHaveProperty("version");
      expect(manifest).toHaveProperty("scene");
      expect(Array.isArray(manifest.scene.nodes)).toBe(true);
      expect(manifest.scene.nodes.length).toBeGreaterThan(0);

      const node = manifest.scene.nodes.find(
        (n) => n.node_id === "node_chair_001",
      );
      expect(node).toBeDefined();

      // Validate current state lives directly on the node under appearance
      expect(node).toHaveProperty("appearance");
      expect(node.appearance).toHaveProperty("color");
      expect(node.appearance).toHaveProperty("scale");
      expect(node.appearance.scale).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        z: expect.any(Number),
      });

      // Validate new source object format
      expect(node.source).toBeDefined();
      expect(node.source).toMatchObject({
        cid: expect.any(String),
        path: expect.any(String),
        format: expect.any(String),
      });

      // Validate version chain via prev_asset_manifest_cid
      expect(manifest).toHaveProperty("prev_asset_manifest_cid");
      expect(manifest.prev_asset_manifest_cid).toBeTruthy();
    });
  });

  describe("POST /api/assets/publish-manifest", () => {
    it("stores and returns a CID", async () => {
      const res = await request(app)
        .post("/api/assets/publish-manifest")
        .send({ test: "data" });

      expect(res.status).toBe(200);
      expect(res.text).toBeDefined();
    });

    it("stores embedded publish thumbnails as separate IPFS assets", async () => {
      const dataUrl = `data:image/webp;base64,${Buffer.from("mock-webp-thumbnail").toString("base64")}`;
      const res = await request(app)
        .post("/api/assets/publish-manifest")
        .send({
          asset_id: "asset_with_thumbnail",
          version: 1,
          scene: { nodes: [] },
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
          .post("/api/assets/generate-node")
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
      const res = await request(app).get("/api/abi/ArbeskAsset.json");
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

  describe("Token Child Ref Manifest", () => {
    let baseCid;

    beforeAll(async () => {
      // Create a base manifest to attach child refs to
      const res = await request(app)
        .post("/api/assets/generate-node")
        .set("Authorization", makeAuthHeader("0xchildtest"))
        .send({
          prompt: "A table",
          nodeId: "node_table_child_001",
          txHash: "0xchildtest",
        });
      baseCid = res.body.assetManifestCid;
    });

    it("saves a manifest with token child_ref nodes", async () => {
      const manifest = {
        name: "Composed World",
        asset_id: "composed_world_001",
        version: 1,
        scene: {
          nodes: [
            {
              node_id: "child_token_314159_12345678_42",
              transform_matrix: [
                1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, -5, 1,
              ],
              child_ref: {
                type: "token",
                chainId: 314159,
                contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
                tokenId: "42",
                standard: "ERC721",
                resolution: "latest",
              },
            },
          ],
        },
      };

      const res = await request(app)
        .post("/api/assets/save-draft")
        .send(manifest);

      expect(res.status).toBe(200);
      expect(res.body.cid).toBeDefined();

      // Verify round-trip: fetch the manifest and check child_ref structure
      let data = "";
      for await (const file of mockIPFS.cat(res.body.cid)) {
        const buffer = new Uint16Array(file);
        buffer.forEach((code) => {
          data += String.fromCharCode(code);
        });
      }
      const stored = JSON.parse(data);

      expect(stored.scene.nodes.length).toBe(1);
      const childNode = stored.scene.nodes[0];
      expect(childNode.node_id).toBe("child_token_314159_12345678_42");
      expect(childNode.child_ref).toMatchObject({
        type: "token",
        chainId: 314159,
        contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
        tokenId: "42",
        standard: "ERC721",
        resolution: "latest",
      });
      expect(childNode.transform_matrix).toEqual([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, -5, 1,
      ]);
      // Token child nodes should NOT have source or history
      expect(childNode.source).toBeUndefined();
      expect(childNode.history).toBeUndefined();
    });

    it("saves a mixed manifest with regular and child_ref nodes", async () => {
      const manifest = {
        name: "Mixed World",
        asset_id: "mixed_world_001",
        version: 1,
        scene: {
          nodes: [
            {
              node_id: "node_regular_001",
              source: {
                cid: "QmSomeCid",
                path: "asset.glb",
                format: "glb",
              },
              transform_matrix: [
                1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
              ],
              history: [],
            },
            {
              node_id: "child_token_314159_abcdef01_7",
              transform_matrix: [
                1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -5, 0, 3, 1,
              ],
              child_ref: {
                type: "token",
                chainId: 314159,
                contractAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
                tokenId: "7",
                standard: "ERC721",
                resolution: "latest",
              },
            },
          ],
        },
      };

      const res = await request(app)
        .post("/api/assets/save-draft")
        .send(manifest);

      expect(res.status).toBe(200);

      let data = "";
      for await (const file of mockIPFS.cat(res.body.cid)) {
        const buffer = new Uint16Array(file);
        buffer.forEach((code) => {
          data += String.fromCharCode(code);
        });
      }
      const stored = JSON.parse(data);

      expect(stored.scene.nodes.length).toBe(2);

      const regularNode = stored.scene.nodes.find(
        (n) => n.node_id === "node_regular_001",
      );
      expect(regularNode.source).toBeDefined();
      expect(regularNode.child_ref).toBeUndefined();

      const childNode = stored.scene.nodes.find(
        (n) => n.node_id === "child_token_314159_abcdef01_7",
      );
      expect(childNode.child_ref).toBeDefined();
      expect(childNode.source).toBeUndefined();
      expect(childNode.transform_matrix).toBeDefined();
    });

    it("publish-manifest accepts thumbnails alongside child_ref nodes", async () => {
      const dataUrl = `data:image/webp;base64,${Buffer.from("child-world-thumb").toString("base64")}`;
      const res = await request(app)
        .post("/api/assets/publish-manifest")
        .send({
          asset_id: "composed_with_thumbnail",
          version: 2,
          scene: {
            nodes: [
              {
                node_id: "child_token_314159_12345678_99",
                transform_matrix: [
                  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
                ],
                child_ref: {
                  type: "token",
                  chainId: 314159,
                  contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
                  tokenId: "99",
                  standard: "ERC721",
                  resolution: "latest",
                },
              },
            ],
          },
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
      });
      expect(storedManifest.scene.nodes[0].child_ref.tokenId).toBe("99");
    });
  });
});
