import { afterAll, beforeAll, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test";

const runIpfsGC = jest.fn();
const storage = { backend: "kubo" };

mock.module("../../src/api/ipfs-gc.ts", () => ({ runIpfsGC }));
mock.module("../../src/api/storage/index.ts", () => ({ createStorageAdapter: () => storage }));

const { runGcCli } = await import("../../src/api/ipfs-gc-cli.ts");

const RESULT = { dryRun: true, aborted: false, liveTokens: 1, reachable: 2, pinned: 2, orphans: 0, eligible: 0, unpinned: 0, errors: [] };

describe("runGcCli", () => {
  const spies = [];

  beforeAll(() => {
    spies.push(
      spyOn(console, "log").mockImplementation(() => {}),
      spyOn(console, "error").mockImplementation(() => {}),
    );
  });

  afterAll(() => {
    for (const s of spies) s.mockRestore();
  });

  beforeEach(() => {
    runIpfsGC.mockReset();
    runIpfsGC.mockResolvedValue(RESULT);
  });

  it("is a dry run unless --live is passed", async () => {
    expect(await runGcCli([])).toBe(0);

    expect(runIpfsGC).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, maxUnpin: Infinity, graceMs: undefined }),
      storage,
    );
  });

  it("passes --live, --max-unpin, --grace-hours and --chain-id through", async () => {
    await runGcCli(["--live", "--max-unpin", "500", "--grace-hours", "24", "--chain-id", "84532"]);

    expect(runIpfsGC).toHaveBeenCalledWith(
      { dryRun: false, maxUnpin: 500, graceMs: 24 * 3600000, chainId: "84532" },
      storage,
    );
  });

  it("exits 2 when the run reported errors", async () => {
    runIpfsGC.mockResolvedValue({ ...RESULT, aborted: true, errors: ["read bafy: timeout"] });

    expect(await runGcCli(["--live"])).toBe(2);
  });

  it("exits 1 when the collector cannot run", async () => {
    runIpfsGC.mockRejectedValue(new Error("No contract address configured for GC scan"));

    expect(await runGcCli([])).toBe(1);
  });
});
