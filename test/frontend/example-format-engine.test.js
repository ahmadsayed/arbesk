import { jest } from "@jest/globals";

/**
 * Reference test for the "example" dummy format engine in asset-core.
 * Copy this alongside example/ when adding a real format.
 *
 * It exercises the two halves the way a real format is exercised:
 *   1. the pure parser/converter (no ports needed), and
 *   2. the decompose/compose round-trip backed by in-memory IpfsRead/IpfsWrite
 *      ports (same setup as test/frontend/3mf-composer.test.js).
 */

// In-memory IPFS: cid → Uint8Array
const store = new Map();
let seq = 0;

const { initRuntime, _resetRuntimeForTesting } = await import(
  "@arbesk/asset-core/runtime.js"
);

function fakeCid() {
  return `bafyFake${String(seq++).padStart(4, "0")}`;
}

initRuntime({
  ipfsRead: {
    getJSON: jest.fn(async (cid) => {
      const bytes = store.get(cid);
      if (!bytes) throw new Error(`fake IPFS miss: ${cid}`);
      return JSON.parse(new TextDecoder().decode(bytes));
    }),
    getBytes: jest.fn(async (cid) => {
      const bytes = store.get(cid);
      if (!bytes) throw new Error(`fake IPFS miss: ${cid}`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }),
    getRawBytes: jest.fn(async (cid) => {
      const bytes = store.get(cid);
      if (!bytes) throw new Error(`fake IPFS miss: ${cid}`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }),
  },
  ipfsWrite: {
    write: jest.fn(async (data) => {
      const bytes =
        data instanceof Uint8Array
          ? data
          : new TextEncoder().encode(String(data));
      const cid = fakeCid();
      store.set(cid, bytes);
      return cid;
    }),
    writeJSON: jest.fn(async (json) => {
      const cid = fakeCid();
      store.set(cid, new TextEncoder().encode(JSON.stringify(json)));
      return cid;
    }),
  },
});

afterAll(() => _resetRuntimeForTesting());

const { parseExample, serializeExample } = await import(
  "@arbesk/asset-core/formats/example/parser.js"
);
const { parsedExampleToGltf } = await import(
  "@arbesk/asset-core/formats/example/to-gltf.js"
);
const { decompose } = await import(
  "@arbesk/asset-core/formats/example/decomposer.js"
);
const { compose, } = await import(
  "@arbesk/asset-core/formats/example/composer.js"
);
const { isCompositeExample } = await import(
  "@arbesk/asset-core/formats/example/format.js"
);

const RAW = new TextEncoder().encode("ARBESK-EXAMPLE Box\nhello payload");

describe("example format (reference engine)", () => {
  it("parses the raw form and round-trips through serialize", () => {
    const parsed = parseExample(RAW);
    expect(parsed.name).toBe("Box");
    expect(new TextDecoder().decode(parsed.payload)).toBe("hello payload");
    expect(serializeExample(parsed)).toEqual(RAW);
  });

  it("rejects bytes without the magic header", () => {
    expect(() => parseExample(new TextEncoder().encode("nope"))).toThrow(
      /magic header/
    );
  });

  it("converts a parsed structure into a valid glTF 2.0 document", () => {
    const gltf = parsedExampleToGltf(parseExample(RAW));
    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.meshes).toHaveLength(1);
    expect(gltf.buffers[0].uri.startsWith("data:application/octet-stream;base64,")).toBe(
      true
    );
  });

  it("round-trips raw → composite → raw through the ports", async () => {
    const { compositeCid, composite } = await decompose(RAW, {
      assetName: "Box",
      assetId: "asset_box",
    });
    expect(compositeCid).toMatch(/^bafyFake/);
    expect(isCompositeExample(composite)).toBe(true);
    expect(composite.name).toBe("Box");
    expect(composite.payload.length).toBe("hello payload".length);

    const rebuilt = await compose(composite);
    expect(rebuilt).toEqual(RAW);
  });

  it("rejects non-composite input in compose", async () => {
    await expect(
      compose({ name: "x", payload: { cid: "bafy", length: 0 } })
    ).rejects.toThrow(/not a composite example/);
  });
});
