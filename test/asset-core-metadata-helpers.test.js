const { setAnnotations, unsetAnnotations, getComputed, getAnnotations, parseJsonValue, patchFromPairs } =
  await import("../packages/besk/src/metadata.ts");

describe("metadata helpers", () => {
  test("setAnnotations merges into metadata.annotations", () => {
    const m = { metadata: { annotations: { a: 1 } } };
    setAnnotations(m, { b: 2, a: 3 });
    expect(m.metadata.annotations).toEqual({ a: 3, b: 2 });
  });
  test("unsetAnnotations deletes keys", () => {
    const m = { metadata: { annotations: { a: 1, b: 2 } } };
    unsetAnnotations(m, ["a"]);
    expect(m.metadata.annotations).toEqual({ b: 2 });
  });
  test("getComputed/getAnnotations default safely", () => {
    expect(getComputed({})).toBeNull();
    expect(getAnnotations({})).toEqual({});
  });
  test("parseJsonValue parses JSON, falls back to string", () => {
    expect(parseJsonValue("42")).toBe(42);
    expect(parseJsonValue('["a"]')).toEqual(["a"]);
    expect(parseJsonValue("plain")).toBe("plain");
  });
  test("patchFromPairs zips keys and values", () => {
    expect(patchFromPairs(["role", "tags"], ["hero", '["npc"]'])).toEqual({
      role: "hero",
      tags: ["npc"],
    });
  });
});
