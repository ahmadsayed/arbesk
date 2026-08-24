/** @jest-environment jsdom */
import { jest } from "@jest/globals";

const TEST_ADDRESS = "0xTestAddress000000000000000000000000000000";
const TEST_TOKEN = "test-token-abc";

let _walletAddress = TEST_ADDRESS;
let _chainId = 1;
let _chainIdResult = 1;
let _signResult = "0xsignature";
let _networkAddress = "0xNetworkContractAddress00000000000000000000";

function makeSession(token, expiresAt, address) {
  return JSON.stringify({ token, expiresAt, address: address.toLowerCase() });
}

function buildResponse(overrides) {
  return {
    ok: overrides.status ? overrides.status >= 200 && overrides.status < 300 : true,
    status: overrides.status ?? 200,
    json: async () => overrides.body ?? {},
  };
}

async function loadApi(options = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  localStorage.clear();

  _walletAddress = options.walletAddress !== undefined ? options.walletAddress : TEST_ADDRESS;
  _chainId = options.chainId !== undefined ? options.chainId : 1;
  _chainIdResult = options.chainIdResult !== undefined ? options.chainIdResult : 1;
  _signResult = options.signResult !== undefined ? options.signResult : "0xsignature";
  _networkAddress = options.networkAddress !== undefined ? options.networkAddress : "0xNetworkContractAddress00000000000000000000";

  const fetchMock = options.fetchMock || jest.fn();
  global.fetch = fetchMock;

  await jest.unstable_mockModule("../../frontend/src/js/asset-core/events/bus.js", () => ({
    on: jest.fn(),
    EVENTS: { WALLET_DISCONNECTED: "wallet:disconnected" },
  }));

  // Shared jest.fn so both the legacy web3.eth.personal.sign path and the new
  // Signer.signMessage path honor mockResolvedValue/mockRejectedValueOnce.
  const personalSign = jest.fn().mockResolvedValue(_signResult);

  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
    web3: {
      eth: {
        getChainId: jest.fn().mockResolvedValue(_chainIdResult),
        personal: { sign: personalSign },
      },
    },
    getSigner: jest.fn(() => ({
      signMessage: personalSign,
      getSignerAddress: jest.fn(() => options.eoaAddress || _walletAddress),
    })),
    getActiveConnectionSource: jest.fn(() => options.connectionSource || "injected"),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/state/wallet-state.js", () => ({
    walletState: {
      get: jest.fn(() => ({
        walletAddress: _walletAddress,
        chainId: _chainId,
        eoaAddress: options.eoaAddress || null,
      })),
    },
    _resetForTesting: jest.fn(),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/blockchain/network-config.js", () => ({
    getContractAddress: jest.fn((chainId) =>
      Number(chainId) === Number(_chainIdResult) ? _networkAddress : null
    ),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/blockchain/siwe.js", () => ({
    buildSiweMessage: jest.fn(
      (domain, address, nonce, chainId) =>
        `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Arbesk Studio\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: 2024-01-01T00:00:00.000Z`
    ),
    generateNonce: jest.fn(() => "nonce1234567890abcdef"),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/ipfs/write-to-ipfs.js", () => ({
    writeToIPFS: jest.fn().mockResolvedValue("bafySourceAsset"),
    writeJSONToIPFS: jest.fn().mockResolvedValue("bafyAssetManifest"),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    getFromRemoteIPFS: jest.fn().mockResolvedValue({}),
    getArrayBufferFromRemoteIPFS: jest.fn().mockRejectedValue(new Error("unmocked")),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/utils/log.js", () => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/services/api.js");

  // Screen-reader status announcements write to #srStatus via rAF.
  // Make rAF synchronous and expose the element so tests can inspect messages.
  const statusEl = { textContent: "" };
  document.getElementById = jest.fn((id) => (id === "srStatus" ? statusEl : null));
  global.requestAnimationFrame = jest.fn((cb) => cb());

  return { ...mod, fetchMock, statusEl };
}

