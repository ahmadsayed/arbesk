# Outline Panel Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Arbesk Studio Outline panel as a contained card with clean GNOME-style rows, full-width selection, hover states, and hierarchy-ready indentation guides and expand/collapse chevrons.

**Architecture:** Update the existing `Outliner` component by rewriting its SCSS (`_outliner.scss`) and minimally extending its renderer (`outliner.js`). The data model currently stores nodes as a flat array, so the hierarchy features (chevrons, indentation guides) will render conditionally and become visible automatically once nested `children` arrays are supported.

**Tech Stack:** Vanilla JavaScript (ES modules), SCSS, Jest for unit tests, existing project build scripts.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/scss/components/_outliner.scss` | All outline visual styles: card container, rows, indentation guides, chevrons, hover/selected/drop-target states. |
| `frontend/src/js/ui/outliner.js` | DOM construction for nodes, depth-based indentation, child-toggle rendering, expand/collapse click handling. |
| `frontend/src/pug/studio.pug` | No changes expected — existing markup provides `.outliner`, `.outliner-tree`, and `.outliner-footer`. |
| `test/outliner.test.js` | New Jest tests for node DOM structure, selection, depth rendering, and child-toggle presence. |

---

## Task 0: Create a feature branch for the PR

- [ ] **Step 1: Create and switch to a feature branch**

```bash
git checkout -b feature/outline-panel-styling
```

Expected: you are now on branch `feature/outline-panel-styling` and all subsequent commits happen there. Do not push to `main` directly.

---

## Task 1: Add unit tests for outliner rendering

**Files:**
- Create: `test/outliner.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
/**
 * @jest-environment jsdom
 */

// We import the pure helpers we can test without bootstrapping the full app.
import {
  initOutliner,
  createNodeElement,
  selectNode,
} from "../frontend/src/js/ui/outliner.js";

describe("outliner node rendering", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="outliner">
        <div class="outliner-tree"></div>
        <div class="outliner-footer">No items</div>
      </div>
    `;
  });

  test("renders a leaf node with icon, label, and no chevron", () => {
    // This test documents expected behavior; it will fail until createNodeElement
    // is exported and renders a blank spacer for leaf nodes.
    const node = {
      node_id: "node_1",
      name: "hello",
    };
    const el = createNodeElement(node, false, 0);
    expect(el.classList.contains("outliner-node")).toBe(true);
    expect(el.dataset.nodeId).toBe("node_1");
    expect(el.querySelector(".outliner-node-label").textContent).toBe("hello");
    expect(el.querySelector(".outliner-node-icon").textContent).toBe("📦");
    expect(el.querySelector(".outliner-node-toggle")).toBeTruthy();
    expect(el.querySelector(".outliner-node-toggle").dataset.hasChildren).toBe("false");
  });

  test("renders a child world with badge and puzzle icon", () => {
    const node = {
      node_id: "node_2",
      name: "cowboy",
      child_ref: { tokenId: "2103578700" },
    };
    const el = createNodeElement(node, true, 0);
    expect(el.querySelector(".outliner-node-icon").textContent).toBe("🧩");
    expect(el.querySelector(".outliner-node-badge").textContent).toBe("#2103578700");
  });

  test("applies depth-based indentation guides", () => {
    const node = {
      node_id: "node_3",
      name: "boots",
      children: [{ node_id: "node_4", name: "spur" }],
    };
    const el = createNodeElement(node, false, 2);
    expect(el.dataset.depth).toBe("2");
    expect(el.querySelectorAll(".outliner-node-guide").length).toBe(2);
  });

  test("selectNode adds and removes the selected class", () => {
    const tree = document.querySelector(".outliner-tree");
    const a = createNodeElement({ node_id: "a", name: "A" }, false, 0);
    const b = createNodeElement({ node_id: "b", name: "B" }, false, 0);
    tree.appendChild(a);
    tree.appendChild(b);

    selectNode("a");
    expect(a.classList.contains("selected")).toBe(true);
    expect(b.classList.contains("selected")).toBe(false);

    selectNode("b");
    expect(a.classList.contains("selected")).toBe(false);
    expect(b.classList.contains("selected")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/outliner.test.js --runInBand
```

Expected: FAIL — `createNodeElement` and `selectNode` are not exported, and `outliner-node-toggle` does not exist.

- [ ] **Step 3: Export helpers and make selection testable**

In `frontend/src/js/ui/outliner.js`:

1. Add a helper to find the tree from the DOM when the module-level variable has not been initialized:

```javascript
function getOutlinerTree() {
  return outlinerTree || document.querySelector(".outliner-tree");
}
```

2. Replace every occurrence of `outlinerTree?.querySelector` and `outlinerTree?.querySelectorAll` in `selectNode` and `clearSelection` with `getOutlinerTree()?.querySelector` and `getOutlinerTree()?.querySelectorAll`.

3. Add named exports for the helper functions:

```javascript
export {
  initOutliner,
  refreshOutliner,
  selectNode,
  clearSelection,
  createNodeElement,
};
```

- [ ] **Step 4: Run tests again**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/outliner.test.js --runInBand
```

Expected: FAIL — tests fail because the DOM structure does not yet include `.outliner-node-toggle`, `.outliner-node-guide`, or the updated depth rendering. Task 3 will make them pass.

- [ ] **Step 5: Commit**

```bash
git add test/outliner.test.js frontend/src/js/ui/outliner.js
git commit -m "test(outliner): add rendering tests for outline styling"
```

---

## Task 2: Restyle the Outline panel SCSS

**Files:**
- Modify: `frontend/src/scss/components/_outliner.scss`

- [ ] **Step 1: Replace the stylesheet with the contained-card design**

```scss
// ═══════════════════════════════════════════════════════════════════
// Outliner — Scene hierarchy tree (sidebar view)
// ═══════════════════════════════════════════════════════════════════

.outliner {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--size-2);
}

