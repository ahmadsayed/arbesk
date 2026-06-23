/**
 * Wrapper that loads Pinata credentials from `.env.pinata` at runtime.
 *
 * It expects exactly two lines:
 *   JWT=...
 *   GATEWAY=...
 *
 * The values are mapped to PINATA_JWT / PINATA_GATEWAY and the benchmark
 * runs without the secrets ever being copied into source code.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env.pinata");

const text = await fs.readFile(envPath, "utf8");
for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  // Strip surrounding quotes if present
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (key === "JWT") process.env.PINATA_JWT = value;
  if (key === "GATEWAY") process.env.PINATA_GATEWAY = value;
}

if (!process.env.PINATA_JWT || !process.env.PINATA_GATEWAY) {
  console.error(
    "FATAL: .env.pinata must contain JWT=... and GATEWAY=... entries.",
  );
  process.exit(1);
}

await import("./compression-overhead-benchmark-pinata.mjs");