describe("getCachedSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("returns a valid session", async () => {
    const { getCachedSession } = await loadApi();
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );
    const session = getCachedSession();
    expect(session).toEqual(
      expect.objectContaining({
        token: TEST_TOKEN,
        address: TEST_ADDRESS.toLowerCase(),
      })
    );
  });

  test("rejects a malformed session", async () => {
    const { getCachedSession } = await loadApi();
    localStorage.setItem("arbesk_session", JSON.stringify({ token: TEST_TOKEN }));
    expect(getCachedSession()).toBeNull();
  });

  test("rejects an expired session and clears it", async () => {
    const { getCachedSession } = await loadApi();
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() - 120_000, TEST_ADDRESS)
    );
    expect(getCachedSession()).toBeNull();
    expect(localStorage.getItem("arbesk_session")).toBeNull();
  });
});

describe("clearSession", () => {
  test("removes the session key", async () => {
    const { clearSession } = await loadApi();
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );
    clearSession();
    expect(localStorage.getItem("arbesk_session")).toBeNull();
  });
});

describe("createSession", () => {
  test("builds a SIWE message, signs it, POSTs to /api/v1/sessions, and caches the result", async () => {
    const freshToken = "fresh-token";
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        buildResponse({ body: { token: freshToken, expiresAt: Date.now() + 3_600_000 } })
      );
    const { createSession } = await loadApi({ fetchMock });

    await createSession();

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/sessions$/);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.proof.kind).toBe("siwe");
    expect(body.proof.message).toContain(TEST_ADDRESS);
    expect(body.proof.signature).toBe("0xsignature");

    const cached = JSON.parse(localStorage.getItem("arbesk_session"));
    expect(cached.token).toBe(freshToken);
  });

  test("throws ApiError when wallet is not connected", async () => {
    const { createSession, ApiError } = await loadApi({ walletAddress: null });
    await expect(createSession()).rejects.toBeInstanceOf(ApiError);
    await expect(createSession()).rejects.toMatchObject({
      status: 401,
      code: "WALLET_NOT_CONNECTED",
    });
  });

  test("throws ApiError when sign is rejected", async () => {
    const { createSession, ApiError } = await loadApi();
    const { web3 } = await import("../../frontend/src/js/blockchain/wallet.js");
    web3.eth.personal.sign.mockRejectedValueOnce(new Error("User denied"));

    const err = await createSession().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 401,
      code: "SIGN_FAILED",
    });
  });

  test("throws ApiError on non-OK response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      buildResponse({
        status: 400,
        body: { error: { message: "Bad request", code: "BAD_REQUEST" } },
      })
    );
    const { createSession, ApiError } = await loadApi({ fetchMock });

    await expect(createSession()).rejects.toBeInstanceOf(ApiError);
    await expect(createSession()).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  test("uses SIWE when connected via CDP", async () => {
    const freshToken = "fresh-token";
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        buildResponse({ body: { token: freshToken, expiresAt: Date.now() + 3_600_000 } })
      );
    const eoaAddress = "0xEOA000000000000000000000000000000000000A";
    const { createSession } = await loadApi({
      fetchMock,
      connectionSource: "cdp",
      eoaAddress,
    });

    await createSession();

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/sessions$/);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    // CDP path still uses SIWE (message + signature), not a JWT
    expect(body.proof.kind).toBe("siwe");
    expect(body.proof.message).toBeDefined();
    expect(body.proof.signature).toBeDefined();
    expect(body.proof.eoaAddress).toBe(eoaAddress);

    const cached = JSON.parse(localStorage.getItem("arbesk_session"));
    expect(cached.token).toBe(freshToken);
  });
});

