import { jest } from "@jest/globals";
import { Hono } from "hono";
import authorize from "../../src/hono/auth.ts";
import {
  createSession,
  invalidateSession,
} from "../../src/api/sessions.ts";

describe("hono session-auth middleware", () => {
  function buildApp() {
    const app = new Hono();
    app.get(
      "/protected",
      authorize,
      (c) => c.json({ userAddress: c.get("userAddress"), txHash: c.get("txHash") }),
    );
    return app;
  }

  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("rejects a missing Authorization header with 401 MISSING_AUTH", async () => {
    const res = await buildApp().request("http://localhost/protected");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "MISSING_AUTH", message: "Missing Authorization header" },
    });
  });

  it("rejects a wrong scheme with 401 INVALID_AUTH_FORMAT", async () => {
    const res = await buildApp().request("http://localhost/protected", {
      headers: { authorization: "Bearer abc" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_AUTH_FORMAT",
        message: "Invalid Authorization format. Expected: Session <token>",
      },
    });
  });

  it("rejects an unknown token with 401 INVALID_SESSION", async () => {
    const res = await buildApp().request("http://localhost/protected", {
      headers: { authorization: "Session 00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_SESSION",
        message:
          "Session token is invalid or expired. Create a new session by signing again.",
      },
    });
  });

  it("accepts a valid session and exposes userAddress + txHash", async () => {
    const token = createSession("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01");
    try {
      const res = await buildApp().request("http://localhost/protected", {
        headers: { authorization: `Session ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        userAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
        txHash: null,
      });
    } finally {
      invalidateSession(token);
    }
  });
});
