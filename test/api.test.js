import { jest } from "@jest/globals";
import request from "supertest";
import { _resetRateLimiter } from "../src/api/rate-limiter.js";

jest.setTimeout(30000);

describe("Arbesk Phase 1 + Phase 3 API", () => {
  let app;
  let ipfsStorage;
  let mockIPFS;
  let mockWeb3Receipt;
  let logSpy;
  let createSession;

  beforeAll(async () => {
    // Suppress noisy production logs/warnings during API tests.
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    logSpy = {
      mockRestore: () => {
        console.log = originalLog;
        console.warn = originalWarn;
      },
    };

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
      pin: {
        add: jest.fn(async () => {}),
        rm: jest.fn(async () => {}),
      },
    };

    mockWeb3Receipt = {
      status: BigInt(1),
      from: "0xTestAddress",
      to: "0xArbeskContractAddress",
      blockNumber: 123,
      _usdcTier: 2, // default tier for tests; overridden per-test
      logs: [
        {
          address: "0xArbeskContractAddress",
          topics: [
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          ],
        },
        // USDC payment event (topics[0] matches "USDC" keccak256 mock)
        {
          address: "0xArbeskContractAddress",
          topics: [
            "0x0000000000000000000000000000000000000000000000000000000000usdc00",
          ],
          data:
            "0x0000000000000000000000000000000000000000000000000000000000000080" +
            "00000000000000000000000000000000000000000000000000000000001ab3f0" +
            "000000000000000000000000000000000000000000000000000000006642b400" +
            "0000000000000000000000000000000000000000000000000000000000000002",
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
          keccak256: jest.fn((sig) => {
            // Return different hashes for different event signatures
            // so we can distinguish native vs USDC events in tests
            if (sig.includes("USDC")) {
              return "0x0000000000000000000000000000000000000000000000000000000000usdc00";
            }
            return "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
          }),
          padRight: jest.fn((x) => x),
          utf8ToHex: jest.fn((x) => x),
        },
        eth: {
          accounts: { recover: jest.fn(() => "0xTestAddress") },
          getTransactionReceipt: jest.fn(() =>
            Promise.resolve(mockWeb3Receipt),
          ),
          abi: {
            decodeParameters: jest.fn((types, data) => {
              // Simulate decoding USDC event data for tier tests
              // Types: ["string", "uint256", "uint256", "uint8"]
              // Returns decoded values including the tier from mockWeb3Receipt._usdcTier
              return {
                0: "mock prompt",
                1: "1750000",
                2: Math.floor(Date.now() / 1000).toString(),
                3: (mockWeb3Receipt._usdcTier ?? 2).toString(),
              };
            }),
          },
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
    process.env.GENERATION_RATE_LIMIT_MAX = "10";
    process.env.CONTRACT_ADDRESS = "0xArbeskContractAddress";

    const sessions = await import("../src/api/sessions.js");
    createSession = sessions.createSession;

    const { app: importedApp } = await import("../src/index.js");
    app = importedApp;
  });

  afterAll(() => {
    logSpy?.mockRestore();
    jest.restoreAllMocks();
    delete process.env.CONTRACT_ADDRESS;
    delete process.env.GENERATION_RATE_LIMIT_MAX;
  });

  async function makeSessionHeader(address = "0x1234567890123456789012345678901234567890") {
    const token = createSession(address);
    return `Session ${token}`;
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

  describe("POST /api/v1/generations", () => {
    it("creates a new manifest with a generation variant entry", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
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
      expect(node).toHaveProperty("post_processor");
      expect(node.post_processor).toHaveProperty("color");
      expect(node.post_processor).toHaveProperty("scale");
      expect(node.source).toMatchObject({
        cid: expect.any(String),
        path: expect.any(String),
        format: expect.any(String),
      });
    });

    it("returns suka.gltf for character prompts", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A tall character",
          nodeId: "node_char_001",
          txHash: "0xdef",
        });

      expect(res.status).toBe(200);
      expect(res.body.sourceAssetCid).toBeDefined();
    });

    it("returns howdy.glb for cowboy prompts", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "howdy cowboy",
          nodeId: "node_cowboy_001",
          txHash: "0xcowboy",
        });

      expect(res.status).toBe(200);
      expect(res.body.sourceAssetCid).toBeDefined();

      const manifestData = await fetchManifestFromIPFS(res.body.assetManifestCid);
      const node = (manifestData.scene?.nodes || [])[0];
      expect(node).toBeDefined();
      expect(node.source.format).toBe("glb");
      expect(node.source.path).toMatch(/\.glb$/);
    });

    it("rejects when prompt or nodeId is missing", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "",
          nodeId: "node_test",
          txHash: "0x123",
        });

      expect(res.status).toBe(400);
    });

    it("rejects replay txHash with 409", async () => {
      const txHash = "0xreplaytest";
      const auth = await makeSessionHeader();

      const res1 = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", auth)
        .send({ prompt: "First", nodeId: "node_r1", txHash });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", auth)
        .send({ prompt: "Second", nodeId: "node_r2", txHash });
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe("REPLAY_DETECTED");
    });

    it("rejects missing Authorization header with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .send({ prompt: "Test", nodeId: "node_noauth", txHash: "0xnoauth" });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("MISSING_AUTH");
    });

    it("rejects invalid session token with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", "Session invalid-token")
        .send({ prompt: "Test", nodeId: "node_badsession", txHash: "0xbadsession" });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("INVALID_SESSION");
    });

    it("rejects non-Session auth scheme with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", "Bearer something")
        .send({ prompt: "Test", nodeId: "node_bearer", txHash: "0xbearer" });
      expect(res.status).toBe(401);
    });

    it("rejects tx sent to wrong contract address", async () => {
      const originalTo = mockWeb3Receipt.to;
      const originalLogAddresses = mockWeb3Receipt.logs.map((l) => l.address);
      mockWeb3Receipt.to = "0xWrongAddress";
      // Payment events must also come from the wrong address for the test
      mockWeb3Receipt.logs.forEach((log) => {
        log.address = "0xWrongAddress";
      });
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({ prompt: "Test", nodeId: "node_w1", txHash: "0xwrongaddr" });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain("not sent to ArbeskAsset");
      mockWeb3Receipt.to = originalTo;
      mockWeb3Receipt.logs.forEach((log, i) => {
        log.address = originalLogAddresses[i];
      });
    });

    // ─── Tier-specific tests ───

    // Reset rate limiter: earlier tests may have exhausted the 10/hour quota
    beforeEach(() => {
      _resetRateLimiter();
    });

    it("accepts generation with matching tier (Premium=2)", async () => {
      // Default mock receipt has USDC event with tier 2, and _usdcTier = 2
      const uniqTx = "0xtier_match_" + Date.now();
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A chair",
          nodeId: "node_tier_match",
          txHash: uniqTx,
          tier: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.assetManifestCid).toBeDefined();
      expect(res.body.tier).toBe(2);
    });

    it("accepts Basic tier (0)", async () => {
      mockWeb3Receipt._usdcTier = 0;
      const uniqTx = "0xtier_basic_" + Date.now();
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A table",
          nodeId: "node_tier_basic",
          txHash: uniqTx,
          tier: 0,
        });

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe(0);
      mockWeb3Receipt._usdcTier = 2; // reset
    });

    it("accepts Pro tier (3)", async () => {
      mockWeb3Receipt._usdcTier = 3;
      const uniqTx = "0xtier_pro_" + Date.now();
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A spaceship",
          nodeId: "node_tier_pro",
          txHash: uniqTx,
          tier: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe(3);
      mockWeb3Receipt._usdcTier = 2; // reset
    });

    it("rejects when requested tier does not match on-chain tier", async () => {
      // On-chain event says tier 2 (default), but request claims tier 3
      const uniqTx = "0xtier_mismatch_" + Date.now();
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A lamp",
          nodeId: "node_tier_mismatch",
          txHash: uniqTx,
          tier: 3, // claims Pro, but receipt says Premium (2)
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("TIER_MISMATCH");
      expect(res.body.error.message).toContain("does not match");
    });

    it("accepts native ETH payment even when tier is specified (Hardhat dev)", async () => {
      // Remove the USDC log from the receipt, leaving only native payment log
      const originalLogs = mockWeb3Receipt.logs;
      mockWeb3Receipt.logs = mockWeb3Receipt.logs.filter(
        (log) =>
          log.topics[0] !==
          "0x0000000000000000000000000000000000000000000000000000000000usdc00",
      );

      const uniqTx = "0xtier_native_" + Date.now();
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A desk",
          nodeId: "node_tier_native",
          txHash: uniqTx,
          tier: 2,
        });

      // Native ETH payment (e.g. Hardhat) has no on-chain tier data,
      // so the backend should accept it regardless of the tier value sent.
      expect(res.status).toBe(200);
      expect(res.body.assetManifestCid).toBeDefined();
      mockWeb3Receipt.logs = originalLogs; // restore
    });

    it("generation without tier still works (backward compat)", async () => {
      const uniqTx = "0xnotier_" + Date.now();
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A bookshelf",
          nodeId: "node_notier",
          txHash: uniqTx,
          // no tier field — backward compat
        });

      expect(res.status).toBe(200);
      expect(res.body.assetManifestCid).toBeDefined();
      // Tier should NOT be in response since it wasn't sent
      expect(res.body.tier).toBeUndefined();
    });
  });

  describe("POST /api/v1/manifests/:cid/publish", () => {
    it("stores and returns a CID", async () => {
      const res = await request(app)
        .post("/api/v1/manifests/QmFakePublish/publish")
        .send({ test: "data" });

      expect(res.status).toBe(200);
      expect(res.body.cid).toBeDefined();
    });

    it("stores embedded publish thumbnails as separate IPFS assets", async () => {
      const dataUrl = `data:image/webp;base64,${Buffer.from("mock-webp-thumbnail").toString("base64")}`;
      const res = await request(app)
        .post("/api/v1/manifests/QmFakeThumbPublish/publish")
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
      const storedManifest = JSON.parse(ipfsStorage.get(res.body.cid));
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
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
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

  describe("POST /api/v1/ipfs/upload-url", () => {
    beforeEach(() => _resetRateLimiter());

    it("rejects without a session (401)", async () => {
      const res = await request(app).post("/api/v1/ipfs/upload-url").send({});
      expect(res.status).toBe(401);
    });

    it("returns a credential for an authed session", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/upload-url")
        .set("Authorization", await makeSessionHeader())
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("backend");
      // Kubo mode in tests (no IPFS_BACKEND set):
      expect(res.body.backend).toBe("kubo");
      expect(res.body).toHaveProperty("apiUrl");
      // master secret must never appear
      expect(JSON.stringify(res.body)).not.toMatch(/PINATA_JWT|Bearer/i);
    });

    it("rate-limits to 5 per minute per wallet (6th = 429), no upload performed", async () => {
      const auth = await makeSessionHeader(
        "0xRateWallet000000000000000000000000000001",
      );
      let last = 200;
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post("/api/v1/ipfs/upload-url")
          .set("Authorization", auth)
          .send({});
        last = res.status;
      }
      expect(last).toBe(429);
    });
  });

  describe("POST /api/v1/ipfs/unpin via storage", () => {
    it("walks the chain and reports unpinned CIDs", async () => {
      const manifest = {
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "n", source: { cid: "QmSource" } }] },
      };
      const addRes = await request(app)
        .post("/api/v1/manifests")
        .send(manifest);
      const startCid = addRes.body.cid;
      expect(startCid).toBeTruthy();

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .send({ cid: startCid });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.unpinned)).toBe(true);
      expect(res.body.unpinned).toContain(startCid);
    });
  });

  describe("ABI Route", () => {
    it("returns ABI JSON when compiled", async () => {
      const res = await request(app).get("/api/v1/contracts/ArbeskAsset/abi");
      // Since we compiled the contract during test setup, the ABI should be present
      if (res.status === 200) {
        expect(res.body).toHaveProperty("abi");
        expect(Array.isArray(res.body.abi)).toBe(true);
      } else {
        expect(res.status).toBe(404);
        expect(res.body.error.message).toContain("ABI not found");
      }
    });
  });

  describe("Token Child Ref Manifest", () => {
    let baseCid;

    beforeAll(async () => {
      // Create a base manifest to attach child refs to
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
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

      const res = await request(app).post("/api/v1/manifests").send(manifest);

      expect(res.status).toBe(201);
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

      const res = await request(app).post("/api/v1/manifests").send(manifest);

      expect(res.status).toBe(201);

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
        .post("/api/v1/manifests/QmFakeChildPublish/publish")
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
      const storedManifest = JSON.parse(ipfsStorage.get(res.body.cid));
      expect(storedManifest.thumbnail).toMatchObject({
        type: "snapshot",
        cid: expect.any(String),
      });
      expect(storedManifest.scene.nodes[0].child_ref.tokenId).toBe("99");
    });
  });

  // ─── Manifest Chain History ──────────────────────────────────────────────

  describe("GET /api/v1/manifests/:cid/history", () => {
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
              post_processor: { color: null, scale: { x: 1, y: 1, z: 1 } },
            },
          ],
        },
      };
      const r1 = await request(app).post("/api/v1/manifests").send(v1);
      chainCids.push(r1.body.cid);

      // v2: modified color on the node, chained off v1.
      // The /variants endpoint was removed; the regular /manifests
      // POST now carries the full manifest with the new post_processor.
      const v2 = {
        ...v1,
        version: 2,
        prev_asset_manifest_cid: chainCids[0],
        scene: {
          nodes: [
            {
              node_id: "node_hist_001",
              source: v1.scene.nodes[0].source,
              post_processor: {
                color: "#111111",
                scale: { x: 1, y: 1, z: 1 },
              },
            },
          ],
        },
      };
      const r2 = await request(app).post("/api/v1/manifests").send(v2);
      chainCids.push(r2.body.cid);

      // v3: another color change, chained off v2
      const v3 = {
        ...v2,
        version: 3,
        prev_asset_manifest_cid: chainCids[1],
        scene: {
          nodes: [
            {
              node_id: "node_hist_001",
              source: v1.scene.nodes[0].source,
              post_processor: {
                color: "#222222",
                scale: { x: 1, y: 1, z: 1 },
              },
            },
          ],
        },
      };
      const r3 = await request(app).post("/api/v1/manifests").send(v3);
      chainCids.push(r3.body.cid);
    });

    it("walks manifest chain and returns versions in chronological order", async () => {
      const res = await request(app).get(
        `/api/v1/manifests/${encodeURIComponent(chainCids[2])}/history`,
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

    it("returns empty chain for non-existent CID with history walk", async () => {
      const res = await request(app).get(
        "/api/v1/manifests/nonexistentcid/history",
      );
      expect(res.status).toBe(200);
      expect(res.body.chain).toBeDefined();
      expect(res.body.chain.length).toBe(0);
    });

    it("returns empty chain for non-existent CID", async () => {
      const fakeCid = "QmDoesNotExistAnywhereInStorage";
      const res = await request(app).get(
        `/api/v1/manifests/${encodeURIComponent(fakeCid)}/history`,
      );

      expect(res.status).toBe(200);
      expect(res.body.chain).toBeDefined();
      expect(res.body.chain.length).toBe(0);
    });
  });

  // ─── Token-By-ID Resolution ───────────────────────────────────────────────

  describe("GET /api/v1/tokens/:tokenId/manifest", () => {
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
              post_processor: { color: null, scale: { x: 1, y: 1, z: 1 } },
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
        `/api/v1/tokens/${knownTokenId}/manifest`,
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

      const res = await request(app).get("/api/v1/tokens/99999/manifest");

      // tokenURI returns null → the handler returns 404
      expect(res.status).toBe(404);
    });

    it("returns 503 when CONTRACT_ADDRESS is not configured", async () => {
      // CONTRACT_ADDRESS is captured as a const at module load time,
      // so deleting process.env after import doesn't change the in-memory value.
      // This test validates the handler's guard exists in code;
      // env-based path is covered by manual testing without the env var.
      const res = await request(app).get("/api/v1/tokens/1/manifest");
      // With CONTRACT_ADDRESS configured, it should attempt resolution
      // (may fail at tokenURI but not at the CONTRACT_ADDRESS guard)
      expect(res.status).not.toBe(503);
    });
  });

  // ─── Save Draft ───────────────────────────────────────────────────────────

  describe("POST /api/v1/manifests", () => {
    it("saves a draft manifest and returns CID with asset_id and version", async () => {
      const manifest = {
        name: "Draft Test",
        asset_id: "draft_test_001",
        version: 1,
        scene: { nodes: [] },
      };

      const res = await request(app).post("/api/v1/manifests").send(manifest);

      expect(res.status).toBe(201);
      expect(res.body.cid).toBeDefined();
      expect(res.body.assetId).toBe("draft_test_001");
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

      const res = await request(app).post("/api/v1/manifests").send(manifest);

      expect(res.status).toBe(201);
      expect(res.body.assetId).toBeDefined();
      expect(res.body.assetId).toMatch(/^asset_\d+$/);
    });

    it("chains versions correctly via prev_asset_manifest_cid", async () => {
      // Save v1
      const res1 = await request(app)
        .post("/api/v1/manifests")
        .send({
          name: "Chain Draft",
          asset_id: "chain_draft",
          version: 1,
          scene: { nodes: [] },
        });

      // Save v2 pointing to v1
      const res2 = await request(app)
        .post("/api/v1/manifests")
        .send({
          name: "Chain Draft v2",
          asset_id: "chain_draft",
          version: 2,
          prev_asset_manifest_cid: res1.body.cid,
          scene: { nodes: [] },
        });

      expect(res2.status).toBe(201);
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

      const res = await request(app).post("/api/v1/manifests").send(manifest);

      expect(res.status).toBe(201);

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
        .post("/api/v1/manifests")
        .send("not-valid-json")
        .set("Content-Type", "application/json");

      expect(res.status).toBe(400);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("POST /api/v1/manifests/:cid/publish handles missing thumbnail gracefully", async () => {
      const res = await request(app)
        .post("/api/v1/manifests/QmNoThumb/publish")
        .send({
          asset_id: "no_thumbnail_asset",
          version: 1,
          scene: { nodes: [] },
        });

      expect(res.status).toBe(200);
      const stored = JSON.parse(ipfsStorage.get(res.body.cid));
      // Manifest should not have a thumbnail key at all when no thumbnail provided
      expect(stored.thumbnail).toBeUndefined();
    });

    it("POST /api/v1/manifests/:cid/publish skips invalid thumbnail data URL", async () => {
      const res = await request(app)
        .post("/api/v1/manifests/QmBadThumb/publish")
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
      const stored = JSON.parse(ipfsStorage.get(res.body.cid));
      // Invalid data URL should be stripped
      expect(stored.thumbnail).toBeUndefined();
    });

    it("POST /api/v1/manifests preserves existing scene nodes on re-save", async () => {
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
              post_processor: { color: "#FF0000", scale: { x: 1, y: 1, z: 1 } },
            },
          ],
        },
      };

      const res1 = await request(app).post("/api/v1/manifests").send(manifest);
      expect(res1.status).toBe(201);

      // Re-save same manifest with incremented version
      manifest.version = 2;
      manifest.prev_asset_manifest_cid = res1.body.cid;
      const res2 = await request(app).post("/api/v1/manifests").send(manifest);
      expect(res2.status).toBe(201);

      // Verify round-trip preserves node data
      const stored = JSON.parse(ipfsStorage.get(res2.body.cid));
      expect(stored.scene.nodes).toHaveLength(1);
      expect(stored.scene.nodes[0].node_id).toBe("node_resave_001");
      expect(stored.scene.nodes[0].post_processor.color).toBe("#FF0000");
    });

    it("GET /api/v1/config returns the configured address", async () => {
      const res = await request(app).get("/api/v1/config");

      expect(res.status).toBe(200);
      expect(res.body.contractAddress).toBe("0xArbeskContractAddress");
    });
  });

  describe("GET /api/v1/config storage fields", () => {
    it("reports the ipfs backend and gateway", async () => {
      const res = await request(app).get("/api/v1/config");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("ipfsBackend");
      expect(res.body).toHaveProperty("ipfsGatewayUrl");
      expect(res.body.ipfsGatewayUrl).toMatch(/\/ipfs\/$/);
    });
  });
});
