/** @jest-environment jsdom */
import { jest } from "@jest/globals";
import { TextEncoder, TextDecoder } from "util";

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

it("reads CIDs from the gateway reported by /config", async () => {
  const { mod, fetchMock } = await load("https://gw.mypinata.cloud/ipfs/");
  await mod.getFromRemoteIPFS("bafyManifest");
  const calledUrl = fetchMock.mock.calls.find((c) => String(c[0]).includes("bafyManifest"))[0];
  expect(calledUrl).toBe("https://gw.mypinata.cloud/ipfs/bafyManifest");
});
