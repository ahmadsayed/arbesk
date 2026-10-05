// @test-env dom

import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
const TEST_ADDRESS = "0xTestAddress000000000000000000000000000000";
const TEST_TOKEN = "test-token-abc";

const calls = { renders: [] };

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
  resetModules();
  jest.clearAllMocks();
  localStorage.clear();
  calls.renders.length = 0;

  const fetchMock = options.fetchMock || jest.fn();
  global.fetch = fetchMock;

  await mock.module("@arbesk/asset-core/events/bus.js", () => ({
    on: jest.fn(),
    EVENTS: { WALLET_DISCONNECTED: "wallet:disconnected" },
  }));

  const personalSign = jest.fn().mockResolvedValue("0xsignature");

  await mock.module("../../frontend/src/js/blockchain/wallet.js", () => ({
    getReadClient: jest.fn(() => ({
      getChainId: jest.fn().mockResolvedValue(1),
    })),
    getSigner: jest.fn(() => ({
      signMessage: personalSign,
      getSignerAddress: jest.fn(() => TEST_ADDRESS),
    })),
    getActiveConnectionSource: jest.fn(() => "injected"),
  }));

  await mock.module("../../frontend/src/js/state/wallet-state.js", () => ({
    walletState: {
      get: jest.fn(() => ({
        walletAddress: TEST_ADDRESS,
        chainId: 1,
        eoaAddress: null,
      })),
    },
    _resetForTesting: jest.fn(),
  }));

  await mock.module("../../frontend/src/js/blockchain/network-config.js", () => ({
    getContractAddress: jest.fn(() => "0xNetworkContractAddress00000000000000000000"),
    getRpcUrl: jest.fn(() => "http://127.0.0.1:8545"),
  }));

  // backend-client.ts (the wallet-free leaf api.ts delegates to) reads the
  // chain id via viem-clients directly — mock it here so getContractAddress
  // never hits a real RPC endpoint.
  await mock.module("../../frontend/src/js/blockchain/viem-clients.js", () => ({
    getReadClient: jest.fn(() => ({
      getChainId: jest.fn().mockResolvedValue(1),
    })),
  }));

  await mock.module("@arbesk/wallet/siwe.js", () => ({
    buildSiweMessage: jest.fn(
      (domain, address, nonce, chainId) =>
        `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Arbesk Studio\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: 2024-01-01T00:00:00.000Z`
    ),
    generateNonce: jest.fn(() => "nonce1234567890abcdef"),
  }));

  // The CAD render worker is the sandbox boundary; stub it so no real Worker
  // is spawned and the render result is deterministic.
  class CadRenderError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const renderCadDesignInWorker = jest.fn(async (design, runtime) => {
    calls.renders.push({ design, runtime });
    return { bytes: new Uint8Array([3, 77, 70]), summary: "A box", stats: { tris: 12 } };
  });
  await mock.module("../../frontend/src/js/services/cad-render.js", () => ({
    CadRenderError,
    renderCadDesignInWorker,
  }));

  await mock.module("../../frontend/src/js/ipfs/write-to-ipfs.js", () => ({
    writeToIPFS: jest.fn().mockResolvedValue("bafySourceAsset"),
    writeJSONToIPFS: jest.fn().mockResolvedValue("bafyAssetManifest"),
  }));

  await mock.module("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    getFromRemoteIPFS: jest.fn().mockRejectedValue(new Error("no prev")),
    getArrayBufferFromRemoteIPFS: jest.fn().mockRejectedValue(new Error("unmocked")),
  }));

  await mock.module("../../frontend/src/js/utils/log.js", () => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/services/api.js");

  // Screen-reader status announcements write to #srStatus via rAF.
  const statusEl = { textContent: "" };
  document.getElementById = jest.fn((id) => (id === "srStatus" ? statusEl : null));
  global.requestAnimationFrame = jest.fn((cb) => cb());

  return { ...mod, fetchMock, statusEl, renderCadDesignInWorker, CadRenderError };
}

const CAD_SUCCESS = {
  status: "success",
  format: "cad-design",
  design: { code: "return box(P.width, P.depth, P.height);", parameters: {}, summary: "A box" },
  runtime: { contractVersion: 1, preludeVersion: "2026-10-04.3" },
  provider: { id: "deepseek", model: "m" },
  attribution: [{ helper: "box", work: "…", author: "…", authorGithub: [], licence: "MIT", url: "u" }],
  diagnostics: { selection: { libraries: [], fit: {}, source: "fallback", jevTokens: { prompt: 0, completion: 0 } }, attempts: [], durationMs: 1, tokens: { prompt: 0, completion: 0 } },
  providerTaskId: "cad-1",
};

