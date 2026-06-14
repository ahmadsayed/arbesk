/**
 * @jest-environment jsdom
 */

// We import the pure helpers we can test without bootstrapping the full app.
import {
  initOutliner,
  createNodeElement,
  selectNode,
  renderTree,
} from "../frontend/src/js/ui/outliner.js";
import { on, EVENTS, _resetListenerCounts } from "../frontend/src/js/events/registry.js";

// jsdom does not implement CSS.escape, but outliner.js uses it for selectors.
if (typeof CSS === "undefined" || !CSS.escape) {
  global.CSS = global.CSS || {};
  global.CSS.escape = (value) => value.replace(/([.:#*+?^${}()|[\]\\])/g, "\\$1");
}

describe("outliner node rendering", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="outliner">
        <div class="outliner-tree"></div>
        <div class="outliner-footer">No items</div>
      </div>
    `;
    on(EVENTS.OUTLINER_NODE_SELECTED, () => {});
  });

  afterEach(() => {
    _resetListenerCounts();
  });

  test("renderTree recursively renders nested children with depth guides", () => {
    const tree = document.querySelector(".outliner-tree");
    const nodes = [
      {
        node_id: "parent",
        name: "parent",
        children: [
          {
            node_id: "child1",
            name: "child1",
            children: [{ node_id: "grandchild", name: "grandchild" }],
          },
          { node_id: "child2", name: "child2" },
        ],
      },
    ];
    renderTree(nodes);

    const parent = tree.querySelector('[data-node-id="parent"]');
    const child1 = tree.querySelector('[data-node-id="child1"]');
    const grandchild = tree.querySelector('[data-node-id="grandchild"]');

    expect(parent).toBeTruthy();
    expect(child1).toBeTruthy();
    expect(grandchild).toBeTruthy();
    expect(parent.dataset.depth).toBe("0");
    expect(child1.dataset.depth).toBe("1");
    expect(grandchild.dataset.depth).toBe("2");
    expect(child1.querySelectorAll(".outliner-node-guide").length).toBe(1);
    expect(grandchild.querySelectorAll(".outliner-node-guide").length).toBe(2);
  });

  test("renderTree renders empty state when nodes array is empty", () => {
    const tree = document.querySelector(".outliner-tree");
    const footer = document.querySelector(".outliner-footer");
    renderTree([]);

    expect(tree.querySelector(".ledger-empty")).toBeTruthy();
    expect(footer.textContent).toBe("0 items · 0 children · Depth 0/5");
  });

  test("renders a leaf node with icon, label, and no chevron", () => {
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
