/**
 * Hardhat Local reads go to the RPC the backend advertises (/api/v1/config →
 * hardhatRpcUrl), not the URL baked into the bundle — parallel E2E workers
 * each run their own Hardhat node behind their own backend.
 */
import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";

let config;
mock.module("../../frontend/src/js/services/app-config.ts", () => ({
  getConfig: jest.fn(async () => config),
}));

const { CHAIN_IDS } = await import("../../constants/chains.js");
const { getReadClient } = await import("../../frontend/src/js/blockchain/viem-clients.ts");

describe("getReadClient(Hardhat Local)", () => {
  const realFetch = globalThis.fetch;
  let urls;

  beforeEach(() => {
    urls = [];
    globalThis.fetch = jest.fn(async (url, init) => {
      urls.push(String(url));
      const { id } = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2a" }), {
        headers: { "content-type": "application/json" },
      });
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("uses the backend-advertised hardhatRpcUrl", async () => {
    config = { hardhatRpcUrl: "http://127.0.0.1:8547" };
    const block = await getReadClient(CHAIN_IDS.HARDHAT_LOCAL).getBlockNumber();
    expect(block).toBe(42n);
    expect(urls.map((u) => new URL(u).origin)).toEqual(["http://127.0.0.1:8547"]);
  });
});