.outliner-toolbar {
  display: flex;
  align-items: center;
  gap: var(--size-1);
  padding: var(--size-2) 0;
  flex-shrink: 0;
}

// Card container for the tree
.outliner-tree {
  flex: 1;
  overflow-y: auto;
  background-color: color-mix(in srgb, var(--window-fg) 2%, var(--sidebar-bg));
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-2);
  padding: var(--size-1);
}

// Tree node
.outliner-node {
  display: flex;
  align-items: center;
  gap: var(--size-1);
  padding: var(--size-1) var(--size-2);
  font-size: var(--font-size-1);
  border-radius: var(--radius-2);
  cursor: pointer;
  transition: background-color var(--duration-quick) var(--ease-out-3);
  user-select: none;
  min-height: 32px;

  &:hover {
    background-color: var(--surface-overlay-hover);
  }

  &.selected {
    background-color: color-mix(in srgb, var(--accent-bg) 15%, transparent);
    color: var(--sidebar-fg);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
}

// Indentation guides (one per depth level)
.outliner-node-guide {
  width: 1px;
  align-self: stretch;
  background-color: var(--border-hairline);
  margin: 0 var(--size-1);
  flex-shrink: 0;
}

// Expand/collapse toggle or leaf spacer
.outliner-node-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--dim-fg);
  transition: transform var(--duration-quick) var(--ease-out-3);
  cursor: pointer;

  &[data-has-children="false"] {
    opacity: 0;
    pointer-events: none;
  }

  &.expanded {
    transform: rotate(90deg);
  }

  &:hover {
    color: var(--sidebar-fg);
  }
}

.outliner-node-icon {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  font-size: var(--font-size-0);
}

.outliner-node-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outliner-node-badge {
  flex-shrink: 0;
  font-size: var(--font-size-0);
  font-family: var(--font-mono);
  color: var(--dim-fg);
  padding: 0 var(--size-1);
  font-variant-numeric: tabular-nums;
}

