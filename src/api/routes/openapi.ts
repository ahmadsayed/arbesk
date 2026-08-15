import express from "express";
import fs from "fs/promises";
import path from "path";
import url from "url";
import openapiSpec from "../openapi.json" with { type: "json" };

const Router = express.Router;
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export default function openapiRoutes() {
  const router = Router();

  router.get("/openapi.json", (req, res) => {
    res.json(openapiSpec);
  });

  router.get("/docs", async (req, res) => {
    const htmlPath = path.resolve(__dirname, "../swagger-ui.html");
    const html = await fs.readFile(htmlPath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  return router;
}
