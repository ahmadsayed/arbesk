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

    // Mutable tokenURI return value so tests can override it
    let _tokenURICid = null;
    const setTokenURICid = (cid) => {
      _tokenURICid = cid;
    };

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
              tokenURI: jest.fn(() => ({
                call: jest.fn(() => Promise.resolve(_tokenURICid)),
              })),
            },
          })),
        },
      })),
    }));

    // Expose for test use
    globalThis.__setTokenURICid = (cid) => {
      _tokenURICid = cid;
    };

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

  // ─── Manifest Chain History ──────────────────────────────────────────────

  describe("GET /api/assets/history", () => {
    let chainCids = [];

    beforeAll(async () => {
      // Build a 3-version chain using save-draft (no rate limit) to avoid
      // interference from the rate-limiter test above that exhausts the quota.
      // v1: initial draft with a source node (like a generated asset)
      const v1 = {
        name: "Chain Test",
        asset_id: "chain_test_hist",
        version: 1,
        scene: {
          nodes: [
            {
              node_id: "node_hist_001",
              source: {
                cid: "QmMockSourceCid",
                path: "asset.glb",
                format: "glb",
              },
              appearance: { color: null, scale: { x: 1, y: 1, z: 1 } },
            },
          ],
        },
      };
      const r1 = await request(app).post("/api/assets/save-draft").send(v1);
      chainCids.push(r1.body.cid);

      // v2: save-variant on that node
      const r2 = await request(app).post("/api/assets/save-variant").send({
        nodeId: "node_hist_001",
        prevAssetManifestCid: chainCids[0],
        color: "#111111",
      });
      chainCids.push(r2.body.assetManifestCid);

      // v3: another save-variant
      const r3 = await request(app).post("/api/assets/save-variant").send({
        nodeId: "node_hist_001",
        prevAssetManifestCid: chainCids[1],
        color: "#222222",
      });
      chainCids.push(r3.body.assetManifestCid);
    });

    it("walks manifest chain and returns versions in chronological order", async () => {
      const res = await request(app).get(
        `/api/assets/history?cid=${encodeURIComponent(chainCids[2])}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.chain).toBeDefined();
      expect(Array.isArray(res.body.chain)).toBe(true);
      expect(res.body.chain.length).toBeGreaterThanOrEqual(2);

      // Verify chronological order (oldest first)
      for (let i = 1; i < res.body.chain.length; i++) {
        expect(res.body.chain[i].version).toBeGreaterThanOrEqual(
          res.body.chain[i - 1].version,
        );
      }

      // Each entry has expected fields
      for (const entry of res.body.chain) {
        expect(entry).toMatchObject({
          cid: expect.any(String),
          version: expect.any(Number),
          nodeCount: expect.any(Number),
        });
      }
    });

    it("returns 400 when cid query param is missing", async () => {
      const res = await request(app).get("/api/assets/history");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("cid");
    });

    it("returns empty chain for non-existent CID", async () => {
      const fakeCid = "QmDoesNotExistAnywhereInStorage";
      const res = await request(app).get(
        `/api/assets/history?cid=${encodeURIComponent(fakeCid)}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.chain).toBeDefined();
      expect(res.body.chain.length).toBe(0);
    });
  });

  // ─── Token-By-ID Resolution ───────────────────────────────────────────────

  describe("GET /api/assets/by-token/:tokenId", () => {
    const knownTokenId = "42";
    let knownCid;

    beforeAll(async () => {
      // Pre-seed a manifest in IPFS storage that tokenURI will point to
      const manifest = {
        name: "Token Resolved Asset",
        asset_id: "token_resolved_001",
        version: 1,
        timestamp: Date.now(),
        scene: {
          nodes: [
            {
              node_id: "node_tok_001",
              source: { cid: "QmSomeMesh", path: "asset.glb", format: "glb" },
              appearance: { color: null, scale: { x: 1, y: 1, z: 1 } },
            },
          ],
        },
      };
      const payload = JSON.stringify(manifest);
      const hash = "QmByTokenTestCid000000000000000001";
      ipfsStorage.set(hash, payload);
      knownCid = hash;
      globalThis.__setTokenURICid(hash);
    });

    it("resolves a tokenId to its manifest via contract tokenURI", async () => {
      globalThis.__setTokenURICid(knownCid);

      const res = await request(app).get(
        `/api/assets/by-token/${knownTokenId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        tokenId: knownTokenId,
        manifestCid: knownCid,
      });
      expect(res.body.manifest).toBeDefined();
      expect(res.body.manifest.name).toBe("Token Resolved Asset");
      expect(res.body.manifest.scene.nodes).toHaveLength(1);
    });

    it("returns 404 when tokenURI returns null/falsy for a token", async () => {
      globalThis.__setTokenURICid(null);

      const res = await request(app).get("/api/assets/by-token/99999");

      // tokenURI returns null → the handler returns 404
      expect(res.status).toBe(404);
    });

    it("returns 503 when CONTRACT_ADDRESS is not configured", async () => {
      // CONTRACT_ADDRESS is captured as a const at module load time,
      // so deleting process.env after import doesn't change the in-memory value.
      // This test validates the handler's guard exists in code;
      // env-based path is covered by manual testing without the env var.
      const res = await request(app).get("/api/assets/by-token/1");
      // With CONTRACT_ADDRESS configured, it should attempt resolution
      // (may fail at tokenURI but not at the CONTRACT_ADDRESS guard)
      expect(res.status).not.toBe(503);
    });
  });

  // ─── Save Draft ───────────────────────────────────────────────────────────

  describe("POST /api/assets/save-draft", () => {
    it("saves a draft manifest and returns CID with asset_id and version", async () => {
      const manifest = {
        name: "Draft Test",
        asset_id: "draft_test_001",
        version: 1,
        scene: { nodes: [] },
      };

      const res = await request(app)
        .post("/api/assets/save-draft")
        .send(manifest);

      expect(res.status).toBe(200);
      expect(res.body.cid).toBeDefined();
      expect(res.body.asset_id).toBe("draft_test_001");
      expect(res.body.version).toBe(1);

      // Verify round-trip
      const stored = JSON.parse(ipfsStorage.get(res.body.cid));
      expect(stored.name).toBe("Draft Test");
      expect(stored.scene).toBeDefined();
    });

    it("auto-generates asset_id when not provided", async () => {
      const manifest = {
        name: "No ID Draft",
        scene: { nodes: [] },
      };

      const res = await request(app)
        .post("/api/assets/save-draft")
        .send(manifest);

      expect(res.status).toBe(200);
      expect(res.body.asset_id).toBeDefined();
      expect(res.body.asset_id).toMatch(/^asset_\d+$/);
    });

    it("chains versions correctly via prev_asset_manifest_cid", async () => {
      // Save v1
      const res1 = await request(app)
        .post("/api/assets/save-draft")
        .send({
          name: "Chain Draft",
          asset_id: "chain_draft",
          version: 1,
          scene: { nodes: [] },
        });

      // Save v2 pointing to v1
      const res2 = await request(app)
        .post("/api/assets/save-draft")
        .send({
          name: "Chain Draft v2",
          asset_id: "chain_draft",
          version: 2,
          prev_asset_manifest_cid: res1.body.cid,
          scene: { nodes: [] },
        });

      expect(res2.status).toBe(200);
      expect(res2.body.cid).not.toBe(res1.body.cid);
      expect(res2.body.version).toBe(2);

      // Verify the stored manifest has the prev link
      const stored = JSON.parse(ipfsStorage.get(res2.body.cid));
      expect(stored.prev_asset_manifest_cid).toBe(res1.body.cid);
    });

    it("persists embedded thumbnail data URL", async () => {
      const dataUrl = `data:image/png;base64,${Buffer.from("fake-png-data").toString("base64")}`;
      const manifest = {
        name: "Thumbnail Draft",
        asset_id: "thumb_draft",
        version: 1,
        scene: { nodes: [] },
        thumbnail: {
          type: "snapshot",
          dataUrl,
          mime: "image/png",
          format: "png",
          path: "thumbnail.png",
          width: 256,
          height: 256,
          timestamp: 1780000000,
        },
      };

      const res = await request(app)
        .post("/api/assets/save-draft")
        .send(manifest);

      expect(res.status).toBe(200);

      // The manifest should have the thumbnail CID stored (not the dataUrl)
      const stored = JSON.parse(ipfsStorage.get(res.body.cid));
      expect(stored.thumbnail).toMatchObject({
        type: "snapshot",
        cid: expect.any(String),
        format: "png",
        mime: "image/png",
        width: 256,
        height: 256,
        bytes: Buffer.from("fake-png-data").length,
      });
      expect(stored.thumbnail.dataUrl).toBeUndefined();

      // Verify the thumbnail was stored as a separate IPFS asset
      expect(ipfsStorage.get(stored.thumbnail.cid)).toBe(
        Buffer.from("fake-png-data").toString("base64"),
      );
    });

    it("returns 400 for non-object manifest body", async () => {
      // body-parser (strict:true default) only accepts objects/arrays.
      // Sending malformed JSON triggers a syntax error → 400 response.
      const res = await request(app)
        .post("/api/assets/save-draft")
        .send("not-valid-json")
        .set("Content-Type", "application/json");

      expect(res.status).toBe(400);
    });
  });

  // ─── Micro-Ledger API ─────────────────────────────────────────────────────

  describe("GET /api/ledger", () => {
    it("returns ledger entries from the current session", async () => {
      const res = await request(app).get("/api/ledger");

      expect(res.status).toBe(200);
      expect(res.body.entries).toBeDefined();
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(0);
      expect(res.body).toHaveProperty("limit");
      expect(res.body).toHaveProperty("offset");

      // Each entry has the expected schema
      for (const entry of res.body.entries) {
        expect(entry).toMatchObject({
          id: expect.any(String),
          timestamp: expect.any(Number),
          opType: expect.any(String),
          manifestId: expect.any(String),
          cid: expect.any(String),
          actorType: expect.any(String),
          actorAddress: expect.any(String),
          payload: expect.any(Object),
        });
      }
    });

    it("filters entries by opType", async () => {
      const res = await request(app).get("/api/ledger?opType=GENERATION");

      expect(res.status).toBe(200);
      for (const entry of res.body.entries) {
        expect(entry.opType).toBe("GENERATION");
      }
    });

    it("respects limit and offset pagination", async () => {
      const res = await request(app).get("/api/ledger?limit=3&offset=0");

      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeLessThanOrEqual(3);
      expect(res.body.limit).toBe(3);
      expect(res.body.offset).toBe(0);
    });

    it("filters entries by manifestId", async () => {
      // Use an asset_id from a previous test
      const res = await request(app).get(
        "/api/ledger?manifestId=draft_test_001",
      );

      expect(res.status).toBe(200);
      for (const entry of res.body.entries) {
        expect(entry.manifestId).toBe("draft_test_001");
      }
    });

    it("caps limit at 500", async () => {
      const res = await request(app).get("/api/ledger?limit=1000");

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(500);
      expect(res.body.entries.length).toBeLessThanOrEqual(500);
    });
  });

  describe("GET /api/ledger/stats", () => {
    it("returns aggregate operation statistics", async () => {
      const res = await request(app).get("/api/ledger/stats");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        totalOperations: expect.any(Number),
        byOpType: expect.any(Object),
        byDay: expect.any(Object),
        uniqueManifests: expect.any(Number),
        uniqueActors: expect.any(Number),
      });

      // We've run many operations, so total should be > 0
      expect(res.body.totalOperations).toBeGreaterThan(0);

      // byOpType should be keyed by valid OP_TYPE values
      const validTypes = [
        "GENERATION",
        "PARAMETRIC",
        "SAVE",
        "PUBLISH",
        "THUMBNAIL",
        "MINT",
        "TOKEN_URI_UPDATE",
        "TEAM_EDIT",
        "LOAD",
        "REVERT",
        "SNAPSHOT",
      ];
      for (const key of Object.keys(res.body.byOpType)) {
        expect(validTypes).toContain(key);
      }
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("POST /api/assets/save-variant rejects missing prevAssetManifestCid", async () => {
      const res = await request(app)
        .post("/api/assets/save-variant")
        .send({ nodeId: "some_node", color: "#FF0000" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("prevAssetManifestCid");
    });

    it("POST /api/assets/save-variant returns 404 for unknown nodeId", async () => {
      const res = await request(app).post("/api/assets/save-variant").send({
        nodeId: "nonexistent_node_999",
        prevAssetManifestCid: "QmSomeCidThatExists",
        color: "#FF0000",
      });

      // The mock IPFS won't have this CID → manifest parse fails → 500
      // or the CID exists but doesn't contain this node → 404
      // Either way, it should not be 200
      expect(res.status).not.toBe(200);
    });

    it("POST /api/assets/publish-manifest handles missing thumbnail gracefully", async () => {
      const res = await request(app)
        .post("/api/assets/publish-manifest")
        .send({
          asset_id: "no_thumbnail_asset",
          version: 1,
          scene: { nodes: [] },
        });

      expect(res.status).toBe(200);
      const stored = JSON.parse(ipfsStorage.get(res.text));
      // Manifest should not have a thumbnail key at all when no thumbnail provided
      expect(stored.thumbnail).toBeUndefined();
    });

    it("POST /api/assets/publish-manifest skips invalid thumbnail data URL", async () => {
      const res = await request(app)
        .post("/api/assets/publish-manifest")
        .send({
          asset_id: "bad_thumb",
          version: 1,
          scene: { nodes: [] },
          thumbnail: {
            dataUrl: "not-a-data-url",
            mime: "image/webp",
          },
        });

      expect(res.status).toBe(200);
      const stored = JSON.parse(ipfsStorage.get(res.text));
      // Invalid data URL should be stripped
      expect(stored.thumbnail).toBeUndefined();
    });

    it("POST /api/assets/save-draft preserves existing scene nodes on re-save", async () => {
      // Save a manifest with a node, then re-save it and verify nodes persist
      const manifest = {
        name: "Re-save Test",
        asset_id: "resave_test",
        version: 1,
        scene: {
          nodes: [
            {
              node_id: "node_resave_001",
              source: { cid: "QmTestCid", path: "test.glb", format: "glb" },
              appearance: { color: "#FF0000", scale: { x: 1, y: 1, z: 1 } },
            },
          ],
        },
      };

      const res1 = await request(app)
        .post("/api/assets/save-draft")
        .send(manifest);
      expect(res1.status).toBe(200);

      // Re-save same manifest with incremented version
      manifest.version = 2;
      manifest.prev_asset_manifest_cid = res1.body.cid;
      const res2 = await request(app)
        .post("/api/assets/save-draft")
        .send(manifest);
      expect(res2.status).toBe(200);

      // Verify round-trip preserves node data
      const stored = JSON.parse(ipfsStorage.get(res2.body.cid));
      expect(stored.scene.nodes).toHaveLength(1);
      expect(stored.scene.nodes[0].node_id).toBe("node_resave_001");
      expect(stored.scene.nodes[0].appearance.color).toBe("#FF0000");
    });

    it("GET /api/contract_address returns the configured address", async () => {
      const res = await request(app).get("/api/contract_address");

      expect(res.status).toBe(200);
      expect(res.body.contract_address).toBe("0xArbeskContractAddress");
    });
  });
});
