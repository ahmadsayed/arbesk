import {
  isSupportedFile,
  getChildItems,
  filterItems,
  sortItems,
  buildBreadcrumb,
  computeRangeSelection,
  formatBytes,
} from "../frontend/src/js/utils/library-items.js";

describe("isSupportedFile", () => {
  test("accepts .glb and .gltf, case-insensitively", () => {
    expect(isSupportedFile("model.glb")).toBe(true);
    expect(isSupportedFile("model.GLTF")).toBe(true);
    expect(isSupportedFile("model.blend")).toBe(false);
    expect(isSupportedFile("model.fbx")).toBe(false);
  });
});

describe("getChildItems", () => {
  const state = {
    folders: [
      { id: "root-folder", name: "Weapons", parentId: null },
      { id: "nested-folder", name: "Swords", parentId: "root-folder" },
    ],
    files: [
      { id: "file-1", name: "shield.glb", parentId: null, status: "wip", sizeBytes: 1024, dateModified: 100 },
      { id: "file-2", name: "sword.glb", parentId: "root-folder", status: "besked", sizeBytes: 2048, dateModified: 200 },
    ],
  };

  test("returns folders and files for the given parentId only", () => {
    const rootItems = getChildItems(state, null);
    expect(rootItems).toHaveLength(2);
    expect(rootItems.find((i) => i.id === "root-folder").type).toBe("folder");
    expect(rootItems.find((i) => i.id === "file-1").type).toBe("file");

    const nestedItems = getChildItems(state, "root-folder");
    expect(nestedItems).toHaveLength(2);
    expect(nestedItems.map((i) => i.id).sort()).toEqual(["file-2", "nested-folder"]);
  });
});

describe("filterItems", () => {
  const items = [{ id: "1", name: "Shield.glb" }, { id: "2", name: "Sword.gltf" }];

  test("returns all items for an empty query", () => {
    expect(filterItems(items, "")).toHaveLength(2);
  });

  test("filters case-insensitively by name substring", () => {
    expect(filterItems(items, "shi")).toEqual([items[0]]);
  });
});

describe("sortItems", () => {
  test("folders always sort before files regardless of sortBy", () => {
    const items = [
      { id: "f1", type: "file", name: "b.glb", status: "wip", dateModified: 1 },
      { id: "d1", type: "folder", name: "z-folder", status: null, dateModified: null },
    ];
    const sorted = sortItems(items, "name");
    expect(sorted.map((i) => i.id)).toEqual(["d1", "f1"]);
  });

  test("sortBy 'name' orders files alphabetically within the file group", () => {
    const items = [
      { id: "b", type: "file", name: "banana.glb", dateModified: 1, status: "wip" },
      { id: "a", type: "file", name: "apple.glb", dateModified: 2, status: "wip" },
    ];
    expect(sortItems(items, "name").map((i) => i.id)).toEqual(["a", "b"]);
  });

  test("sortBy 'date' orders files newest first", () => {
    const items = [
      { id: "old", type: "file", name: "old.glb", dateModified: 1, status: "wip" },
      { id: "new", type: "file", name: "new.glb", dateModified: 2, status: "wip" },
    ];
    expect(sortItems(items, "date").map((i) => i.id)).toEqual(["new", "old"]);
  });

  test("sortBy 'status' orders uploading, then wip, then besked", () => {
    const items = [
      { id: "b", type: "file", name: "b.glb", status: "besked", dateModified: 1 },
      { id: "u", type: "file", name: "u.glb", status: "uploading", dateModified: 1 },
      { id: "s", type: "file", name: "s.glb", status: "wip", dateModified: 1 },
    ];
    expect(sortItems(items, "status").map((i) => i.id)).toEqual(["u", "s", "b"]);
  });
});

describe("buildBreadcrumb", () => {
  const folders = [
    { id: "f1", name: "Characters", parentId: null },
    { id: "f2", name: "Heroes", parentId: "f1" },
  ];

  test("returns just Home at the root", () => {
    expect(buildBreadcrumb(folders, null)).toEqual([{ id: null, name: "Home" }]);
  });

  test("returns the full ancestor chain ending at the current folder", () => {
    expect(buildBreadcrumb(folders, "f2")).toEqual([
      { id: null, name: "Home" },
      { id: "f1", name: "Characters" },
      { id: "f2", name: "Heroes" },
    ]);
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
