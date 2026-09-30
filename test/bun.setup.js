/**
 * bun test preload — runs once per test process, before any test file.
 *
 * Resolves the @arbesk/* workspace packages to their TypeScript sources so
 * tests run without `bun run build:packages`. The bare specifiers end in `.js`
 * (the emitted-ESM convention); Bun's own resolver would send them to
 * packages/<name>/dist.
 */
import { afterEach } from "bun:test";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const PACKAGES = ["asset-core", "nostr", "wallet", "authz", "ai-asset-gen", "cad-gen"];

Bun.plugin({
  name: "arbesk-workspace-src",
  setup(build) {
    for (const name of PACKAGES) {
      const src = path.join(ROOT, "packages", name, "src");
      build.onResolve({ filter: new RegExp(`^@arbesk/${name}$`) }, () => ({
        path: path.join(src, "index.ts"),
      }));
      build.onResolve({ filter: new RegExp(`^@arbesk/${name}/(.+)\\.js$`) }, (args) => ({
        path: path.join(src, args.path.slice(`@arbesk/${name}/`.length).replace(/\.js$/, ".ts")),
      }));
    }
  },
});

// Code under test (the besk CLI) sets process.exitCode. Bun ignores
// `process.exitCode = undefined` (Node resets on it), and the value outlives
// the test: it would leak into the next test and become this process's exit
// status even when every test passed. Reset it after each test; tests assert
// on it inside the test body.
afterEach(() => {
  process.exitCode = 0;
});
