# CAD Parameter Editor and Colour in Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Studio user edit a CAD part's parameters (lengths and colours) in the Inspector, preview the rebuilt part live, and save it as a new 3MF version. Colour is declared in the Manifold script.

**Architecture:** `@arbesk/cad-gen` core gains a `color` parameter type, a `color(part, hex)` prelude helper (kernel-read tags), `<basematerials>` export and `usedParameterNames(code)`. The Studio gets a Parameters Inspector section backed by a pending-edit store. A debounced worker render swaps the node's meshes from local bytes, and a new save step uploads the preview 3MF and re-applies older baked colours.

**Tech Stack:** TypeScript, Bun test (`bun:test`, `// @test-env dom` for DOM suites), manifold-3d (WASM, in worker), Babylon.js (CDN global), Pug/SCSS, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-20-cad-parameter-editor-design.md` · **Mockup:** https://claude.ai/artifact/4w7gVJ3wPPL1SBetry1NiE

## Global Constraints

- Execute in a linked worktree (`arbesk-worktree` skill), branch `feat/cad-parameter-editor`.
- `packages/cad-gen/src/core/` stays free of Node and browser globals; no imports from `frontend/` or `src/`.
- Existing designs (no `type`, no `color()`) must produce byte-identical 3MF output and parse unchanged.
- Colour value format: `/^#[0-9a-fA-F]{6}$/`, stored lowercase. 3MF `displaycolor` is `#RRGGBBFF`.
- `PRELUDE_VERSION` bumps to `"2026-10-20.1"`; `CONTRACT_VERSION` stays `2`.
- Preview debounce: 300 ms; at most one worker render in flight; newest values win.
- Copy (verbatim): section title `Parameters`; View-mode hint `Switch to Edit to change parameters.`; mismatch `This part was made with a newer CAD runtime — refresh the page.`; toast `Colours reset on part-N (the part count changed).` (comma-joined names when several).
- Frontend imports use `.ts` specifiers; SDK subpaths end `.js`; `import type` for type-only imports.
- After changes to `packages/*`: `bun run build` in that package before frontend tests that consume `dist/`.
- UI work follows the `edit-ui` skill (Graphite/Paper tokens, WCAG 2.2 AA, labelled controls).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Destructured or aliased parameter reads** (`const { width: w } = P`, `const p = P; p.width`): every parameter a user expects to see must appear. The aliasing case must fall back to `dynamic: true` (Task 2 test `aliasing P marks dynamic`).
2. **Typing a value outside min–max, or clearing the number box** (empty string → `NaN`): the value is clamped or ignored and never reaches the kernel as `NaN` (Task 8 test `empty or non-numeric input is ignored`).
3. **Saving while a render is still running**: the save must wait for that render or refuse. It must never upload stale bytes (Task 10 test `waits for in-flight render`).
4. **Undo after save**: the undo stack must not resurrect pre-save values as a pending edit against the new CID without a re-render (Task 7 test `undo after save re-renders and marks dirty`).
5. **Switching selection mid-render**: a render result for node A arriving while node B is selected must update A only (Task 7 test `result applies to the node it was scheduled for`).

---

### Task 1: Colour parameter type

**Files:**
- Modify: `packages/cad-gen/src/types.ts:4-12`, `packages/cad-gen/src/core/document.ts:19-34,74-85`, `packages/cad-gen/src/index.ts`, `src/api/schemas.ts:351-357`
- Test: `test/cad-gen/document.test.js`, `test/api/generations-cad.test.js`

**Interfaces:**
- Produces: `CadLengthParameter`, `CadColorParameter`, `CadParameter = CadLengthParameter | CadColorParameter` (exported types); `isColorParameter(p: CadParameter): p is CadColorParameter`; `validateParameterOverrides(design, overrides: Record<string, number | string>): string[]` (returns undeclared names AND names whose override kind mismatches the declared type).

