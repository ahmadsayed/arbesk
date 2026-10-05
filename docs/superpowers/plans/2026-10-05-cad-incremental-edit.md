# CAD Incremental Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A typed prompt while a CAD part is the active ("Refining") version edits that part: the Studio sends the part's design as `priorDesign`, and the result saves as the next version of the same asset.

**Architecture:** The backend already assembles edit prompts from `priorDesign`; this plan carries the field through `POST /api/v1/generations` → `GenerationProvider.textToModel` → the CAD provider → `CadGenerator.generate`. On the client, the create panel's `ActiveVersion` gains a `kind`; a new small module (`ui/refine-target.ts`) decides the route, builds CAD chips from manifests and resolves a version's design from its 3MF (raw or saved composite).

**Tech Stack:** TypeScript (Bun runtime, no emit for `src/`; packages build to `dist/`), Hono + zod (API), bun test (`// @test-env dom` = happy-dom), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-05-cad-incremental-edit-design.md` (§3 decisions are locked).

## Global Constraints

- The server stays stateless: the client sends the full design. No `sourceRef` work (it stays 501).
- Only the current design plus the new request go to the model. No earlier prompts.
- The chip decides the route: `cad` chip → CAD edit; `mesh` chip → Tripo retexture (unchanged); no chip → the provider selector.
- While a chip is attached the provider selector shows the chip's provider (`cad` for CAD chips, `tripo3d` for mesh chips), is disabled, and has the title "Detach to choose a provider". The lock never writes the provider to `localStorage`.
- `priorDesign` is valid only with `provider: "cad"`; validated by the existing `cadDesignSchema`.
- Copy (exact): chat line `Editing "<name>"…`; toast `Couldn't load the design of '<name>'. Detach to generate a new part.`; toast `This design is too large to edit. Detach to start a new part.`
- During a CAD edit, `CAD_REQUEST_UNSUITABLE` shows the existing message without the "Retry with Tripo 3D" offer.
- Unit tests: `bun scripts/run-tests.mjs <paths>` (not bare `bun test`). Test files import `.ts` sources with a `.js` extension.
- If a unit failure is deterministic but nonsensical (flips on unrelated edits), rerun with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` before debugging; if that passes, `rm -rf ~/.bun/install/cache/@t@`.
- The fallow pre-commit gate must pass with no new suppressions — extract small helpers instead.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work only in `/home/ahmedh/Projects/arbesk/.worktrees/cad-edit` (branch `feat/cad-incremental-edit`). Never checkout/pull in the main checkout. After E2E runs: `git checkout -- blockchain/deployments`.

## File map

| File | Status | Responsibility |
|------|--------|----------------|
| `src/api/schemas.ts` | modify | `priorDesign` on `generateAssetSchema` + cad-only refine |
| `src/api/assets/generate-node.ts` | modify | Forward `priorDesign` to the CAD provider |
| `src/api/generation-providers.ts` | modify | Mock CAD generator honours `priorDesign` (E2E observability) |
| `packages/ai-asset-gen/src/facade.ts` | modify | `textToModel` input gains `priorDesign?` |
| `packages/ai-asset-gen/src/providers/cad-provider.ts` | modify | Store + pass `priorDesign` to the generator |
| `frontend/src/js/services/api.ts` | modify | `generateCadAsset` sends `priorDesign`, returns `design` |
| `frontend/src/js/services/cad-design-source.ts` | create | `resolveCadDesign(sourceCid)` — design from raw or composite 3MF |
| `frontend/src/js/ui/refine-target.ts` | create | `ActiveVersion` type, `decideGenerationRoute`, `cadChipFromManifest`, `resolveActiveDesign`, `isPriorDesignRejection` |
| `frontend/src/js/ui/create-panel.ts` | modify | Chip set points, selector lock, CAD edit send path, edit-aware errors |
| `e2e/specs/28-cad-edit.spec.js` | create | End-to-end edit flow |
| `docs/CURRENT_STATUS.md`, `e2e/README.md` | modify | Docs |

---

### Task 0: Worktree setup (no commit)

The worktree was created with plain `git worktree add`, so it has no `node_modules`. This feature changes `packages/ai-asset-gen`, which the backend and `tsc` load from its built `dist/`, so that one package must resolve to the worktree.

- [ ] **Step 1: Link dependencies**

```bash
cd /home/ahmedh/Projects/arbesk/.worktrees/cad-edit
MAIN=/home/ahmedh/Projects/arbesk
# root node_modules: a real dir linking every entry of main's, except @arbesk
mkdir node_modules
for e in $MAIN/node_modules/* $MAIN/node_modules/.[!.]*; do
  n=$(basename "$e"); [ "$n" = "@arbesk" ] && continue; ln -s "$e" "node_modules/$n"
done
mkdir node_modules/@arbesk
for p in $MAIN/node_modules/@arbesk/*; do
  n=$(basename "$p"); ln -s "$MAIN/packages/$n" "node_modules/@arbesk/$n"
done
# the one package this branch changes resolves to the worktree
rm node_modules/@arbesk/ai-asset-gen && ln -s ../../packages/ai-asset-gen node_modules/@arbesk/ai-asset-gen
ln -s $MAIN/frontend/node_modules frontend/node_modules
ln -s $MAIN/blockchain/node_modules blockchain/node_modules
for d in $MAIN/packages/*/node_modules; do
  p=$(basename "$(dirname "$d")"); [ -e packages/$p/node_modules ] || ln -s "$d" packages/$p/node_modules
done
```

- [ ] **Step 2: Build the changed package and check the baseline**

```bash
(cd packages/ai-asset-gen && bun run build)
bun run test 2>&1 | grep -E "^FAIL|^Files:|^Tests:"
npx tsc --noEmit -p frontend/tsconfig.json && bun run typecheck
```

Expected: all unit files pass; both typechecks clean. Record any failure before starting — it is not yours.

---

### Task 1: Backend — carry `priorDesign` through `/generations`

**Files:**
- Modify: `src/api/schemas.ts` (`generateAssetSchema`, ~line 87; `cadDesignSchema` is at ~line 352)
- Modify: `packages/ai-asset-gen/src/facade.ts:26`
- Modify: `packages/ai-asset-gen/src/providers/cad-provider.ts` (`CadTaskState`, `run`, `textToModel`)
- Modify: `src/api/assets/generate-node.ts` (`TripoGenerationInput` ~376, `handleCadRequest` ~792-835)
- Modify: `src/api/generation-providers.ts:40-` (`createMockCadGenerator`)
- Test: `test/ai-asset-gen/cad-provider.test.js`, `test/api/generations-cad.test.js`

**Interfaces:**
- Produces: request body field `priorDesign?: { code; parameters; summary?; turn? }` on `POST /api/v1/generations` (cad only); `GenerationProvider.textToModel(input: { prompt: string; textureQuality?: string; priorDesign?: CadDesign })`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ai-asset-gen/cad-provider.test.js` inside `describe("createCadProvider", …)`:

