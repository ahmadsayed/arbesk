/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  registerFormatHandler,
  getFormatHandler,
  detectAssetFormat,
  resolveFormatHandler,
  listFormatHandlers,
  _resetFormatRegistry,
} from "../../frontend/src/js/formats/registry.js";

describe("format registry", () => {
  afterEach(() => {
    _resetFormatRegistry();
  });

  const minimalHandler = (format) => ({
    format,
    extensions: [],
    load: async () => ({ meshes: [] }),
    decomposeForSave: async () => null,
    isStoredForm: () => false,
  });

  it("registers and looks up a handler", () => {
    const h = minimalHandler("foo");
    registerFormatHandler(h);
    expect(getFormatHandler("foo")).toBe(h);
    expect(getFormatHandler("FOO")).toBe(h);
  });

  it("throws on duplicate format", () => {
    registerFormatHandler(minimalHandler("foo"));
    expect(() => registerFormatHandler(minimalHandler("foo"))).toThrow(
      /already registered/
    );
  });

  it("throws when required hooks are missing", () => {
    expect(() => registerFormatHandler({ format: "x" })).toThrow(/handler.load/);
    expect(() =>
      registerFormatHandler({ format: "x", load: async () => {} })
    ).toThrow(/handler.decomposeForSave/);
    expect(() =>
      registerFormatHandler({
        format: "x",
        load: async () => {},
        decomposeForSave: async () => {},
      })
    ).toThrow(/handler.isStoredForm/);
  });

  it("detects formats case-insensitively", () => {
    expect(detectAssetFormat({ format: "GLB" })).toBe("glb");
    expect(detectAssetFormat({ format: "gltf" })).toBe("gltf");
    expect(detectAssetFormat({ format: "EXAMPLE" })).toBe("example");
  });

  it('defaults to "gltf" for missing/unknown format', () => {
    expect(detectAssetFormat({ cid: "bafy" })).toBe("gltf");
    expect(detectAssetFormat(null)).toBe("gltf");
    expect(detectAssetFormat("plain")).toBe("gltf");
  });

  it("lists all handlers", () => {
    const a = minimalHandler("a");
    const b = minimalHandler("b");
    registerFormatHandler(a);
    registerFormatHandler(b);
    expect(listFormatHandlers()).toEqual([a, b]);
  });

  it("warns once on unknown format and falls back to gltf", () => {
    registerFormatHandler(minimalHandler("gltf"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    resolveFormatHandler({ format: "unknown" });
    resolveFormatHandler({ format: "UNKNOWN" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