// Nesting indent: 1rem per depth level, plus guides
.outliner-node[data-depth="1"] { padding-left: var(--size-5); }
.outliner-node[data-depth="2"] { padding-left: var(--size-8); }
.outliner-node[data-depth="3"] { padding-left: 64px; }
.outliner-node[data-depth="4"] { padding-left: 80px; }
.outliner-node[data-depth="5"] { padding-left: 96px; }

// Drag target indicator
.outliner-drop-target {
  height: 2px;
  background-color: var(--accent-bg);
  border-radius: 1px;
  margin: 0 var(--size-2);
  opacity: 0;
  transition: opacity var(--duration-quick) var(--ease-out-3);

  &.active {
    opacity: 1;
  }
}

// Footer
.outliner-footer {
  flex-shrink: 0;
  padding: var(--size-2);
  font-size: var(--font-size-0);
  color: var(--dim-fg);
  border-top: var(--border-size-1) solid var(--border-color);
}
```

- [ ] **Step 2: Build the frontend to catch SCSS errors**

```bash
npm run build:frontend
```

Expected: build succeeds with no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/scss/components/_outliner.scss
git commit -m "style(outliner): contained card, row polish, hierarchy guides"
```

---

## Task 3: Update outliner.js to render hierarchy affordances

**Files:**
- Modify: `frontend/src/js/ui/outliner.js`

- [ ] **Step 1: Refactor createNodeElement to accept depth and render guides/toggle**

Replace the existing `createNodeElement` function (lines 138–186) with:

```javascript
function createNodeElement(node, isChildWorld, depth = 0) {
  const el = document.createElement("div");
  el.className = "outliner-node";
  el.dataset.nodeId = node.node_id;
  el.dataset.depth = depth;
  el.draggable = true;

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  // Indentation guides for nested rows
  for (let i = 0; i < depth; i++) {
    const guide = document.createElement("span");
    guide.className = "outliner-node-guide";
    guide.setAttribute("aria-hidden", "true");
    el.appendChild(guide);
  }

  // Expand/collapse toggle or leaf spacer
  const toggle = document.createElement("span");
  toggle.className = "outliner-node-toggle";
  toggle.setAttribute("aria-hidden", "true");
  toggle.dataset.hasChildren = String(hasChildren);
  toggle.textContent = hasChildren ? "▶" : "";
  if (hasChildren) {
    toggle.classList.add("expanded");
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle.classList.toggle("expanded");
      // Future: emit collapse/expand event or toggle child rows
    });
  }
  el.appendChild(toggle);

  // Icon
  const icon = document.createElement("span");
  icon.className = "outliner-node-icon";
  icon.textContent = isChildWorld ? "🧩" : "📦";
  el.appendChild(icon);

  // Label
  const label = document.createElement("span");
  label.className = "outliner-node-label";
  label.textContent = getNodeDisplayName(node);
  el.appendChild(label);

  // Badge (token ID for child worlds)
  if (isChildWorld && node.child_ref?.tokenId) {
    const badge = document.createElement("span");
    badge.className = "outliner-node-badge";
    badge.textContent = `#${node.child_ref.tokenId}`;
    el.appendChild(badge);
  }

  // Click → select
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    selectNode(node.node_id);
  });

  // Double-click child → dive
  if (isChildWorld) {
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      diveIntoChild(node);
    });
  }

  // Drag start
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", node.node_id);
    e.dataTransfer.effectAllowed = "move";
  });

  return el;
}
```

- [ ] **Step 2: Update renderTree to recurse through node.children**

Replace the existing `renderTree` function (lines 97–121) with:

```javascript
function renderTree(nodes, depth = 0) {
  if (!outlinerTree) return { totalNodes: 0, childCount: 0 };

  if (depth === 0) {
    outlinerTree.innerHTML = "";
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    if (depth === 0) {
      outlinerTree.innerHTML =
        '<div class="ledger-empty">No items in this world</div>';
      updateFooter(0, 0);
    }
    return { totalNodes: 0, childCount: 0 };
  }

  let totalNodes = 0;
  let childCount = 0;

  nodes.forEach((node) => {
    const isChild = !!node.child_ref;
    if (isChild) childCount++;
    totalNodes++;

    const el = createNodeElement(node, isChild, depth);
    outlinerTree.appendChild(el);

    if (Array.isArray(node.children) && node.children.length > 0) {
      const childStats = renderTree(node.children, depth + 1);
      totalNodes += childStats.totalNodes;
      childCount += childStats.childCount;
    }
  });

  if (depth === 0) {
    updateFooter(totalNodes, childCount);
  }

  return { totalNodes, childCount };
}
```

- [ ] **Step 3: Run the outliner tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/outliner.test.js --runInBand
```