```js
  it("passes priorDesign through to the generator", async () => {
    const generate = jest.fn(async () => RESULT);
    const provider = createCadProvider({ config: CONFIG, generator: { generate } });
    const prior = { ...DESIGN, turn: 3 };

    const taskId = await provider.textToModel({ prompt: "make it taller", priorDesign: prior });
    for (let i = 0; i < 50 && generate.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toMatchObject({ prompt: "make it taller", priorDesign: prior });
    expect(typeof taskId).toBe("string");
  });

  it("omits priorDesign for a fresh generation", async () => {
    const generate = jest.fn(async () => RESULT);
    const provider = createCadProvider({ config: CONFIG, generator: { generate } });
    await provider.textToModel({ prompt: "a cube" });
    for (let i = 0; i < 50 && generate.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    expect("priorDesign" in generate.mock.calls[0][0]).toBe(false);
  });
```

Append to `test/api/generations-cad.test.js` inside `describe("POST /api/v1/generations with provider cad", …)`:

```js
  test("forwards priorDesign to the generator", async () => {
    const res = await post({
      prompt: "make it 2 mm taller", nodeId: "n_cad_edit", provider: "cad", priorDesign: DESIGN,
    });
    expect(res.status).toBe(202);
    await until(async () => generate.mock.calls.length > 0, "generate call");
    expect(generate.mock.calls[0][0]).toMatchObject({
      prompt: "make it 2 mm taller",
      priorDesign: { code: DESIGN.code, parameters: DESIGN.parameters, summary: "cube", turn: 1 },
    });
  });

  test("rejects a malformed priorDesign with 400 naming the field", async () => {
    const res = await post({
      prompt: "edit", nodeId: "n_cad_bad", provider: "cad", priorDesign: { code: "", parameters: {} },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues.some((i) => i.path[0] === "priorDesign")).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  test("rejects priorDesign on a non-cad provider", async () => {
    const res = await post({
      prompt: "edit", nodeId: "n_tripo_prior", provider: "tripo3d", providerKey: "k", priorDesign: DESIGN,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues.some((i) => i.path[0] === "priorDesign")).toBe(true);
  });
```

Append to the `describe("CAD_MOCK_GENERATION", …)` block (copy the setup lines of the existing "mock mode settles a canned design without DEEPSEEK_API_KEY" test for env + app):

```js
  test("mock mode edits: priorDesign comes back with turn + 1", async () => {
    process.env.CAD_MOCK_GENERATION = "true";
    app = buildBareApp();
    const prior = { ...DESIGN, turn: 2 };
    const res = await post({ prompt: "taller", nodeId: "n_cad_mock_edit", provider: "cad", priorDesign: prior });
    expect(res.status).toBe(202);
    let body;
    await until(async () => {
      body = (await request(app).get("/generations/" + res.body.taskId).set("Authorization", sessionHeader())).body;
      return body.status === "success";
    }, "mock edit success");
    expect(body.design.code).toBe(DESIGN.code);
    expect(body.design.turn).toBe(3);
  });
```

If the existing CAD_MOCK tests set more env than `CAD_MOCK_GENERATION` (check the first test in that block), mirror them exactly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun scripts/run-tests.mjs test/ai-asset-gen/cad-provider.test.js test/api/generations-cad.test.js`
Expected: the new tests FAIL (priorDesign not forwarded; schema strips it so no 400; mock returns turn 1).

- [ ] **Step 3: Implement**

`src/api/schemas.ts` — in `generateAssetSchema`'s `z.object({ … })`, after the `images` field:

```ts
    // Incremental CAD edit (cad only): the current design document, echoed
    // back so the model edits it instead of starting over. Lazy because
    // cadDesignSchema is declared further down this module.
    priorDesign: z.lazy(() => cadDesignSchema).optional(),
```

and append one refine to the chain (after the last existing `.refine`):

```ts
  .refine((v) => !v.priorDesign || v.provider === "cad", {
    message: "priorDesign is only valid with provider cad",
    path: ["priorDesign"],
  })
```

`packages/ai-asset-gen/src/facade.ts` — add `import type { CadDesign } from "@arbesk/cad-gen";` and change the `textToModel` line to:

```ts
  textToModel(input: { prompt: string; textureQuality?: string; priorDesign?: CadDesign }): Promise<string>;
```

`packages/ai-asset-gen/src/providers/cad-provider.ts`:

- import: `import type { CadDesign } from "@arbesk/cad-gen";`
- `CadTaskState` gains `priorDesign?: CadDesign;`
- in `run`:

```ts
      const result = await generator.generate({
        prompt: state.prompt,
        ...(state.priorDesign && { priorDesign: state.priorDesign }),
        signal: state.controller.signal,
      });
