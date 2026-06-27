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