describe("getOrCreateSession", () => {
  test("reuses a cached token", async () => {
    const fetchMock = jest.fn();
    const { getOrCreateSession } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const token = await getOrCreateSession();
    expect(token).toBe(TEST_TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("creates a new token when none is cached", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      buildResponse({ body: { token: "new-token", expiresAt: Date.now() + 3_600_000 } })
    );
    const { getOrCreateSession } = await loadApi({ fetchMock });

    const token = await getOrCreateSession();
    expect(token).toBe("new-token");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/sessions$/),
      expect.any(Object)
    );
  });

  test("shares an in-flight session promise", async () => {
    let resolveSession;
    const deferred = new Promise((resolve) => {
      resolveSession = resolve;
    });
    const fetchMock = jest.fn().mockReturnValue(deferred);
    const { getOrCreateSession } = await loadApi({ fetchMock });

    const p1 = getOrCreateSession();
    const p2 = getOrCreateSession();

    resolveSession(
      buildResponse({ body: { token: "shared-token", expiresAt: Date.now() + 3_600_000 } })
    );

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe("shared-token");
    expect(t2).toBe("shared-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getConfig", () => {
  test("memoizes a successful fetch", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(buildResponse({ body: { contractAddress: "0xCfg" } }));
    const { getConfig } = await loadApi({ fetchMock });

    const cfg1 = await getConfig();
    expect(cfg1).toEqual({ contractAddress: "0xCfg" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    const cfg2 = await getConfig();
    expect(cfg2).toEqual({ contractAddress: "0xCfg" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("retries after a failed fetch", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(buildResponse({ body: { contractAddress: "0xRetry" } }));
    const { getConfig } = await loadApi({ fetchMock });

    const cfg1 = await getConfig();
    expect(cfg1).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cfg2 = await getConfig();
    expect(cfg2).toEqual({ contractAddress: "0xRetry" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getContractAddress", () => {
  test("prefers the network-config address", async () => {
    const fetchMock = jest.fn();
    const { getContractAddress } = await loadApi({ fetchMock });

    const addr = await getContractAddress();
    expect(addr).toBe(_networkAddress);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("falls back to the backend config when network-config has no address", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(buildResponse({ body: { contractAddress: "0xBackend" } }));
    const { getContractAddress } = await loadApi({
      fetchMock,
      networkAddress: null,
    });

    const addr = await getContractAddress();
    expect(addr).toBe("0xBackend");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/config$/));
  });
});

describe("getContractArtifact", () => {
  test("fetches the ABI route", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(buildResponse({ body: { abi: [] } }));
    const { getContractArtifact } = await loadApi({ fetchMock });

    const artifact = await getContractArtifact("ArbeskAsset");
    expect(artifact).toEqual({ abi: [] });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/contracts\/ArbeskAsset\/abi$/);
  });
});

describe("snapshotCommentsArchive", () => {
  test("sends the correct headers and body", async () => {
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ body: { cid: "bafyComments", eventCount: 3 } }));
    const { snapshotCommentsArchive } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const ctx = { tokenId: 1, chainId: 1337, contractAddress: "0xC", assetId: "asset-1" };
    const result = await snapshotCommentsArchive(ctx);

    expect(result).toEqual({ cid: "bafyComments", eventCount: 3 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/assets\/snapshot-comments$/);
    expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
    expect(JSON.parse(opts.body)).toEqual(ctx);
  });

  test("retries once on a 401 and then succeeds", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 401,
          body: { error: { code: "INVALID_SESSION", message: "bad token" } },
        })
      )
      .mockResolvedValueOnce(buildResponse({ body: { token: "fresh-token", expiresAt: Date.now() + 3_600_000 } }))
      .mockResolvedValueOnce(buildResponse({ body: { cid: "bafyComments2", eventCount: 1 } }));
    const { snapshotCommentsArchive } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await snapshotCommentsArchive({ tokenId: 2, assetId: "asset-2" });
    expect(result.cid).toBe("bafyComments2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, , [url]] = fetchMock.mock.calls;
    expect(url).toMatch(/\/assets\/snapshot-comments$/);
  });

  test("throws ApiError on non-OK response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      buildResponse({
        status: 403,
        body: { error: { message: "Forbidden", code: "FORBIDDEN" } },
      })
    );
    const { snapshotCommentsArchive, ApiError } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await expect(snapshotCommentsArchive({ tokenId: 3, assetId: "asset-3" })).rejects.toBeInstanceOf(ApiError);
    await expect(snapshotCommentsArchive({ tokenId: 3, assetId: "asset-3" })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});

describe("getUploadCredential", () => {
  test("sends the correct headers and body", async () => {
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ body: { strategy: "kubo-api" } }));
    const { getUploadCredential } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const cred = await getUploadCredential();
    expect(cred).toEqual({ strategy: "kubo-api" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/ipfs\/upload-url$/);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
    expect(opts.body).toBe("{}");
  });

  test("retries once on a 401 and then succeeds", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 401,
          body: { error: { code: "INVALID_SESSION", message: "bad token" } },
        })
      )
      .mockResolvedValueOnce(buildResponse({ body: { token: "fresh-token", expiresAt: Date.now() + 3_600_000 } }))
      .mockResolvedValueOnce(buildResponse({ body: { strategy: "presigned-put" } }));
    const { getUploadCredential } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const cred = await getUploadCredential();
    expect(cred.strategy).toBe("presigned-put");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("throws on non-OK response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ status: 500, body: {} }));
    const { getUploadCredential } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await expect(getUploadCredential()).rejects.toThrow("upload-url failed: HTTP 500");
  });
});

