import {
  initRuntime,
  getRuntime,
  _resetRuntimeForTesting,
} from "../../frontend/src/js/asset-core/runtime.ts";
import { memoryStorage } from "../../frontend/src/js/asset-core/storage/memory.ts";

const fakeRead = { getJSON: async () => ({}), getBytes: async () => new ArrayBuffer(0), getRawBytes: async () => new ArrayBuffer(0) };
const fakeWrite = { write: async () => "bafyfake", writeJSON: async () => "bafyfake" };

afterEach(() => _resetRuntimeForTesting());

test("getRuntime throws before init", () => {
  expect(() => getRuntime()).toThrow(/not initialized/);
});

test("initRuntime applies defaults for optional ports", () => {
  const rt = initRuntime({ ipfsRead: fakeRead, ipfsWrite: fakeWrite });
  expect(rt.ipfsRead).toBe(fakeRead);
  expect(rt.executor).toBeDefined();
  expect(rt.kernels.base64).toBeDefined();
  expect(rt.storage.getItem("x")).toBeNull();
});

test("memoryStorage round-trips and removes", () => {
  const s = memoryStorage();
  s.setItem("k", "v");
  expect(s.getItem("k")).toBe("v");
  s.removeItem("k");
  expect(s.getItem("k")).toBeNull();
});
