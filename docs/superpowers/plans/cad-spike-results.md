# Cad spike results — Manifold WASM in `manifold-3d@3.5.3`

Task 1 of `docs/superpowers/plans/2026-09-11-cad-generation.md`.
Probe code is throwaway (`scripts/cad-spike.mjs`, `scripts/cad-spike-child.mjs` — deleted in Task 14).

**Environment:** worktree `/home/ahmedh/Projects/arbesk/.worktrees/cad-gen` @ `cd3abe0`,
Bun **1.4.2** (`744846f84`, Linux x64), Node **v22.22.2**. All commands run from the worktree root.

## Decision

**PASS — the Manifold kernel loads and produces solids in all four runtime contexts the brief
targets.** The plan is valid; downstream tasks may proceed.

Two corrections to the plan's snippets are **mandatory** (both proven below, both would break every
later task verbatim):

1. **`wasm.setup()` is required.** `manifold-3d@3.5.3` does not install its JS API until
   `setup()` is called. Every snippet in the brief and in the plan omits it, so
   `Manifold.cube` is `undefined`. `ManifoldModule` (plan line 453) needs `setup: () => void`.
2. **`locateFile` must be fed a `PROJECT_ROOT`-relative absolute path, not an
   `import.meta.url`-relative one.** The brief's step-8 snippet works under `bun` and **still
   fails in the compiled binary**, because `import.meta.url` there is
   `file:///$bunfs/root/cad-spike`. Nothing in this repo can be resolved from
   `import.meta.url` at runtime (see `src/api/project-root.ts` and the brotli shim in
   `scripts/build-server.mjs`).

### The loader call that works

```js
import path from "node:path";
import Module from "manifold-3d";

const wasmDir = process.env.CAD_MANIFOLD_WASM_DIR ??
  path.resolve(process.cwd(), "node_modules", "manifold-3d"); // = PROJECT_ROOT-relative

const wasm = await Module({ locateFile: (file) => path.join(wasmDir, file) });
wasm.setup();
const { Manifold } = wasm;
```

- **Loader call:** `Module({ locateFile })` — the Emscripten option, exactly as the brief
  predicted. `locateFile` receives the bare filename `"manifold.wasm"` and must return an
  **absolute** path to it.
- **Wasm path passed:** `/home/ahmedh/Projects/arbesk/.worktrees/cad-gen/node_modules/manifold-3d/manifold.wasm`
  (541,470 bytes; run `du -shL` — the top-level entry is a Bun store symlink so plain
  `du -sh` reports 4.0K).
- **In the compiled server this must come from `PROJECT_ROOT`** (`src/api/project-root.ts` =
  `process.env.ARBESK_ROOT || process.cwd()`), for the same reason the brotli shim exists:
  a compiled binary's module URL is virtual.

---

## Step 1 — Add the dependency to the shared catalog — **PASS (with a required follow-on)**

```diff
--- a/package.json
+++ b/package.json
@@ -16,7 +16,8 @@
       "zod": "^3.25.76",
       "@swc/core": "^1.16.0",
       "nostr-tools": "^2.23.5",
-      "fast-xml-parser": "^4.5.3"
+      "fast-xml-parser": "^4.5.3",
+      "manifold-3d": "^3.5.3"
     }
```

**A catalog entry alone installs nothing.** Bun treats `workspaces.catalog` as a version registry
only; a package becomes installable only when some workspace references it as `"catalog:"`. After
step 1 + `bun install`, Bun reported `Checked 844 installs across 884 packages (no changes)` and
`node_modules/manifold-3d` **did not exist** — so step 2's expected output was unreachable, and so
was the step-3 probe (`import Module from "manifold-3d"`).

**Follow-on applied** (repo convention, `AGENTS.md §4` — "add with `bun add <pkg> --catalog`"):

```
$ bun add manifold-3d --catalog
installed manifold-3d@3.5.3 with binaries:
 - manifold-cad
32 packages installed [3.83s]
```

