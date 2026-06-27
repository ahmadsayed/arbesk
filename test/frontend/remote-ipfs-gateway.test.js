/** @jest-environment jsdom */
import { jest } from "@jest/globals";
import { TextEncoder, TextDecoder } from "util";
import { compress } from "../../frontend/src/js/utils/compression.js";

if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

async function load(gateway) {
  jest.resetModules();
  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    __esModule: true,
    getConfig: jest.fn(async () => ({ ipfsGatewayUrl: gateway })),
  }));
  const fetchMock = jest.fn(async () => ({
    ok: true,
    text: async () => '{"version":1}',
    json: async () => ({ version: 1 }),
    arrayBuffer: async () => new Uint8Array(Buffer.from('{"version":1}')).buffer,
  }));
  global.fetch = fetchMock;
  const mod = await import("../../frontend/src/js/ipfs/remote-ipfs.js");
  return { mod, fetchMock };
}

function makeGzippedResponse(gateway, text) {
  const raw = compress(text);
  return jest.fn(async (url) => {
    if (!String(url).startsWith(gateway)) {
      return { ok: false, status: 404 };
    }
    return {
      ok: true,
      arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    };
  });
}

it("reads CIDs from the gateway reported by /config", async () => {
  const { mod, fetchMock } = await load("https://gw.mypinata.cloud/ipfs/");
  await mod.getFromRemoteIPFS("bafyManifest");
  const calledUrl = fetchMock.mock.calls.find((c) => String(c[0]).includes("bafyManifest"))[0];
  expect(calledUrl).toBe("https://gw.mypinata.cloud/ipfs/bafyManifest");
});

describe("raw vs decompressed fetch", () => {
  it("getRawArrayBufferFromRemoteIPFS returns gzipped bytes unchanged", async () => {
    const gateway = "http://127.0.0.1:8080/ipfs/";
    const { mod } = await load(gateway);
    const text = "hello raw fetch";
    const gzipped = compress(text);
    global.fetch = makeGzippedResponse(gateway, text);

    const raw = await mod.getRawArrayBufferFromRemoteIPFS("bafyRaw");
    const rawBytes = new Uint8Array(raw);
    expect(rawBytes.length).toBe(gzipped.length);
    for (let i = 0; i < gzipped.length; i++) {
      expect(rawBytes[i]).toBe(gzipped[i]);
    }
  });

  it("getArrayBufferFromRemoteIPFS still returns decompressed bytes", async () => {
    const gateway = "http://127.0.0.1:8080/ipfs/";
    const { mod } = await load(gateway);
    const text = "hello decompressed fetch";
    global.fetch = makeGzippedResponse(gateway, text);

    const buffer = await mod.getArrayBufferFromRemoteIPFS("bafyDecompressed");
    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toBe(text);
  });
});

