// @ts-nocheck
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TMP_DIR = path.resolve("coverage/tmp/e2e");

function cleanTmp() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

function runE2E(args) {
  return new Promise((resolve) => {
    const child = spawn(
      "npm",
      ["run", "test:e2e", "--", ...args],
      {
        stdio: "inherit",
        env: { ...process.env, E2E_COVERAGE: "1" },
      },
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function mergeE2ECoverage() {
  await import("./merge-e2e-coverage.mjs");
}

async function main() {
  cleanTmp();
  const args = process.argv.slice(2);
  const exitCode = await runE2E(args);
  try {
    await mergeE2ECoverage();
  } catch (err) {
    console.error("[E2E COV] merge failed:", err.message);
  }
  process.exit(exitCode);
}

main();