```diff
   "dependencies": {
     ...
     "ipfs-http-client": "^60.0.0",
+    "manifold-3d": "catalog:",
     "morgan": "^1.11.0",
```

(Bun also re-encoded the `description` field's `\u2014` escape to a literal em dash on that write;
that cosmetic line was reverted, so the committed `package.json` diff is only the two lines above.)

**Controller decision point:** if `manifold-3d` is meant to be owned by the future
`packages/cad-gen` rather than the root, move the `"catalog:"` reference there in Task 5. It has to
live *somewhere* a workspace can resolve it, or nothing downstream installs.

## Step 2 — Install and record what lands — **PASS**

```
$ ls node_modules/manifold-3d/manifold.wasm
node_modules/manifold-3d/manifold.wasm                         # exit 0

$ du -sh node_modules/manifold-3d
4.0K    node_modules/manifold-3d                               # symlink into the Bun store

$ ls -d node_modules/esbuild-wasm 2>/dev/null || echo "esbuild-wasm not installed"
esbuild-wasm not installed                                     # <- literal command output

$ du -shL node_modules/manifold-3d                             # dereferenced, for weight
2.8M    node_modules/manifold-3d
```

Real payload: `manifold.wasm` 541,470 B · `manifold.js` (Emscripten glue) 74,762 B ·
`manifold.d.ts` + `*-types.d.ts` ~130 KB · `lib/`, `dist/`, `bin/` (the `manifold-cad` CLI).
The lockfile grew by **60 package entries** (`bun.lock` `+122` lines, 0 removed).

### `esbuild-wasm` peer — installed as a peer, **not hoisted to the root**

The brief's literal `ls -d node_modules/esbuild-wasm` says "not installed", and that is misleading.
Bun **did** auto-install it, inside the isolated store:

```
$ ls -ld node_modules/.bun/node_modules/esbuild-wasm
lrwxrwxrwx ... node_modules/.bun/node_modules/esbuild-wasm -> ../esbuild-wasm@0.27.7/node_modules/esbuild-wasm
$ du -shL node_modules/.bun/node_modules/esbuild-wasm
14M     node_modules/.bun/node_modules/esbuild-wasm
```

