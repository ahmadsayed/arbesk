# Checklists — Arbesk Studio UI / UX

Keyboard shortcut checklist and new panel/component checklist.

## 8. Keyboard Shortcut Checklist (when adding a new one)

**Gate — run the 4-question bar first. Fail any → don't add a chord; use a visible button instead:**

1. **Frequent?** A few times a *session* isn't frequent — button only. (A few times a *minute* — frame / undo / save — earns a chord.)
2. **Does the browser/OS already own it?** `Ctrl+N` (new window) and `Ctrl+B` (bookmarks) are weak — you can't reliably claim them. `Ctrl+S` / `Ctrl+Z` are expected — fine.
3. **Better as a visible button?** Most actions are. Reserve chords for viewport ops, undo/save, panel toggles.
4. **Willing to document it?** If yes, it MUST land in `ui/keyboard-help.ts` (the `Ctrl+/` panel) and get a `title` tooltip. Not willing → don't add it.

**Then, if it passes:**

1. **Route it through the shared keymap/dispatcher** — not a new `document.addEventListener("keydown")` (that's how ~20 listeners across ~17 modules accumulated). If a dispatcher doesn't exist yet, add the chord to the *existing* central switch (`scene-graph.ts` viewport keys) or `undo-controller.ts` (edit keys), and note the consolidation as follow-up.
2. **Guard form focus** with the shared helper (not a fresh inline copy):

```js
const tag = document.activeElement?.tagName?.toLowerCase();
const editable = document.activeElement?.isContentEditable
  || tag === "input" || tag === "textarea" || tag === "select";
if (editable) return;
```

3. **Respect Escape's priority stack** — don't add another `Esc` listener. Escape routes to the topmost surface: dialog > popover > context menu > library > deselect > ascend. A new surface that opens above others must interpose into that stack, not fire in parallel.
4. **`e.preventDefault()`** for keys the browser would otherwise consume (`Home`, `Backspace`, `/`).
5. **Add `title` tooltip** on the corresponding button (use `MOD` from `utils/platform.ts` so macOS shows ⌘).
6. **E2E** — if the shortcut changes a flow the specs drive (generate/save/publish/dive/etc.), update `e2e/helpers/studio-selectors.mjs` + specs. See [→ E2E Sync](./e2e-sync.md).

---

## 11. Adding a New Panel or Component — Checklist

1. **Markup** — Add to the appropriate `frontend/src/pug/includes/*.pug` partial (or `frontend/src/pug/app.pug` only if adding a top-level body fragment). Use existing classes (`.inspector`, `.sidebar`, etc.) or extend them.
2. **Styles** — Add to the relevant `frontend/src/scss/components/_*.scss`. If a new file, add `@use` to `styles.scss`.
3. **Behavior** — Add to a new file in `frontend/src/js/ui/` (panel-style) or `frontend/src/js/engine/` (engine-level). Use ES modules, import from `state.ts` for shared state.
4. **Events** — If your panel emits selection/state changes, dispatch a custom event on `document`. Don't couple panels directly.
5. **Keyboard** — If your panel needs a shortcut, pass the 4-question bar in §8 first, then route it through the shared dispatcher (not a new `keydown` listener) with the shared form-field guard.
6. **Build** — Run `npm run build:frontend`. Check `frontend/dist/studio.html` for the markup and `frontend/dist/css/styles.css` for the styles.
7. **Test** — Open `http://localhost:9090` in the browser. Test with and without a loaded asset. Test the keyboard shortcuts work and don't fire in form fields.
8. **E2E sync** — if your panel adds/renames a button, `id`, label, or status text that a spec touches (or sits in the wallet/generate/save/publish/gallery/outliner/nesting flow), update `e2e/helpers/studio-selectors.mjs` + the affected spec and run `npx playwright test --config=e2e/playwright.config.js --project=chromium`. See [→ E2E Sync](./e2e-sync.md).
