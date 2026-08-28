/**
 * Wallet relay route tests (P2d).
 */
import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import walletRelayRoutes from "../../src/api/routes/wallet-relay.ts";
import { createSession, sessions } from "../../src/api/sessions.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";

function makeApp(cdp, authz) {
  const app = express();
  app.use(express.json());
  app.use("/wallet/relay", walletRelayRoutes({
    getCdpClientFn: async () => cdp,
    getAuthz: () => authz,
  }));
  return app;
}

function fakeAuthz(allowed = true) {
  return {
    checkAssetAccess: jest.fn(async () => ({
      allowed,
      assetId: "84532:0xcont:1",
      chainId: 84532,
      isOwner: true,
      role: 2,
    })),
  };
}

function fakeCdp({ users = [] } = {}) {
  return {
    endUser: {
      listEndUsers: jest.fn(async () => ({ endUsers: users, nextPageToken: undefined })),
      sendUserOperation: jest.fn(async () => ({ userOpHash: "0xop" })),
    },
    evm: {
      getUserOperation: jest.fn(async () => ({ status: "complete", transactionHash: "0xtx" })),
    },
  };
}

describe("wallet relay", () => {
  beforeEach(() => {
    _resetRateLimiters();
    sessions.clear();
  });

  test("relays an updateUri write for an email session", async () => {
    const cdp = fakeCdp();
    const authz = fakeAuthz();
    const app = makeApp(cdp, authz);
    const token = createSession("0xabc", { userId: "u1", email: "maya@studio.com", authMethod: "email" });

    const res = await request(app)
      .post("/wallet/relay")
      .set("Authorization", "Session " + token)
      .send({ op: "updateUri", tokenId: "1", contractAddress: "0xcont", params: { newUri: "ipfs://new", proof: [] } });

    expect(res.status).toBe(200);
    expect(res.body.receipt.transactionHash).toBe("0xtx");
    expect(res.body.receipt.status).toBe(true);

    const sent = cdp.endUser.sendUserOperation.mock.calls[0][0];
    expect(sent.userId).toBe("u1");
    expect(sent.address).toBe("0xabc");
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0].to).toBe("0xcont");
    expect(sent.calls[0].data).toMatch(/^0x/);
  });

  test("rejects when session has no userId and no matching address", async () => {
    const app = makeApp(fakeCdp(), fakeAuthz());
    const token = createSession("0xabc");
    const res = await request(app)
      .post("/wallet/relay")
      .set("Authorization", "Session " + token)
      .send({ op: "updateUri", tokenId: "1", contractAddress: "0xcont", params: { newUri: "ipfs://new", proof: [] } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("DELEGATION_REQUIRED");
  });

  test("resolves userId from the wallet address for a browser-assisted session", async () => {
    const cdp = fakeCdp({
      users: [{ userId: "u-delegated", evmSmartAccounts: ["0xabc"], evmSmartAccountObjects: [{ address: "0xabc" }] }],
    });
    const app = makeApp(cdp, fakeAuthz());
    const token = createSession("0xabc"); // no userId — browser-assisted
    const res = await request(app)
      .post("/wallet/relay")
      .set("Authorization", "Session " + token)
      .send({ op: "updateUri", tokenId: "1", contractAddress: "0xcont", params: { newUri: "ipfs://new", proof: [] } });
    expect(res.status).toBe(200);
    expect(cdp.endUser.sendUserOperation.mock.calls[0][0].userId).toBe("u-delegated");
  });

  test("rejects when authz denies", async () => {
    const app = makeApp(fakeCdp(), fakeAuthz(false));
    const token = createSession("0xabc", { userId: "u1", authMethod: "email" });
    const res = await request(app)
      .post("/wallet/relay")
      .set("Authorization", "Session " + token)
      .send({ op: "updateUri", tokenId: "1", contractAddress: "0xcont", params: { newUri: "ipfs://new", proof: [] } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });
});
