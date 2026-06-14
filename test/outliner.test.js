/**
 * @jest-environment jsdom
 */

// We import the pure helpers we can test without bootstrapping the full app.
import {
  initOutliner,
  createNodeElement,
  selectNode,
} from "../frontend/src/js/ui/outliner.js";

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
