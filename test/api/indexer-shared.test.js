/**
 * API route tests for GET /api/v1/indexer/shared.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

async function buildApp() {
  const mockIndexer = {
    catchUp: jest.fn().mockResolvedValue(undefined),
    lastCatchUpAt: 0,
    lastScannedBlock: 100,
    getSharedTokens: jest.fn().mockReturnValue(["7", "42"]),
  };

  await jest.unstable_mockModule("../../src/api/token-indexer.js", () => ({
    getIndexer: jest.fn(() => mockIndexer),
  }));

  const { default: indexerRoutes } = await import("../../src/api/routes/indexer.js");

  const app = express();
  app.use("/indexer", indexerRoutes());
  return { app, mockIndexer };
}

beforeEach(() => {
  jest.resetModules();
});

test("GET /indexer/shared returns shared token IDs", async () => {
  const { app } = await buildApp();
  const res = await request(app)
    .get("/indexer/shared?address=0x0000000000000000000000000000000000000BBB&chainId=31415822&force=true")
    .set("Accept", "application/json");

  expect(res.status).toBe(200);
  expect(res.body.shared).toEqual(["7", "42"]);
  expect(res.body.address).toBe("0x0000000000000000000000000000000000000bbb");
  expect(res.body.chainId).toBe(31415822);
});

test("GET /indexer/shared rejects invalid address", async () => {
  const { app } = await buildApp();
  const res = await request(app)
    .get("/indexer/shared?address=not-an-address&chainId=31415822")
    .set("Accept", "application/json");

  expect(res.status).toBe(400);
});
