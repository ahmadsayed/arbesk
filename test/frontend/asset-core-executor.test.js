/**
 * asset-core inline ExecutorPort tests.
 *
 * The inline executor runs the moved gltf pipeline on the calling thread —
 * it is the backend default and the browser fallback when module workers are
 * unavailable. The decomposeGlb → compose round-trip over
 * mock-gltf-assets/triangle.glb (against in-memory IPFS) is the contract:
 * decomposeGlb stores a composite whose buffers/images are ipfs:// refs, and
 * compose resolves them back to self-contained data URIs.
 */
import { readFileSync } from "node:fs";
import {
  initRuntime,
  _resetRuntimeForTesting,
} from "../../frontend/src/js/asset-core/runtime.ts";
import { inlineExecutor } from "../../frontend/src/js/asset-core/executor/inline.ts";
import { createMemoryIpfs } from "../../frontend/src/js/asset-core/testing/memory-ipfs.ts";

afterEach(() => _resetRuntimeForTesting());

function triangleGlbArrayBuffer() {
  const buf = readFileSync("mock-gltf-assets/triangle.glb");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test("inline executor reports available", async () => {
  await expect(inlineExecutor.available()).resolves.toBe(true);
});

test("inline executor decomposeGlb + compose round-trips triangle.glb", async () => {
  const { read, write } = createMemoryIpfs();
  initRuntime({ ipfsRead: read, ipfsWrite: write, executor: inlineExecutor });

  const result = await inlineExecutor.exec("decomposeGlb", [
    { arrayBuffer: triangleGlbArrayBuffer(), assetName: "triangle" },
  ]);
  expect(result.compositeCid).toMatch(/^bafymem/);
  expect(result.composite.buffers[0].uri).toMatch(/^ipfs:\/\/bafymem/);

  // Compose from the stored CID (what a loader does) rather than the
  // in-memory composite, so the memory-IPFS read path is exercised too.
  const compositeJson = await read.getJSON(result.compositeCid);
  const { composedJson } = await inlineExecutor.exec("compose", [
    { compositeJson },
  ]);
  expect(composedJson).toBeDefined();
  expect(composedJson.buffers[0].uri).toMatch(/^data:/);
});

test("inline executor rejects unknown ops", async () => {
  const { read, write } = createMemoryIpfs();
  initRuntime({ ipfsRead: read, ipfsWrite: write, executor: inlineExecutor });
  await expect(
    inlineExecutor.exec("noSuchOp", [{}])
  ).rejects.toThrow(/unknown executor op/);
});
