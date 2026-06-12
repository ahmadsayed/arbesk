import fs from "fs";
import path from "path";

const MOCK_ASSETS_DIR = process.env.MOCK_ASSETS_DIR || "./mock-gltf-assets";

/**
 * Generate a mock asset from local files.
 *   - howdy.glb for cowboy/western prompts
 *   - suka.gltf for character/figure/person/avatar prompts
 *   - intro.gltf for everything else
 */
export async function mockGenerate(prompt) {
  const lower = prompt.toLowerCase();
  let filename = "intro.gltf";
  let format = "gltf";

  if (lower.includes("howdy") || lower.includes("cowboy")) {
    filename = "howdy.glb";
    format = "glb";
  } else if (
    lower.includes("character") ||
    lower.includes("figure") ||
    lower.includes("person") ||
    lower.includes("avatar")
  ) {
    filename = "suka.gltf";
  }

  const filepath = path.resolve(MOCK_ASSETS_DIR, filename);

  if (format === "glb") {
    const buffer = fs.readFileSync(filepath);
    return { buffer, format: "glb", provider: "mock" };
  }

  const data = fs.readFileSync(filepath, "utf-8");
  return { data, format: "gltf", provider: "mock" };
}
