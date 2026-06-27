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

  await jest.unstable_mockModule("../../frontend/src/js/events/bus.js", () => ({
    on: jest.fn(),
    EVENTS: { WALLET_DISCONNECTED: "wallet:disconnected" },
  }));

  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
    web3: {
      eth: {
        getChainId: jest.fn().mockResolvedValue(_chainIdResult),
        personal: { sign: jest.fn().mockResolvedValue(_signResult) },
      },
    },
  }));

  await jest.unstable_mockModule("../../frontend/src/js/state/wallet-state.js", () => ({
    walletState: {
      get: jest.fn(() => ({ walletAddress: _walletAddress, chainId: _chainId })),
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
    writeToIPFS: jest.fn().mockResolvedValue("QmSourceAsset"),
    writeJSONToIPFS: jest.fn().mockResolvedValue("QmAssetManifest"),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    getFromRemoteIPFS: jest.fn().mockResolvedValue({}),
  }));

  await jest.unstable_mockModule("../../frontend/src/js/utils/log.js", () => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/services/api.js");
  return { ...mod, fetchMock };
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
    expect(body.message).toContain(TEST_ADDRESS);
    expect(body.signature).toBe("0xsignature");

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
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ body: { cid: "QmComments", eventCount: 3 } }));
    const { snapshotCommentsArchive } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const ctx = { tokenId: 1, chainId: 1337, contractAddress: "0xC", assetId: "asset-1" };
    const result = await snapshotCommentsArchive(ctx);

    expect(result).toEqual({ cid: "QmComments", eventCount: 3 });
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
      .mockResolvedValueOnce(buildResponse({ body: { cid: "QmComments2", eventCount: 1 } }));
    const { snapshotCommentsArchive } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await snapshotCommentsArchive({ tokenId: 2, assetId: "asset-2" });
    expect(result.cid).toBe("QmComments2");
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
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ body: { backend: "kubo" } }));
    const { getUploadCredential } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const cred = await getUploadCredential();
    expect(cred).toEqual({ backend: "kubo" });
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
      .mockResolvedValueOnce(buildResponse({ body: { backend: "pinata" } }));
    const { getUploadCredential } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const cred = await getUploadCredential();
    expect(cred.backend).toBe("pinata");
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

describe("unpinAssetCids", () => {
  test("sends the correct headers and body", async () => {
    const fetchMock = jest.fn().mockResolvedValue(buildResponse({ body: { unpinned: ["QmA"], count: 1 } }));
    const { unpinAssetCids } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await unpinAssetCids("QmManifest", TEST_ADDRESS);
    expect(result).toEqual({ unpinned: ["QmA"], count: 1 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/ipfs\/unpin$/);
    expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
    expect(JSON.parse(opts.body)).toEqual({ cid: "QmManifest", actorAddress: TEST_ADDRESS });
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
      .mockResolvedValueOnce(buildResponse({ body: { unpinned: ["QmB"], count: 1 } }));
    const { unpinAssetCids } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await unpinAssetCids("QmManifest");
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

    await expect(unpinAssetCids("QmManifest")).rejects.toBeInstanceOf(ApiError);
    await expect(unpinAssetCids("QmManifest")).rejects.toMatchObject({
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

    expect(result.assetManifestCid).toBe("QmAssetManifest");
    expect(result.sourceAssetCid).toBe("QmSourceAsset");
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
    expect(result.assetManifestCid).toBe("QmAssetManifest");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [, , [url, opts]] = fetchMock.mock.calls;
    expect(url).toMatch(/\/generations$/);
    expect(opts.headers.Authorization).toBe("Session fresh-token");
  });
});