- [ ] **Step 1: Write failing tests** in `document.test.js`:
  - `parses a colour parameter and lowercases it`: `parseDesign({code:"return box(P.w,1,1)", parameters:{w:{value:1,unit:"mm"}, c:{type:"color", value:"#D33A2C"}}})` → `parameters.c` equals `{type:"color", value:"#d33a2c"}`.
  - `rejects bad hex`: value `"red"` and `"#d33"` each throw `CadDesignError` with message containing `"c"`.
  - `rejects unit/min/max on a colour`: `{type:"color", value:"#000000", unit:"mm"}` throws.
  - `rejects an unknown type`: `{type:"angle", value:1}` throws.
  - `length parameters unchanged`: an existing fixture design parses to the same object as before (`toEqual` on the snapshot of today's output, no `type` key added).
  - `override kind mismatch`: `validateParameterOverrides(design, { c: 5, w: "#000000" })` → `["c","w"]`.
  - In `generations-cad.test.js`: `accepts a colour parameter in priorDesign`. A POST with `priorDesign.parameters.c = {type:"color", value:"#112233"}` is not 400.
- [ ] **Step 2: Run** `bun run test -- test/cad-gen/document.test.js test/api/generations-cad.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `parseParameter` branches on `p.type` (`undefined | "length"` → today's code path unchanged; `"color"` → hex check, no other keys kept except `label`). Zod: `cadParameterSchema` becomes `z.union([colorSchema, lengthSchema])` with `colorSchema = z.object({ type: z.literal("color"), value: z.string().regex(/^#[0-9a-fA-F]{6}$/), label: z.string().max(200).optional() }).strict()`, and `lengthSchema` = today's object plus `type: z.literal("length").optional()`. Export `isColorParameter` from `index.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `bun run test -- test/cad-gen/` and confirm nothing else regressed.
- [ ] **Step 5: Commit** `feat(cad-gen): colour parameter type`.

### Task 2: `usedParameterNames`

**Files:**
- Modify: `packages/cad-gen/src/core/document.ts` (next to `referencedIdentifiers`), `packages/cad-gen/src/index.ts`
- Test: `test/cad-gen/document.test.js`

**Interfaces:**
- Produces: `usedParameterNames(code: string): { names: string[]; dynamic: boolean }`. `names` is deduped, in first-seen order.

- [ ] **Step 1: Write failing tests:**
  - `dot access`: `"return box(P.width, PARAMETERS.depth, P.width)"` → `{names:["width","depth"], dynamic:false}`.
  - `bracket literal`: `'P["a"] + P[\'b\']'` → `["a","b"]`.
  - `destructuring with alias and default`: `"const { a, b: bee, c = 2 } = P;"` → `["a","b","c"]`.
  - `ignores comments and strings`: `"// P.ghost\nconst s = 'P.fake'; return box(P.real,1,1)"` → `["real"]`.
  - `computed key marks dynamic`: `"P[name]"` → `dynamic:true`.
  - `aliasing P marks dynamic`: `"const p = P; return box(p.w,1,1)"` and `"f(PARAMETERS)"` → `dynamic:true`.
- [ ] **Step 2: Run** `bun run test -- test/cad-gen/document.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Blank out the non-code spans with the existing scanner (replace comment/string contents with spaces, keeping string text available for the bracket-literal case). Then regex passes for: `\b(?:P|PARAMETERS)\.([A-Za-z_$][\w$]*)`, `\b(?:P|PARAMETERS)\[\s*(["'])(\w+)\1\s*\]`, and `\{([^}]*)\}\s*=\s*(?:P|PARAMETERS)\b` (split on `,`, take the key before `:`/`=`). `dynamic` = any `\b(?:P|PARAMETERS)\b` occurrence not consumed by those three patterns.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(cad-gen): usedParameterNames`.

### Task 3: `color()` prelude helper and kernel tags

**Files:**
- Modify: `packages/cad-gen/src/core/prelude.ts` (`PRELUDE_NAMES`, `PreludeOptions`, `buildPrelude`), `packages/cad-gen/src/core/kernel.ts` (`parameterValues`, `run`), `packages/cad-gen/src/types.ts` (`CadMesh`), `packages/cad-gen/src/core/contract.ts`
- Test: `test/cad-gen/prelude.test.js`, `test/cad-gen/kernel-assembly.test.js`

**Interfaces:**
- Consumes: `CadColorParameter` (Task 1).
- Produces: `CadMesh.color?: string` (lowercase `#rrggbb`) on `KernelRunResult.parts[i]`; `PreludeOptions.colorTags?: WeakMap<object, string>`; `PRELUDE_VERSION = "2026-10-20.1"`.

- [ ] **Step 1: Write failing tests** (use the existing `FakeManifold` pattern in `kernel-assembly.test.js`):
  - `color() tags a returned part`: code `"return [color(box(1,1,1), P.c), box(1,1,1)]"` with `c: {type:"color", value:"#112233"}` → `parts[0].color === "#112233"`, `parts[1].color === undefined`.
  - `a boolean after color() drops the tag`: `"return color(box(1,1,1),'#112233').subtract(box(1,1,1))"` → `parts[0].color === undefined`.
  - `bad hex throws`: `"return color(box(1,1,1),'blue')"` → `CadKernelError` with message containing `color needs a #rrggbb hex`.
  - `colour parameters reach the script as strings`: `"if (typeof P.c !== 'string') throw new Error('x'); return box(1,1,1)"` runs.
  - `untagged design parts unchanged`: today's single-solid fixture → `parts` deep-equals the pre-change output (no `color` key).
  - `prelude.test.js`: `PRELUDE_NAMES` includes `"color"`.
- [ ] **Step 2: Run** `bun run test -- test/cad-gen/kernel-assembly.test.js test/cad-gen/prelude.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `run()`, create a fresh `WeakMap` per run and pass it to `buildPrelude` as `colorTags`. `color(part, hex)` validates the hex, does `colorTags.set(part, hex.toLowerCase())`, and returns `part`. After `assertManifold`, read each returned part's tag before `withoutFlakes` (which may replace the instance) and set it on that part's `CadMesh`. `parameterValues` returns `Record<string, number | string>`. Bump `PRELUDE_VERSION`.
- [ ] **Step 4: Run** the same files, then `bun run test -- test/cad-gen/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cad-gen): color() prelude helper`.

### Task 4: 3MF exporter writes colours

**Files:**
- Modify: `packages/cad-gen/src/core/export/three-mf.ts` (`objectXml`, `buildModelXml`)
- Test: `test/cad-gen/exporters.test.js`

**Interfaces:**
- Consumes: `CadMesh.color` (Task 3).
- Produces: model XML with `<basematerials id="{n+1}">` (n = part count) holding one `<base name="#rrggbb" displaycolor="#RRGGBBFF"/>` per distinct colour, in first-use order. Coloured objects carry `pid="{n+1}" pindex="{i}"`.

- [ ] **Step 1: Write failing tests:**
  - `writes basematerials for coloured parts`: two parts, colours `#112233` and none → after unzip, `parse3mfModel(xml)` gives `basematerials[0].color === "#112233FF"`, `objects[0].pid === "3"`, `objects[0].pindex === 0`, and `objects[1].pid === null`.
  - `shared colour has one base entry`: two parts both `#112233` → `basematerials.length === 1`.
  - `uncoloured output is byte-identical`: `meshTo3mf(parts, design)` model XML equals the pre-change string for the existing fixture (capture it as a literal in the test).
  - `renders through asset-core`: `parsed3mfToGltf(parse3mfModel(xml))` material for mesh 0 has `baseColorFactor` ≈ `[0x11/255, 0x22/255, 0x33/255, 1]`.
- [ ] **Step 2: Run** `bun run test -- test/cad-gen/exporters.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** in `buildModelXml`. Emit the group only when any part has a colour; with no colour, keep the existing string concatenation path untouched.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(cad-gen): export part colours to 3MF`.

### Task 5: Prompt teaches colour

**Files:**
- Modify: `packages/cad-gen/src/backend/prompt.ts` (system prompt lines 20-45, prelude reference)
- Test: `test/cad-gen/prompt.test.js`

- [ ] **Step 1: Write failing tests:** the system prompt contains `color(part, hex)`, `type: "color"`, and the phrase `call color() last`. It no longer contains `PARAMETERS hold NUMBERS only.`
- [ ] **Step 2: Run** `bun run test -- test/cad-gen/prompt.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the numbers-only rule with: lengths are numbers in mm; colours are `{ "type": "color", "value": "#rrggbb" }` parameters; every other string option stays literal in the call. Add the rules: use colour only when the user asks for it or the object has several parts; never put a literal hex in a `color()` call; call `color()` last on each returned solid. Add `color(part, hex)` to the prelude reference with a one-line example `return [color(box, P.boxColor), color(lid, P.lidColor)]`.
- [ ] **Step 4: Run** `bun run test -- test/cad-gen/`. Expected: PASS.
- [ ] **Step 5:** Run `(cd packages/cad-gen && bun run build)`. Expected: exit 0. Commit `feat(cad-gen): prompt teaches color()`.

### Task 6: Read baked colours from a 3MF model

**Files:**
- Modify: `packages/asset-core/src/formats/3mf/color-editor.ts`
- Test: `test/frontend/3mf-color-editor.test.js`

**Interfaces:**
- Produces: `readObjectColors(modelXml: string): Record<string, string>`, mapping viewer mesh name → `"#rrggbb"` for every object with an object-level `pid`/`pindex` into a basematerials group. Keys use the same naming as `objectIdsByMeshName`: `name`, else `object_<id>`.

- [ ] **Step 1: Write failing tests:** `round-trips applyObjectColors`: `readObjectColors(applyObjectColors(xml, {"object_1":"#AABBCC"}).model)` → `{object_1:"#aabbcc"}`. An uncoloured model → `{}`. A named object `part-2` → key `part-2`.
- [ ] **Step 2: Run** `bun run test -- test/frontend/3mf-color-editor.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** with `parse3mfModel`: look up `basematerials` by `groupId === pid`, take the entry at `pindex`, and strip alpha.
- [ ] **Step 4: Run.** Expected: PASS. Run `(cd packages/asset-core && bun run build)`.
- [ ] **Step 5: Commit** `feat(asset-core): readObjectColors for 3MF`.

### Task 7: Pending parameter edits and preview render

**Files:**
- Create: `frontend/src/js/state/cad-param-edits.ts`, `frontend/src/js/services/cad-param-preview.ts`
- Modify: `frontend/src/js/formats/registry.ts` (`FormatLoadContext.bytes?: Uint8Array`), `frontend/src/js/formats/handlers/3mf-handler.ts` (`load` uses `ctx.bytes` when set), `frontend/src/js/engine/scene-loader.ts` (new export), `frontend/src/js/engine/cleanup.ts` (call `clearCadParamEdits()` where `state.pendingSourceOverrides.clear()` runs at scene teardown, ~line 265)
- Test: `test/frontend/cad-param-edits.test.js`, `test/frontend/cad-param-preview.test.js`, `test/frontend/3mf-handler.test.js`

**Interfaces:**
- Consumes: `renderCadDesignInWorker(design, runtime)` (`services/cad-render.ts`), `CadDesign`.
- Produces:
  - `cad-param-edits.ts`:
    - `interface CadParamEdit { nodeId: string; savedDesign: CadDesign; design: CadDesign; bytes: Uint8Array | null; stats: CadStats | null; status: "rendering" | "ok" | "error"; error?: string }`
    - `getCadParamEdit(nodeId): CadParamEdit | undefined`, `getPendingCadParamEdits(): Map<string, CadParamEdit>`
    - `setCadParamValues(nodeId, savedDesign, values: Record<string, number | string>): CadParamEdit`, which drops the entry when values equal the saved ones
    - `clearCadParamEdits(nodeIds?: string[])`
    - Registers itself with `registerPendingSource`; undo type `"cad-params"` via `registerUndoApplier`.
  - `scene-loader.ts`: `replaceNodeModelFromBytes(nodeId: string, source: AssetSourceRef, bytes: Uint8Array): Promise<boolean>`. Disposes the node content, loads through the handler with `ctx.bytes`, then re-applies the manifest node's `post_processor` (as `loadNode` does).
  - `cad-param-preview.ts`:
    - `scheduleCadPreview(nodeId: string): void` (300 ms debounce per node; one worker render globally; when values change mid-render, re-render once with the newest values; on success sets `bytes`/`stats`/`status:"ok"` and calls `replaceNodeModelFromBytes`; on error sets `status:"error"`, `error = CadRenderError.message` and leaves the viewport as is)
    - `whenCadPreviewsSettled(): Promise<void>`
    - emits `EVENTS.CAD_PARAMS_CHANGED` `{ nodeId }` (add it to the asset-core events bus constants)

- [ ] **Step 1: Write failing tests** (mock `services/cad-render.ts` and `engine/scene-loader.ts` with `mock.module`, use fake timers):
  - `debounces 300 ms`: three `setCadParamValues` + `scheduleCadPreview` calls within 100 ms → one render, after 300 ms.
  - `newest values win`: change during an in-flight render → exactly 2 renders total, second with the newest values.
  - `result applies to the node it was scheduled for`: schedule A, change the selection to B, resolve → `replaceNodeModelFromBytes` called with A's id only.
  - `failure keeps preview`: the render rejects with `CadRenderError("CAD_KERNEL_FAILED","boom")` → `status:"error"`, `error:"boom"`, `replaceNodeModelFromBytes` not called.
  - `equal-to-saved drops the edit`: setting values back to the saved ones → `getCadParamEdit` is `undefined` and `hasUnsavedChanges()` is false.
  - `undo after save re-renders and marks dirty`: push an undo entry, `clearCadParamEdits()`, apply undo → the entry exists again with the `before` values and a render is scheduled.
  - In `3mf-handler.test.js`: `load uses ctx.bytes without fetching`: the IPFS fetch mock is not called.
- [ ] **Step 2: Run** `bun run test -- test/frontend/cad-param-edits.test.js test/frontend/cad-param-preview.test.js test/frontend/3mf-handler.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files to the interfaces above. The runtime passed to the worker is `{}` (stored designs carry no runtime; spec §7 mismatch is handled in Task 8).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): pending CAD parameter edits with live preview`.

### Task 8: Inspector Parameters section

**Files:**
- Create: `frontend/src/js/ui/cad-params-panel.ts`, `frontend/src/scss/components/_cad-params.scss` (import it from the components index the way `_inspector.scss` is imported)
- Modify: `frontend/src/pug/includes/studio-main.pug` (new `section#cadParamsSection.inspector-section(hidden)` before `section#parametricEditor`), `frontend/src/js/engine/parametric-preview.ts` (`openInspector`/`closeInspector` call `showCadParams(nodeId)` / `hideCadParams()`), `.agents/skills/edit-ui/` docs (list the new section)
- Test: `test/frontend/cad-params-panel.test.js`

**Interfaces:**
- Consumes: `resolveCadDesign(sourceCid)`, `usedParameterNames`, `isColorParameter`, `PRELUDE_VERSION`, Task 7 store and `scheduleCadPreview`, `isEditing`/`subscribeEditMode`, `pushUndoEntry`.
- Produces: `showCadParams(nodeId: string): Promise<void>`, `hideCadParams(): void`. DOM ids: `#cadParamsSection`, `#cadParamsList`, `#cadParamsStatus`, `#cadParamsReset`, `#cadParamsHint`, inputs `#cadParam-<name>` (number or color) and `#cadParamRange-<name>`.

Markup per the mockup's Main and States frames: a label; a number input (step 0.5) plus a range slider when both `min` and `max` are set; the unit `mm`. Colour parameters get `input[type=color]` and the hex shown as text. Below the rows: a status line with a dot (`Rebuilding…` / `Preview up to date · not saved` / `Saved values` / the error text in `--danger-text`) and the Reset button. Section title `Parameters`. The section is shown only when the manifest node's manifest has `metadata.cad` and the design resolves; a design that cannot be read hides it and logs `console.warn`.

- [ ] **Step 1: Write failing tests** (`// @test-env dom`, mock `resolveCadDesign` and the preview service):
  - `lists only used parameters`: design with params `w,d,unused`, code reads `P.w, P.d` → inputs `#cadParam-w`, `#cadParam-d` exist; `#cadParam-unused` absent.
  - `dynamic shows all`: code `P[k]` → all three rows.
  - `no slider without min/max`.
  - `clamps on commit`: type `999` into `w` (max 200) + `change` → the input reads `200` and the store value is 200.
  - `empty or non-numeric input is ignored`: `""` + `change` → the store is unchanged, and the input is restored to the last value.
  - `input schedules preview, change pushes one undo entry`: 5 `input` events + 1 `change` → `scheduleCadPreview` called ≥ 1, `pushUndoEntry` called exactly once with type `"cad-params"`.
  - `View mode disables inputs`: `isEditing() === false` → every input `disabled`, and `#cadParamsHint` text is `Switch to Edit to change parameters.`
  - `error status`: store `status:"error"` + `CAD_PARAMS_CHANGED` → the status text equals the error message.
  - `Reset restores saved values`.
  - `hidden for non-CAD nodes`: manifest without `metadata.cad` → `#cadParamsSection.hidden === true`.
  - `newer runtime`: a render failing with code `CAD_GUARD_REJECTED` or `CAD_PRELUDE_MISMATCH` on first open (the stored script calls a helper this build lacks) → status text `This part was made with a newer CAD runtime — refresh the page.` and every input disabled.
- [ ] **Step 2: Run** `bun run test -- test/frontend/cad-params-panel.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the panel and markup. Build rows with DOM APIs (`document.createElement`), never `innerHTML` with design-supplied labels, because labels are model-written text.
- [ ] **Step 4: Run** the panel tests plus `bun run test -- test/frontend/parametric-preview.test.js`. Expected: PASS. Then `bun run build:frontend`, expected exit 0.
- [ ] **Step 5: Commit** `feat(studio): Parameters section in the Inspector`.

### Task 9: Studio colour picker edits colour parameters

**Files:**
- Modify: `frontend/src/js/engine/parametric-preview.ts` (`onComponentColorChange`), `frontend/src/js/state/cad-param-edits.ts` (new helper)
- Test: `test/frontend/parametric-preview.test.js`

**Interfaces:**
- Consumes: the Task 7 store, `CadMesh.color` via the render result's design.
- Produces: `colorParameterForPart(design: CadDesign, partColors: (string | undefined)[], meshName: string): string | null`. `meshName` is `part-<n>` or `object_<n>` (1-based). The function returns the name of the first colour parameter, in table order, whose value equals that part's colour, or `null`. `CadParamEdit` gains `partColors: (string | undefined)[]`, filled from the render's per-part colours (pass `parts.map(p => p.color)` through the worker result, alongside `stats`).

- [ ] **Step 1: Write failing tests:**
  - `routes a CAD part colour to its parameter`: a node with a design whose colour param `lid = #d33a2c` and partColors `[undefined, "#d33a2c"]`; changing the picker on mesh `part-2` to `#00ff00` → `setCadParamValues` gets `{..., lid:"#00ff00"}`, and no entry is added to `getPendingSourceColorEdits()`.
  - `falls back to the source bake`: mesh `part-1` (no colour) → the existing pending source colour edit is recorded, as today.
  - `first parameter wins on equal values`.
- [ ] **Step 2: Run** `bun run test -- test/frontend/parametric-preview.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Also extend `workers/cad-render-core.ts`, `workers/cad-worker.ts` and `services/cad-render.ts` so the result carries `partColors`. Bump the worker URL `?v=1` → `?v=2` in `cad-render.ts`.
- [ ] **Step 4: Run** the same file plus `test/frontend/cad-render-core.test.js test/frontend/cad-render.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): part colour picker edits CAD colour parameters`.

### Task 10: Save writes the new 3MF

**Files:**
- Modify: `frontend/src/js/services/asset-save/manifest-builder.ts` (new `applyCadParameterEdits`, called before `applySourceColorEdits` at ~line 871; snapshot pending edits next to `pendingColors` ~line 748; include in `needsDedup`), `frontend/src/js/ui/refine-target.ts` or the create panel's chip owner (update `ActiveVersion.design` after save), `frontend/src/js/ui/toasts.ts` (use the existing toast API)
- Test: `test/frontend/manifest-builder.test.js`

**Interfaces:**
- Consumes: `getPendingCadParamEdits`, `whenCadPreviewsSettled`, `clearCadParamEdits`, `readObjectColors` (Task 6), `handler.decomposeForSave`, `handler.editSourceColors`, `writeToIPFS`.
- Produces: `applyCadParameterEdits(manifest, pending: Map<string, CadParamEdit>, dedupMap): Promise<void>`. Exported for tests. It throws `Error("CAD parameters have no successful preview")` when an edit's `status !== "ok"`.

Behaviour, per node: await `whenCadPreviewsSettled()`. Read the current source's model XML and `readObjectColors` it. Set `summary` = `"Parameters: " + changes.join(", ")`, where each change is `"<name> <old>→<new>"` with a ` mm` suffix for lengths (e.g. `width 60→80 mm, lidColor #d33a2c→#2c7ad3`). Apply it with `withDesign(edit.bytes, { ...edit.design, summary })` (sidecar only, no second kernel run). Then `writeToIPFS(bytes, "asset.3mf")` → `decomposeForSave` → `pointNodeAtEditedSource`. Re-apply the baked colours whose key is not a part tagged by `color()` (`partColors[i]` set) through `editSourceColors`; names absent from the new model go into the toast. Set `manifest.metadata.cad.stats = { triangles, bboxMm }` from `edit.stats`. After the manifest uploads: `clearCadParamEdits(savedIds)`, and when the active chip's `sourceAssetCid` was this node's old CID, set `chip.design = edit.design` and `chip.sourceAssetCid` to the new CID.

- [ ] **Step 1: Write failing tests** (extend the existing manifest-builder harness mocks):
  - `points the node at a new CID with edited sidecar`: after save, `node.source.cid` changes, and `readDesignFrom3mf` of the uploaded bytes has `parameters.width.value === 80` and a summary starting `Parameters: width 60→80 mm`.
  - `runs before the colour bake`: call order recorded by the mocks is `writeToIPFS(3mf)` → `editSourceColors` for the pending Studio colour edit, on the new CID.
  - `carries baked colours by name`: old source `readObjectColors` → `{ "part-1": "#aabbcc", "part-3": "#112233" }`, new model has 2 parts → `editSourceColors` called with `{ "part-1": "#aabbcc" }`, and the toast text is `Colours reset on part-3 (the part count changed).`
  - `script colour wins`: `partColors[0] = "#ff0000"` → `part-1` is not in the re-applied map.
  - `updates metadata.cad.stats`.
  - `waits for in-flight render`: an edit in `status:"rendering"` that resolves to `"ok"` after 50 ms → save uses the resolved bytes. An edit that ends `"error"` → save rejects with `CAD parameters have no successful preview` and the manifest is not uploaded.
  - `refine chip follows the save`.
- [ ] **Step 2: Run** `bun run test -- test/frontend/manifest-builder.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** to the behaviour above. Add `export function withDesign(bytes: Uint8Array, design: CadDesign): Uint8Array` to `packages/cad-gen/src/core/export/three-mf.ts` (it replaces only the sidecar part), export it from `index.ts`, and add a test in `exporters.test.js`: `withDesign replaces only the sidecar`, where the model part bytes are unchanged and the sidecar parses to the new design.
- [ ] **Step 4: Run** `bun run test -- test/frontend/manifest-builder.test.js test/cad-gen/exporters.test.js`. Expected: PASS. Then run `bun run test:frontend`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): save CAD parameter edits as a new 3MF`.

### Task 11: End-to-end and docs

**Files:**
- Create: `e2e/specs/27-cad-parameters.spec.js`
- Modify: `e2e/README.md` (spec list), `AGENTS.md` (one sentence in the CAD provider paragraph: the Inspector Parameters section, live preview, save rebuilds the 3MF, `color()` / colour parameters)

- [ ] **Step 1: Write the E2E spec**, following `21-metadata-computed.spec.js` (mock CAD box is 40×30×20 with params `width`, `depth`, `height`):
  1. `connectStudio`, select provider `cad`, prompt `"a box"`, generate, click `.chat-asset-send`, wait for the saved class.
  2. Select the root node. Expect `#cadParamsSection` visible, and three inputs `#cadParam-width|depth|height`.
  3. Switch to Edit, fill `#cadParam-width` with `60`, press Tab. Expect `#cadParamsStatus` to reach `Preview up to date · not saved` within 30 s.
  4. Save Draft. Expect the URL manifest CID to change, and the fetched manifest's root `source.cid` to differ from before.
  5. Expect `SELECTORS.bottomBarAssetInfo` to contain `60` (it reads the saved `metadata.cad.stats`).
  6. Reload that URL, select the root. Expect `#cadParam-width` to have value `60`.
- [ ] **Step 2: Run** `bun run test:e2e -- --project=chromium e2e/specs/27-cad-parameters.spec.js`. Expected: PASS.
- [ ] **Step 3: Run the full gate:** `bun run lint && bun run typecheck && bun run typecheck:frontend && bun run test && bun run audit`. Expected: all exit 0.
- [ ] **Step 4: Commit** `test(e2e): CAD parameter edit round trip; docs`.