describe("gateway error paths", () => {
  async function loadWithFetch(fetchMock, gateway = "http://127.0.0.1:8080/ipfs/") {
    jest.resetModules();
    jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
      __esModule: true,
      getConfig: jest.fn(async () => ({ ipfsGatewayUrl: gateway })),
    }));
    global.fetch = fetchMock;
    return await import("../../frontend/src/js/ipfs/remote-ipfs.js");
  }

  function jsonResponse(obj, status = 200) {
    const text = JSON.stringify(obj);
    return {
      ok: status === 200,
      status,
      text: async () => text,
      arrayBuffer: async () => new Uint8Array(Buffer.from(text)).buffer,
    };
  }

  function errorResponse(status = 500) {
    return { ok: false, status, text: async () => "error", arrayBuffer: async () => new ArrayBuffer(0) };
  }

  it("throws when the gateway responds with a non-2xx status", async () => {
    const mod = await loadWithFetch(jest.fn(async () => errorResponse(504)));
    await expect(mod.getFromRemoteIPFS("bafyFail")).rejects.toThrow(
      "IPFS gateway returned 504",
    );
  });

  it("falls back to the default gateway when /config rejects", async () => {
    jest.resetModules();
    jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
      __esModule: true,
      getConfig: jest.fn(async () => {
        throw new Error("config unavailable");
      }),
    }));
    const fetchMock = jest.fn(async () => jsonResponse({ version: 1 }));
    global.fetch = fetchMock;
    const mod = await import("../../frontend/src/js/ipfs/remote-ipfs.js");

    await mod.getFromRemoteIPFS("bafyFallback");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/ipfs/bafyFallback",
      { cache: "default" },
    );
  });

  it("getBase64FromRemoteIPFS returns base64 of raw bytes", async () => {
    const mod = await loadWithFetch(
      jest.fn(async () => jsonResponse({ hello: "world" })),
    );
    const b64 = await mod.getBase64FromRemoteIPFS("bafyBase64");
    expect(typeof b64).toBe("string");
    expect(Buffer.from(b64, "base64").toString("utf-8")).toBe(
      '{"hello":"world"}',
    );
  });

  it("getBlobFromRemoteIPFS returns a Blob", async () => {
    const mod = await loadWithFetch(
      jest.fn(async () => jsonResponse({ hello: "world" })),
    );
    const blob = await mod.getBlobFromRemoteIPFS("bafyBlob");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("getArrayBufferFromRemoteIPFS returns an ArrayBuffer", async () => {
    const mod = await loadWithFetch(
      jest.fn(async () => jsonResponse({ hello: "world" })),
    );
    const buffer = await mod.getArrayBufferFromRemoteIPFS("bafyBuffer");
    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("isIpfsCidReachable returns true for a reachable CID", async () => {
    const mod = await loadWithFetch(jest.fn(async () => ({ ok: true, status: 200 })));
    expect(await mod.isIpfsCidReachable("bafyReachable")).toBe(true);
  });

  it("isIpfsCidReachable returns false for a non-2xx response", async () => {
    const mod = await loadWithFetch(jest.fn(async () => ({ ok: false, status: 404 })));
    expect(await mod.isIpfsCidReachable("bafyMissing")).toBe(false);
  });

  it("isIpfsCidReachable returns false when the fetch throws", async () => {
    const mod = await loadWithFetch(
      jest.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await mod.isIpfsCidReachable("bafyOffline")).toBe(false);
  });

  it("getManifestChain walks prev_asset_manifest_cid links", async () => {
    const responses = [
      jsonResponse({ version: 3, name: "v3", prev_asset_manifest_cid: "bafy2" }),
      jsonResponse({ version: 2, name: "v2", prev_asset_manifest_cid: "bafy1" }),
      jsonResponse({ version: 1, name: "v1" }),
    ];
    let index = 0;
    const fetchMock = jest.fn(async () => responses[index++]);
    const mod = await loadWithFetch(fetchMock);

    const chain = await mod.getManifestChain("bafy3");
    expect(chain).toHaveLength(3);
    expect(chain[0]).toMatchObject({ cid: "bafy3", version: 3, name: "v3" });
    expect(chain[1]).toMatchObject({ cid: "bafy2", version: 2, name: "v2" });
    expect(chain[2]).toMatchObject({ cid: "bafy1", version: 1, name: "v1" });
  });

  it("getManifestChain stops when a manifest cannot be fetched", async () => {
    const fetchMock = jest.fn(async () => errorResponse(500));
    const mod = await loadWithFetch(fetchMock);

    const chain = await mod.getManifestChain("bafyBroken");
    expect(chain).toEqual([]);
  });

  it("getManifestChain respects the maxDepth limit", async () => {
    const responses = Array.from({ length: 5 }, (_, i) =>
      jsonResponse({
        version: i + 1,
        prev_asset_manifest_cid: i < 4 ? `bafy${i}` : undefined,
      }),
    );
    let index = 0;
    const fetchMock = jest.fn(async () => responses[index++]);
    const mod = await loadWithFetch(fetchMock);

    const chain = await mod.getManifestChain("bafyStart", 3);
    expect(chain).toHaveLength(3);
  });
});
