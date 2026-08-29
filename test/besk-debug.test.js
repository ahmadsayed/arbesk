/**
 * besk --verbose: timestamped debug log of every backend/IPFS/relay action,
 * always on stderr (stdout stays pipeable for the CLI and is the JSON-RPC
 * channel under `besk mcp`). Enabled by --verbose/-v or ARBESK_VERBOSE=1.
 */
import { jest } from "@jest/globals";
import os from "os";
import path from "path";

delete process.env.ARBESK_VERBOSE;
process.env.ARBESK_CACHE_PATH = path.join(os.tmpdir(), "besk-debug-test-cache-" + process.pid + ".json");

const relayMock = jest.fn(async () => ({}));
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const written = [];
jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({ contractAddress: "0x0", ipfsGatewayUrl: "http://gw", networkConfigs: {} })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async () => "bafyCurrentCollection"),
    listTokens: jest.fn(async () => []),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async () => ({
      type: "collection", name: "c", asset_id: "collection_1",
      version: 2, timestamp: 1, assets: { a: "cidA", b: "cidB" },
    })),
    getBytes: jest.fn(), getRawBytes: jest.fn(),
  })),
  createIpfsWritePort: jest.fn(() => ({
    write: jest.fn(),
    writeJSON: jest.fn(async (json) => { written.push(json); return "bafyNewCollection"; }),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
}));

const { debug, trace, setVerbose, isVerbose } = await import("../packages/besk/src/debug.ts");
const { updateCollection } = await import("../packages/besk/src/catalog.ts");

const SESSION = { token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc", email: "a@b.c", authMethod: "siwe" };

describe("besk debug module", () => {
  let errorSpy;
  beforeEach(() => {
    setVerbose(false);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  test("is silent by default", () => {
    expect(isVerbose()).toBe(false);
    debug("hello");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("writes one timestamped stderr line per action when verbose", () => {
    setVerbose(true);
    debug("relay", "updateUri");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0].join(" ");
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] relay updateUri$/);
  });

  test("trace logs start + done with a duration and returns the value", async () => {
    setVerbose(true);
    const v = await trace("op", async () => 42);
    expect(v).toBe(42);
    const lines = errorSpy.mock.calls.map((c) => c.join(" "));
    expect(lines[0]).toMatch(/start: op$/);
    expect(lines[1]).toMatch(/done: op \(\d+ms\)$/);
  });

  test("trace logs the failure and rethrows", async () => {
    setVerbose(true);
    await expect(trace("op", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const lines = errorSpy.mock.calls.map((c) => c.join(" "));
    expect(lines[1]).toMatch(/fail: op \(\d+ms\) boom/);
  });
});

describe("besk --verbose instrumentation", () => {
  test("a collection write emits timestamped action lines (token, new CID, relay op)", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    setVerbose(true);
    await updateCollection(SESSION, "42", (draft) => { delete draft.assets.b; });
    setVerbose(false);
    const lines = errorSpy.mock.calls.map((c) => c.join(" "));
    errorSpy.mockRestore();
    expect(lines.some((l) => /updateCollection token=42/.test(l))).toBe(true);
    expect(lines.some((l) => /bafyNewCollection/.test(l))).toBe(true);
    expect(lines.every((l) => /^\[\d{4}-/.test(l))).toBe(true);
  });

  test("silent again once verbose is off", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    setVerbose(false);
    await updateCollection(SESSION, "42", (draft) => { delete draft.assets.a; });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
