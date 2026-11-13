import { afterAll, beforeAll, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test";

const runIpfsGC = jest.fn();
const storage = { backend: "kubo" };

const realGc = await import("../../src/api/ipfs-gc.ts");
mock.module("../../src/api/ipfs-gc.ts", () => ({ ...realGc, runIpfsGC }));
mock.module("../../src/api/storage/index.ts", () => ({ createStorageAdapter: () => storage }));

const { runGcCli } = await import("../../src/api/ipfs-gc-cli.ts");

const RESULT = { dryRun: true, aborted: false, liveTokens: 1, reachable: 2, pinned: 2, orphans: 0, eligible: 0, unpinned: 0, orphanBytes: 0, eligibleBytes: 0, unpinnedBytes: 0, sizeUnknown: 0, errors: [] };

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

  it("ends with a readable line of files and storage", async () => {
    runIpfsGC.mockResolvedValue({
      ...RESULT, dryRun: false, orphans: 5, eligible: 2, unpinned: 2,
      orphanBytes: 5 * 1024 * 1024, eligibleBytes: 2 * 1024 * 1024, unpinnedBytes: 2 * 1024 * 1024, sizeUnknown: 1,
    });

    await runGcCli(["--live"]);

    expect(console.log).toHaveBeenLastCalledWith(
      "[GC-CLI] removed 2 files, 2.0 MB freed | 3 unused files, 3.0 MB, still pinned (1 of unknown size not counted)",
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