```

- `textToModel: async ({ prompt, priorDesign }) => {` and add `...(priorDesign && { priorDesign }),` to the `state` object literal.

`src/api/assets/generate-node.ts`:

- import: `import type { CadDesign } from "@arbesk/cad-gen";` (if a `@arbesk/cad-gen` type import already exists, extend it).
- `TripoGenerationInput` gains `/** Current design for an incremental CAD edit (cad only). */ priorDesign?: CadDesign;`
- `handleCadRequest`'s `body` param type becomes `{ prompt?: string; nodeId: string; priorDesign?: CadDesign }`.
- replace the `textToModel` call and log line:

```ts
  console.log(
    `[GEN] cad generation started nodeId=${body.nodeId}` +
      (body.priorDesign ? ` edit turn=${body.priorDesign.turn ?? "?"}` : ""),
  );
  const cadTaskId = await provider.textToModel({
    prompt,
    ...(body.priorDesign && { priorDesign: body.priorDesign }),
  });
```

`src/api/generation-providers.ts` — `createMockCadGenerator`: change the signature to `generate: async ({ prompt, priorDesign }): Promise<CadGenerateResult> => {` and, after the unsuitable check, choose the design:

```ts
      // An edit echoes the prior design one turn later (the real facade's
      // turn arithmetic), so E2E can observe that priorDesign arrived.
      const design = priorDesign
        ? { ...priorDesign, summary: "Mock edit: " + prompt.slice(0, 200), turn: (priorDesign.turn ?? 1) + 1 }
        : {
            code: "return box(P.width, P.depth, P.height);",
            // …the existing canned parameters/summary/turn object, unchanged…
          };
```

and return `design` in place of the inline literal. Keep the canned object byte-identical.

- [ ] **Step 4: Rebuild the package and run the tests**

```bash
(cd packages/ai-asset-gen && bun run build)
bun scripts/run-tests.mjs test/ai-asset-gen/cad-provider.test.js test/api/generations-cad.test.js test/api/cad-route.test.js
bun run typecheck
```

Expected: all pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.ts src/api/assets/generate-node.ts src/api/generation-providers.ts packages/ai-asset-gen/src/facade.ts packages/ai-asset-gen/src/providers/cad-provider.ts test/ai-asset-gen/cad-provider.test.js test/api/generations-cad.test.js
git commit -m "feat(cad): accept priorDesign on /generations for incremental edits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client services — send `priorDesign`, return `design`, resolve a version's design

**Files:**
- Modify: `frontend/src/js/services/api.ts` (`GenerateAssetResult` ~375, `GenerateCadAssetParams` ~760, `generateCadAsset` ~843)
- Create: `frontend/src/js/services/cad-design-source.ts`
- Test: `test/frontend/generate-cad-asset.test.js`, `test/frontend/cad-design-source.test.js`

**Interfaces:**
- Produces:
  - `GenerateAssetResult.design?: CadDesign`
  - `GenerateCadAssetParams.priorDesign?: CadDesign`
  - `resolveCadDesign(sourceCid: string): Promise<CadDesign | null>` — never throws

- [ ] **Step 1: Write the failing tests**

In `test/frontend/generate-cad-asset.test.js`, extend the first test's assertions with `expect(result.design).toEqual(CAD_SUCCESS.design);` and add:

```js
  test("an edit sends priorDesign and chains onto the previous version", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(buildResponse({ status: 202, body: { taskId: "t2", provider: "cad", status: "running" } }))
      .mockResolvedValueOnce(buildResponse({ body: CAD_SUCCESS }));
    const { generateCadAsset } = await loadApi({ fetchMock });
    localStorage.setItem("arbesk_session", makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS));
    const prior = { code: "return box(1,1,1);", parameters: { s: { value: 1, unit: "mm" } }, summary: "cube", turn: 1 };

    await generateCadAsset({ prompt: "taller", nodeId: "n_2", priorDesign: prior, prevAssetManifestCid: "bafyPrev" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ provider: "cad", prompt: "taller", nodeId: "n_2", priorDesign: prior });
  });

  test("a fresh generation sends no priorDesign", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(buildResponse({ status: 202, body: { taskId: "t3", provider: "cad", status: "running" } }))
      .mockResolvedValueOnce(buildResponse({ body: CAD_SUCCESS }));
    const { generateCadAsset } = await loadApi({ fetchMock });
    localStorage.setItem("arbesk_session", makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS));
    await generateCadAsset({ prompt: "a box", nodeId: "n_3" });
    expect("priorDesign" in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
  });
```

Create `test/frontend/cad-design-source.test.js`:

```js
import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { meshTo3mf, serializeDesign } from "@arbesk/cad-gen";

const DESIGN = {
  code: "return box(P.w, P.w, P.w);",
  parameters: { w: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 2,
};
const MESH = { vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), triVerts: new Uint32Array([0, 1, 2]), numProp: 3 };

const store = new Map();
const getArrayBufferFromRemoteIPFS = jest.fn(async (cid) => {
  if (!store.has(cid)) throw new Error("not found " + cid);
  const b = store.get(cid);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
const getFromRemoteIPFS = jest.fn(async (cid) => JSON.parse(new TextDecoder().decode(store.get(cid))));

mock.module("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getArrayBufferFromRemoteIPFS,
  getFromRemoteIPFS,
}));

const { resolveCadDesign } = await import("../../frontend/src/js/services/cad-design-source.js");
const enc = (o) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe("resolveCadDesign", () => {
  test("reads the sidecar from a raw 3MF", async () => {
    store.set("bafyRaw", meshTo3mf(MESH, DESIGN));
    expect(await resolveCadDesign("bafyRaw")).toMatchObject({ code: DESIGN.code, turn: 2 });
  });

  test("reads the sidecar part of a saved composite 3MF", async () => {
    store.set("bafySidecar", enc(serializeDesign(DESIGN)));
    store.set("bafyComposite", enc({
      arbesk_format: "composite-3mf",
      parts: { "Metadata/arbesk_cad.json": { cid: "bafySidecar", _arbesk: {} } },
    }));
    expect(await resolveCadDesign("bafyComposite")).toMatchObject({ code: DESIGN.code, summary: "cube" });
  });

  test("returns null for a 3MF without a sidecar, a non-3MF, or a fetch failure", async () => {
    store.set("bafyJson", enc({ hello: "world" }));
    expect(await resolveCadDesign("bafyJson")).toBeNull();
    expect(await resolveCadDesign("bafyMissing")).toBeNull();
  });
});
```

Check the `CadMesh` field names in `packages/cad-gen/src/types.ts` (`CadMesh`) and adjust `MESH` to match if they differ; the test only needs a tiny valid mesh for `meshTo3mf`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/generate-cad-asset.test.js test/frontend/cad-design-source.test.js`
Expected: FAIL (`result.design` undefined; body lacks `priorDesign`; module not found).

- [ ] **Step 3: Implement**

`frontend/src/js/services/api.ts`:

- add `import type { CadDesign } from "@arbesk/cad-gen";` near the other type imports.
- `GenerateAssetResult` gains `/** CAD only: the design this asset was rendered from. */ design?: CadDesign;`
- `GenerateCadAssetParams` gains `/** Incremental edit: the active version's design. */ priorDesign?: CadDesign;`
- `generateCadAsset`: destructure `priorDesign`, send

```ts
  const response = await fetchWithSession("/generations", {
    body: { provider: "cad", prompt, nodeId, ...(priorDesign && { priorDesign }) },
  });
```

  and add `design: final.design,` to the returned object.

Create `frontend/src/js/services/cad-design-source.ts`:

```ts
/**
 * Reads a CAD version's design document back out of its stored model.
 * @remarks A fresh generation stores the raw .3mf (design sidecar inside the
 *   zip); a saved version stores a composite-3mf JSON whose parts are
 *   content-addressed, the sidecar among them. Both are handled. Lazy-imports
 *   @arbesk/cad-gen so the main bundle only pays for it on an edit.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { getArrayBufferFromRemoteIPFS, getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";

const COMPOSITE_3MF_FORMAT = "composite-3mf";

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function designFromComposite(json: any, sidecarPath: string): Promise<CadDesign | null> {
  if (json?.arbesk_format !== COMPOSITE_3MF_FORMAT) return null;
  const partCid = json.parts?.[sidecarPath]?.cid;
  if (!partCid) return null;
  const { parseEmbeddedDesign } = await import("@arbesk/cad-gen");
  return parseEmbeddedDesign(await getFromRemoteIPFS(partCid));
}

/**
 * Resolves the design embedded in a CAD version's source model.
 * @returns the design, or null when it cannot be fetched or carries none.
 */
export async function resolveCadDesign(sourceCid: string): Promise<CadDesign | null> {
  try {
    const bytes = new Uint8Array(await getArrayBufferFromRemoteIPFS(sourceCid));
    const { readDesignFrom3mf, SIDECAR_PART_PATH } = await import("@arbesk/cad-gen");
    return readDesignFrom3mf(bytes) ?? (await designFromComposite(parseJson(bytes), SIDECAR_PART_PATH));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun scripts/run-tests.mjs test/frontend/generate-cad-asset.test.js test/frontend/cad-design-source.test.js`
Expected: all pass. Then `npx tsc --noEmit -p frontend/tsconfig.json` — clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/api.ts frontend/src/js/services/cad-design-source.ts test/frontend/generate-cad-asset.test.js test/frontend/cad-design-source.test.js
git commit -m "feat(cad): send priorDesign from the client and resolve a version's design

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Refine target module + CAD chips + provider lock

**Files:**
- Create: `frontend/src/js/ui/refine-target.ts`
- Modify: `frontend/src/js/ui/create-panel.ts` (`ActiveVersion` ~569, `setActiveVersion` ~580, Show-in-Studio branch ~695, `presentGenerationResult` ~1127, `presentStagedModel` ~1207, `SCENE_READY` handler ~2260, `HISTORY_VERSION_SELECTED` handler ~2313)
- Test: `test/frontend/refine-target.test.js`, `test/frontend/create-panel-cad.test.js`

**Interfaces:**
- Consumes: `resolveCadDesign(sourceCid)` (Task 2); `GenerateAssetResult.design` (Task 2).
- Produces (`ui/refine-target.ts`):
  - `type RefineKind = "mesh" | "cad"`
  - `interface ActiveVersion { kind: RefineKind; sourceAssetCid: string; manifestCid: string | null; name: string; design?: CadDesign }`
  - `type GenerationRoute = { mode: "fresh"; provider: string } | { mode: "retexture"; provider: "tripo3d" } | { mode: "cad-edit"; provider: "cad" }`
  - `decideGenerationRoute(input: { activeKind: RefineKind | null; selectedProvider: string; hasImage: boolean }): GenerationRoute`
  - `chipProvider(kind: RefineKind): "cad" | "tripo3d"`
  - `cadChipFromManifest(manifest: any, manifestCid: string, name: string): ActiveVersion | null`
  - `resolveActiveDesign(version: ActiveVersion): Promise<CadDesign | null>` — caches on `version.design`
  - `isPriorDesignRejection(err: unknown): boolean`

- [ ] **Step 1: Write the failing tests**

Create `test/frontend/refine-target.test.js`:

```js
import { beforeEach, describe, expect, jest, mock, test } from "bun:test";

const resolveCadDesign = jest.fn();
mock.module("../../frontend/src/js/services/cad-design-source.js", () => ({ resolveCadDesign }));

const rt = await import("../../frontend/src/js/ui/refine-target.js");
const DESIGN = { code: "return box(1,1,1);", parameters: { s: { value: 1, unit: "mm" } }, summary: "cube", turn: 1 };

beforeEach(() => resolveCadDesign.mockReset());

describe("decideGenerationRoute", () => {
  test("the chip decides; the selector only applies without one", () => {
    expect(rt.decideGenerationRoute({ activeKind: "cad", selectedProvider: "tripo3d", hasImage: false }))
      .toEqual({ mode: "cad-edit", provider: "cad" });
    expect(rt.decideGenerationRoute({ activeKind: "mesh", selectedProvider: "cad", hasImage: false }))
      .toEqual({ mode: "retexture", provider: "tripo3d" });
    expect(rt.decideGenerationRoute({ activeKind: null, selectedProvider: "cad", hasImage: false }))
      .toEqual({ mode: "fresh", provider: "cad" });
  });

  test("an attached image starts fresh with the selected provider", () => {
    expect(rt.decideGenerationRoute({ activeKind: "mesh", selectedProvider: "tripo3d", hasImage: true }))
      .toEqual({ mode: "fresh", provider: "tripo3d" });
    expect(rt.decideGenerationRoute({ activeKind: "cad", selectedProvider: "cad", hasImage: true }))
      .toEqual({ mode: "fresh", provider: "cad" });
  });

  test("chipProvider maps kinds to providers", () => {
    expect(rt.chipProvider("cad")).toBe("cad");
    expect(rt.chipProvider("mesh")).toBe("tripo3d");
  });
});

describe("cadChipFromManifest", () => {
  test("builds a cad chip from a manifest with metadata.cad", () => {
    const manifest = {
      metadata: { cad: { summary: "box" } },
      scene: { nodes: [{ node_id: "c", child_ref: {} }, { node_id: "r", source: { cid: "bafyRoot", format: "3mf" } }] },
    };
    expect(rt.cadChipFromManifest(manifest, "bafyM", "Box")).toEqual({
      kind: "cad", sourceAssetCid: "bafyRoot", manifestCid: "bafyM", name: "Box",
    });
  });

  test("returns null without metadata.cad or a root source", () => {
    expect(rt.cadChipFromManifest({ scene: { nodes: [{ source: { cid: "x" } }] } }, "m", "n")).toBeNull();
    expect(rt.cadChipFromManifest({ metadata: { cad: {} }, scene: { nodes: [] } }, "m", "n")).toBeNull();
  });
});

describe("resolveActiveDesign", () => {
  test("returns a held design without fetching", async () => {
    const v = { kind: "cad", sourceAssetCid: "bafy", manifestCid: null, name: "n", design: DESIGN };
    expect(await rt.resolveActiveDesign(v)).toBe(DESIGN);
    expect(resolveCadDesign).not.toHaveBeenCalled();
  });

  test("fetches once and caches on the version", async () => {
    resolveCadDesign.mockResolvedValue(DESIGN);
    const v = { kind: "cad", sourceAssetCid: "bafy", manifestCid: null, name: "n" };
    expect(await rt.resolveActiveDesign(v)).toBe(DESIGN);
    expect(await rt.resolveActiveDesign(v)).toBe(DESIGN);
    expect(resolveCadDesign).toHaveBeenCalledTimes(1);
    expect(v.design).toBe(DESIGN);
  });

  test("returns null when the design cannot be read", async () => {
    resolveCadDesign.mockResolvedValue(null);
    expect(await rt.resolveActiveDesign({ kind: "cad", sourceAssetCid: "x", manifestCid: null, name: "n" })).toBeNull();
  });
});

describe("isPriorDesignRejection", () => {
  test("recognises a 400 whose issues point at priorDesign", () => {
    const err = Object.assign(new Error("Invalid request body"), {
      status: 400, code: "VALIDATION_ERROR", details: { issues: [{ path: ["priorDesign", "code"], message: "too long" }] },
    });
    expect(rt.isPriorDesignRejection(err)).toBe(true);
    expect(rt.isPriorDesignRejection(Object.assign(new Error("x"), { status: 400, details: { issues: [{ path: ["prompt"] }] } }))).toBe(false);
    expect(rt.isPriorDesignRejection(new Error("plain"))).toBe(false);
  });
});
```

