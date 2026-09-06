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

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  compile: { outfile: "dist/arbesk-server" },
  bytecode: true,
  format: "esm",
  target: "bun",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [x402Stub, ipfsUtilsFetch],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`[BUILD] dist/arbesk-server compiled (${result.outputs.length} output(s))`);