describe("getUploadCredentials", () => {
  test("sends the correct headers and body, returns the credentials array", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      buildResponse({
        body: {
          credentials: [
            { strategy: "presigned-put", url: "https://signed-1" },
            { strategy: "presigned-put", url: "https://signed-2" },
          ],
        },
      })
    );
    const { getUploadCredentials } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const creds = await getUploadCredentials(2);
    expect(creds).toHaveLength(2);
    expect(creds[0].url).toBe("https://signed-1");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/ipfs\/upload-urls$/);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
    expect(JSON.parse(opts.body)).toEqual({ count: 2 });
  });

  test("retries once on a 401 and then succeeds", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 401,
          body: { error: { code: "INVALID_SESSION", message: "bad token" } },
        })
      )
      .mockResolvedValueOnce(buildResponse({ body: { token: "fresh-token", expiresAt: Date.now() + 3_600_000 } }))
      .mockResolvedValueOnce(buildResponse({ body: { credentials: [{ strategy: "presigned-put", url: "https://signed" }] } }));
    const { getUploadCredentials } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const creds = await getUploadCredentials(1);
    expect(creds).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("throws on non-OK response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ status: 500, body: {} }));
    const { getUploadCredentials } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await expect(getUploadCredentials(3)).rejects.toThrow("upload-urls failed: HTTP 500");
  });
});

describe("unpinAssetCids", () => {
  test("sends the correct headers and body with token context", async () => {
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ body: { unpinned: ["bafyA"], count: 1 } }));
    const { unpinAssetCids } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await unpinAssetCids("bafyManifest", {
      tokenId: "42",
      chainId: 31415822,
      contractAddress: "0x1234567890123456789012345678901234567890",
      proof: ["0xProof"],
    });
    expect(result).toEqual({ unpinned: ["bafyA"], count: 1 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/ipfs\/unpin$/);
    expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
    expect(JSON.parse(opts.body)).toEqual({
      cid: "bafyManifest",
      tokenId: "42",
      chainId: 31415822,
      contractAddress: "0x1234567890123456789012345678901234567890",
      proof: ["0xProof"],
    });
  });

  test("omits missing/invalid token context fields from the body", async () => {
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ body: { unpinned: ["bafyA"], count: 1 } }));
    const { unpinAssetCids } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await unpinAssetCids("bafyManifest", { chainId: NaN });
    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ cid: "bafyManifest" });
  });

  test("retries once on a 401 and then succeeds", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 401,
          body: { error: { code: "INVALID_SESSION", message: "bad token" } },
        })
      )
      .mockResolvedValueOnce(buildResponse({ body: { token: "fresh-token", expiresAt: Date.now() + 3_600_000 } }))
      .mockResolvedValueOnce(buildResponse({ body: { unpinned: ["bafyB"], count: 1 } }));
    const { unpinAssetCids } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await unpinAssetCids("bafyManifest");
    expect(result.count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("throws ApiError on non-OK response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      buildResponse({
        status: 403,
        body: { error: { message: "Forbidden", code: "FORBIDDEN" } },
      })
    );
    const { unpinAssetCids, ApiError } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await expect(unpinAssetCids("bafyManifest")).rejects.toBeInstanceOf(ApiError);
    await expect(unpinAssetCids("bafyManifest")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});