Append to `test/frontend/create-panel-cad.test.js` (it already mocks `services/api.js`; add a mock for the design source at the top with the other `mock.module` calls — `const mockResolveCadDesign = jest.fn();` and `mock.module("../../frontend/src/js/services/cad-design-source.js", () => ({ resolveCadDesign: mockResolveCadDesign }));`). Add `const CAD_DESIGN = { code: "return box(P.w,P.w,P.w);", parameters: { w: { value: 10, unit: "mm" } }, summary: "box", turn: 1 };`, return it from the generate mock (`mockGenerateCadAsset.mockResolvedValue({ ...CAD_RESULT, design: CAD_DESIGN })` in `beforeEach`), then:

```js
test("a fresh cad result attaches a cad chip and locks the selector to cad", async () => {
  connectWallet();
  selectProvider("cad");
  promptInput.value = "a 20 mm cube";
  await clickGenerate();

  expect(document.getElementById("refineIndicator").hidden).toBe(false);
  expect(document.getElementById("refineIndicatorText").textContent).toBe("Refining: a 20 mm cube");
  expect(providerSelect.value).toBe("cad");
  expect(providerSelect.disabled).toBe(true);
  expect(providerSelect.title).toBe("Detach to choose a provider");

  document.getElementById("refineIndicatorDetach").click();
  expect(providerSelect.disabled).toBe(false);
  expect(providerSelect.title).toBe("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/refine-target.test.js test/frontend/create-panel-cad.test.js`
Expected: FAIL (module not found; no chip for cad).

- [ ] **Step 3: Implement `ui/refine-target.ts`**

```ts
/**
 * What a typed prompt refines: the active version behind the "Refining" chip.
 * @remarks A cad chip edits the part's design (priorDesign); a mesh chip
 *   retextures (Tripo3D). With a chip attached the chip decides the provider;
 *   without one the provider selector does.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { resolveCadDesign } from "../services/cad-design-source.ts";

export type RefineKind = "mesh" | "cad";

export interface ActiveVersion {
  kind: RefineKind;
  /** GLB (mesh) or 3MF / composite-3mf (cad) CID — the durable reference. */
  sourceAssetCid: string;
  manifestCid: string | null;
  name: string;
  /** cad only: set from a generation result, or loaded on first send. */
  design?: CadDesign;
}

export type GenerationRoute =
  | { mode: "fresh"; provider: string }
  | { mode: "retexture"; provider: "tripo3d" }
  | { mode: "cad-edit"; provider: "cad" };

/** Provider a chip of this kind generates with. */
export function chipProvider(kind: RefineKind): "cad" | "tripo3d" {
  return kind === "cad" ? "cad" : "tripo3d";
}

/**
 * Decides how a typed prompt is generated.
 * @remarks An attached image always starts fresh (neither follow-up path
 *   takes images).
 */
export function decideGenerationRoute(input: {
  activeKind: RefineKind | null;
  selectedProvider: string;
  hasImage: boolean;
}): GenerationRoute {
  if (input.hasImage || !input.activeKind) {
    return { mode: "fresh", provider: input.selectedProvider };
  }
  return input.activeKind === "cad"
    ? { mode: "cad-edit", provider: "cad" }
    : { mode: "retexture", provider: "tripo3d" };
}

/**
 * Builds a cad chip for an opened or restored version.
 * @returns null unless the manifest is a CAD asset with a root model.
 */
export function cadChipFromManifest(manifest: any, manifestCid: string, name: string): ActiveVersion | null {
  if (!manifest?.metadata?.cad) return null;
  const root = (manifest.scene?.nodes || []).find((n: any) => n.source?.cid && !n.child_ref);
  if (!root) return null;
  return { kind: "cad", sourceAssetCid: root.source.cid, manifestCid, name };
}

/**
 * The design to send as priorDesign, loading it once per chip.
 * @returns null when it cannot be read; the caller tells the user.
 */
export async function resolveActiveDesign(version: ActiveVersion): Promise<CadDesign | null> {
  if (version.design) return version.design;
  const design = await resolveCadDesign(version.sourceAssetCid);
  if (design) version.design = design;
  return design;
}

/** True for the API's 400 whose validation issues point at priorDesign. */
export function isPriorDesignRejection(err: unknown): boolean {
  const e = err as { status?: number; details?: { issues?: Array<{ path?: unknown[] }> } };
  if (e?.status !== 400) return false;
  return (e.details?.issues ?? []).some((i) => Array.isArray(i.path) && i.path[0] === "priorDesign");
}
```

- [ ] **Step 4: Wire chips + lock into `create-panel.ts`**

1. Delete the local `interface ActiveVersion { … }` and import instead:

```ts
import {
  chipProvider,
  cadChipFromManifest,
  decideGenerationRoute,
  isPriorDesignRejection,
  resolveActiveDesign,
} from "./refine-target.ts";
import type { ActiveVersion } from "./refine-target.ts";
```

2. Replace `setActiveVersion` with:

