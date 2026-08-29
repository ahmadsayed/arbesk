/**
 * besk burn: destroys a collection token via the backend relay and unpins its
 * IPFS footprint. The unpin must happen BEFORE the burn (the backend verifies
 * on-chain ownership, so the token must still be live) and is best-effort —
 * failures never block the burn. Burning the active collection clears it from
 * the session file.
 */
import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

const SESSION_FILE = path.join(os.tmpdir(), "besk-burn-test-session.json");
process.env.ARBESK_SESSION_PATH = SESSION_FILE;
process.env.ARBESK_CACHE_PATH = path.join(os.tmpdir(), "besk-burn-test-cache.json");

const callOrder = [];
const relayMock = jest.fn(async () => {
  callOrder.push("relay");
  return { transactionHash: "0xtx" };
});
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const unpinMock = jest.fn(async () => {
  callOrder.push("unpin");
  return { count: 3 };
});
jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({
    contractAddress: "0x0",
    ipfsGatewayUrl: "http://gw",
    networkConfigs: { 84532: { contractAddress: "0xContract84532", rpcUrl: "http://rpc" } },
  })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async (tokenId) => {
      if (tokenId === "99") throw new Error("tokenURI reverted");
      return "bafyCurrentCollection";
    }),
    listTokens: jest.fn(async () => []),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async () => ({ type: "collection", asset_id: "collection_1", assets: {} })),
    getBytes: jest.fn(), getRawBytes: jest.fn(),
  })),
  createIpfsWritePort: jest.fn(() => ({ write: jest.fn(), writeJSON: jest.fn() })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
  unpinCids: unpinMock,
}));

const { burnCollection } = await import("../packages/besk/src/burn.ts");

const SESSION = { token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc", email: "a@b.c", authMethod: "siwe" };

beforeEach(() => {
  callOrder.length = 0;
  relayMock.mockClear();
  unpinMock.mockClear();
  unpinMock.mockImplementation(async () => { callOrder.push("unpin"); return { count: 3 }; });
  try { fs.unlinkSync(SESSION_FILE); } catch { /* gone */ }
});

describe("besk burnCollection", () => {
  test("unpins the collection CID before relaying the burn, returns the receipt", async () => {
    const receipt = await burnCollection(SESSION, "42");

    expect(receipt).toEqual({ transactionHash: "0xtx" });
    expect(unpinMock).toHaveBeenCalledWith(SESSION, "bafyCurrentCollection", "42");
    expect(relayMock).toHaveBeenCalledWith(SESSION, "burn", "42", { proof: [] });
    expect(callOrder).toEqual(["unpin", "relay"]);
  });

  test("unpin failure is non-fatal — the burn still proceeds", async () => {
    unpinMock.mockImplementation(async () => { throw new Error("unpin boom"); });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const receipt = await burnCollection(SESSION, "42");

    expect(receipt).toEqual({ transactionHash: "0xtx" });
    expect(relayMock).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("manifest resolution failure skips the unpin but still burns", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const receipt = await burnCollection(SESSION, "99");

    expect(receipt).toEqual({ transactionHash: "0xtx" });
    expect(unpinMock).not.toHaveBeenCalled();
    expect(relayMock).toHaveBeenCalledWith(SESSION, "burn", "99", { proof: [] });
    warn.mockRestore();
  });

  test("burning the active collection clears it from the session file", async () => {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ ...SESSION, activeCollectionTokenId: "42" }));

    await burnCollection({ ...SESSION, activeCollectionTokenId: "42" }, "42");

    const saved = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    expect(saved.activeCollectionTokenId).toBeNull();
  });

  test("leaves the active collection alone when burning a different one", async () => {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ ...SESSION, activeCollectionTokenId: "7" }));

    await burnCollection({ ...SESSION, activeCollectionTokenId: "7" }, "42");

    const saved = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    expect(saved.activeCollectionTokenId).toBe("7");
  });
});
