'use strict';
/**
 * Bun.build bundler for the browser frontend (ported from esbuild).
 *
 * Produces a single app.js plus two standalone vendor bundles (viem and
 * @coinbase/cdp-core) that are resolved through the page import map. This
 * keeps the request count low (no code-splitting fragmentation) while still
 * isolating cdp-core, whose internal circular dependencies only bundle
 * correctly as a self-contained entry.
 *
 * Production tuning: NODE_ENV is defined as "production" (dead-code
 * elimination of dev branches in dependencies) and debugger statements are
 * dropped. console calls are kept — the frontend's console logging is
 * intentional diagnostics.
 *
 * Outputs:
 *   dist/js/app.js                    - main bundle (single file)
 *   dist/js/vendor/viem.js            - shared viem bundle
 *   dist/js/vendor/cdp-core.js        - cdp-core bundle (imports viem)
 *   dist/js/workers/gltf-worker.js    - self-contained module worker
 *   dist/js/engine/theme-init.js      - classic head script
 *   dist/js/app/initial-view.js       - classic head script
 */
const path = require('path');

/** Bun runtime global — this script runs under `bun`; the local binding keeps
 *  eslint/tsc happy without pulling @types/bun into the program. */
const Bun = /** @type {any} */ (globalThis).Bun;

const srcRoot = path.resolve(__dirname, '../src/js');
const distRoot = path.resolve(__dirname, '../dist/js');
const entriesDir = path.resolve(__dirname, 'entries');

// @gltf-transform/core ships node_modules index.modern.js, which references
// the Node 'Buffer' global (184 uses). Resolve it to the vendored esm.sh
// core.bundle.mjs + Buffer polyfill so the same known-good code runs in both
// the main thread and the worker.
const GLTF_TRANSFORM_VENDOR = path.join(
  srcRoot,
  'vendor/gltf-transform-core-4.1.2.js'
);

// workerpool's UMD bundle references node builtins in its node-only branches.
// Stub ONLY these genuinely node-only builtins. Do NOT stub buffer, crypto,
// events, stream, util, process, etc. — those are real npm packages (browser
// polyfills) that must resolve normally, or Buffer/crypto become undefined.
const NODE_BUILTINS = new Set(['worker_threads', 'os', 'child_process']);

const nodeBuiltinsStub = {
  name: 'node-builtins-stub',
  /** @param {any} build */
  setup(build) {
    build.onResolve({ filter: /^(node:)?[a-z_]+$/ }, (args) => {
      const name = args.path.replace(/^node:/, '');
      return NODE_BUILTINS.has(name)
        ? { path: args.path, namespace: 'node-builtin-stub' }
        : null;
    });
    build.onLoad({ filter: /.*/, namespace: 'node-builtin-stub' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js',
    }));
  },
};

// esbuild `alias` equivalent: redirect bare specifiers to concrete paths.
const aliasPlugin = (aliases) => ({
  name: 'alias',
  /** @param {any} build */
  setup(build) {
    for (const [from, to] of Object.entries(aliases)) {
      build.onResolve({ filter: new RegExp(`^${from.replace(/[/.@]/g, '\\$&')}$`) }, () => ({
        path: to,
      }));
    }
  },
});

const GLTF_ALIAS = { '@gltf-transform/core': GLTF_TRANSFORM_VENDOR };
const ZUSTAND_ALIAS = { zustand: require.resolve('zustand/vanilla') };

const common = {
  target: 'browser',
  minify: true,
  sourcemap: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  drop: ['debugger'],
  plugins: [nodeBuiltinsStub],
};

async function run(config, label) {
  const result = await Bun.build(config);
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`bundle failed: ${label}`);
  }
  const out = result.outputs[0];
  console.log(`[BUNDLE] ${label} → ${out.path} (${(out.size / 1024).toFixed(0)} KB)`);
}

async function build() {
  // 1. Shared vendor bundles (resolved by the page import map). viem is used
  //    by both the app and cdp-core, so bundling it once keeps a single copy.
  await run({
    ...common,
    entrypoints: [path.join(entriesDir, 'viem.js')],
    outdir: path.join(distRoot, 'vendor'),
    naming: 'viem.js',
    format: 'esm',
  }, 'vendor/viem.js');

  await run({
    ...common,
    entrypoints: [path.join(entriesDir, 'cdp-core.js')],
    outdir: path.join(distRoot, 'vendor'),
    naming: 'cdp-core.js',
    format: 'esm',
    external: ['viem', 'viem/utils'],
    plugins: [nodeBuiltinsStub, aliasPlugin(ZUSTAND_ALIAS)],
  }, 'vendor/cdp-core.js');

  // 2. Main app bundle — single file (no code-splitting). cdp-core and viem
  //    are external and resolve through the page import map.
  await run({
    ...common,
    entrypoints: [path.join(srcRoot, 'app-entry.ts')],
    outdir: distRoot,
    naming: 'app.js',
    format: 'esm',
    external: ['@coinbase/cdp-core', 'viem', 'viem/utils'],
    plugins: [nodeBuiltinsStub, aliasPlugin({ ...GLTF_ALIAS, ...ZUSTAND_ALIAS })],
  }, 'app.js');

  // 3. Self-contained glTF worker (module workers get no import map).
  await run({
    ...common,
    entrypoints: [path.join(srcRoot, 'workers/gltf-worker.ts')],
    outdir: path.join(distRoot, 'workers'),
    naming: 'gltf-worker.js',
    format: 'esm',
    plugins: [nodeBuiltinsStub, aliasPlugin(GLTF_ALIAS)],
  }, 'workers/gltf-worker.js');

  // 4. Classic (non-module) synchronous head scripts.
  for (const rel of ['engine/theme-init', 'app/initial-view']) {
    await run({
      entrypoints: [path.join(srcRoot, rel + '.ts')],
      outdir: path.join(distRoot, rel, '..'),
      naming: path.basename(rel) + '.js',
      format: 'iife',
      target: 'browser',
      minify: true,
      sourcemap: 'none',
    }, rel + '.js');
  }
}

build().catch((err) => {
  console.error('### ERROR: bundle failed', err);
  process.exit(1);
});