```ts
/**
 * Locks the provider selector to the chip's provider while one is attached.
 * @remarks Never persisted: detaching restores the stored provider.
 */
function syncProviderLock() {
  if (!providerSelect) return;
  if (activeVersion) {
    providerSelect.value = chipProvider(activeVersion.kind);
    providerSelect.disabled = true;
    providerSelect.title = "Detach to choose a provider";
  } else {
    const stored = localStorage.getItem(PROVIDER_STORAGE);
    const known = Array.from(providerSelect.options).some((o) => o.value === stored);
    if (stored && known) providerSelect.value = stored;
    providerSelect.disabled = false;
    providerSelect.title = "";
  }
  syncProviderUI();
  syncImageAttachUI();
}

function setActiveVersion(version: ActiveVersion | null) {
  activeVersion = version;
  syncProviderLock();
  if (!refineIndicator || !refineIndicatorText) return;
  refineIndicator.hidden = !version;
  if (version) refineIndicatorText.textContent = `Refining: ${version.name}`;
}
```

   If `syncImageAttachUI` or `PROVIDER_STORAGE` is declared after this point and not hoisted (a `const`), move `syncProviderLock` below their declarations or call it lazily; function declarations are hoisted, `const` is not.

3. Every existing `setActiveVersion({ sourceAssetCid, manifestCid, name })` call becomes `setActiveVersion({ kind: "mesh", sourceAssetCid, manifestCid, name })` (the Show-in-Studio branch, `presentGenerationResult`'s tripo3d branch, `presentStagedModel`, the history handler).

4. `presentGenerationResult` — after the tripo3d branch:

```ts
  // A fresh CAD result is the active version for typed design edits.
  if (provider === "cad") {
    setActiveVersion({
      kind: "cad",
      sourceAssetCid: result.sourceAssetCid,
      manifestCid: result.assetManifestCid,
      name: prompt,
      ...(result.design && { design: result.design }),
    });
  }
```

5. Show-in-Studio branch (~695): after the `tripo3d || upload` block add

```ts
    if (record.provider === "cad") {
      setActiveVersion({
        kind: "cad",
        sourceAssetCid: record.sourceAssetCid,
        manifestCid: record.assetManifestCid,
        name: record.prompt,
      });
    }
```

6. `SCENE_READY` handler — after the `presentOpenedAssetModel` block:

```ts
  // An opened CAD asset is editable straight away (its design is read from
  // the stored 3MF on the first send).
  if (identityChanged && manifestCid) {
    const cadChip = cadChipFromManifest(event?.manifest, manifestCid, name || "Part");
    if (cadChip) setActiveVersion(cadChip);
  }
```

7. `HISTORY_VERSION_SELECTED` handler — replace the two `setActiveVersion` lines with:

```ts
    const restored = await getFromRemoteIPFS(cid).catch(() => null);
    const cadChip = cadChipFromManifest(restored, cid, name || "");
    if (cadChip) setActiveVersion(cadChip);
    else if (sourceCid) setActiveVersion({ kind: "mesh", sourceAssetCid: sourceCid, manifestCid: cid, name: name || "" });
    else setActiveVersion(null); // chat-less version (e.g. parametric edit) — no retexture target
```

   Import `getFromRemoteIPFS` from `../ipfs/remote-ipfs.ts` if create-panel does not already; if create-panel tests mock `remote-ipfs.js` without `getFromRemoteIPFS`, add it to those mocks as `jest.fn().mockResolvedValue(null)`.

- [ ] **Step 5: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/refine-target.test.js test/frontend/create-panel-cad.test.js test/frontend/create-panel-followups.test.js test/frontend/create-panel-generate.test.js test/frontend/chat-history.test.js`
Expected: all pass. A followups/generate test that asserted the selector stays editable with a mesh chip is now wrong by spec decision 4 — update its expectation to the locked `tripo3d` value and note it in the report. `npx tsc --noEmit -p frontend/tsconfig.json` clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/refine-target.ts frontend/src/js/ui/create-panel.ts test/frontend/refine-target.test.js test/frontend/create-panel-cad.test.js
git add -u test/frontend
git commit -m "feat(cad): cad refine chips and provider lock while a chip is attached

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Send CAD edits from the create panel

**Files:**
- Modify: `frontend/src/js/ui/create-panel.ts` (`GenerationRequestArgs` ~2068, `dispatchGeneration` ~2119, `onGenerate` ~2142-2230, `offerCadTripoRetry` ~1921, `reportGenerationFailure` ~1953)
- Test: `test/frontend/create-panel-cad.test.js`

**Interfaces:**
- Consumes: `decideGenerationRoute`, `resolveActiveDesign`, `isPriorDesignRejection` (Task 3); `generateCadAsset({ priorDesign, prevAssetManifestCid, transformMatrix })` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `test/frontend/create-panel-cad.test.js`:

```js
async function generateCadPart(prompt = "a 20 mm cube") {
  connectWallet();
  selectProvider("cad");
  promptInput.value = prompt;
  await clickGenerate();
}

test("a typed prompt with a cad chip edits: priorDesign + version chain", async () => {
  await generateCadPart();
  assetDomainState.activeCid = "bafyOpenAsset";
  mockGenerateCadAsset.mockClear();

  promptInput.value = "make it 5 mm taller";
  await clickGenerate();

  expect(mockGenerateCadAsset).toHaveBeenCalledTimes(1);
  const args = mockGenerateCadAsset.mock.calls[0][0];
  expect(args.prompt).toBe("make it 5 mm taller");
  expect(args.priorDesign).toEqual(CAD_DESIGN);
  expect(args.prevAssetManifestCid).toBe("bafyOpenAsset");
  expect(Array.isArray(args.transformMatrix)).toBe(true);
  expect(mockAddChatMessage).toHaveBeenCalledWith("system", 'Editing "a 20 mm cube"…');
  expect(mockResolveCadDesign).not.toHaveBeenCalled(); // design came with the result
});

test("after a successful edit the chip moves to the new version", async () => {
  await generateCadPart();
  const edited = { ...CAD_DESIGN, turn: 2, summary: "taller box" };
  mockGenerateCadAsset.mockResolvedValueOnce({ ...CAD_RESULT, assetManifestCid: "bafyV2", design: edited });
  promptInput.value = "taller";
  await clickGenerate();

  mockGenerateCadAsset.mockClear();
  promptInput.value = "add a 3 mm fillet";
  await clickGenerate();
  expect(mockGenerateCadAsset.mock.calls[0][0].priorDesign).toEqual(edited);
});

test("a fresh cad generation (no chip) sends no priorDesign", async () => {
  await generateCadPart();
  expect("priorDesign" in mockGenerateCadAsset.mock.calls[0][0]).toBe(false);
  expect(mockGenerateCadAsset.mock.calls[0][0].prevAssetManifestCid).toBeUndefined();
});

test("an unreadable design shows the toast and sends nothing", async () => {
  await generateCadPart();
  // Simulate a restored chip with no design in hand.
  mockGenerateCadAsset.mockClear();
  panel._setActiveVersionForTest({ kind: "cad", sourceAssetCid: "bafyOld", manifestCid: "bafyM", name: "Old bracket" });
  mockResolveCadDesign.mockResolvedValueOnce(null);
  promptInput.value = "edit";
  await clickGenerate();

  expect(mockGenerateCadAsset).not.toHaveBeenCalled();
  expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
    message: "Couldn't load the design of 'Old bracket'. Detach to generate a new part.",
  }));
  expect(generateBtn.disabled).toBe(false);
});

