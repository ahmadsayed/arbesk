# Checklists — Arbesk Studio UI / UX

Keyboard shortcut checklist and new panel/component checklist.

## 8. Keyboard Shortcut Checklist (when adding a new one)

1. **Pick the right key** — Blender uses `1/3/7` for views, `F` for frame, `5` for perspective toggle. GNOME uses `Ctrl+B` (sidebar), `Ctrl+N` (new), `Esc` (cancel).

2. **Add to the existing `keydown` switch** in `scene-graph.js` (don't create a new listener — they conflict).

3. **Guard against form field focus**:

```js
const tag = document.activeElement?.tagName?.toLowerCase();
const editable = document.activeElement?.isContentEditable
  || tag === "input" || tag === "textarea" || tag === "select";
if (editable) return;
```

4. **`e.preventDefault()` for keys that would otherwise scroll/navigate the browser** (e.g., `Home`, arrow keys).

5. **Add `title` tooltip on the corresponding button** showing the shortcut.

6. **Export any new function from scene-graph.js** so it can be tested or called from elsewhere.

---

## 11. Adding a New Panel or Component — Checklist

1. **Markup** — Add to `frontend/src/pug/studio.pug`. Use existing classes (`.inspector`, `.sidebar`, etc.) or extend them.
2. **Styles** — Add to the relevant `frontend/src/scss/components/_*.scss`. If a new file, add `@use` to `styles.scss`.
3. **Behavior** — Add to a new file in `frontend/src/js/ui/` (panel-style) or `frontend/src/js/engine/` (engine-level). Use ES modules, import from `state.js` for shared state.
4. **Events** — If your panel emits selection/state changes, dispatch a custom event on `document`. Don't couple panels directly.
5. **Keyboard** — If your panel has shortcuts, add them to the existing `keydown` switch in `scene-graph.js` with the form-field guard.
6. **Build** — Run `npm run build:frontend`. Check `frontend/dist/studio.html` for the markup and `frontend/dist/css/styles.css` for the styles.
7. **Test** — Open `http://localhost:9090` in the browser. Test with and without a loaded asset. Test the keyboard shortcuts work and don't fire in form fields.
