import { jest } from "@jest/globals";
import request from "supertest";
import zlib from "zlib";
import { _resetRateLimiters } from "../src/api/rate-limiter.js";

jest.setTimeout(30000);

describe("Arbesk Phase 1 + Phase 3 API", () => {
  let app;
  let ipfsStorage;
  let mockIPFS;
  let mockWeb3Receipt;
  let logSpy;
  let createSession;
  let _resetStorage;

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
        if (!stored) return;
        if (stored instanceof Uint8Array || Buffer.isBuffer(stored)) {
          yield stored;
        } else {
          const chars = stored.split("").map((c) => c.charCodeAt(0));
          yield new Uint16Array(chars);
        }
      }),
      addAll: jest.fn(async function* (source, _options) {
        // Mirror Kubo's wrapWithDirectory: store each file under a content
        // hash, then yield a root directory node whose path is "".
        const entries = [];
        for await (const entry of source) {
          const hash = "Qm" + Math.random().toString(36).substring(2, 15);
          const data =
            entry.content instanceof Uint8Array
              ? Buffer.from(entry.content).toString("base64")
              : String(entry.content);
          ipfsStorage.set(hash, data);
          entries.push({ path: entry.path, hash });
          yield { path: entry.path, cid: { toString: () => hash } };
        }
        const rootHash = "QmDir" + Math.random().toString(36).substring(2, 12);
        ipfsStorage.set(rootHash, JSON.stringify(entries));
        yield { path: "", cid: { toString: () => rootHash } };
      }),
      pin: {
        add: jest.fn(async () => {}),
        rm: jest.fn(async () => {}),
        ls: jest.fn(async function* () {
          // Treat everything in ipfsStorage as pinned.
          for (const cid of ipfsStorage.keys()) {
            yield { cid: { toString: () => cid, toJSON: () => cid } };
          }
        }),
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

    // Mutable state for GC token discovery tests.
    const gcTokens = new Map();
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
          getBlockNumber: jest.fn(() => Promise.resolve(1000)),
          accounts: { recover: jest.fn(() => "0xTestAddress") },
          getTransactionReceipt: jest.fn(() =>
            Promise.resolve(mockWeb3Receipt),
          ),
          abi: {
            decodeParameters: jest.fn((_types, _data) => {
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
            getPastEvents: jest.fn(async (event, _opts) => {
              if (event !== "Transfer") return [];
              // Return mint events for every registered GC token.
              return Array.from(gcTokens.entries()).map(
                ([tokenId, t]) => ({
                  returnValues: {
                    from: ZERO_ADDRESS,
                    to: t.owner,
                    tokenId,
                  },
                }),
              );
            }),
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
              tokenURI: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  if (t) return Promise.resolve(t.tokenURI);
                  return Promise.resolve(_tokenURICid);
                }),
              })),
              ownerOf: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  if (!t) throw new Error("Token does not exist");
                  return Promise.resolve(t.owner);
                }),
              })),
              editorListURI: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  return Promise.resolve(t?.editorListURI || "");
                }),
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
    globalThis.__registerGCToken = (tokenId, tokenURI, owner, editorListURI) => {
      gcTokens.set(String(tokenId), {
        tokenURI,
        owner: owner || "0xOwner",
        editorListURI: editorListURI || "",
      });
    };
    globalThis.__burnGCToken = (tokenId) => {
      gcTokens.delete(String(tokenId));
    };
    globalThis.__clearGCTokens = () => {
      gcTokens.clear();
    };

    process.env.MOCK_3D_GENERATION = "true";
    process.env.GENERATION_RATE_LIMIT_MAX = "10";
    process.env.UPLOAD_URL_RATE_LIMIT_MAX = "5";
    process.env.CONTRACT_ADDRESS = "0xArbeskContractAddress";
    process.env.GC_ADMIN_TOKEN = "test-admin-token";

    const sessions = await import("../src/api/sessions.js");
    createSession = sessions.createSession;

    const { app: importedApp } = await import("../src/index.js");
    app = importedApp;

    // Import after mocking ipfs-http-client so the storage adapter factory
    // resolves the mock instead of the real ESM-only client under Jest.
    const storageMod = await import("../src/api/storage/index.js");
    _resetStorage = storageMod._resetStorage;
  });

  beforeEach(() => {
    // Storage adapter is a singleton selected by IPFS_BACKEND; reset it
    // between tests so Pinata/Kubo backend changes take effect cleanly.
    _resetStorage();
    _resetRateLimiters();
    ipfsStorage.clear();
  });

  afterAll(() => {
    logSpy?.mockRestore();
    jest.restoreAllMocks();
    delete process.env.CONTRACT_ADDRESS;
    delete process.env.GENERATION_RATE_LIMIT_MAX;
    delete process.env.UPLOAD_URL_RATE_LIMIT_MAX;
    delete process.env.UNPIN_RATE_LIMIT_MAX;
    delete process.env.GC_RATE_LIMIT_MAX;
  });

  async function makeSessionHeader(
    address = "0x1234567890123456789012345678901234567890",
  ) {
    const token = createSession(address);
    return `Session ${token}`;
  }

  /**
   * Write a manifest JSON directly to the mock IPFS storage and return its
   * deterministic CID. Replaces the removed POST /api/v1/manifests route -
   * manifests are now written client-side in production; tests seed storage
   * directly.
   */
  let _manifestSeq = 0;
  function saveManifestToStorage(manifest, { compress = false } = {}) {
    _manifestSeq++;
    const hash = `QmTestManifest${String(_manifestSeq).padStart(4, "0")}`;
    const payload = JSON.stringify(manifest);
    ipfsStorage.set(
      hash,
      compress ? zlib.gzipSync(Buffer.from(payload, "utf-8")) : payload,
    );
    return hash;
  }

  describe("POST /api/v1/generations", () => {
    it("returns asset bytes for a prompt", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A modern minimalist workbench",
          nodeId: "node_table_001",
        });

      expect(res.status).toBe(200);
      expect(res.body.assetData).toBeDefined();
      expect(typeof res.body.assetData).toBe("string");
      expect(res.body.format).toBeDefined();
      expect(res.body.path).toBeDefined();
      expect(res.body.provider).toBe("mock");

      // assetData should be valid base64
      expect(() => atob(res.body.assetData)).not.toThrow();
    });

    it("returns suka.gltf for character prompts", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A tall character",
          nodeId: "node_char_001",
        });

      expect(res.status).toBe(200);
      expect(res.body.format).toBe("gltf");
      expect(res.body.path).toMatch(/\.gltf$/);
    });

    it("returns howdy.glb for cowboy prompts", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "howdy cowboy",
          nodeId: "node_cowboy_001",
        });

      expect(res.status).toBe(200);
      expect(res.body.format).toBe("glb");
      expect(res.body.path).toMatch(/\.glb$/);
    });

    it("rejects when prompt or nodeId is missing", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "",
          nodeId: "node_test",
        });

      expect(res.status).toBe(400);
    });

    it("rejects missing Authorization header with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .send({ prompt: "Test", nodeId: "node_noauth" });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("MISSING_AUTH");
    });

    it("rejects invalid session token with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", "Session invalid-token")
        .send({
          prompt: "Test",
          nodeId: "node_badsession",
        });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("INVALID_SESSION");
    });

    it("rejects non-Session auth scheme with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", "Bearer something")
        .send({ prompt: "Test", nodeId: "node_bearer" });
      expect(res.status).toBe(401);
    });

    it("rejects real provider without providerKey", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A chair",
          nodeId: "node_no_key",
          provider: "meshy",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_PROVIDER_KEY");
    });

    it("BYOK: real provider with providerKey succeeds", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A BYOK lamp",
          nodeId: "node_byok_001",
          provider: "meshy",
          providerKey: "sk-byok-test-key-1234",
        });

      expect(res.status).toBe(200);
      expect(res.body.assetData).toBeDefined();
      expect(res.body.format).toBeDefined();
    });

    it("BYOK: empty/whitespace providerKey is rejected for real providers", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "An empty-key asset",
          nodeId: "node_byok_empty",
          provider: "meshy",
          providerKey: "   ",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_PROVIDER_KEY");
    });
  });

  describe("POST /api/v1/assets/snapshot-comments", () => {
    it("rejects without a session (401)", async () => {
      const res = await request(app)
        .post("/api/v1/assets/snapshot-comments")
        .send({
          tokenId: "42",
          chainId: 31415822,
          contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
          assetId: "asset_42",
        });

      expect(res.status).toBe(401);
    });

    it("snapshots Nostr comments to IPFS", async () => {
      const res = await request(app)
        .post("/api/v1/assets/snapshot-comments")
        .set("Authorization", await makeSessionHeader())
        .send({
          tokenId: "42",
          chainId: 31415822,
          contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
          assetId: "asset_42",
        });

      expect(res.status).toBe(200);
      expect(res.body.cid).toBeDefined();
      expect(typeof res.body.eventCount).toBe("number");
    });

    it("returns 400 when tokenId is missing", async () => {
      const res = await request(app)
        .post("/api/v1/assets/snapshot-comments")
        .set("Authorization", await makeSessionHeader())
        .send({ chainId: 31415822, assetId: "asset_42" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_TOKEN_ID");
    });

    it("returns 400 when assetId is missing", async () => {
      const res = await request(app)
        .post("/api/v1/assets/snapshot-comments")
        .set("Authorization", await makeSessionHeader())
        .send({ tokenId: "42", chainId: 31415822 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_ASSET_ID");
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
          });
        lastStatus = res.status;
        if (res.status === 429) break;
      }
      expect(lastStatus).toBe(429);
    });
  });

  describe("POST /api/v1/ipfs/upload-url", () => {
    beforeEach(() => _resetRateLimiters());

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
    it("rejects without a session (401)", async () => {
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "n", source: { cid: "QmSource" } }] },
      });

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .send({ cid: startCid });
      expect(res.status).toBe(401);
    });

    it("walks the chain and reports unpinned CIDs", async () => {
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "n", source: { cid: "QmSource" } }] },
      });

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.unpinned)).toBe(true);
      expect(res.body.unpinned).toContain(startCid);
    });

    it("skips shared source.cid and source.bundleCid", async () => {
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: {
          nodes: [
            {
              node_id: "n",
              source: { cid: "QmSource", bundleCid: "QmBundleRoot" },
            },
          ],
        },
      });

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid });
      expect(res.status).toBe(200);
      // The manifest itself is unpinned, but source CIDs are shared via dedup
      // and must survive the delete so other assets can still reference them.
      expect(res.body.unpinned).toContain(startCid);
      expect(res.body.unpinned).not.toContain("QmSource");
      expect(res.body.unpinned).not.toContain("QmBundleRoot");
      expect(res.body.skipped).toContain("QmSource");
      expect(res.body.skipped).toContain("QmBundleRoot");
    });

    it("walks and unpins a gzip-compressed manifest chain but skips shared sources", async () => {
      const prevCid = saveManifestToStorage(
        {
          version: 1,
          prev_asset_manifest_cid: null,
          scene: { nodes: [] },
        },
        { compress: true },
      );
      const startCid = saveManifestToStorage(
        {
          version: 2,
          prev_asset_manifest_cid: prevCid,
          scene: { nodes: [{ node_id: "n", source: { cid: "QmSource" } }] },
        },
        { compress: true },
      );
      // Source asset must exist and be readable JSON for the ref-walker.
      ipfsStorage.set("QmSource", '{"buffers":[{"uri":"ipfs://QmBuffer"}]}');

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid });
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      // Manifest chain CIDs are asset-unique and get unpinned.
      expect(res.body.unpinned).toContain(startCid);
      expect(res.body.unpinned).toContain(prevCid);
      // Source glTF and its embedded buffer/image are shared via dedup and
      // must be left pinned so other assets keep working.
      expect(res.body.unpinned).not.toContain("QmSource");
      expect(res.body.unpinned).not.toContain("QmBuffer");
      expect(res.body.skipped).toContain("QmSource");
      // Embedded buffer/image CIDs are not even inspected in conservative mode;
      // they are left pinned and reclaimed later by the reachability GC.
    });

    it("does not unpin a shared buffer CID referenced by another asset", async () => {
      // cowboy1 and cowboy2 share the same mesh/texture CID.
      ipfsStorage.set(
        "QmSharedMesh",
        '{"buffers":[{"uri":"ipfs://QmSharedBuffer"}]}',
      );

      const cowboy1Cid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "QmSharedMesh" } }] },
      });

      const cowboy2Cid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "QmSharedMesh" } }] },
      });

      // Deleting cowboy2 must not unpin the shared mesh or its buffer.
      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: cowboy2Cid });
      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(cowboy2Cid);
      expect(res.body.unpinned).not.toContain("QmSharedMesh");
      expect(res.body.unpinned).not.toContain("QmSharedBuffer");
      expect(res.body.skipped).toContain("QmSharedMesh");
      // cowboy1's manifest is untouched.
      expect(res.body.unpinned).not.toContain(cowboy1Cid);
    });

    it("rate-limits unpin requests per wallet", async () => {
      process.env.UNPIN_RATE_LIMIT_MAX = "1";
      _resetRateLimiters();
      const cid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: {},
      });
      const auth = await makeSessionHeader();

      const res1 = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", auth)
        .send({ cid });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", auth)
        .send({ cid });
      expect(res2.status).toBe(429);
      expect(res2.text).toMatch(/Unpin rate limit exceeded/i);
    });
  });

  describe("POST /api/v1/ipfs/gc reachability GC", () => {
    beforeEach(() => {
      globalThis.__clearGCTokens?.();
    });

    it("requires session and admin token", async () => {
      const resNoSession = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: true });
      expect(resNoSession.status).toBe(401);

      const resNoAdmin = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", await makeSessionHeader())
        .send({ dryRun: true });
      expect(resNoAdmin.status).toBe(403);
    });

    it("dry-run reports orphaned CIDs without unpinning", async () => {
      ipfsStorage.set(
        "QmSharedMesh",
        '{"buffers":[{"uri":"ipfs://QmSharedBuffer"}]}',
      );

      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "QmSharedMesh" } }] },
      });

      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { cowboy: assetCid },
      });

      // Orphan: pinned but not referenced by any live token.
      ipfsStorage.set("QmOrphan", "orphan data");

      globalThis.__registerGCToken("1", collectionCid);

      const res = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", await makeSessionHeader())
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.liveTokens).toBe(1);
      expect(res.body.pinned).toBeGreaterThanOrEqual(3);
      expect(res.body.orphans).toBeGreaterThanOrEqual(1);
      expect(res.body.unpinned).toBe(0);
    });

    it("live run unpins only orphaned CIDs", async () => {
      ipfsStorage.set(
        "QmSharedMesh",
        '{"buffers":[{"uri":"ipfs://QmSharedBuffer"}]}',
      );
      ipfsStorage.set("QmSharedBuffer", "buffer bytes");

      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "QmSharedMesh" } }] },
      });

      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { cowboy: assetCid },
      });

      ipfsStorage.set("QmOrphan", "orphan data");

      globalThis.__registerGCToken("1", collectionCid);

      const res = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", await makeSessionHeader())
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: false });

      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(false);
      expect(res.body.unpinned).toBeGreaterThanOrEqual(1);
      // Reachable CIDs must still be pinned (mock storage still contains them;
      // in real life they would remain pinned).
      expect(ipfsStorage.has(collectionCid)).toBe(true);
      expect(ipfsStorage.has(assetCid)).toBe(true);
      expect(ipfsStorage.has("QmSharedMesh")).toBe(true);
      expect(ipfsStorage.has("QmSharedBuffer")).toBe(true);
    });

    it("keeps shared source CID pinned while token lives and unpin it after burn", async () => {
      ipfsStorage.set(
        "QmSharedMesh",
        '{"buffers":[{"uri":"ipfs://QmSharedBuffer"}]}',
      );

      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "QmSharedMesh" } }] },
      });

      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { cowboy: assetCid },
      });

      globalThis.__registerGCToken("1", collectionCid);

      // While token #1 is alive, the shared mesh is reachable.
      const dryRes = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", await makeSessionHeader())
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: true });
      expect(dryRes.status).toBe(200);
      expect(dryRes.body.orphans).toBe(0);

      // Burn the token.
      globalThis.__burnGCToken("1");

      // After burn, the shared mesh and its buffer are orphaned.
      const liveRes = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", await makeSessionHeader())
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: false });
      expect(liveRes.status).toBe(200);
      expect(liveRes.body.liveTokens).toBe(0);
      expect(liveRes.body.unpinned).toBeGreaterThanOrEqual(2);
    });

    it("rate-limits GC requests per wallet", async () => {
      process.env.GC_RATE_LIMIT_MAX = "1";
      _resetRateLimiters();
      const auth = await makeSessionHeader();

      const res1 = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", auth)
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: true });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", auth)
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: true });
      expect(res2.status).toBe(429);
      expect(res2.text).toMatch(/GC rate limit exceeded/i);
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
    it("stores a manifest with token child_ref nodes in IPFS", () => {
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

      const cid = saveManifestToStorage(manifest);
      expect(cid).toBeDefined();

      const stored = JSON.parse(ipfsStorage.get(cid));

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

    it("stores a mixed manifest with regular and child_ref nodes", () => {
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

      const cid = saveManifestToStorage(manifest);
      const stored = JSON.parse(ipfsStorage.get(cid));

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
