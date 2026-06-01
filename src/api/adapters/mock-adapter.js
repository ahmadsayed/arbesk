import fs from "fs";
import path from "path";

const MOCK_ASSETS_DIR = process.env.MOCK_ASSETS_DIR || "./mock-gltf-assets";

/**
 * Generate a mock asset from local files.
 * Returns intro.gltf by default, suka.gltf for character prompts.
 */
export async function mockGenerate(prompt) {
  const lower = prompt.toLowerCase();
  let filename = "intro.gltf";
  if (
    lower.includes("character") ||
    lower.includes("figure") ||
    lower.includes("person") ||
    lower.includes("avatar")
  ) {
    filename = "suka.gltf";
  }
  const filepath = path.resolve(MOCK_ASSETS_DIR, filename);
  const data = fs.readFileSync(filepath, "utf-8");
  return { data, format: "gltf", provider: "mock" };
}
