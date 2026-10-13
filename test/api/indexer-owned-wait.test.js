/**
 * API route tests for the catch-up wait cap on GET /api/v1/indexer/owned.
 * A stalled catch-up (e.g. a cold sweep of a public testnet) must not hold the
 * request open; the route serves current state once the cap elapses.
 */
import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
import request from "supertest";
import { mountRoutes } from "../helpers/hono.js";

const OWNED_URL =
  "/indexer/owned?address=0x0000000000000000000000000000000000000AAA&chainId=84532";

async function buildApp(catchUp) {
  const mockIndexer = {
    catchUp: jest.fn(catchUp),
    lastCatchUpAt: 0,
    lastScannedBlock: 100,
    getOwnedTokens: jest.fn().mockReturnValue(["1"]),
  };

  await mock.module("../../src/api/token-indexer.ts", () => ({
    getIndexer: jest.fn(() => mockIndexer),
  }));

  const { default: indexerRoutes } = await import("../../src/api/routes/indexer.ts");

  const app = mountRoutes("/indexer", indexerRoutes({}));
  return { app, mockIndexer };
}

beforeEach(() => {
  resetModules();
  process.env.INDEXER_CATCHUP_WAIT_MS = "50";
});

afterEach(() => {
  delete process.env.INDEXER_CATCHUP_WAIT_MS;
});

test("serves current state when catch-up outlasts the wait cap", async () => {
  const { app, mockIndexer } = await buildApp(() => new Promise(() => {}));

  const started = Date.now();
  const res = await request(app).get(OWNED_URL);

  expect(res.status).toBe(200);
  expect(res.body.owned).toEqual(["1"]);
  expect(res.body.lastScannedBlock).toBe(100);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(mockIndexer.catchUp).toHaveBeenCalledTimes(1);
});

test("waits for a catch-up that finishes within the cap", async () => {
  const { app, mockIndexer } = await buildApp(async () => {
    await new Promise((r) => setTimeout(r, 5));
    mockIndexer.lastScannedBlock = 120;
    mockIndexer.getOwnedTokens.mockReturnValue(["1", "2"]);
  });

  const res = await request(app).get(OWNED_URL);

  expect(res.status).toBe(200);
  expect(res.body.owned).toEqual(["1", "2"]);
  expect(res.body.lastScannedBlock).toBe(120);
});

test("a catch-up failing after the cap does not surface as unhandled", async () => {
  const unhandled = jest.fn();
  process.on("unhandledRejection", unhandled);
  try {
    const { app } = await buildApp(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("rpc down")), 100)),
    );

    const res = await request(app).get(OWNED_URL);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 150));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off("unhandledRejection", unhandled);
  }
});
