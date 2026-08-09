# Asset Domain Model — Phase 4: Terminology Cleanup ("world" → "asset")

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the asset-domain unification by replacing the legacy "world" vocabulary with "asset" everywhere it is safe to do so: user-facing copy, code-internal names, logs, constants, and docs. Persisted manifest schema fields and internal event names stay frozen.

**Architecture:** No new structs or state changes. This is a rename-only phase on top of Phases 1–3. The ERC-721 `Collection` concept remains unchanged on-chain; nested manifests are still referenced via `child_ref`. Big structs + module functions; **no `class`, no inheritance**.

**Tech Stack:** ESM JS, Pug, SCSS, Jest (jsdom), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-09-asset-domain-model-design.md` § Terminology cleanup.

**Scope refinements vs spec (controller-noted):**
- `MAX_CHILD_WORLD_DEPTH` → `MAX_CHILD_ASSET_DEPTH` in code and comments.
- UI copy in `app.pug`, `ui/nesting.js`, and related SCSS data attributes.
- Log lines and comments in `engine/scene-loader.js`, `engine/scene-graph.js` where they say "child world".
- Docs: `AGENTS.md` and `ARCHITECTURE.md` wording corrected; manifest field names (`child_ref`, etc.) are NOT renamed.
- Internal bus event names (`NESTING_*`) are NOT renamed.
- Storage keys (`localStorage` / IndexedDB) are NOT renamed.

## Global Constraints

- Behavior preservation is paramount. No functional changes; only names, copy, and comments.
- ESM; camelCase; `npm run typecheck:frontend` must pass.
- `npm run lint` must pass.
- E2E-sync: if any selector or toast copy changes, update `e2e/helpers/studio-selectors.mjs` and affected specs (`e2e/README.md`, edit-ui skill's E2E Sync guide).
- Git commits: pre-authorized by the user for this refactor run (per-task commits, repo conventional style).
- Run from repo root `/home/ahmedh/Projects/arbesk/.worktrees/refactor-asset-domain-phase4` (or current phase worktree).

---

### Task 1: Constant rename

**Files:**
- Modify: `frontend/src/js/engine/state.js`
- Modify: all files importing or comparing `MAX_CHILD_WORLD_DEPTH`
- Modify: `test/frontend/nesting.test.js` (if it references the constant)

**Interfaces:**
- Export `MAX_CHILD_ASSET_DEPTH` from `engine/state.js`.
- Keep a deprecated re-export alias `MAX_CHILD_WORLD_DEPTH` pointing at `MAX_CHILD_ASSET_DEPTH` if any external/legacy consumer still references it, otherwise replace all usages.

- [ ] **Step 1: Rename in `engine/state.js`**

```js
export const MAX_CHILD_ASSET_DEPTH = 5;
// Deprecated alias — kept for backwards compatibility during migration.
export const MAX_CHILD_WORLD_DEPTH = MAX_CHILD_ASSET_DEPTH;
```

- [ ] **Step 2: Replace usages**

Search for `MAX_CHILD_WORLD_DEPTH` across `frontend/src/js/` and replace with `MAX_CHILD_ASSET_DEPTH` except for the re-export alias itself.

- [ ] **Step 3: Update tests**

If `test/frontend/nesting.test.js` asserts the constant name, update the assertion. Ensure no regression in depth-limit logic.

- [ ] **Step 4: Run focused tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/nesting.test.js test/frontend/domain-asset.test.js test/frontend/domain-collection.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/state.js <other changed files> test/frontend/nesting.test.js
git commit -m "refactor(engine): rename MAX_CHILD_WORLD_DEPTH to MAX_CHILD_ASSET_DEPTH"
```

---

### Task 2: Log and comment wording

**Files:**
- Modify: `frontend/src/js/engine/scene-loader.js`
- Modify: `frontend/src/js/engine/scene-graph.js`
- Modify: any other files logging "child world" or "world"

**Interfaces:**
- No API changes.

- [ ] **Step 1: Update `scene-loader.js`**

Replace log/comments:
- "child world" → "child asset"
- "world depth" → "asset depth"
- Keep functional behavior identical.

- [ ] **Step 2: Update `scene-graph.js`**

Same as above for any comments/logs; no functional changes.

- [ ] **Step 3: Grep sweep**

```bash
grep -R "child world\|world depth" frontend/src/js/ --include="*.js" || true
```

Expected: no matches (except frozen schema fields like `child_ref`).

