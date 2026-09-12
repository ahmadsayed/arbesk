import { Hono } from "hono";
import { sendError } from "../../src/hono/json-error.ts";

describe("hono json-error sendError", () => {
  it("emits the standard envelope without details", async () => {
    const app = new Hono();
    app.get("/err", (c) => sendError(c, 400, "BAD_THING", "Something failed"));

    const res = await app.request("http://localhost/err");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "BAD_THING", message: "Something failed" },
    });
    // Byte-identical to the Express sendError serialization (no details key).
    expect(text).toBe(
      JSON.stringify({ error: { code: "BAD_THING", message: "Something failed" } }),
    );
  });

  it("includes details when provided", async () => {
    const app = new Hono();
    app.get("/err", (c) =>
      sendError(c, 429, "RATE_LIMITED", "Slow down", { retryAfterSeconds: 60 }),
    );

    const res = await app.request("http://localhost/err");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Slow down",
        details: { retryAfterSeconds: 60 },
      },
    });
  });

  it("omits details for falsy values (matches Express sendError)", async () => {
    const app = new Hono();
    app.get("/err", (c) => sendError(c, 500, "OOPS", "nope", 0));

    const res = await app.request("http://localhost/err");
    const body = await res.json();
    expect(body.error).not.toHaveProperty("details");
  });
});