`manifold-3d`'s `package.json` declares `"peerDependencies": { "esbuild-wasm": "^0.27.3" }`.
**Accepted install-time weight: +14 MB** (plus a second copy of the `@gltf-transform` 4.5.0 family
next to the repo's pinned 4.1.2). It is never imported by our code path and `bun build --compile`
only bundles what is imported — confirmed: the compiled probe bundles **2 modules** and runs with
only `manifold.wasm` on disk (see step 8).

**Sandbox `EROFS` note:** the brief's `BUN_TMPDIR`/`TMPDIR` workaround was **not needed** — no
`EROFS accessing temporary directory` error occurred at any point (`bun install`, `bun build`,
`bun build --compile` all wrote their scratch files normally).

## Step 3 — Write the kernel probe — **PASS (file written verbatim; see step 4)**

`scripts/cad-spike.mjs` created exactly as briefed.

## Step 4 — Run it under Bun — **FAIL as written / PASS after one-line API fix**

```
$ bun scripts/cad-spike.mjs
2 | import Module from "manifold-3d";
3 |
4 | const wasm = await Module();
5 | const { Manifold } = wasm;
6 |
7 | const box = Manifold.cube([60, 40, 10], true);
                         ^
TypeError: Manifold.cube is not a function. (In 'Manifold.cube([60, 40, 10], !0)', 'Manifold.cube' is undefined)
      at /home/ahmedh/Projects/arbesk/.worktrees/cad-gen/scripts/cad-spike.mjs:7:22

Bun v1.4.2 (Linux x64)
[exit 1]
```

**This is not a WASM failure.** `await Module()` resolved — the .wasm was found, instantiated and
the Emscripten runtime booted. The API surface is simply registered lazily. From
`node_modules/manifold-3d/manifold.js`:

```js
var _ManifoldInitialized = false;
Module.setup = function() {
  if (_ManifoldInitialized) return;
  _ManifoldInitialized = true;
  Module.initTBB();
  ...                                 // <- installs Module.Manifold.cube, .cylinder, …
};
```

Proof, before/after:

```
typeof Manifold.cube before setup: undefined
typeof Manifold.cube after setup:  function
```

With `wasm.setup();` inserted after `await Module()`, the brief's script passes **exactly** as its
"Expected" line predicts:

```
$ bun scripts/cad-spike.mjs
{
  "status": "NoError",
  "numTri": 144,
  "numVert": 72,
  "volume": 23719.069936296775,
  "bbox": { "min": [-30, -20, -5], "max": [30, 20, 5] }
}
mesh numProp=3 vertProperties=216 triVerts=432
[exit 0]
```

Checked against the brief's expectations:

| Brief's expectation | Observed | Verdict |
|---|---|---|
| `status` is `"NoError"` | `"NoError"` | ✅ |
| `numTri` > 0 | `144` | ✅ |
| `volume` ≈ 23717 (within a few %) | `23719.07` (+0.008 %) | ✅ |
| `bbox` min ≈ `[-30,-20,-5]` | exactly `[-30,-20,-5]` | ✅ |
| `bbox` max ≈ `[30,20,5]` | exactly `[30,20,5]` | ✅ |
| `triVerts.length` divisible by 3 | `432` (= `144` tris × 3) | ✅ |

The 1.8 mm³ gap from the brief's 23717 is arithmetic, not error: a 32-segment cylinder
inscribes `0.5·32·3²·sin(11.25°) = 28.093` per unit height vs `π·9 = 28.274`, and
`24000 − 10·28.093 = 23719.07` — the observed value to the last digit. `vertProperties` 216 =
72 verts × 3 props, consistent with `numVert` and `numProp` 3.

## Step 5 — Write the child-process kill probe — **PASS (file written verbatim; see step 6)**

## Step 6 — Prove the parent can kill a runaway child holding the kernel — **FAIL as written / PASS after the same fix**

Exactly the brief's command block (heredoc + `mkdir -p .tmp && bun .tmp/cad-spike-kill.mjs`), run
verbatim against the brief-literal child:

```
$ mkdir -p .tmp && bun .tmp/cad-spike-kill.mjs
TIMEOUT: never became ready
[exit 1]

# child stderr:
4 | Manifold.cube([1, 1, 1], true); // hold a live solid
             ^
TypeError: Manifold.cube is not a function. (In 'Manifold.cube([1, 1, 1], !0)', 'Manifold.cube' is undefined)
      at .../scripts/cad-spike-child.mjs:4:10
```

Same root cause as step 4 — the child died on the missing `setup()` before printing
`CHILD_READY`. With `wasm.setup();` added, the brief's exact block:

```
$ mkdir -p .tmp && bun .tmp/cad-spike-kill.mjs
killed after 18ms
[exit 0]
```

Stable and clean across repeats (3/3 runs at 18 ms, all exit 0):

```
killed after 18ms   [run 1 exit 0]
killed after 18ms   [run 2 exit 0]
killed after 18ms   [run 3 exit 0]
--- orphan check: no orphaned child processes
```

**18 ms → 0.12 % of the 15000 ms budget** (a later re-run measured 17 ms — jitter, not a
finding). `SIGKILL` is sufficient; no zombie
`bun` child survived, so the plan's "fresh child per attempt + hard timeout" design (spec §5) is
enforceable. This is the property the whole server-side validation sandbox rests on.

Minor: the brief's block runs `cat >` **before** `mkdir -p .tmp`, so on a clean checkout it fails on
the first line. Harmless here (`.tmp` already existed) but worth swapping.

## Step 7 — Compiled-binary probe — **PASS (fails exactly as predicted)**

```
$ mkdir -p .tmp && bun build --compile scripts/cad-spike.mjs --outfile .tmp/cad-spike
   [5ms]  bundle  2 modules
  [73ms] compile  .tmp/cad-spike
[build exit 0]

$ .tmp/cad-spike
failed to asynchronously prepare wasm: Error: ENOENT: no such file or directory, open '/$bunfs/root/manifold.wasm'
Aborted(Error: ENOENT: no such file or directory, open '/$bunfs/root/manifold.wasm')
RuntimeError: Aborted(Error: ENOENT: no such file or directory, open '/$bunfs/root/manifold.wasm'). Build with -sASSERTIONS for more info.
    at abort (/$bunfs/root/cad-spike:740:13)
    at instantiateArrayBuffer (/$bunfs/root/cad-spike:776:12)

Bun v1.4.2 (Linux x64)
[run exit 1]
```

**This is the expected finding, not a task failure** — same class of failure
`scripts/build-server.mjs` documents for `brotli-wasm` (lines 41-46). Without `locateFile`, the
Emscripten glue calls `new URL("manifold.wasm", import.meta.url)`, and inside a compiled binary
`import.meta.url` is the virtual `file:///$bunfs/root/cad-spike`. The probe was **not** "fixed" here;
step 8 is the fix.

## Step 8 — Prove `locateFile` fixes it — **FAIL with the brief's literal snippet / PASS with the PROJECT_ROOT-relative path**

Applying the brief's step-8 edit verbatim:

```js
const here = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(here, "..", "node_modules", "manifold-3d");
const wasm = await Module({ locateFile: (file) => path.join(wasmDir, file) });
```

```
$ bun scripts/cad-spike.mjs
... full correct JSON ...
wasmDir=/home/ahmedh/Projects/arbesk/.worktrees/cad-gen/node_modules/manifold-3d
importMetaUrl=file:///home/ahmedh/Projects/arbesk/.worktrees/cad-gen/scripts/cad-spike.mjs
[exit 0]                                        <- source run: OK

$ bun build --compile scripts/cad-spike.mjs --outfile .tmp/cad-spike && .tmp/cad-spike
failed to asynchronously prepare wasm: Error: ENOENT: no such file or directory, open '/$bunfs/node_modules/manifold-3d/manifold.wasm'
RuntimeError: Aborted(...)
[run exit 1]                                    <- compiled run: STILL fails
```

**The brief's "Expected: both succeed" does not hold.** `import.meta.url` is virtual in the compiled
binary (`file:///$bunfs/root/cad-spike`), so `here` = `/$bunfs/root` and the path collapses to
`/$bunfs/node_modules/manifold-3d`. The brief's own prose already says the compiled path "must
resolve from `PROJECT_ROOT`"; the code it supplies does not do that.

Replacing the `import.meta.url` base with a `PROJECT_ROOT`-relative base (**the loader contract for
later tasks**) makes **both** runs pass:

```
$ bun scripts/cad-spike.mjs
{ "status": "NoError", "numTri": 144, "numVert": 72, "volume": 23719.069936296775,
  "bbox": { "min": [-30,-20,-5], "max": [30,20,5] } }
mesh numProp=3 vertProperties=216 triVerts=432
wasmDir=.../node_modules/manifold-3d  cwd=.../cad-gen
[exit 0]

$ .tmp/cad-spike
{ "status": "NoError", "numTri": 144, ... "volume": 23719.069936296775, ... }
mesh numProp=3 vertProperties=216 triVerts=432
wasmDir=.../node_modules/manifold-3d  cwd=.../cad-gen
importMetaUrl=file:///$bunfs/root/cad-spike  (import.meta.url dirname=/$bunfs/root)   <- the trap
[exit 0]
```

### Deployment consequences (extra evidence, beyond the brief)

The compiled binary resolves `wasmDir` from `cwd`, so it is **not** location-independent — proven:

```
$ (cd /tmp && .../.tmp/cad-spike)
failed to asynchronously prepare wasm: Error: ENOENT: no such file or directory, open '/tmp/node_modules/manifold-3d/manifold.wasm'
[exit 1]

$ (cd /tmp && CAD_MANIFOLD_WASM_DIR=.../node_modules/manifold-3d .../.tmp/cad-spike)
{ "status": "NoError", ... }                          # env override neutralises any cwd
[exit 0]
```

**Only `manifold.wasm` is needed on disk** — the glue is bundled into the binary by
`bun build --compile` ("bundle 2 modules"). Proven with a wasm-only directory standing in for a
slim runtime image:

```
$ mkdir -p .tmp/wasm-only && cp node_modules/manifold-3d/manifold.wasm .tmp/wasm-only/
$ CAD_MANIFOLD_WASM_DIR="$PWD/.tmp/wasm-only" .tmp/cad-spike
{ "status": "NoError", ... }  mesh numProp=3 vertProperties=216 triVerts=432
[exit 0]
```

That matters because `docker/app.Dockerfile` currently copies **no `node_modules`** into the
runtime stage (only `dist/arbesk-server`, `frontend/dist`, `blockchain/artifacts`, two HTML files,
and `.data/`). **`docker/app.Dockerfile` needs a line like
`COPY --from=builder /app/node_modules/manifold-3d/manifold.wasm ./node_modules/manifold-3d/manifold.wasm`**
(or the wasm must be embedded at build time, the way the brotli shim embeds `brotli_wasm_bg.wasm`
via `with { type: "file" }`). Without it the production server will ENOENT on first CAD validation.
A later task must own that; it is out of this spike's throwaway scope.

## Step 9 — Record results and commit — **PASS**

Committed on `feature/cad-gen` as **`498127c`** — `spike: verify manifold-3d loads under bun,
in a child, and compiled` (5 files changed, 621 insertions, 1 deletion). The pre-commit
`fallow audit --changed-since HEAD` gate **passed** — `✓ No issues in 9 changed files` — so no
`--no-verify` was needed. This line was corrected in a follow-up docs-only commit.

---

## Runtime matrix (the brief's "four runtimes", plus one bonus)

| # | Runtime | Command | Result |
|---|---|---|---|
| 1 | **Bun source** | `bun scripts/cad-spike.mjs` | ✅ NoError, vol 23719.07, bbox `[-30,-20,-5]..[30,20,5]` |
| 2 | **Bun spawned child** | `bun .tmp/cad-spike-kill.mjs` | ✅ `CHILD_READY` then `killed after 18ms` (SIGKILL, no orphan) |
| 3 | **Compiled binary, no `locateFile`** | `.tmp/cad-spike` | ❌ ENOENT `/$bunfs/root/manifold.wasm` — expected |
| 4 | **Compiled binary + `locateFile`→absolute path** | `.tmp/cad-spike` | ✅ NoError, identical geometry |
| + | **Node 22 source** (jest runs here) | `node scripts/cad-spike.mjs` | ✅ NoError, identical geometry |

## Files changed

- `package.json` — `workspaces.catalog` gains `"manifold-3d": "^3.5.3"` (step 1) and
  `dependencies` gains `"manifold-3d": "catalog:"` (required follow-on, see step 1).
- `bun.lock` — 60 new package entries (`+122` lines, 0 removed).
- `scripts/cad-spike.mjs` — new, throwaway probe (final form = brief + `setup()` +
  `PROJECT_ROOT`-relative `locateFile`).
- `scripts/cad-spike-child.mjs` — new, throwaway probe (brief + `setup()`).
- `docs/superpowers/plans/cad-spike-results.md` — this file.

Untracked and **not** committed: `.tmp/` (scratch kill probe, compiled binary, wasm-only dir).
Note: `.tmp` is **not** in `.gitignore` (`git check-ignore -v .tmp/x.mjs` → not ignored) despite the
task brief assuming it is, so it shows up in `git status`; the commit used the brief's explicit
`git add` list, so nothing from `.tmp/` was staged.
The brief's two probe scripts and `.tmp/` are deleted in Task 14.

## Self-review

- **Honest about every FAIL.** Step 4 and step 6 failed *as written*, and step 8 failed for the
  compiled binary *even with the brief's fix*; all three failures are recorded verbatim above
  rather than smoothed over. I did not report BLOCKED, because the brief's STOP trigger is "the
  kernel does not run under Bun **at all**" — it runs, and the failures were API-shape and
  path-resolution defects in the snippets, each fixed by one line and re-verified.
- **Deviation from the brief's file list is disclosed**, not hidden: `package.json` gained a
  `dependencies` entry the brief did not mention. Without it step 2's artifacts cannot exist.
- **Probes were not weakened** to make anything pass; the only edits are the two corrections, both
  annotated in-file with the observed error they fix.
- **What I did NOT verify — no claim is made about it.** The **browser** runtime. The design has
  the *client* execute Manifold code to produce GLB/3MF, but this brief has no browser step and I
  did not add one. `manifold.js` takes an Emscripten browser path (XHR/fetch + `import.meta.url`)
  and manifoldcad.org ships it, so it is very likely fine, but **it is untested here** and the
  frontend bundling/staging of `manifold.wasm` (mirroring the brotli web-build staging in
  `frontend/scripts/bundle.js`) is unproven. If the controller wants that gated before Task 5+,
  it needs its own spike step (Playwright could cover it).
- **Numbers cross-checked**, not just eyeballed: volume reconciles to the last digit against the
  32-segment inscribed polygon, `triVerts.length/3 == numTri`, `vertProperties.length/numProp == numVert`.
- **Volume is reported in mm³** by Manifold for these inputs; no unit conversion is done anywhere,
  which matches the plan's `unit: "mm"` parameter schema.

## Concerns / recommended follow-ups for the controller

1. **Plan snippet bug (blocking for every later task): add `wasm.setup()`.** Affects the brief,
   `packages/cad-gen/src/core/kernel.ts` callers, `backend/child.ts` (plan line 1072) and the
   `ManifoldModule` port (plan line 453). The port type needs `setup: () => void`.
2. **Plan snippet bug: `resolveWasmDir()` (plan lines 1132-1137) defaults to an
   `import.meta.url`-relative path**, which is exactly the virtual `/$bunfs` case the compiled
   server hits. The `CAD_MANIFOLD_WASM_DIR` override works, but the *default* must be
   `path.resolve(PROJECT_ROOT, "node_modules", "manifold-3d")`.
3. **`docker/app.Dockerfile` must ship `manifold.wasm` into the runtime stage** (541 KB; the JS
   glue is already bundled). No task in the current plan covers this and production would otherwise
   fail at first validation. Consider whether the deploy task (Task 13/14) absorbs it.
4. **Install weight:** +14 MB of `esbuild-wasm` peer (store-only, never bundled) and +60 lock
   entries with a duplicated `@gltf-transform` 4.5.0 family beside the pinned 4.1.2. Harmless at
   runtime, but it is real `bun install` and CI cost, and it is the kind of thing a
   `--frozen-lockfile` Docker build will now pay on every cache miss.
5. **`.tmp` is not gitignored** in this worktree, contrary to the task brief. A one-line
   `.gitignore` addition would prevent accidental commits of scratch binaries — I did not add it,
   since the brief scoped my edits and Task 14 deletes the probes anyway.
6. **Child-process child script path:** the plan runs the validation child as
   `bun src/backend/child.ts <request.json>` (plan line 1048). Under a compiled server there is no
   `bun` and no `src/backend/child.ts` on disk, so the production child needs either a second
   compiled binary or `process.execPath`-based re-exec. Not this spike's question, but it is the
   same class of `$bunfs` problem and Task 5 must not rediscover it the hard way.
