'use strict';
/**
 * esbuild bundler for the browser frontend.
 *
 * Produces a single app.js plus two standalone vendor bundles (viem and
 * @coinbase/cdp-core) that are resolved through the page import map. This
 * keeps the request count low (no code-splitting fragmentation) while still
 * isolating cdp-core, whose internal circular dependencies only bundle
 * correctly as a self-contained entry.
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
const esbuild = require('esbuild');

const srcRoot = path.resolve(__dirname, '../src/js');
const distRoot = path.resolve(__dirname, '../dist/js');

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

const common = {
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  treeShaking: true,
  sourcemap: false,
  plugins: [nodeBuiltinsStub],
  logLevel: 'info',
};

async function build() {
  // 1. Shared vendor bundles (resolved by the page import map). viem is used
  //    by both the app and cdp-core, so bundling it once keeps a single copy.
  await esbuild.build({
    ...common,
    stdin: {
      contents: 'export * from "viem"; export * from "viem/utils";',
      resolveDir: srcRoot,
      sourcefile: 'viem-entry.js',
    },
    bundle: true,
    outfile: path.join(distRoot, 'vendor/viem.js'),
    format: 'esm',
  });

  await esbuild.build({
    ...common,
    alias: { zustand: 'zustand/vanilla' },
    stdin: {
      contents: 'export * from "@coinbase/cdp-core";',
      resolveDir: srcRoot,
      sourcefile: 'cdp-core-entry.js',
    },
    bundle: true,
    external: ['viem', 'viem/utils'],
    outfile: path.join(distRoot, 'vendor/cdp-core.js'),
    format: 'esm',
  });

  // 2. Main app bundle — single file (no code-splitting). cdp-core and viem
  //    are external and resolve through the page import map.
  await esbuild.build({
    ...common,
    alias: {
      '@gltf-transform/core': GLTF_TRANSFORM_VENDOR,
      zustand: 'zustand/vanilla',
    },
    entryPoints: [path.join(srcRoot, 'app-entry.ts')],
    bundle: true,
    external: ['@coinbase/cdp-core', 'viem', 'viem/utils'],
    outfile: path.join(distRoot, 'app.js'),
    format: 'esm',
  });

  // 3. Self-contained glTF worker (module workers get no import map).
  await esbuild.build({
    ...common,
    alias: { '@gltf-transform/core': GLTF_TRANSFORM_VENDOR },
    entryPoints: [path.join(srcRoot, 'workers/gltf-worker.ts')],
    bundle: true,
    outfile: path.join(distRoot, 'workers/gltf-worker.js'),
    format: 'esm',
  });

  // 4. Classic (non-module) synchronous head scripts.
  for (const rel of ['engine/theme-init', 'app/initial-view']) {
    await esbuild.build({
      platform: 'browser',
      target: ['es2022'],
      minify: true,
      sourcemap: false,
      entryPoints: [path.join(srcRoot, rel + '.ts')],
      bundle: false,
      outfile: path.join(distRoot, rel + '.js'),
      format: 'iife',
    });
  }
}

build().catch((err) => {
  console.error('### ERROR: bundle failed', err);
  process.exit(1);
});