- [ ] **Step 4: Run focused tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest test/frontend/nesting.test.js test/frontend/engine-scene-graph.test.js 2>/dev/null || echo "no such test"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/scene-loader.js frontend/src/js/engine/scene-graph.js
git commit -m "docs(engine): replace world vocabulary with asset in logs and comments"
```

---

### Task 3: UI copy

**Files:**
- Modify: `frontend/src/pug/app.pug`
- Modify: `frontend/src/js/ui/nesting.js`
- Modify: `frontend/src/scss/` files if data attributes or aria-labels reference "world"
- Modify: `e2e/helpers/studio-selectors.mjs` if selectors change
- Modify: affected E2E specs if assertions change

**Interfaces:**
- "Open This World" → "Open Asset"
- "Dive" / "Ascend" → "Open child asset" / "Back to parent asset" (or shorter: "Open child" / "Back to parent")
- Tooltips and aria-labels updated accordingly.

- [ ] **Step 1: Update `app.pug`**

Find the dive button label and change from "Open This World" to "Open Asset".

- [ ] **Step 2: Update `ui/nesting.js`**

Update toast messages, labels, and any user-visible strings:
- dive toast: "Opened child asset" (or equivalent)
- ascend toast: "Back to parent asset" (or equivalent)

- [ ] **Step 3: Update SCSS / data attributes**

Search for `world` in `frontend/src/scss/` and Pug templates; update only user-facing strings, not class names that would break selectors.

- [ ] **Step 4: E2E sync**

Run:
```bash
grep -R "Open This World\|Open Asset\|child world\|child asset" e2e/ --include="*.mjs" --include="*.js"
```

Update `e2e/helpers/studio-selectors.mjs` and specs if any literal strings are asserted.

- [ ] **Step 5: Build frontend + run E2E regression**

```bash
npm run build:frontend
npm run test:e2e -- --project=chromium e2e/specs/06-nesting.spec.js e2e/specs/11-library-studio-roundtrip.spec.js e2e/specs/20-new-asset-name.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pug/app.pug frontend/src/js/ui/nesting.js frontend/src/scss/ e2e/
git commit -m "refactor(ui): replace world vocabulary with asset in user-facing copy"
```

---

### Task 4: Documentation update

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Update golden-rules wording: "fractal nesting ('dollhouse')" stays; "world" → "asset" where it refers to nested assets.
- Update any stale `child_ref` shape description if wrong (field name stays, but prose should say "child asset reference").

- [ ] **Step 1: Update `AGENTS.md`**

Search for "world" (case-insensitive) in `AGENTS.md`. Replace with "asset" where it refers to nested assets; keep references to the product name or unrelated concepts unchanged.

- [ ] **Step 2: Update `docs/ARCHITECTURE.md`**

Same sweep. Ensure `child_ref` field name is preserved.

- [ ] **Step 3: Verify docs only**

```bash
grep -R "child world\|world depth" AGENTS.md docs/ARCHITECTURE.md || true
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/ARCHITECTURE.md
git commit -m "docs: align terminology with asset domain model (world → asset)"
```

---

### Task 5: Verification + merge

- [ ] **Step 1: Full test suite**

```bash
npm run lint
npm run typecheck:frontend
NODE_OPTIONS=--experimental-vm-modules npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='/blockchain/' --testPathIgnorePatterns='/.claude/' --testPathIgnorePatterns='/e2e/'
npm run build:frontend
```

Expected: all green.

- [ ] **Step 2: E2E regression**

```bash
npm run test:e2e -- --project=chromium e2e/specs/02-generate-asset.spec.js e2e/specs/03-save-and-publish.spec.js e2e/specs/04-parametric-version.spec.js e2e/specs/06-nesting.spec.js e2e/specs/08-fork-live-ref.spec.js e2e/specs/11-library-studio-roundtrip.spec.js e2e/specs/20-new-asset-name.spec.js
```

Expected: PASS.

- [ ] **Step 3: Final review**

Generate review package from `MERGE_BASE=main` to `HEAD`, dispatch code reviewer, address findings (one fix dispatch + one scoped re-review max).

- [ ] **Step 4: Merge**

```bash
git checkout main
git pull origin main
git merge --no-ff refactor/asset-domain-phase4 -m "Merge refactor/asset-domain-phase4: terminology cleanup (world → asset)"
git push origin main
```

- [ ] **Step 5: Clean up**

Remove phase-4 SDD workspace and worktree.