describe("generateCadAsset", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("polls, renders client-side, uploads 3MF, and returns a 3mf result", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({ status: 202, body: { taskId: "t1", provider: "cad", status: "running" } })
      )
      .mockResolvedValueOnce(buildResponse({ body: CAD_SUCCESS }));
    const { generateCadAsset, renderCadDesignInWorker } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateCadAsset({ prompt: "a box", nodeId: "n_1" });

    expect(result.format).toBe("3mf");
    expect(result.path).toBe("asset.3mf");
    expect(result.sourceAssetCid).toBe("bafySourceAsset");
    expect(result.assetManifestCid).toBe("bafyAssetManifest");
    expect(result.taskId).toBe("t1");
    expect(result.providerTaskId).toBe("cad-1");
    expect(result.design).toEqual(CAD_SUCCESS.design);
    expect(renderCadDesignInWorker).toHaveBeenCalledTimes(1);
    expect(calls.renders[0].design.code).toContain("box(");
    expect(calls.renders[0].runtime.preludeVersion).toBe("2026-10-04.3");

    const { writeToIPFS, writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    expect(writeToIPFS).toHaveBeenCalledTimes(1);
    expect(writeToIPFS.mock.calls[0][1]).toBe("asset.3mf");
    const manifest = writeJSONToIPFS.mock.calls[0][0];
    expect(manifest.scene.nodes[0].source.format).toBe("3mf");
    expect(manifest.metadata.cad.summary).toBe("A box");
    expect(manifest.metadata.cad.attribution).toHaveLength(1);
    expect(manifest.metadata.cad.providerTaskId).toBe("cad-1");

    // POST carried the cad provider; the poll GET hit the task route.
    const [postUrl, postOpts] = fetchMock.mock.calls[0];
    expect(postUrl).toMatch(/\/generations$/);
    expect(JSON.parse(postOpts.body)).toMatchObject({ provider: "cad", prompt: "a box", nodeId: "n_1" });
    const [pollUrl, pollOpts] = fetchMock.mock.calls[1];
    expect(pollUrl).toMatch(/\/generations\/t1$/);
    expect(pollOpts.method).toBe("GET");
  });

  test("CAD_REQUEST_UNSUITABLE keeps suitability and alternative on the error", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({ status: 202, body: { taskId: "t2", provider: "cad", status: "running" } })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "failed",
            error: {
              code: "CAD_REQUEST_UNSUITABLE",
              message: "not CAD-able",
              suitability: 0.2,
              alternative: { kind: "organic-mesh", provider: "tripo3d" },
            },
          },
        })
      );
    const { generateCadAsset, ApiError } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const err = await generateCadAsset({ prompt: "a dragon", nodeId: "n_2" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CAD_REQUEST_UNSUITABLE");
    expect(err.details.suitability).toBe(0.2);
    expect(err.details.alternative.provider).toBe("tripo3d");
  });

  test("surfaces CAD_NOT_CONFIGURED from the POST", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildResponse({
        status: 503,
        body: { error: { code: "CAD_NOT_CONFIGURED", message: "DEEPSEEK_API_KEY is not set" } },
      })
    );
    const { generateCadAsset, ApiError } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const err = await generateCadAsset({ prompt: "x", nodeId: "n_3" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CAD_NOT_CONFIGURED");
    expect(err.status).toBe(503);
  });

  test("an edit sends priorDesign and chains onto the previous version", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(buildResponse({ status: 202, body: { taskId: "t2", provider: "cad", status: "running" } }))
      .mockResolvedValueOnce(buildResponse({ body: CAD_SUCCESS }));
    const { generateCadAsset } = await loadApi({ fetchMock });
    localStorage.setItem("arbesk_session", makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS));
    const prior = { code: "return box(1,1,1);", parameters: { s: { value: 1, unit: "mm" } }, summary: "cube", turn: 1 };

    await generateCadAsset({ prompt: "taller", nodeId: "n_2", priorDesign: prior, prevAssetManifestCid: "bafyPrev" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ provider: "cad", prompt: "taller", nodeId: "n_2", priorDesign: prior });
  });

  test("a fresh generation sends no priorDesign", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(buildResponse({ status: 202, body: { taskId: "t3", provider: "cad", status: "running" } }))
      .mockResolvedValueOnce(buildResponse({ body: CAD_SUCCESS }));
    const { generateCadAsset } = await loadApi({ fetchMock });
    localStorage.setItem("arbesk_session", makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS));
    await generateCadAsset({ prompt: "a box", nodeId: "n_3" });
    expect("priorDesign" in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
  });
});
