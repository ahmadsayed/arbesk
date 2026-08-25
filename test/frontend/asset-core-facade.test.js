/**
 * asset-core SDK facade tests.
 *
 * Deliberately run in the default node environment (no jsdom): the facade is
 * environment-agnostic, and jsdom's realm-mismatched Uint8Array breaks the
 * `instanceof` checks in asset-core/utils/compression.ts (same reason as
 * asset-core-ipfs-ports.test.js). Blob is a Node ≥ 18 global.
 */
import { readFileSync } from "node:fs";
import { encodePacked, keccak256 } from "viem/utils";
import { createArbeskCore } from "@arbesk/asset-core/facade.js";
import { createMemoryIpfs } from "@arbesk/asset-core/storage/memory-ipfs.js";
import { _resetRuntimeForTesting } from "@arbesk/asset-core/runtime.js";

/** Minimal viem-backed HashPort (same semantics as createBrowserHashPort). */
const makeHashPort = () => ({
  soliditySha3: (...args) =>
    keccak256(
      encodePacked(
        args.map((a) => a.type),
        args.map((a) =>
          a.type === "address" ? String(a.value).toLowerCase() : a.value
        )
      )
    ),
  keccak256: (data) => keccak256(data),
});

const makeCore = (extra = {}) => {
  const { read, write } = createMemoryIpfs();
  return createArbeskCore({ ipfsRead: read, ipfsWrite: write, ...extra });
};

afterEach(() => _resetRuntimeForTesting());

test("upload(GLB) → download round-trips through memory IPFS", async () => {
  const core = makeCore();
  const bytes = readFileSync("mock-gltf-assets/triangle.glb");
  const { rootCid } = await core.upload(new Uint8Array(bytes));
  expect(rootCid).toMatch(/^bafymem/);
  const blob = await core.download(rootCid);
  expect(blob.size).toBeGreaterThan(0);
});

test("upload(glTF JSON string) decomposes and stores a composite", async () => {
  const core = makeCore();
  const gltf = JSON.stringify({
    asset: { version: "2.0" },
    buffers: [
      { uri: "data:application/octet-stream;base64,AQIDBA==", byteLength: 4 },
    ],
  });
  const { rootCid } = await core.upload(gltf);
  expect(rootCid).toMatch(/^bafymem/);
  const composite = await core.getManifest(rootCid);
  expect(composite.buffers[0].uri).toMatch(/^ipfs:\/\/bafymem/);
});

test("validateManifest is exposed on the facade", async () => {
  const core = makeCore();
  expect(core.validateManifest(42).valid).toBe(false);
});

test("addEditor with email but no chain port rejects with guidance", async () => {
  const core = makeCore();
  await expect(
    core.addEditor({ tag: "31337:0x0:1:asset" }, "friend@example.com")
  ).rejects.toThrow(/resolveEmail|0x/);
});

test("addEditor/listEditors round-trip a 0x address (no chain port)", async () => {
  const core = makeCore({ hash: makeHashPort() });
  const asset = { tokenId: "7" };
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  await core.addEditor(asset, address);
  const editors = await core.listEditors(asset);
  expect(editors).toEqual([{ address, role: 2 }]);
  await expect(core.addEditor(asset, address)).rejects.toThrow(
    /already an editor/
  );
  // Removing the only editor is rejected by the last-editor guard, so the
  // list still holds it.
  await expect(core.removeEditor(asset, address)).rejects.toThrow(
    /last editor/
  );
  await expect(core.listEditors(asset)).resolves.toEqual([
    { address, role: 2 },
  ]);
});
