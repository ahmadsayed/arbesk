import { jest } from "@jest/globals";
import { Hono } from "hono";
import { z } from "zod";
import { validateBody, validateQuery } from "../../src/hono/validate.ts";

describe("hono validate wrappers", () => {
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  describe("validateBody", () => {
    const schema = z.object({
      name: z.string(),
      role: z.string().default("user"),
    });

    function buildApp() {
      const app = new Hono();
      app.post("/t", validateBody(schema), (c) => {
        const body = c.req.valid("json");
        return c.json({ ok: true, role: body.role });
      });
      return app;
    }

    const post = (app, body) =>
      app.request("http://localhost/t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    it("passes the parsed body (with defaults applied) to the handler", async () => {
      const res = await post(buildApp(), { name: "ada" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, role: "user" });
    });

    it("rejects an invalid body with 400 VALIDATION_ERROR and issues", async () => {
      const res = await post(buildApp(), { name: 42 });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("Invalid request body");
      expect(body.error.details.issues).toEqual([
        { path: ["name"], message: "Expected string, received number" },
      ]);
    });
  });

  describe("validateQuery", () => {
    const schema = z.object({ n: z.coerce.number().int().positive() });

    function buildApp() {
      const app = new Hono();
      app.get("/q", validateQuery(schema), (c) =>
        c.json({ ok: true, n: c.req.valid("query").n }),
      );
      return app;
    }

    it("passes coerced query values to the handler", async () => {
      const res = await buildApp().request("http://localhost/q?n=5");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, n: 5 });
    });

    it("rejects invalid query params with 400 VALIDATION_ERROR", async () => {
      const res = await buildApp().request("http://localhost/q?n=abc");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("Invalid query parameters");
      expect(body.error.details.issues[0].path).toEqual(["n"]);
    });
  });
});
