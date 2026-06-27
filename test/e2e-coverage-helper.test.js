import {
  E2E_COVERAGE,
  sourcePathFromUrl,
  filterLocalScriptEntries,
} from "../e2e/lib/coverage.mjs";

describe("e2e coverage helpers", () => {
  const ROOT = "/home/user/arbesk";

  test("E2E_COVERAGE reflects env var", () => {
    expect(E2E_COVERAGE).toBe(false);
  });

  test("maps /js/ URLs to frontend/src/js source files", () => {
    expect(
      sourcePathFromUrl(
        "http://127.0.0.1:9090/js/engine/scene-graph.js",
        ROOT,
      ),
    ).toBe("/home/user/arbesk/frontend/src/js/engine/scene-graph.js");
  });

  test("maps /constants/ URLs to root constants", () => {
    expect(
      sourcePathFromUrl("http://127.0.0.1:9090/constants/chains.js", ROOT),
    ).toBe("/home/user/arbesk/constants/chains.js");
  });

  test("ignores CDN, vendor, and non-script URLs", () => {
    expect(
      sourcePathFromUrl(
        "https://cdn.babylonjs.com/v9.12.0/babylon.js",
        ROOT,
      ),
    ).toBeNull();
    expect(
      sourcePathFromUrl(
        "http://127.0.0.1:9090/js/vendor/gltf-transform-core-4.1.2.js",
        ROOT,
      ),
    ).toBeNull();
    expect(
      sourcePathFromUrl("http://127.0.0.1:9090/css/styles.css", ROOT),
    ).toBeNull();
  });

  test("filters only local /js/ and /constants/ entries", () => {
    const entries = [
      { url: "http://127.0.0.1:9090/js/engine/scene-graph.js" },
      { url: "https://cdn.babylonjs.com/babylon.js" },
      { url: "http://127.0.0.1:9090/constants/chains.js" },
      { url: "http://127.0.0.1:9090/vendor/workerpool.js" },
    ];
    const filtered = filterLocalScriptEntries(
      entries,
      "http://127.0.0.1:9090",
    );
    expect(filtered.map((e) => e.url)).toEqual([
      "http://127.0.0.1:9090/js/engine/scene-graph.js",
      "http://127.0.0.1:9090/constants/chains.js",
    ]);
  });
});
