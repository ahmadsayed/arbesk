// Production server build: compiles src/index.ts into a single-file binary
// with embedded JavaScriptCore bytecode (faster startup). The plugin stubs
// @coinbase/cdp-sdk's optional @x402/* peers (x402 payments are unused) so
// the bundle stays free of Solana/EVM payment dependencies — see
// scripts/x402-stub.mjs.
//
// Usage: bun scripts/build-server.mjs   (or: bun run build:server)

/** The Bun runtime global — this script only ever runs under `bun`, and
 *  pulling in @types/bun would pollute the whole program's fetch types. */
const Bun = /** @type {any} */ (globalThis).Bun;

const x402Stub = {
  name: "x402-optional-peer-stub",
  /** @param {any} build */
  setup(build) {
    build.onResolve({ filter: /^@x402(\/|$)/ }, () => ({
      path: new URL("./x402-stub.mjs", import.meta.url).pathname,
    }));
  },
};

// ipfs-utils (transitive via ipfs-http-client) picks its fetch implementation
// with computed `require(variable)` calls that bundlers cannot follow. The
// server binary always runs under Bun, so resolve the Node implementations
// statically.
const STATIC_IMPL_OVERRIDES = [
  [/ipfs-utils[/\\]src[/\\]http[/\\]fetch\.js$/, "module.exports = require('./fetch.node.js')"],
  [/ipfs-utils[/\\]src[/\\]fetch\.js$/, "module.exports = require('native-fetch')"],
];
const ipfsUtilsFetch = {
  name: "ipfs-utils-static-fetch",
  /** @param {any} build */
  setup(build) {
    for (const [filter, contents] of STATIC_IMPL_OVERRIDES) {
      build.onLoad({ filter }, () => ({ contents, loader: "js" }));
    }
  },
};

// brotli-wasm's ESM entry initializes by fetching its .wasm via a URL computed
// from import.meta.url — which inside a compiled binary points into the
// virtual $bunfs and fails. Replace the package with a shim that embeds the
// WASM (`with { type: "file" }`) and initializes the web glue from its bytes.
// Resolved from @arbesk/asset-core, the workspace that depends on it (bun's
// isolated installs don't expose it at the root).
const path = await import("node:path");
const { createRequire } = await import("node:module");
const brotliPkgDir = path.dirname(
  createRequire(new URL("../packages/asset-core/package.json", import.meta.url)).resolve("brotli-wasm")
);
const brotliWasmShim = {
  name: "brotli-wasm-embedded-shim",
  /** @param {any} build */
  setup(build) {
    build.onResolve({ filter: /^brotli-wasm$/ }, () => ({
      path: "brotli-wasm-shim",
      namespace: "brotli-wasm-shim",
    }));
    build.onLoad({ filter: /.*/, namespace: "brotli-wasm-shim" }, () => ({
      contents: `
        import init, * as api from ${JSON.stringify(path.join(brotliPkgDir, "pkg.web", "brotli_wasm.js"))};
        import wasmPath from ${JSON.stringify(path.join(brotliPkgDir, "pkg.web", "brotli_wasm_bg.wasm"))} with { type: "file" };
        const bytes = await Bun.file(wasmPath).arrayBuffer();
        await init(bytes);
        export default Promise.resolve(api);
      `,
      loader: "js",
    }));
  },
};

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  compile: { outfile: "dist/arbesk-server" },
  bytecode: true,
  format: "esm",
  target: "bun",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [x402Stub, ipfsUtilsFetch, brotliWasmShim],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`[BUILD] dist/arbesk-server compiled (${result.outputs.length} output(s))`);
