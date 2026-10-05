import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { meshTo3mf, serializeDesign } from "@arbesk/cad-gen";

const DESIGN = {
  code: "return box(P.w, P.w, P.w);",
  parameters: { w: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 2,
};
const MESH = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), numProp: 3 };

const store = new Map();
const getArrayBufferFromRemoteIPFS = jest.fn(async (cid) => {
  if (!store.has(cid)) throw new Error("not found " + cid);
  const b = store.get(cid);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
const getFromRemoteIPFS = jest.fn(async (cid) => JSON.parse(new TextDecoder().decode(store.get(cid))));

mock.module("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getArrayBufferFromRemoteIPFS,
  getFromRemoteIPFS,
}));

const { resolveCadDesign } = await import("../../frontend/src/js/services/cad-design-source.js");
const enc = (o) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe("resolveCadDesign", () => {
  test("reads the sidecar from a raw 3MF", async () => {
    store.set("bafyRaw", meshTo3mf(MESH, DESIGN));
    expect(await resolveCadDesign("bafyRaw")).toMatchObject({ code: DESIGN.code, turn: 2 });
  });

  test("reads the sidecar part of a saved composite 3MF", async () => {
    store.set("bafySidecar", enc(serializeDesign(DESIGN)));
    store.set("bafyComposite", enc({
      arbesk_format: "composite-3mf",
      parts: { "Metadata/arbesk_cad.json": { cid: "bafySidecar", _arbesk: {} } },
    }));
    expect(await resolveCadDesign("bafyComposite")).toMatchObject({ code: DESIGN.code, summary: "cube" });
  });

  test("returns null for a 3MF without a sidecar, a non-3MF, or a fetch failure", async () => {
    store.set("bafyJson", enc({ hello: "world" }));
    expect(await resolveCadDesign("bafyJson")).toBeNull();
    expect(await resolveCadDesign("bafyMissing")).toBeNull();
  });
});
