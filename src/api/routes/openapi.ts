import { Hono } from "hono";
import fs from "fs/promises";
import path from "path";
import openapiSpec from "../openapi.json" with { type: "json" };
import { PROJECT_ROOT } from "../project-root.ts";

export default function openapiRoutes() {
  const app = new Hono();

  app.get("/openapi.json", (c) => c.json(openapiSpec));

  app.get("/docs", async (c) => {
    const htmlPath = path.resolve(PROJECT_ROOT, "src/api/swagger-ui.html");
    return c.html(await fs.readFile(htmlPath, "utf-8"));
  });

  return app;
}
