import { jest } from "@jest/globals";
import { Hono } from "hono";
import { requestLog } from "../../src/hono/request-log.ts";

describe("hono requestLog middleware", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function buildApp() {
    const app = new Hono();
    app.use(requestLog());
    app.get("/ok", (c) => c.json({ ok: true }));
    app.get("/redir", (c) => c.redirect("/ok"));
    return app;
  }

  it("logs [OK] with method, path+query, status, ms and client", async () => {
    const app = buildApp();
    const res = await app.request("http://localhost/ok?x=1");
    expect(res.status).toBe(200);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(
      /^\[OK\] GET \/ok\?x=1 → 200 \(\d+ms\) \| client=test$/,
    );
  });

  it("uses x-forwarded-for as client when present", async () => {
    const app = buildApp();
    await app.request("http://localhost/ok", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });

    expect(logSpy.mock.calls[0][0]).toContain("client=203.0.113.7");
  });

  it("tags 4xx/5xx as [ERR] and 3xx as [RDR]", async () => {
    const app = buildApp();

    await app.request("http://localhost/missing");
    expect(logSpy.mock.calls[0][0]).toMatch(/^\[ERR\] GET \/missing → 404 /);

    await app.request("http://localhost/redir", { redirect: "manual" });
    expect(logSpy.mock.calls[1][0]).toMatch(/^\[RDR\] GET \/redir → 302 /);
  });
});