Expected: PASS.

> **Implemented as:** The live `createNodeElement` renders a `<button>` toggle with `aria-expanded` and switches between `▶` (collapsed) and `▼` (expanded), rather than rotating a single chevron via CSS.

- [ ] **Step 4: Run the full frontend test suite**

```bash
npm run test:frontend
```

Expected: All tests pass (or existing failures remain unchanged).

- [ ] **Step 5: Build the frontend**

```bash
npm run build:frontend
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/outliner.js test/outliner.test.js
git commit -m "feat(outliner): render depth guides and child toggles"
```

---

## Task 4: Visual verification

**Files:**
- Verify: `frontend/dist/studio.html` and browser rendering

- [ ] **Step 1: Ensure dev infrastructure is running**

```bash
docker-compose ps
```

Expected: `ipfs` and `hardhat` containers are up.

- [ ] **Step 2: Start the backend and open the studio**

```bash
npm start
```

In a browser, open `http://localhost:9090/studio` and load an asset with scene nodes.

- [ ] **Step 3: Verify acceptance criteria**

Check the Outline panel for:

1. Tree renders inside a bordered card with rounded corners.
2. Row icon, label, and badge are vertically aligned.
3. Hover state darkens the row.
4. Selected row uses full-width accent highlight (no left inset bar).
5. No visual regressions in drag-and-drop or footer.
6. With mock data containing nested `children`, indentation guides and chevrons appear.

- [ ] **Step 4: Stop any local development servers (if still running)**

> The exact path in the original plan referred to a transient brainstorming server; use the standard dev teardown (`docker compose down`, stop `npm start`, etc.) instead.

- [ ] **Step 5: Final commit (if any verification fixes were made)**

If changes were required during verification:

```bash
git add .
git commit -m "fix(outliner): polish after visual verification"
```

---

## Task 5: Push branch and open a pull request

- [ ] **Step 1: Push the feature branch**

```bash
git push -u origin feature/outline-panel-styling
```

Expected: branch pushed to remote without touching `main`.

- [ ] **Step 2: Open a pull request**

Create a PR from `feature/outline-panel-styling` to `main` with title and description:

```text
Title: style(outliner): contained card styling and hierarchy-ready tree

Body:
- Wraps the outline tree in a bordered card with rounded corners.
- Polishes row spacing, alignment, hover, and full-width selection states.
- Adds indentation guides and expand/collapse toggles for nested nodes.
- Adds unit tests for outliner DOM rendering and selection.

Closes: <link to issue if available>
```

Do not merge the PR until code review is complete.

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every acceptance criterion in `docs/superpowers/specs/2026-06-14-outline-styling-design.md` maps to a task or verification step.
- [ ] **Placeholder scan:** No "TBD", "TODO", or vague instructions remain.
- [ ] **Type consistency:** `createNodeElement` signature stays `(node, isChildWorld, depth)` throughout; exports match the test imports.
- [ ] **Testability:** Tests import pure helpers without requiring full app bootstrap.
- [ ] **PR workflow:** All commits happen on `feature/outline-panel-styling`; `main` is not pushed to directly; a PR is opened at the end.
