import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "../project-root.ts";

// Contract name → compiled Hardhat artifact, relative to the project root.
const ABI_MAP: Record<string, string> = {
  ArbeskAsset: "blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json",
  ArbeskAssetFree:
    "blockchain/artifacts/contracts/ArbeskAssetFree.sol/ArbeskAssetFree.json",
};

/**
 * Serve contract ABI by name.
 * GET /api/v1/contracts/:name/abi
 */
export default function contractsRoutes() {
  const app = new Hono();

  app.get("/:name/abi", async (c) => {
    const name = c.req.param("name");
    // Object.hasOwn: a name like "constructor" must not resolve through the
    // prototype chain.
    if (!Object.hasOwn(ABI_MAP, name)) return c.notFound();
    const abiPath = path.resolve(PROJECT_ROOT, ABI_MAP[name]);
    if (!fs.existsSync(abiPath)) {
      console.log(`[ABI] not found at ${abiPath}`);
      return c.json(
        {
          error:
            "ABI not found. Run: docker compose run --rm hardhat npx hardhat compile",
        },
        404,
      );
    }
    console.log(`[ABI] serving ${abiPath}`);
    return c.body(await fs.promises.readFile(abiPath, "utf8"), 200, {
      "Content-Type": "application/json",
    });
  });

  return app;
}
