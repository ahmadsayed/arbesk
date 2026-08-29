/**
 * Verbose IPFS port instrumentation: every asset-core read (tokenURI manifest,
 * version-chain walk, buffers) funnels through the CLI's read/write ports in
 * adapters.ts — so per-fetch status/bytes/duration lines appear without
 * touching the SDK. This is what makes `besk history <name> --verbose` show
 * the manifest exploration tree.
 */
import { jest } from "@jest/globals";

delete process.env.ARBESK_VERBOSE;

const { setVerbose } = await import("../packages/besk/src/debug.ts");
const { createIpfsReadPort } = await import("../packages/besk/src/adapters.ts");

describe("besk verbose IPFS read port", () => {
  let errorSpy;
  let realFetch;
  beforeEach(() => {
    setVerbose(true);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    realFetch = global.fetch;
  });
  afterEach(() => {
    setVerbose(false);
    errorSpy.mockRestore();
    global.fetch = realFetch;
  });

  test("getJSON logs the fetch with status, size, and duration", async () => {
    global.fetch = jest.fn(async (url) => {
      expect(url).toBe("http://gw/ipfs/bafyX");
      return new Response(new TextEncoder().encode(JSON.stringify({ a: 1 })));
    });
    const port = createIpfsReadPort("http://gw");
    const json = await port.getJSON("bafyX");
    expect(json).toEqual({ a: 1 });
    const lines = errorSpy.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => /start: ipfs fetch bafyX/.test(l))).toBe(true);
    expect(lines.some((l) => /ipfs http 200 \d+ bytes/.test(l))).toBe(true);
    expect(lines.some((l) => /done: ipfs fetch bafyX \(\d+ms\)/.test(l))).toBe(true);
  });

  test("silent when verbose is off", async () => {
    setVerbose(false);
    global.fetch = jest.fn(async () => new Response(new TextEncoder().encode("{}")));
    const port = createIpfsReadPort("http://gw");
    await port.getJSON("bafyY");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
