import {
  initRuntime,
  getRuntime,
  _resetRuntimeForTesting,
} from "@arbesk/asset-core/runtime.js";
import { memoryStorage } from "@arbesk/asset-core/storage/memory.js";

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

test("default kernels: base64 round-trips", () => {
  const rt = initRuntime({ ipfsRead: fakeRead, ipfsWrite: fakeWrite });
  const bytes = new Uint8Array([104, 101, 108, 108, 111]);
  expect(
    Array.from(rt.kernels.base64.decode(rt.kernels.base64.encode(bytes)))
  ).toEqual(Array.from(bytes));
});

test("default kernels: murmur3 matches utils/hash", async () => {
  const { murmur3_128 } = await import(
    "@arbesk/asset-core/utils/hash.js"
  );
  const rt = initRuntime({ ipfsRead: fakeRead, ipfsWrite: fakeWrite });
  const bytes = new Uint8Array([1, 2, 3]);
  expect(rt.kernels.hash.murmur3_128(bytes)).toBe(murmur3_128(bytes));
});
