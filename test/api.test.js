import { jest } from "@jest/globals";
import request from "supertest";
import zlib from "zlib";
import { _resetRateLimiters } from "../src/api/rate-limiter.js";
import {
  _resetRegistry,
  registerTask,
  markTaskComplete,
} from "../src/api/generation-tasks.js";

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
        const rootHash = "bafyDir" + Math.random().toString(36).substring(2, 12);
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
    const ZERO_ROOT =
      "0x0000000000000000000000000000000000000000000000000000000000000000";

    // A token registered with extras.contractAddress is only "visible" on
    // that contract; any other contract address behaves as if the token does
    // not exist (like querying the wrong tier's contract).
    const visibleOn = (t, address) =>
      !t?.contractAddress ||
      !address ||
      String(t.contractAddress).toLowerCase() === String(address).toLowerCase();

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
          Contract: jest.fn((_abi, address) => ({
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
              tokenURI: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  if (t && visibleOn(t, address)) {
                    return Promise.resolve(t.tokenURI);
                  }
                  if (t) throw new Error("Token does not exist");
                  return Promise.resolve(_tokenURICid);
                }),
              })),
              ownerOf: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  if (!t || !visibleOn(t, address)) {
                    throw new Error("Token does not exist");
                  }
                  return Promise.resolve(t.owner);
                }),
              })),
              editorRoot: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  if (!visibleOn(t, address)) return Promise.resolve(ZERO_ROOT);
                  return Promise.resolve(t?.editorRoot || ZERO_ROOT);
                }),
              })),
              editorSetVersion: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  if (!visibleOn(t, address)) return Promise.resolve("1");
                  return Promise.resolve(t?.editorSetVersion || "1");
                }),
              })),
              editorListURI: jest.fn((tokenId) => ({
                call: jest.fn(() => {
                  const t = gcTokens.get(String(tokenId));
                  if (!visibleOn(t, address)) return Promise.resolve("");
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
    globalThis.__registerGCToken = (
      tokenId,
      tokenURI,
      owner,
      editorListURI,
      extras = {},
    ) => {
      gcTokens.set(String(tokenId), {
        tokenURI,
        owner: owner || "0xOwner",
        editorListURI: editorListURI || "",
        editorRoot: extras.editorRoot || null,
        editorSetVersion: extras.editorSetVersion || "1",
        contractAddress: extras.contractAddress || null,
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
    _resetRegistry();
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
    const hash = `bafyTestManifest${String(_manifestSeq).padStart(4, "0")}`;
    const payload = JSON.stringify(manifest);
    ipfsStorage.set(
      hash,
      compress ? zlib.gzipSync(Buffer.from(payload, "utf-8")) : payload,
    );
    return hash;
  }

  describe("Security headers", () => {
    it("includes CDP API hosts in connect-src CSP", async () => {
      const res = await request(app).get("/app.html");
      const csp = res.headers["content-security-policy-report-only"];
      expect(csp).toBeDefined();
      expect(csp).toMatch(
        /connect-src[^;]*https:\/\/api\.cdp\.coinbase\.com/,
      );
      expect(csp).toMatch(
        /connect-src[^;]*https:\/\/sepolia\.base\.org/,
      );
    });
  });

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

    it("returns box.3mf for 3mf prompts", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "a 3mf box",
          nodeId: "node_3mf_001",
        });

      expect(res.status).toBe(200);
      expect(res.body.format).toBe("3mf");
      expect(res.body.path).toMatch(/\.3mf$/);
      const bytes = Buffer.from(res.body.assetData, "base64");
      expect(bytes[0]).toBe(0x50); // 'P'
      expect(bytes[1]).toBe(0x4b); // 'K'
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
          provider: "tripo3d",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_PROVIDER_KEY");
    });

    it("BYOK: tripo3d provider with providerKey creates a task", async () => {
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task_byok" } }),
        });

      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "A BYOK lamp",
          nodeId: "node_byok_001",
          provider: "tripo3d",
          providerKey: "sk-byok-test-key-1234",
        });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        provider: "tripo3d",
        status: "running",
      });
      expect(typeof res.body.taskId).toBe("string");
      expect(JSON.stringify(res.body)).not.toContain("sk-byok-test-key-1234");

      fetchSpy.mockRestore();
    });

    it("BYOK: empty/whitespace providerKey is rejected for real providers", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "An empty-key asset",
          nodeId: "node_byok_empty",
          provider: "tripo3d",
          providerKey: "   ",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_PROVIDER_KEY");
    });

    it("rejects sourceAssetCid without an action flag", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects sourceAssetCid with two action flags", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", retopo: true, animate: true, animations: ["preset:idle"] });
      expect(res.status).toBe(400);
    });

    it("rejects retexture without a prompt", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", retexture: true });
      expect(res.status).toBe(400);
    });

    it("rejects animate without animations unless rigOnly", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", animate: true });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid textureQuality", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "x", textureQuality: "ultra" });
      expect(res.status).toBe(400);
    });

    it("accepts auto-rig (animate + rigOnly, no animations)", async () => {
      ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_rc" } }),
      });
      try {
        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", animate: true, rigOnly: true });
        expect(res.status).toBe(202);
        expect(res.body.animating).toBe(true);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    describe("tripo3d provider", () => {
      afterEach(() => {
        jest.restoreAllMocks();
      });

      it("returns 202 with taskId on POST", async () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task_abc" } }),
        });

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A red cube",
            nodeId: "node_tripo_001",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({
          taskId: expect.any(String),
          provider: "tripo3d",
          status: "running",
        });
        expect(JSON.stringify(res.body)).not.toContain("tsk_test_secret_key");
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        fetchSpy.mockRestore();
      });

      it("returns 202 on image-to-3D POST (upload then image task, no prompt)", async () => {
        const fetchSpy = jest
          .spyOn(global, "fetch")
          // 1: image upload → file_token
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { file_token: "ftok_1" } }),
          })
          // 2: image-to-model task
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_img" } }),
          });

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            nodeId: "node_tripo_img",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
            imageData: Buffer.from("png-bytes").toString("base64"),
            imageMime: "image/png",
          });

        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({
          taskId: expect.any(String),
          provider: "tripo3d",
          status: "running",
        });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(fetchSpy.mock.calls[0][0]).toBe(
          "https://openapi.tripo3d.ai/v3/files",
        );
        expect(fetchSpy.mock.calls[1][0]).toBe(
          "https://openapi.tripo3d.ai/v3/generation/image-to-model",
        );
        expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toMatchObject({
          file: { file_token: "ftok_1" },
        });

        fetchSpy.mockRestore();
      });

      it("ignores action flags without sourceAssetCid (fresh generation)", async () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task_fresh" } }),
        });

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A fresh model",
            nodeId: "node_tripo_flag_no_source",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
            // The schema permits action flags without sourceAssetCid; the
            // route must ignore them and run a fresh generation, not crash.
            retopo: true,
          });

        expect(res.status).toBe(202);
        expect(res.body.retopo).toBeUndefined();
        expect(fetchSpy.mock.calls[0][0]).toBe(
          "https://openapi.tripo3d.ai/v3/generation/text-to-model",
        );
      });

      it("returns 400 VALIDATION_ERROR when neither prompt nor imageData is sent", async () => {
        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            nodeId: "node_tripo_empty",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      });

      it("POST /generations/balance returns the Tripo credit balance", async () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { balance: 630, frozen: 0 } }),
        });

        const res = await request(app)
          .post("/api/v1/generations/balance")
          .set("Authorization", await makeSessionHeader())
          .send({ providerKey: "tsk_test_secret_key" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ balance: 630, frozen: 0 });
        expect(fetchSpy.mock.calls[0][0]).toBe(
          "https://openapi.tripo3d.ai/v3/account/balance",
        );
        expect(JSON.stringify(res.body)).not.toContain("tsk_test_secret_key");
        fetchSpy.mockRestore();
      });

      it("POST /generations/balance maps an invalid key to 401 PROVIDER_AUTH_FAILED", async () => {
        jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 1002, message: "Authentication failed" }),
        });

        const res = await request(app)
          .post("/api/v1/generations/balance")
          .set("Authorization", await makeSessionHeader())
          .send({ providerKey: "tsk_bad_key" });

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("PROVIDER_AUTH_FAILED");
      });

      it("POST /generations/balance rejects a missing providerKey", async () => {
        const res = await request(app)
          .post("/api/v1/generations/balance")
          .set("Authorization", await makeSessionHeader())
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      });

      it("POST /generations/balance requires a session", async () => {
        const res = await request(app)
          .post("/api/v1/generations/balance")
          .send({ providerKey: "tsk_test_secret_key" });

        expect(res.status).toBe(401);
      });

      it("POST animate uploads the GLB and starts rig-check with the file token", async () => {
        ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));
        const calls = [];
        const bodies = [];
        jest.spyOn(global, "fetch").mockImplementation(async (url, opts) => {
          calls.push(url);
          if (opts?.body && !(opts.body instanceof FormData)) bodies.push(JSON.parse(opts.body));
          return { ok: true, json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_rc" } }) };
        });
        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", animate: true, animations: ["preset:idle"] });
        expect(res.status).toBe(202);
        expect(res.body.animating).toBe(true);
        expect(calls[0]).toBe("https://openapi.tripo3d.ai/v3/files");
        expect(calls[1]).toBe("https://openapi.tripo3d.ai/v3/animations/rig-check");
        expect(bodies[0]).toMatchObject({ input: "file_1" });
      });

      it("POST animate with sourceTaskId of a completed rig-only task retargets directly (no rig-check)", async () => {
        const rigSourceId = registerTask({
          tripoTaskId: "task_rig_done",
          providerKey: "k",
          userAddress: "0x1234567890123456789012345678901234567890",
          kind: "animate",
          phase: "rig",
          rigOnly: true,
        });
        markTaskComplete(rigSourceId, "0x1234567890123456789012345678901234567890");

        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task_rt_direct" } }),
        });

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            nodeId: "node_anim_direct",
            provider: "tripo3d",
            providerKey: "k",
            sourceAssetCid: "bafySource",
            animate: true,
            sourceTaskId: rigSourceId,
            animations: ["preset:idle", "preset:walk"],
          });

        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({
          provider: "tripo3d",
          status: "running",
          animating: true,
        });
        // Exactly one upstream call: the retarget on the rig task — no GLB
        // upload, no rig-check, no rig.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toBe(
          "https://openapi.tripo3d.ai/v3/animations/retarget",
        );
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
          input: "task_rig_done",
          animations: ["preset:idle", "preset:walk"],
          out_format: "glb",
        });
      });

      it("POST animate with rigOnly and a sourceTaskId falls through to a fresh rig-only chain", async () => {
        ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));
        const rigSourceId = registerTask({
          tripoTaskId: "task_rig_done_2",
          providerKey: "k",
          userAddress: "0x1234567890123456789012345678901234567890",
          kind: "animate",
          phase: "rig",
          rigOnly: true,
        });
        markTaskComplete(rigSourceId, "0x1234567890123456789012345678901234567890");

        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_rc_rerig" } }),
        });

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            nodeId: "node_anim_rerig",
            provider: "tripo3d",
            providerKey: "k",
            sourceAssetCid: "bafySource",
            animate: true,
            rigOnly: true,
            sourceTaskId: rigSourceId,
          });

        // No retarget shortcut with rigOnly — the GLB starts a fresh
        // rig-only chain (upload + rig-check).
        expect(res.status).toBe(202);
        expect(res.body.animating).toBe(true);
        expect(fetchSpy.mock.calls[0][0]).toBe(
          "https://openapi.tripo3d.ai/v3/files",
        );
        expect(fetchSpy.mock.calls[1][0]).toBe(
          "https://openapi.tripo3d.ai/v3/animations/rig-check",
        );
      });

      it("POST animate with an unknown sourceTaskId falls back to the GLB chain", async () => {
        ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));
        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_rc_fb" } }),
        });

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            nodeId: "node_anim_fallback",
            provider: "tripo3d",
            providerKey: "k",
            sourceAssetCid: "bafySource",
            animate: true,
            sourceTaskId: "00000000-0000-0000-0000-000000000000",
            animations: ["preset:idle"],
          });

        // The registry entry may have expired (TTL) — the GLB is the
        // canonical source, so the chain still starts normally.
        expect(res.status).toBe(202);
        expect(res.body.animating).toBe(true);
        expect(fetchSpy.mock.calls[1][0]).toBe(
          "https://openapi.tripo3d.ai/v3/animations/rig-check",
        );
      });

      it("GET advances the animate chain rig-check → rig → retarget → GLB", async () => {
        const glb = new TextEncoder().encode("animated-glb");
        const session = await makeSessionHeader();
        ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));

        const fetchSpy = jest.spyOn(global, "fetch");
        fetchSpy.mockReset();
        fetchSpy
          // 1: POST → source GLB uploaded to Tripo
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { file_token: "file_1" } }),
          })
          // 2: POST → rig-check created
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_rc_2" } }),
          })
          // 3: GET poll → rig-check success (riggable biped)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_rc_2",
                status: "success",
                output: { riggable: true, rig_type: "biped" },
              },
            }),
          })
          // 4: chain → rig created
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_rig_2" } }),
          })
          // 5: GET poll → rig success
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: { task_id: "task_rig_2", status: "success", output: {} },
            }),
          })
          // 6: chain → retarget created
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_rt_2" } }),
          })
          // 7: GET poll → retarget success with model_url
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_rt_2",
                status: "success",
                output: { model_url: "https://cdn/animated.glb" },
              },
            }),
          })
          // 8: download
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () =>
              glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
          });

        const post = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", session)
          .send({
            nodeId: "node_anim_2",
            provider: "tripo3d",
            providerKey: "k",
            sourceAssetCid: "bafySource",
            animate: true,
            animations: ["preset:idle"],
          });
        expect(post.status).toBe(202);
        const taskId = post.body.taskId;

        // Poll 1: rig-check done → rig started
        const poll1 = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", session);
        expect(poll1.body).toEqual({
          status: "running",
          progress: 40,
          stage: "Rigging skeleton",
        });
        // Rig input must be the uploaded file token (the entry's sourceFileToken);
        // bipeds go to the v1.0 rig line.
        expect(JSON.parse(fetchSpy.mock.calls[3][1].body)).toMatchObject({
          input: "file_1",
          rig_type: "biped",
          model: "v1.0-20240301",
        });

        // Poll 2: rig done → retarget started
        const poll2 = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", session);
        expect(poll2.body).toEqual({
          status: "running",
          progress: 75,
          stage: "Baking animations",
        });
        // Retarget input must be the rig task id; presets map to the v1.0
        // biped namespace for v1.0 rigs.
        expect(JSON.parse(fetchSpy.mock.calls[5][1].body)).toEqual({
          input: "task_rig_2",
          animations: ["preset:biped:idle"],
          out_format: "glb",
        });

        // Poll 3: retarget done → animated GLB
        const poll3 = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", session);
        expect(poll3.body.status).toBe("success");
        expect(poll3.body.assetData).toBe(
          Buffer.from("animated-glb").toString("base64"),
        );
      });

      it("rigOnly chain stops after rig — no retarget call, rig GLB returned", async () => {
        const glb = new TextEncoder().encode("rigged-glb");
        const session = await makeSessionHeader();
        ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));

        const fetchSpy = jest.spyOn(global, "fetch");
        fetchSpy.mockReset();
        fetchSpy
          // 1: POST → source GLB uploaded to Tripo
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { file_token: "file_1" } }),
          })
          // 2: POST → rig-check created
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_rc_ro" } }),
          })
          // 3: poll → rig-check success
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_rc_ro",
                status: "success",
                output: { riggable: true, rig_type: "biped" },
              },
            }),
          })
          // 4: chain → rig created
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_rig_ro" } }),
          })
          // 5: poll → rig success with rigged model URL
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_rig_ro",
                status: "success",
                output: { model_url: "https://cdn/rigged.glb" },
              },
            }),
          })
          // 6: download
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () =>
              glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
          });

        const post = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", session)
          .send({
            nodeId: "node_anim_rigonly",
            provider: "tripo3d",
            providerKey: "k",
            sourceAssetCid: "bafySource",
            animate: true,
            rigOnly: true,
          });
        expect(post.status).toBe(202);
        const taskId = post.body.taskId;

        const poll1 = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", session);
        expect(poll1.body.stage).toBe("Rigging skeleton");

        const poll2 = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", session);
        expect(poll2.body.status).toBe("success");
        expect(poll2.body.assetData).toBe(
          Buffer.from("rigged-glb").toString("base64"),
        );

        // 6 upstream calls total — no animations/retarget among them.
        expect(fetchSpy).toHaveBeenCalledTimes(6);
        const urls = fetchSpy.mock.calls.map((c) => c[0]);
        expect(urls.some((u) => u.includes("animations/retarget"))).toBe(false);
      });

      it("GET fails the chain with MODEL_NOT_RIGGABLE when Tripo says no", async () => {
        const session = await makeSessionHeader();
        ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));

        const fetchSpy = jest.spyOn(global, "fetch");
        fetchSpy.mockReset();
        fetchSpy
          // 1: POST → source GLB uploaded to Tripo
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { file_token: "file_1" } }),
          })
          // 2: POST → rig-check created
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_rc_3" } }),
          })
          // 3: poll → rig-check says not riggable
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_rc_3",
                status: "success",
                output: { riggable: false },
              },
            }),
          });

        const post = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", session)
          .send({
            nodeId: "node_anim_3",
            provider: "tripo3d",
            providerKey: "k",
            sourceAssetCid: "bafySource",
            animate: true,
            animations: ["preset:idle"],
          });
        const poll = await request(app)
          .get(`/api/v1/generations/${post.body.taskId}`)
          .set("Authorization", session);
        expect(poll.body.status).toBe("failed");
        expect(poll.body.error.code).toBe("MODEL_NOT_RIGGABLE");
      });

      it("POST with textureQuality=detailed passes texture_quality=detailed to Tripo", async () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task_hq" } }),
        });
        fetchSpy.mockClear();

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A detailed statue",
            nodeId: "node_tripo_hq",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
            textureQuality: "detailed",
          });

        expect(res.status).toBe(202);
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({
          texture_quality: "detailed",
        });
      });

      it("POST without textureQuality omits texture_quality", async () => {
        const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task_std" } }),
        });
        fetchSpy.mockClear();

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A plain cube",
            nodeId: "node_tripo_std",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        expect(res.status).toBe(202);
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).not.toHaveProperty(
          "texture_quality",
        );
      });

      describe("retopo (smart retopology)", () => {
        const WALLET = "0x1234567890123456789012345678901234567890";

        it("POST retopo uploads the source GLB and creates a decimate task with GLB-safe defaults", async () => {
          ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));
          const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_dec_1" } }),
          });

          const res = await request(app)
            .post("/api/v1/generations")
            .set("Authorization", await makeSessionHeader())
            .send({
              nodeId: "node_retopo_1",
              provider: "tripo3d",
              providerKey: "k",
              sourceAssetCid: "bafySource",
              retopo: true,
            });

          expect(res.status).toBe(202);
          expect(res.body).toMatchObject({
            provider: "tripo3d",
            status: "running",
            retopo: true,
          });
          expect(fetchSpy.mock.calls[0][0]).toBe(
            "https://openapi.tripo3d.ai/v3/files",
          );
          expect(fetchSpy.mock.calls[1][0]).toBe(
            "https://openapi.tripo3d.ai/v3/mesh/decimate",
          );
          expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({
            input: "file_1",
            model: "v2.0",
            quad: false,
            bake: true,
          });
        });

        it("POST retopo with faceLimit forwards face_limit", async () => {
          ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));
          const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_dec_2" } }),
          });

          const res = await request(app)
            .post("/api/v1/generations")
            .set("Authorization", await makeSessionHeader())
            .send({
              nodeId: "node_retopo_2",
              provider: "tripo3d",
              providerKey: "k",
              sourceAssetCid: "bafySource",
              retopo: true,
              faceLimit: 5000,
            });

          expect(res.status).toBe(202);
          expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toMatchObject({
            face_limit: 5000,
          });
        });

        it("GET poll completes a decimate task and returns the retopo GLB", async () => {
          const glb = new TextEncoder().encode("retopo-glb");
          const session = await makeSessionHeader();
          const taskId = registerTask({
            tripoTaskId: "task_dec_3",
            providerKey: "k",
            userAddress: WALLET,
          });

          global.fetch = jest
            .fn()
            // 1: poll → success with model_url
            .mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                code: 0,
                data: {
                  task_id: "task_dec_3",
                  status: "success",
                  output: { model_url: "https://cdn/retopo.glb" },
                },
              }),
            })
            // 2: download
            .mockResolvedValueOnce({
              ok: true,
              arrayBuffer: async () =>
                glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
            });

          const res = await request(app)
            .get(`/api/v1/generations/${taskId}`)
            .set("Authorization", session);

          expect(res.body.status).toBe("success");
          expect(res.body.format).toBe("glb");
          expect(Buffer.from(res.body.assetData, "base64").toString()).toBe(
            "retopo-glb",
          );
        });
      });

      it("GET returns progress while task is running", async () => {
        jest
          .spyOn(global, "fetch")
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_run" } }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_run",
                status: "running",
                progress: 37,
              },
            }),
          });

        const post = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A blue sphere",
            nodeId: "node_tripo_run",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        expect(post.status).toBe(202);
        const taskId = post.body.taskId;

        const res = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: "running", progress: 37 });
      });

      it("GET returns GLB base64 on success and evicts the task", async () => {
        const glbBuf = Buffer.from("glb binary");
        jest
          .spyOn(global, "fetch")
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_suc" } }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_suc",
                status: "success",
                output: { pbr_model: "https://cdn/result.glb" },
              },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () =>
              glbBuf.buffer.slice(
                glbBuf.byteOffset,
                glbBuf.byteOffset + glbBuf.byteLength,
              ),
          });

        const post = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A green cone",
            nodeId: "node_tripo_suc",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        expect(post.status).toBe(202);
        const taskId = post.body.taskId;

        const res = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          status: "success",
          format: "glb",
          path: "asset.glb",
          provider: "tripo3d",
        });
        expect(res.body.assetData).toBe(glbBuf.toString("base64"));
        expect(JSON.stringify(res.body)).not.toContain("tsk_test_secret_key");

        const second = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());
        expect(second.status).toBe(404);
        expect(second.body.error.code).toBe("GENERATION_TASK_NOT_FOUND");
      });

      it("GET returns 404 when task belongs to a different wallet", async () => {
        const foreignId = registerTask({
          tripoTaskId: "task_foreign",
          providerKey: "tsk_foreign_key",
          userAddress: "0x0000000000000000000000000000000000000001",
        });

        const res = await request(app)
          .get(`/api/v1/generations/${foreignId}`)
          .set("Authorization", await makeSessionHeader());

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("GENERATION_TASK_NOT_FOUND");
      });

      it("GET returns failed status when Tripo reports failure", async () => {
        jest
          .spyOn(global, "fetch")
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_fail" } }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 0,
              data: {
                task_id: "task_fail",
                status: "failed",
                message: "boom",
              },
            }),
          });

        const post = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A doomed asset",
            nodeId: "node_tripo_fail",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        const taskId = post.body.taskId;
        const res = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          status: "failed",
          error: { code: "PROVIDER_TASK_FAILED", message: "boom" },
        });
      });

      it("returns provider auth error with documented code and evicts the task", async () => {
        jest
          .spyOn(global, "fetch")
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ code: 0, data: { task_id: "task_err" } }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              code: 1002,
              message: "Authentication failed",
            }),
          });

        const post = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "An auth error",
            nodeId: "node_tripo_err",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        const taskId = post.body.taskId;
        const res = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());

        expect(res.status).toBe(401);
        expect(res.body.error).toMatchObject({
          code: "PROVIDER_AUTH_FAILED",
          message: expect.stringContaining("Authentication failed"),
        });

        // Auth failure is terminal: the task entry must be evicted.
        const again = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());
        expect(again.status).toBe(404);
      });

      it("maps Tripo credit exhaustion to 402 PROVIDER_CREDITS_EXHAUSTED on POST", async () => {
        jest.spyOn(global, "fetch").mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 2010,
            message: "You don't have enough credit",
          }),
        });

        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({
            prompt: "A pricey asset",
            nodeId: "node_tripo_credits",
            provider: "tripo3d",
            providerKey: "tsk_test_secret_key",
          });

        expect(res.status).toBe(402);
        expect(res.body.error.code).toBe("PROVIDER_CREDITS_EXHAUSTED");
      });

      it("POST retexture uploads the source GLB and starts a texture task", async () => {
        ipfsStorage.set("bafySource", Buffer.from("glb source bytes"));
        const calls = [];
        const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
          calls.push(url);
          return { ok: true, json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_tex" } }) };
        });
        // An earlier test assigns global.fetch directly; spyOn reuses that
        // mock including its call history — start from a clean slate.
        fetchSpy.mockClear();
        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "rusty bronze", sourceAssetCid: "bafySource", retexture: true, textureQuality: "detailed" });
        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({ provider: "tripo3d", status: "running", refined: true });
        expect(calls[0]).toBe("https://openapi.tripo3d.ai/v3/files");
        expect(calls[1]).toBe("https://openapi.tripo3d.ai/v3/models/texture");
        expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toMatchObject({
          input: "file_1",
          text_prompt: "rusty bronze",
          texture_quality: "detailed",
        });
      });

      it("returns 400 SOURCE_ASSET_UNAVAILABLE when the GLB cannot be fetched", async () => {
        // The mocked ipfs client's cat throws for this test only.
        mockIPFS.cat.mockImplementationOnce(async function* () {
          yield await Promise.reject(new Error("no such file"));
        });
        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "x", sourceAssetCid: "bafyMissing", retexture: true });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("SOURCE_ASSET_UNAVAILABLE");
      });

      it("returns 400 SOURCE_ASSET_UNAVAILABLE when the GLB is empty", async () => {
        ipfsStorage.set("bafyEmpty", Buffer.alloc(0));
        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "x", sourceAssetCid: "bafyEmpty", retexture: true });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("SOURCE_ASSET_UNAVAILABLE");
      });

      it("returns 400 SOURCE_ASSET_TOO_LARGE when the GLB exceeds 150 MB", async () => {
        ipfsStorage.set("bafyHuge", Buffer.alloc(150 * 1024 * 1024 + 1));
        const res = await request(app)
          .post("/api/v1/generations")
          .set("Authorization", await makeSessionHeader())
          .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "x", sourceAssetCid: "bafyHuge", retexture: true });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("SOURCE_ASSET_TOO_LARGE");
        expect(res.body.error.message).toContain("150 MB");
      });
    });

    it("rejects unknown provider with 501", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({
          prompt: "An unknown provider asset",
          nodeId: "node_unknown",
          provider: "meshy",
          providerKey: "sk-byok-test-key-1234",
        });

      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
    });
  });

  describe("DELETE /api/v1/generations/:taskId", () => {
    const SESSION_ADDRESS = "0x1234567890123456789012345678901234567890";

    it("evicts an in-flight task and best-effort cancels upstream", async () => {
      const taskId = registerTask({
        tripoTaskId: "tripo_cancel_1",
        providerKey: "k",
        userAddress: SESSION_ADDRESS,
      });
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ code: 0, data: {} }),
      });
      // Older tests assign global.fetch directly, leaving stale call history.
      fetchSpy.mockClear();
      try {
        const res = await request(app)
          .delete(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          status: "cancelled",
          upstreamCancelled: true,
        });
        expect(fetchSpy.mock.calls[0][0]).toBe(
          "https://openapi.tripo3d.ai/v3/tasks/tripo_cancel_1/cancel",
        );

        // The entry is gone — polling it now 404s.
        const poll = await request(app)
          .get(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());
        expect(poll.status).toBe(404);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("still cancels locally when the upstream cancel is unsupported", async () => {
      const taskId = registerTask({
        tripoTaskId: "tripo_cancel_2",
        providerKey: "k",
        userAddress: SESSION_ADDRESS,
      });
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "not found",
      });
      try {
        const res = await request(app)
          .delete(`/api/v1/generations/${taskId}`)
          .set("Authorization", await makeSessionHeader());
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          status: "cancelled",
          upstreamCancelled: false,
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("404s for an unknown task", async () => {
      const res = await request(app)
        .delete("/api/v1/generations/does-not-exist")
        .set("Authorization", await makeSessionHeader());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("GENERATION_TASK_NOT_FOUND");
    });

    it("404s for a task owned by another wallet", async () => {
      const taskId = registerTask({
        tripoTaskId: "tripo_cancel_3",
        providerKey: "k",
        userAddress: "0x9999999999999999999999999999999999999999",
      });
      const res = await request(app)
        .delete(`/api/v1/generations/${taskId}`)
        .set("Authorization", await makeSessionHeader());
      expect(res.status).toBe(404);
    });

    it("rejects without a session (401)", async () => {
      const res = await request(app).delete("/api/v1/generations/whatever");
      expect(res.status).toBe(401);
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
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ["tokenId"] })]),
      );
    });

    it("returns 400 when assetId is missing", async () => {
      const res = await request(app)
        .post("/api/v1/assets/snapshot-comments")
        .set("Authorization", await makeSessionHeader())
        .send({ tokenId: "42", chainId: 31415822 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ["assetId"] })]),
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

  describe("POST /api/v1/ipfs/upload-urls", () => {
    beforeEach(() => _resetRateLimiters());

    it("rejects without a session (401)", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/upload-urls")
        .send({ count: 3 });
      expect(res.status).toBe(401);
    });

    it("returns `count` credentials for an authed session", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/upload-urls")
        .set("Authorization", await makeSessionHeader())
        .send({ count: 3 });
      expect(res.status).toBe(200);
      expect(res.body.credentials).toHaveLength(3);
      for (const cred of res.body.credentials) {
        expect(cred.backend).toBe("kubo");
        expect(cred).toHaveProperty("apiUrl");
      }
      expect(JSON.stringify(res.body)).not.toMatch(/PINATA_JWT|Bearer/i);
    });

    it("defaults count to 1 when omitted", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/upload-urls")
        .set("Authorization", await makeSessionHeader())
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.credentials).toHaveLength(1);
    });

    it("rejects count above the cap (400)", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/upload-urls")
        .set("Authorization", await makeSessionHeader())
        .send({ count: 201 });
      expect(res.status).toBe(400);
    });

    it("rejects count below 1 (400)", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/upload-urls")
        .set("Authorization", await makeSessionHeader())
        .send({ count: 0 });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/ipfs/unpin via storage", () => {
    // Default session wallet used by makeSessionHeader().
    const SESSION_WALLET = "0x1234567890123456789012345678901234567890";

    beforeEach(() => globalThis.__clearGCTokens?.());

    it("rejects without a session (401)", async () => {
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "n", source: { cid: "bafySource" } }] },
      });

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .send({ cid: startCid, tokenId: "1" });
      expect(res.status).toBe(401);
    });

    it("rejects when tokenId is missing (400)", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: "bafyWhatever" });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a non-decimal tokenId (400)", async () => {
      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: "bafyWhatever", tokenId: "abc" });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });

    it("rejects when the session wallet is not owner/editor (403)", async () => {
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      globalThis.__registerGCToken(
        "1",
        startCid,
        "0x0000000000000000000000000000000000000002",
      );

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid, tokenId: "1" });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("FORBIDDEN");
    });

    it("rejects when the CID does not belong to the claimed token (400)", async () => {
      // The session wallet owns token 1, but bafyVictimManifest is not the
      // tokenURI CID nor an asset in its collection.
      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { a1: "bafySomeoneElsesAsset" },
      });
      globalThis.__registerGCToken("1", collectionCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: "bafyVictimManifest", tokenId: "1" });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("CID_NOT_IN_TOKEN");
    });

    it("allows an editor with a valid Merkle proof", async () => {
      const { SimpleMerkleTree } = await import("@openzeppelin/merkle-tree");
      const { makeLeaf } = await import("../src/api/merkle-editors-node.js");

      const tokenId = "7";
      const setVersion = "1";
      const leaves = [
        makeLeaf(SESSION_WALLET, 2, tokenId, setVersion),
        makeLeaf("0x0000000000000000000000000000000000000002", 2, tokenId, setVersion),
      ];
      const tree = SimpleMerkleTree.of(leaves);
      const proof = tree.getProof(leaves[0]);

      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      // Owned by someone else; session wallet is only an editor.
      globalThis.__registerGCToken(
        tokenId,
        startCid,
        "0x0000000000000000000000000000000000000003",
        "",
        { editorRoot: tree.root, editorSetVersion: setVersion },
      );

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid, tokenId, proof });
      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(startCid);
    });

    it("accepts an asset CID from a previous collection version (delete-asset flow)", async () => {
      // The orphaned asset manifest sits one step back in the collection's
      // prev_asset_manifest_cid chain.
      const orphanedAssetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      const oldCollectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { a1: orphanedAssetCid },
      });
      const newCollectionCid = saveManifestToStorage({
        version: 2,
        type: "collection",
        prev_asset_manifest_cid: oldCollectionCid,
        assets: {},
      });
      globalThis.__registerGCToken("1", newCollectionCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: orphanedAssetCid, tokenId: "1" });
      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(orphanedAssetCid);
    });

    it("rejects a contractAddress that is not configured for the chain (400)", async () => {
      // Guards against pointing the ownership/membership checks at an
      // attacker-deployed contract that spoofs ownerOf()/tokenURI().
      const { CHAIN_IDS } = await import("../constants/chains.js");
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      globalThis.__registerGCToken("1", startCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({
          cid: startCid,
          tokenId: "1",
          chainId: CHAIN_IDS.HARDHAT_LOCAL,
          contractAddress: "0x0000000000000000000000000000000000000bad",
        });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("INVALID_CONTRACT");
    });

    it("accepts an allowlisted contractAddress from the body", async () => {
      const { NETWORK_CONFIGS } = await import("../src/config.js");
      const { CHAIN_IDS } = await import("../constants/chains.js");
      const freeAddr = NETWORK_CONFIGS[CHAIN_IDS.HARDHAT_LOCAL].contractAddress;

      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      globalThis.__registerGCToken("1", startCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({
          cid: startCid,
          tokenId: "1",
          chainId: CHAIN_IDS.HARDHAT_LOCAL,
          contractAddress: freeAddr,
        });
      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(startCid);
    });

    it("falls back to the paid contract when the token only exists there", async () => {
      const { NETWORK_CONFIGS } = await import("../src/config.js");
      const { CHAIN_IDS } = await import("../constants/chains.js");
      const paidAddr =
        NETWORK_CONFIGS[CHAIN_IDS.HARDHAT_LOCAL].paidContractAddress;

      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      // Token lives ONLY on the paid contract: the free-tier candidate misses
      // (ownerOf reverts), the paid candidate matches.
      globalThis.__registerGCToken("9", startCid, SESSION_WALLET, "", {
        contractAddress: paidAddr,
      });

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid, tokenId: "9", chainId: CHAIN_IDS.HARDHAT_LOCAL });
      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(startCid);
    });

    it("403s when the token exists on a configured contract but the caller is not owner/editor", async () => {
      const { CHAIN_IDS } = await import("../constants/chains.js");
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      globalThis.__registerGCToken(
        "1",
        startCid,
        "0x0000000000000000000000000000000000000002",
      );

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid, tokenId: "1", chainId: CHAIN_IDS.HARDHAT_LOCAL });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("FORBIDDEN");
    });

    it("walks the chain and reports unpinned CIDs", async () => {
      const startCid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "n", source: { cid: "bafySource" } }] },
      });
      globalThis.__registerGCToken("1", startCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid, tokenId: "1" });
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
              source: { cid: "bafySource", bundleCid: "bafyBundleRoot" },
            },
          ],
        },
      });
      globalThis.__registerGCToken("1", startCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid, tokenId: "1" });
      expect(res.status).toBe(200);
      // The manifest itself is unpinned, but source CIDs are shared via dedup
      // and must survive the delete so other assets can still reference them.
      expect(res.body.unpinned).toContain(startCid);
      expect(res.body.unpinned).not.toContain("bafySource");
      expect(res.body.unpinned).not.toContain("bafyBundleRoot");
      expect(res.body.skipped).toContain("bafySource");
      expect(res.body.skipped).toContain("bafyBundleRoot");
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
          scene: { nodes: [{ node_id: "n", source: { cid: "bafySource" } }] },
        },
        { compress: true },
      );
      // Source asset must exist and be readable JSON for the ref-walker.
      ipfsStorage.set("bafySource", '{"buffers":[{"uri":"ipfs://bafyBuffer"}]}');
      globalThis.__registerGCToken("1", startCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: startCid, tokenId: "1" });
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      // Manifest chain CIDs are asset-unique and get unpinned.
      expect(res.body.unpinned).toContain(startCid);
      expect(res.body.unpinned).toContain(prevCid);
      // Source glTF and its embedded buffer/image are shared via dedup and
      // must be left pinned so other assets keep working.
      expect(res.body.unpinned).not.toContain("bafySource");
      expect(res.body.unpinned).not.toContain("bafyBuffer");
      expect(res.body.skipped).toContain("bafySource");
      // Embedded buffer/image CIDs are not even inspected in conservative mode;
      // they are left pinned and reclaimed later by the reachability GC.
    });

    it("does not unpin a shared buffer CID referenced by another asset", async () => {
      // cowboy1 and cowboy2 share the same mesh/texture CID.
      ipfsStorage.set(
        "bafySharedMesh",
        '{"buffers":[{"uri":"ipfs://bafySharedBuffer"}]}',
      );

      const cowboy1Cid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "bafySharedMesh" } }] },
      });

      const cowboy2Cid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "bafySharedMesh" } }] },
      });
      globalThis.__registerGCToken("1", cowboy2Cid, SESSION_WALLET);

      // Deleting cowboy2 must not unpin the shared mesh or its buffer.
      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: cowboy2Cid, tokenId: "1" });
      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(cowboy2Cid);
      expect(res.body.unpinned).not.toContain("bafySharedMesh");
      expect(res.body.unpinned).not.toContain("bafySharedBuffer");
      expect(res.body.skipped).toContain("bafySharedMesh");
      // cowboy1's manifest is untouched.
      expect(res.body.unpinned).not.toContain(cowboy1Cid);
    });

    it("unpins a collection manifest but skips its asset CIDs", async () => {
      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { a1: assetCid },
      });
      globalThis.__registerGCToken("1", collectionCid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid: collectionCid, tokenId: "1" });

      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(collectionCid);
      expect(res.body.unpinned).not.toContain(assetCid);
      expect(res.body.skipped).toContain(assetCid);
    });

    it("unpins thumbnail and comments archive as assetUnique", async () => {
      const cid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        thumbnail: { cid: "bafyThumb" },
        comments_archive_cid: "bafyComments",
        scene: { nodes: [] },
      });
      globalThis.__registerGCToken("1", cid, SESSION_WALLET);

      const res = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", await makeSessionHeader())
        .send({ cid, tokenId: "1" });

      expect(res.status).toBe(200);
      expect(res.body.unpinned).toContain(cid);
      expect(res.body.unpinned).toContain("bafyThumb");
      expect(res.body.unpinned).toContain("bafyComments");
    });

    it("rate-limits unpin requests per wallet", async () => {
      process.env.UNPIN_RATE_LIMIT_MAX = "1";
      _resetRateLimiters();
      const cid = saveManifestToStorage({
        version: 1,
        prev_asset_manifest_cid: null,
        scene: {},
      });
      globalThis.__registerGCToken("1", cid, SESSION_WALLET);
      const auth = await makeSessionHeader();

      const res1 = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", auth)
        .send({ cid, tokenId: "1" });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/v1/ipfs/unpin")
        .set("Authorization", auth)
        .send({ cid, tokenId: "1" });
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
        "bafySharedMesh",
        '{"buffers":[{"uri":"ipfs://bafySharedBuffer"}]}',
      );

      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "bafySharedMesh" } }] },
      });

      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { cowboy: assetCid },
      });

      // Orphan: pinned but not referenced by any live token.
      ipfsStorage.set("bafyOrphan", "orphan data");

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
        "bafySharedMesh",
        '{"buffers":[{"uri":"ipfs://bafySharedBuffer"}]}',
      );
      ipfsStorage.set("bafySharedBuffer", "buffer bytes");

      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "bafySharedMesh" } }] },
      });

      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { cowboy: assetCid },
      });

      ipfsStorage.set("bafyOrphan", "orphan data");

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
      expect(ipfsStorage.has("bafySharedMesh")).toBe(true);
      expect(ipfsStorage.has("bafySharedBuffer")).toBe(true);
    });

    it("keeps shared source CID pinned while token lives and unpin it after burn", async () => {
      ipfsStorage.set(
        "bafySharedMesh",
        '{"buffers":[{"uri":"ipfs://bafySharedBuffer"}]}',
      );

      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [{ node_id: "cowboy", source: { cid: "bafySharedMesh" } }] },
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

    it("respects maxUnpin in live GC runs", async () => {
      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { a1: assetCid },
      });

      ipfsStorage.set("bafyOrphan1", "orphan 1");
      ipfsStorage.set("bafyOrphan2", "orphan 2");
      ipfsStorage.set("bafyOrphan3", "orphan 3");

      globalThis.__registerGCToken("1", collectionCid);

      const res = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", await makeSessionHeader())
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: false, maxUnpin: 2 });

      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(false);
      expect(res.body.orphans).toBeGreaterThanOrEqual(3);
      expect(res.body.unpinned).toBe(2);
    });

    it("keeps editorListURI CID reachable even when not in manifest chain", async () => {
      const assetCid = saveManifestToStorage({
        version: 1,
        type: "asset",
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      });
      const collectionCid = saveManifestToStorage({
        version: 1,
        type: "collection",
        prev_asset_manifest_cid: null,
        assets: { a1: assetCid },
      });

      // The editor list CID is not referenced by the manifest chain.
      ipfsStorage.set("bafyEditors", '{"editors":["0xEditor"]}');

      globalThis.__registerGCToken(
        "1",
        collectionCid,
        "0xOwner",
        "ipfs://bafyEditors",
      );

      const res = await request(app)
        .post("/api/v1/ipfs/gc")
        .set("Authorization", await makeSessionHeader())
        .set("X-Admin-Token", "test-admin-token")
        .send({ dryRun: false });

      expect(res.status).toBe(200);
      // bafyEditors is protected by the on-chain editorListURI, so it must not
      // have been unpinned (mock storage still contains it).
      expect(ipfsStorage.has("bafyEditors")).toBe(true);
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
                cid: "bafySomeCid",
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

    it("reports cdpProjectId (not thirdwebClientId)", async () => {
      const res = await request(app).get("/api/v1/config");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("cdpProjectId");
      expect(res.body).not.toHaveProperty("thirdwebClientId");
    });
  });
});