describe("generateAsset", () => {
  test("posts to /api/v1/generations with the correct body and headers", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        buildResponse({
          body: {
            assetData: Buffer.from("hello").toString("base64"),
            format: "glb",
            path: "asset.glb",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock, chainId: 1337 });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({
      prompt: "a cube",
      nodeId: "cube-node",
      provider: "mock",
      assetId: "asset-1",
      tier: 2,
    });

    expect(result.assetManifestCid).toBe("bafyAssetManifest");
    expect(result.sourceAssetCid).toBe("bafySourceAsset");
    expect(result.tier).toBe(2);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/generations$/);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
    expect(opts.headers["x-chain-id"]).toBe("1337");
    expect(JSON.parse(opts.body)).toEqual({
      prompt: "a cube",
      nodeId: "cube-node",
      provider: "mock",
      chainId: 1337,
    });
  });

  test("re-authenticates on 401 and retries the generation", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 401,
          body: { error: { code: "INVALID_SESSION", message: "bad token" } },
        })
      )
      .mockResolvedValueOnce(buildResponse({ body: { token: "fresh-token", expiresAt: Date.now() + 3_600_000 } }))
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            assetData: Buffer.from("hello").toString("base64"),
            format: "glb",
            path: "asset.glb",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({ prompt: "a sphere", nodeId: "sphere-node" });
    expect(result.assetManifestCid).toBe("bafyAssetManifest");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [, , [url, opts]] = fetchMock.mock.calls;
    expect(url).toMatch(/\/generations$/);
    expect(opts.headers.Authorization).toBe("Session fresh-token");
  });

  test("polls a Tripo3D task until success and returns a glb result", async () => {
    const taskId = "task-abc-123";
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId, provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({ body: { status: "running", progress: 25 } })
      )
      .mockResolvedValueOnce(
        buildResponse({ body: { status: "running", progress: 75 } })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset, statusEl } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({
      prompt: "a robot",
      nodeId: "robot-node",
      provider: "tripo3d",
      providerKey: "tripo-key",
    });

    expect(result.format).toBe("glb");
    expect(result.assetManifestCid).toBe("bafyAssetManifest");
    expect(result.sourceAssetCid).toBe("bafySourceAsset");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [postUrl, postOpts] = fetchMock.mock.calls[0];
    expect(postUrl).toMatch(/\/generations$/);
    expect(postOpts.method).toBe("POST");
    expect(JSON.parse(postOpts.body)).toEqual({
      prompt: "a robot",
      nodeId: "robot-node",
      provider: "tripo3d",
      providerKey: "tripo-key",
      chainId: 1,
    });

    for (let i = 1; i <= 3; i++) {
      const [url, opts] = fetchMock.mock.calls[i];
      expect(url).toMatch(/\/generations\/task-abc-123$/);
      expect(opts.method).toBe("GET");
      expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
    }

    // Last progress update before success + final success announcement.
    expect(statusEl.textContent).toBe("Asset generated successfully.");
  }, 15_000);

  test("aborts polling with GENERATION_CANCELLED when the signal is aborted", async () => {
    const taskId = "task-cancel-1";
    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildResponse({
        status: 202,
        body: { taskId, provider: "tripo3d", status: "running" },
      })
    );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const controller = new AbortController();
    await expect(
      generateAsset({
        prompt: "a robot",
        nodeId: "robot-node",
        provider: "tripo3d",
        providerKey: "tripo-key",
        signal: controller.signal,
        onTaskId: () => controller.abort(),
      })
    ).rejects.toMatchObject({ code: "GENERATION_CANCELLED" });

    // Only the POST happened — the poll loop exited before any GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("cancelGenerationTask issues DELETE and surfaces upstreamCancelled", async () => {
    const taskId = "task-cancel-2";
    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildResponse({ body: { status: "cancelled", upstreamCancelled: true } })
    );
    const { cancelGenerationTask } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await cancelGenerationTask(taskId);
    expect(result).toEqual({ status: "cancelled", upstreamCancelled: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/generations/${taskId}$`));
    expect(opts.method).toBe("DELETE");
  });

  test("returns providerTaskId from the Tripo3D poll success payload", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-abc-123", provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
            providerTaskId: "tripo-task-xyz",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({
      prompt: "a robot",
      nodeId: "robot-node",
      provider: "tripo3d",
      providerKey: "tripo-key",
    });

    // Registry taskId unchanged (refine chain depends on it); providerTaskId is new.
    expect(result.taskId).toBe("task-abc-123");
    expect(result.providerTaskId).toBe("tripo-task-xyz");
  }, 15_000);

  test("throws ApiError when a Tripo3D task fails", async () => {
    const taskId = "task-fail-456";
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId, provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "failed",
            error: { code: "PROVIDER_TASK_FAILED", message: "Tripo task failed" },
          },
        })
      );
    const { generateAsset, ApiError } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const err = await generateAsset({
      prompt: "a robot",
      nodeId: "robot-node",
      provider: "tripo3d",
      providerKey: "tripo-key",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 500,
      code: "PROVIDER_TASK_FAILED",
      message: "Tripo task failed",
    });
  });

  test("passes sourceAssetCid/retexture/textureQuality to the backend and returns taskId", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-refine-2", provider: "tripo3d", status: "running", refined: true },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({
      prompt: "make it blue",
      nodeId: "n2",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      sourceTaskId: "task-gen-1",
      retexture: true,
      textureQuality: "detailed",
    });

    expect(result.taskId).toBe("task-refine-2");
    const [, postOpts] = fetchMock.mock.calls[0];
    const body = JSON.parse(postOpts.body);
    expect(body).toEqual({
      prompt: "make it blue",
      nodeId: "n2",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      sourceTaskId: "task-gen-1",
      retexture: true,
      textureQuality: "detailed",
      chainId: 1,
    });
    expect(body.refineTaskId).toBeUndefined();
    expect(body.highQuality).toBeUndefined();
  }, 15_000);

  test("passes imageData/imageMime to the backend for image-to-3D", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-img-1", provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const imageData = Buffer.from("png-bytes").toString("base64");
    const result = await generateAsset({
      prompt: "Image: chair.png",
      nodeId: "n-img",
      provider: "tripo3d",
      providerKey: "tripo-key",
      imageData,
      imageMime: "image/png",
      imageName: "chair.png",
    });

    expect(result.taskId).toBe("task-img-1");
    const [, postOpts] = fetchMock.mock.calls[0];
    expect(JSON.parse(postOpts.body)).toEqual({
      prompt: "Image: chair.png",
      nodeId: "n-img",
      provider: "tripo3d",
      providerKey: "tripo-key",
      imageData,
      imageMime: "image/png",
      chainId: 1,
    });

    // The reference image is uploaded to IPFS alongside the model and
    // recorded in the manifest node.
    const { writeToIPFS, writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    expect(writeToIPFS).toHaveBeenCalledTimes(2);
    expect(writeToIPFS.mock.calls[1][1]).toBe("chair.png");
    const manifest = writeJSONToIPFS.mock.calls[0][0];
    expect(manifest.scene.nodes[0].reference_image).toEqual({
      cid: "bafySourceAsset",
      mime: "image/png",
      name: "chair.png",
    });
  }, 15_000);

  test("passes sourceAssetCid/animate/animations to the backend for rig & animate", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-anim-1", provider: "tripo3d", status: "running", animating: true },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({
      prompt: "Animate: idle, walk",
      nodeId: "n-anim",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      animate: true,
      animations: ["preset:idle", "preset:walk"],
    });

    expect(result.taskId).toBe("task-anim-1");
    const [, postOpts] = fetchMock.mock.calls[0];
    const body = JSON.parse(postOpts.body);
    expect(body).toEqual({
      prompt: "Animate: idle, walk",
      nodeId: "n-anim",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      animate: true,
      animations: ["preset:idle", "preset:walk"],
      chainId: 1,
    });
    expect(body.animateTaskId).toBeUndefined();
  }, 15_000);

  test("passes rigOnly to the backend", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-rig-1", provider: "tripo3d", status: "running", animating: true },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await generateAsset({
      prompt: "Rig only",
      nodeId: "n-rig",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      animate: true,
      rigOnly: true,
    });

    const [, postOpts] = fetchMock.mock.calls[0];
    expect(JSON.parse(postOpts.body)).toEqual({
      prompt: "Rig only",
      nodeId: "n-rig",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      animate: true,
      rigOnly: true,
      chainId: 1,
    });
  }, 15_000);

  test("passes sourceAssetCid/retopo/faceLimit to the backend for smart retopology", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-retopo-1", provider: "tripo3d", status: "running", retopo: true },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({
      prompt: "Retopo for animation",
      nodeId: "n-retopo",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      retopo: true,
      faceLimit: 5000,
    });

    expect(result.taskId).toBe("task-retopo-1");
    const [, postOpts] = fetchMock.mock.calls[0];
    const body = JSON.parse(postOpts.body);
    expect(body).toEqual({
      prompt: "Retopo for animation",
      nodeId: "n-retopo",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      retopo: true,
      faceLimit: 5000,
      chainId: 1,
    });
    expect(body.retopoTaskId).toBeUndefined();
  }, 15_000);

  test("passes textureQuality to the backend", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-hq-1", provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await generateAsset({
      prompt: "A detailed statue",
      nodeId: "n-hq",
      provider: "tripo3d",
      providerKey: "tripo-key",
      textureQuality: "detailed",
    });

    const [, postOpts] = fetchMock.mock.calls[0];
    const body = JSON.parse(postOpts.body);
    expect(body).toMatchObject({ textureQuality: "detailed" });
    expect(body.highQuality).toBeUndefined();
  }, 15_000);

  test("compensates provider re-normalization on follow-ups via post_processor scale", async () => {
    const buildGlb = (size) => {
      const gltf = {
        asset: { version: "2.0" },
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ type: "VEC3", min: [-size / 2, -size / 2, -size / 2], max: [size / 2, size / 2, size / 2] }],
      };
      const json = new TextEncoder().encode(JSON.stringify(gltf));
      const pad = (4 - (json.length % 4)) % 4;
      const jsonChunk = new Uint8Array(json.length + pad);
      jsonChunk.set(json);
      jsonChunk.fill(0x20, json.length);
      const total = 12 + 8 + jsonChunk.length;
      const buf = new ArrayBuffer(total);
      const view = new DataView(buf);
      view.setUint32(0, 0x46546c67, true);
      view.setUint32(4, 2, true);
      view.setUint32(8, total, true);
      view.setUint32(12, jsonChunk.length, true);
      view.setUint32(16, 0x4e4f534a, true);
      new Uint8Array(buf, 20).set(jsonChunk);
      return buf;
    };
    // Tripo rig/retarget re-normalize: source is 2 units tall, result 0.5.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-anim-1", provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from(buildGlb(0.5)).toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    const remote = await import("../../frontend/src/js/ipfs/remote-ipfs.js");
    remote.getArrayBufferFromRemoteIPFS.mockResolvedValue(buildGlb(2));
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await generateAsset({
      prompt: "Animate: idle",
      nodeId: "n-anim",
      provider: "tripo3d",
      providerKey: "tripo-key",
      sourceAssetCid: "bafySource",
      animate: true,
      animations: ["preset:idle"],
    });

    const manifest = writeJSONToIPFS.mock.calls[0][0];
    expect(manifest.scene.nodes[0].post_processor.scale).toEqual({ x: 4, y: 4, z: 4 });
  }, 15_000);

  test("fresh generations keep the default post_processor scale", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-fresh-1", provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await generateAsset({
      prompt: "A fresh model",
      nodeId: "n-fresh",
      provider: "tripo3d",
      providerKey: "tripo-key",
    });

    const manifest = writeJSONToIPFS.mock.calls[0][0];
    expect(manifest.scene.nodes[0].post_processor.scale).toEqual({ x: 1, y: 1, z: 1 });
  }, 15_000);

  test("propagates provider errors without retrying", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildResponse({
        status: 400,
        body: {
          error: {
            code: "SOURCE_ASSET_UNAVAILABLE",
            message: "Source asset unavailable in IPFS",
          },
        },
      })
    );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    await expect(
      generateAsset({
        prompt: "rusty",
        nodeId: "n1",
        provider: "tripo3d",
        providerKey: "bad",
        sourceAssetCid: "bafySource",
        retexture: true,
      })
    ).rejects.toMatchObject({ status: 400, code: "SOURCE_ASSET_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 15_000);
});

describe("getProviderBalance", () => {
  test("posts the key and returns the balance", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildResponse({ body: { balance: 630, frozen: 0 } })
    );
    const { getProviderBalance } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await getProviderBalance("tripo-key");

    expect(result).toEqual({ balance: 630, frozen: 0 });
    const [url, postOpts] = fetchMock.mock.calls[0];
    expect(url).toContain("/generations/balance");
    expect(JSON.parse(postOpts.body)).toEqual({ providerKey: "tripo-key" });
  });

  test("throws ApiError on provider failure", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildResponse({
        status: 402,
        ok: false,
        body: {
          error: { code: "PROVIDER_CREDITS_EXHAUSTED", message: "No credit" },
        },
      })
    );
    const { getProviderBalance, ApiError } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const err = await getProviderBalance("bad-key").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 402, code: "PROVIDER_CREDITS_EXHAUSTED" });
  });
});
