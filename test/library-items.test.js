import {
  filterItems,
  computeRangeSelection,
  formatBytes,
} from "../frontend/src/js/utils/library-items.js";

describe("filterItems", () => {
  const items = [
    { id: "1", name: "Shield.glb" },
    { id: "2", name: "Sword.gltf" },
  ];

  test("returns all items for an empty query", () => {
    expect(filterItems(items, "")).toHaveLength(2);
  });

  test("filters case-insensitively by name substring", () => {
    expect(filterItems(items, "shi")).toEqual([items[0]]);
  });
});

describe("computeRangeSelection", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  test("selects the inclusive range between anchor and target, regardless of direction", () => {
    expect(computeRangeSelection(items, "a", "c")).toEqual(["a", "b", "c"]);
    expect(computeRangeSelection(items, "c", "a")).toEqual(["a", "b", "c"]);
  });

  test("falls back to just the target if the anchor is not found", () => {
    expect(computeRangeSelection(items, "missing", "b")).toEqual(["b"]);
  });
});

describe("formatBytes", () => {
  test("formats bytes, KB, and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
