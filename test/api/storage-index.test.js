import { afterEach, describe, expect, it, jest, mock } from "bun:test";

const createPinataAdapter = jest.fn(() => ({ backend: "pinata" }));
mock.module("../../src/api/storage/pinata-adapter.ts", () => ({ createPinataAdapter }));

const { createStorageAdapter } = await import("../../src/api/storage/index.ts");

describe("createStorageAdapter (pinata)", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    createPinataAdapter.mockClear();
  });

  function poolSizeFor(options) {
    process.env.IPFS_BACKEND = "pinata";
    process.env.PINATA_GATEWAY = "example.mypinata.cloud";
    process.env.PINATA_POOL_SIZE = "20";
    createStorageAdapter(options);
    return createPinataAdapter.mock.calls[0][1].poolSize;
  }

  it("keeps the configured upload pool by default", () => {
    expect(poolSizeFor()).toBe(20);
  });

  it("turns the upload pool off for read-only callers", () => {
    expect(poolSizeFor({ uploadPool: false })).toBe(0);
  });
});