test("CAD_REQUEST_UNSUITABLE during an edit offers no Tripo retry", async () => {
  await generateCadPart();
  mockGenerateCadAsset.mockRejectedValueOnce(
    new api.ApiError("unsuitable", 400, "CAD_REQUEST_UNSUITABLE", { alternative: { provider: "tripo3d" } })
  );
  promptInput.value = "turn it into a dragon";
  await clickGenerate();
  expect(mockAddChoiceMessage).not.toHaveBeenCalled();
  expect(mockAddChatMessage).toHaveBeenCalledWith("system", expect.stringContaining("Parametric CAD can't model this request"));
});

test("a 400 on priorDesign shows the too-large toast", async () => {
  await generateCadPart();
  mockGenerateCadAsset.mockRejectedValueOnce(
    new api.ApiError("Invalid request body", 400, "VALIDATION_ERROR", { issues: [{ path: ["priorDesign", "code"], message: "too long" }] })
  );
  promptInput.value = "edit";
  await clickGenerate();
  expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
    message: "This design is too large to edit. Detach to start a new part.",
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/create-panel-cad.test.js`
Expected: the six new tests FAIL.

- [ ] **Step 3: Implement in `create-panel.ts`**

1. Test seam (next to the other exported helpers):

```ts
/** Test seam: attach a chip without a generation (restore/open paths). */
export function _setActiveVersionForTest(version: ActiveVersion | null) {
  setActiveVersion(version);
}
```

2. `GenerationRequestArgs` gains `priorDesign?: CadDesign;` (`import type { CadDesign } from "@arbesk/cad-gen";`).

3. `dispatchGeneration` CAD branch:

```ts
  if (args.provider === "cad") {
    return api.generateCadAsset({
      prompt: args.effectivePrompt,
      nodeId: args.nodeId,
      // An edit chains onto the open asset like a Tripo follow-up; a fresh
      // part starts a new asset (CAD v1 behaviour).
      ...(args.priorDesign && {
        priorDesign: args.priorDesign,
        prevAssetManifestCid: args.prevAssetManifestCid,
        transformMatrix: args.transformMatrix,
      }),
      ...(args.stoppable && {
        signal: args.stoppable.signal,
        onTaskId: args.stoppable.onTaskId,
        onProgress: args.stoppable.onProgress,
      }),
    });
  }
```

4. `onGenerate` — replace the `retextureSource` block with route-driven selection (keep the BYOK check before it):

```ts
    const route = decideGenerationRoute({
      activeKind: activeVersion?.kind ?? null,
      selectedProvider: provider,
      hasImage: !!imagePayload,
    });
    const retextureSource = route.mode === "retexture" ? activeVersion : null;
    if (retextureSource) {
      addChatMessage("system", `Refining "${retextureSource.name}" (texture/material only — geometry unchanged)…`);
    }
    const priorDesign = route.mode === "cad-edit" ? await priorDesignOrWarn() : undefined;
    if (route.mode === "cad-edit" && !priorDesign) return; // finally restores the UI
    editingCad = route.mode === "cad-edit";
```

   and pass `provider: route.provider` and `...(priorDesign && { priorDesign })` into the `dispatchGeneration({ … })` call; `task: retextureSource ? "texture" : "model"` stays.

   Add the helper above `onGenerate`:

```ts
/** True while the in-flight generation is a CAD edit (error copy differs). */
let editingCad = false;

/**
 * Loads the active cad chip's design, announcing the edit.
 * @returns undefined (after a toast) when the design cannot be read.
 */
async function priorDesignOrWarn(): Promise<CadDesign | undefined> {
  const version = activeVersion as ActiveVersion;
  const design = await resolveActiveDesign(version);
  if (!design) {
    showToast({
      type: "warning",
      title: "Can't edit this part",
      message: `Couldn't load the design of '${version.name}'. Detach to generate a new part.`,
    });
    return undefined;
  }
  addChatMessage("system", `Editing "${version.name}"…`);
  return design;
}
```

   In `onGenerate`'s `finally`, add `editingCad = false;` after `setGenerating(false);` — and make sure the catch runs before it (it does: catch, then finally).

5. Edit-aware errors:

```ts
function offerCadTripoRetry(err: unknown, effectivePrompt: string): boolean {
  if (
    editingCad || // switching provider would discard the part being edited
    !(err instanceof ApiError) ||
    …existing conditions…
```

   and at the start of `reportGenerationFailure`, after the cancelled check:

```ts
  if (editingCad && isPriorDesignRejection(err)) {
    showToast({
      type: "warning",
      title: "Can't edit this part",
      message: "This design is too large to edit. Detach to start a new part.",
    });
    return true;
  }
```

   If adding these pushes `onGenerate` or `reportGenerationFailure` over the fallow threshold, extract (e.g. a `planGeneration()` helper returning `{ route, retextureSource, priorDesign }`).

- [ ] **Step 4: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/create-panel-cad.test.js test/frontend/create-panel-followups.test.js test/frontend/create-panel-generate.test.js test/frontend/refine-target.test.js`
Expected: all pass. Then `bun run test:frontend 2>&1 | grep -E "^FAIL|^Files:"` — no FAIL lines; `npx tsc --noEmit -p frontend/tsconfig.json` and `npx eslint frontend/src/js/ui/create-panel.ts frontend/src/js/ui/refine-target.ts` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/create-panel.ts test/frontend/create-panel-cad.test.js
git commit -m "feat(cad): typed prompts edit the active cad part via priorDesign

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: E2E + docs

**Files:**
- Create: `e2e/specs/28-cad-edit.spec.js`
- Modify: `e2e/helpers/studio-selectors.mjs` (add `refineIndicatorText: "#refineIndicatorText"`, `refineIndicatorDetach: "#refineIndicatorDetach"` next to `refineIndicator`)
- Modify: `e2e/README.md` (new spec entry, same style as its neighbours), `docs/CURRENT_STATUS.md` (CAD row: "typed follow-ups edit the active CAD part (priorDesign); the result is the next version")

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { MANIFEST_URL_REGEX, fetchManifest, manifestCidFromUrl } from "../helpers/manifest.mjs";
import { connectStudio } from "../helpers/flows.mjs";

const PROMPT = "a 40 by 30 by 20 mm box";
const MOCK_CODE = "return box(P.width, P.depth, P.height);";

/** Waits for the next CAD POST and returns its JSON body. */
async function nextCadPost(page) {
  const req = await page.waitForRequest(
    (r) => r.method() === "POST" && /\/api\/v1\/generations$/.test(r.url()) && r.postDataJSON()?.provider === "cad",
  );
  return req.postDataJSON();
}

/** Clicks the newest bubble's Show in Studio and waits for the saved pill. */
async function showNewestInStudio(page) {
  const bubble = page.locator(SELECTORS.assetBubble).last();
  await expect(bubble).toBeVisible({ timeout: 60_000 });
  await bubble.locator(".chat-asset-send").click();
  await page.waitForURL(MANIFEST_URL_REGEX);
  await expect(bubble).toHaveClass(/chat-bubble-asset-saved/, { timeout: 30_000 });
  return manifestCidFromUrl(page.url());
}

test.describe("CAD incremental edit", () => {
  test("a follow-up edits the active part; detaching starts fresh", async ({ page }) => {
    await connectStudio(page);
    await page.locator(SELECTORS.providerSelect).selectOption("cad");

    // 1. Fresh part: no priorDesign.
    await page.fill(SELECTORS.promptInput, PROMPT);
    const firstPost = nextCadPost(page);
    await page.click(SELECTORS.generateBtn);
    expect("priorDesign" in (await firstPost)).toBe(false);
    const v1 = await showNewestInStudio(page);

    // 2. The chip is attached and the selector locked to CAD.
    await expect(page.locator(SELECTORS.refineIndicator)).toBeVisible();
    await expect(page.locator(SELECTORS.refineIndicatorText)).toHaveText(`Refining: ${PROMPT}`);
    await expect(page.locator(SELECTORS.providerSelect)).toBeDisabled();
    await expect(page.locator(SELECTORS.providerSelect)).toHaveValue("cad");

    // 3. Follow-up: priorDesign carries the first design; result chains onto v1.
    await page.fill(SELECTORS.promptInput, "make it 5 mm taller");
    const editPost = nextCadPost(page);
    await page.click(SELECTORS.generateBtn);
    const body = await editPost;
    expect(body.priorDesign.code).toBe(MOCK_CODE);
    expect(body.priorDesign.turn).toBe(1);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(`Editing "${PROMPT}"…`);
    const v2 = await showNewestInStudio(page);
    expect(v2).not.toBe(v1);
    const saved = await fetchManifest(v2);
    const generation = await fetchManifest(saved.prev_asset_manifest_cid);
    expect(generation.prev_asset_manifest_cid).toBe(v1);

    // 4. Detach: the selector unlocks and the next prompt is fresh.
    await page.click(SELECTORS.refineIndicatorDetach);
    await expect(page.locator(SELECTORS.providerSelect)).toBeEnabled();
    await page.locator(SELECTORS.providerSelect).selectOption("cad");
    await page.fill(SELECTORS.promptInput, "a 10 mm cube");
    const freshPost = nextCadPost(page);
    await page.click(SELECTORS.generateBtn);
    expect("priorDesign" in (await freshPost)).toBe(false);
  });
});
```

If the saved-manifest chain differs (e.g. Show in Studio's auto-save chains differently for an edit), assert what the app actually records for Tripo follow-ups in `e2e/specs` (grep `prev_asset_manifest_cid`) and match that shape; report the difference.

- [ ] **Step 2: Run the CAD specs**

Nothing may listen on :9090 first (`ss -ltn | grep 9090` empty). Then:

```bash
bun run test:e2e -- --project=chromium e2e/specs/28-cad-edit.spec.js e2e/specs/26-cad-generation.spec.js
git checkout -- blockchain/deployments
```

Expected: all pass.

- [ ] **Step 3: Docs + commit**

Update `e2e/README.md` and `docs/CURRENT_STATUS.md` as listed above.

```bash
git add e2e/specs/28-cad-edit.spec.js e2e/helpers/studio-selectors.mjs e2e/README.md docs/CURRENT_STATUS.md
git commit -m "test(e2e): cad incremental edit flow; docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verification + PR

- [ ] **Step 1:** `npx tsc --noEmit -p frontend/tsconfig.json && bun run typecheck && bun run lint && (cd frontend && bun run build)` — clean.
- [ ] **Step 2:** `bun run test 2>&1 | grep -E "^FAIL|^Files:|^Tests:"` — no FAIL lines.
- [ ] **Step 3:** `bun run test:e2e -- --project=chromium` (full suite). Known order flakes: `18-chat-provenance`, `25-public-profile` — rerun solo if only those fail. Then `git checkout -- blockchain/deployments`.
- [ ] **Step 4:** Live check against the real DeepSeek generator (needs `DEEPSEEK_API_KEY` in `.env`; skip with a note if absent): `./scripts/start-dev.sh`, generate "a 60 x 40 x 5 mm plate with four 4 mm corner holes", Show in Studio, then "make the holes 6 mm" — the new version keeps the plate size and changes only the holes. Stop the stack.
- [ ] **Step 5:** `git fetch -q origin && git rebase origin/main`, `git push -u origin feat/cad-incremental-edit`, `gh pr create` (body: summary, test plan, ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line). Merging is the user's call.
- [ ] **Step 6:** After the user merges: remove the worktree (`git worktree remove --force`; chown root-owned leftovers via `docker run --rm -v "$W":/w alpine chown -R $(id -u):$(id -g) /w` first if needed), delete the branch locally and remotely, remove `arbesk-*cad-edit*` Docker volumes, and `rm -rf ~/.bun/install/cache/@t@` (the transpiler cache bakes worktree paths).
