/**
 * besk representations (spec docs/superpowers/specs/2026-11-10-asset-representations-design.md):
 * attach / detach / info / download through the MCP tools (the CLI shares the
 * same module), and R3's carry-forward through every besk write that builds
 * an asset's next version. Runs against an in-memory IPFS + collection store:
 * the relay mock moves the token's URI, so each write reads the last one.
 */
import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARBESK_CACHE_PATH = path.join(os.tmpdir(), "besk-reps-test-cache-" + process.pid + ".json");

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const manifests = {};
const blobs = {};
const written = [];
const tokenURIs = {};
/**
 * Another client's save landing mid-command: runs at an IPFS write (the JSON
 * written, or null for bytes) until it returns true.
 */
let onWrite = null;
function fireOnWrite(json) {
  if (onWrite?.(json)) onWrite = null;
}

const relayMock = jest.fn(async (_s, action, tokenId, params) => {
  if (action === "updateUri") tokenURIs[String(tokenId)] = params.newUri;
  return {};
});
mock.module("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const runGenerationMock = jest.fn();
mock.module("../packages/besk/src/generate.ts", () => ({
  runGeneration: runGenerationMock,
  cancelGeneration: jest.fn(),
  getProviderBalance: jest.fn(),
  resolveSourceCid: jest.fn(async (cid) => "src:" + cid),
}));

let currentSession = null;
mock.module("../packages/besk/src/session.ts", () => ({
  loadSession: jest.fn(() => currentSession),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
  setActiveCollection: jest.fn(),
}));

mock.module("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({
    contractAddress: "0x0",
    ipfsGatewayUrl: "http://gw",
    networkConfigs: { 84532: { contractAddress: "0xContract84532", rpcUrl: "http://rpc" } },
  })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async (tokenId) => tokenURIs[String(tokenId)]),
    listTokens: jest.fn(async ({ scope }) => (scope === "owned" ? Object.keys(tokenURIs) : [])),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async (cid) => {
      if (!(cid in manifests)) throw new Error("unknown cid " + cid);
      return structuredClone(manifests[cid]);
    }),
    getBytes: jest.fn(),
    getRawBytes: jest.fn(async (cid) => {
      if (!(cid in blobs)) throw new Error("unknown blob " + cid);
      return blobs[cid].slice().buffer;
    }),
  })),
  createIpfsWritePort: jest.fn(() => ({
    write: jest.fn(async (data, filename, _cred, options) => {
      fireOnWrite(null);
      const cid = "bafyBlob" + (Object.keys(blobs).length + 1);
      blobs[cid] = new Uint8Array(data);
      blobs[cid].filename = filename;
      blobs[cid].compress = options?.compress;
      return cid;
    }),
    writeJSON: jest.fn(async (json) => {
      fireOnWrite(json);
      written.push(json);
      const cid = "bafyWritten" + written.length;
      manifests[cid] = structuredClone(json);
      return cid;
    }),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
  unpinCids: jest.fn(),
}));

const { callTool } = await import("../packages/besk/src/mcp.ts");
const { clearCatalogCache } = await import("../packages/besk/src/catalog.ts");
const { setAssetMetadata, unsetAssetMetadata } = await import("../packages/besk/src/metadata.ts");
const { linkChildAsset } = await import("../packages/besk/src/link.ts");
const { sendAssetToCollection } = await import("../packages/besk/src/send.ts");
const { saveGenerated } = await import("../packages/besk/src/helpers.ts");
const { MAX_REPRESENTATIONS } = await import("@arbesk/asset-core/manifest/representations.js");
const { representationChanges } = await import("../packages/besk/src/representations.ts");

const SESSION = {
  token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc",
  email: "a@b.c", authMethod: "siwe", activeCollectionTokenId: "1",
};

const BLEND = {
  id: "source", role: "source", format: "blend", name: "Bracket.blend",
  cid: "bafyBlend", bytes: 3, encoding: "raw", created_at: 1,
};

function resetStore() {
  for (const k of Object.keys(manifests)) delete manifests[k];
  for (const k of Object.keys(blobs)) delete blobs[k];
  for (const k of Object.keys(tokenURIs)) delete tokenURIs[k];
  tokenURIs[1] = "bafyCol1";
  tokenURIs[2] = "bafyCol2";
  manifests.bafyCol1 = {
    type: "collection", name: null, asset_id: "c1", version: 1,
    assets: { asset_bracket: "bafyBracket", asset_raw: "bafyRaw" },
  };
  manifests.bafyCol2 = { type: "collection", name: "props", asset_id: "c2", version: 1, assets: {} };
  manifests.bafyBracket = {
    type: "asset", name: "bracket", asset_id: "asset_bracket", version: 2, timestamp: 1,
    scene: { nodes: [{ node_id: "node_1", transform_matrix: IDENTITY, source: { cid: "bafyModel" } }] },
  };
  manifests.bafyModel = { asset: { version: "2.0" }, nodes: [] };
  // A `besk upload` entry: the bare composite glTF, no asset manifest.
  manifests.bafyRaw = { asset: { version: "2.0" }, name: "raw", nodes: [], meshes: [] };
}

/** The asset's current manifest, read back through the collection. */
function current(assetId) {
  return manifests[manifests[tokenURIs[1]].assets[assetId]];
}

function tmpFile(name, contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "besk-reps-")), name);
  fs.writeFileSync(file, contents);
  return file;
}

function withRepresentations(reps) {
  manifests.bafyBracket.representations = reps;
}

beforeEach(() => {
  currentSession = { ...SESSION };
  resetStore();
  written.length = 0;
  relayMock.mockClear();
  onWrite = null;
  runGenerationMock.mockReset();
  clearCatalogCache();
});

describe("attach_representation", () => {
  test("uploads a G-code brotli-framed and records it derived from the model", async () => {
    const gcode = "G1 X10 Y10 E0.5\n".repeat(500);
    const file = tmpFile("Bracket_PETG.gcode", gcode);
    const r = await callTool("attach_representation", {
      name: "bracket", file, printer: "Original Prusa MK4", material: "PETG", layer: 0.2, nozzle: 0.4,
    });

    expect(r).toMatchObject({ attached: "gcode-original-prusa-mk4-petg", replaced: false });
    expect(r.warnings).toBeUndefined();
    const m = current("asset_bracket");
    expect(m.version).toBe(3);
    expect(m.prev_asset_manifest_cid).toBe("bafyBracket");
    expect(m.representations).toHaveLength(1);
    const rep = m.representations[0];
    expect(rep).toMatchObject({
      role: "machine", format: "gcode", name: "Bracket_PETG.gcode", bytes: gcode.length, encoding: "brotli",
      derived_from: { ref: "primary", cid: "bafyModel" },
      profile: { printer: "Original Prusa MK4", material: "PETG", layer_mm: 0.2, nozzle_mm: 0.4 },
    });
    // Stored exactly as encoded: the port is told not to compress again.
    expect(blobs[rep.cid].compress).toBe(false);
    expect(blobs[rep.cid].length).toBeLessThan(gcode.length);
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1", expect.objectContaining({ assetId: "asset_bracket" }),
    );
  });

  test("a source file is stored raw, derived from nothing, with the public warning", async () => {
    const file = tmpFile("Bracket.blend", "BLENDER-v300");
    const r = await callTool("attach_representation", { name: "bracket", file });
    expect(r.attached).toBe("source");
    expect(r.warnings).toEqual([expect.stringContaining("public")]);
    const rep = current("asset_bracket").representations[0];
    expect(rep).toMatchObject({ role: "source", encoding: "raw", bytes: 12 });
    expect(rep.derived_from).toBeUndefined();
  });

  test("--from another representation records that file's CID", async () => {
    withRepresentations([BLEND]);
    const file = tmpFile("bracket.stl", "solid x");
    await callTool("attach_representation", { name: "bracket", file, from: "source" });
    const reps = current("asset_bracket").representations;
    expect(reps.map((rep) => rep.id)).toEqual(["source", "stl"]);
    expect(reps[1].derived_from).toEqual({ ref: "source", cid: "bafyBlend" });
  });

  test("--from none records no origin; an unknown --from is refused before the upload", async () => {
    await callTool("attach_representation", { name: "bracket", file: tmpFile("b.stl", "solid"), from: "none" });
    expect(current("asset_bracket").representations[0].derived_from).toBeUndefined();
    const before = Object.keys(blobs).length;
    await expect(
      callTool("attach_representation", { name: "bracket", file: tmpFile("c.stl", "solid"), from: "nope" }),
    ).rejects.toThrow("No representation nope");
    expect(Object.keys(blobs)).toHaveLength(before);
  });

  test("the same id replaces the entry in place", async () => {
    withRepresentations([BLEND]);
    const r = await callTool("attach_representation", { name: "bracket", file: tmpFile("Bracket2.blend", "v2") });
    expect(r.replaced).toBe(true);
    const reps = current("asset_bracket").representations;
    expect(reps).toHaveLength(1);
    expect(reps[0].name).toBe("Bracket2.blend");
  });

  test(`refuses a ${MAX_REPRESENTATIONS + 1}th entry before uploading`, async () => {
    withRepresentations(Array.from({ length: MAX_REPRESENTATIONS }, (_, i) => ({ ...BLEND, id: "r" + i })));
    await expect(
      callTool("attach_representation", { name: "bracket", file: tmpFile("x.stl", "solid") }),
    ).rejects.toThrow("at most 32");
    expect(Object.keys(blobs)).toHaveLength(0);
  });

  test("refuses a missing file, an unknown role, a bad id and a bad layer", async () => {
    const file = tmpFile("x.stl", "solid");
    await expect(callTool("attach_representation", { name: "bracket", file: "/no/such.stl" })).rejects.toThrow("File not found");
    await expect(callTool("attach_representation", { name: "bracket", file, role: "print" })).rejects.toThrow("Unknown role print");
    await expect(callTool("attach_representation", { name: "bracket", file, id: "Primary" })).rejects.toThrow("Invalid id");
    await expect(callTool("attach_representation", { name: "bracket", file, id: "primary" })).rejects.toThrow("reserved");
    await expect(callTool("attach_representation", { name: "bracket", file, layer: -1 })).rejects.toThrow("layer must be");
    expect(written).toHaveLength(0);
  });

  test("records node 0's placement, so a rescale makes a G-code stale", async () => {
    await callTool("attach_representation", { name: "bracket", file: tmpFile("b.gcode", "G1") });
    expect(current("asset_bracket").representations[0].derived_from).toEqual({
      ref: "primary", cid: "bafyModel", transform_matrix: IDENTITY,
    });
  });

  test("refuses a format the schema rejects before uploading anything", async () => {
    for (const name of ["part.my-ext", "x.verylongextension17"]) {
      await expect(
        callTool("attach_representation", { name: "bracket", file: tmpFile(name, "x") }),
      ).rejects.toThrow("Cannot attach: format");
    }
    expect(Object.keys(blobs)).toHaveLength(0);
    expect(written).toHaveLength(0);
  });

  test("counts an entry it cannot parse, refusing before the upload, and carries it", async () => {
    const foreign = { id: "plan", role: "plan", format: "json", cid: "bafyPlan" };
    withRepresentations([foreign, ...Array.from({ length: MAX_REPRESENTATIONS - 1 }, (_, i) => ({ ...BLEND, id: "r" + i }))]);
    await expect(
      callTool("attach_representation", { name: "bracket", file: tmpFile("x.stl", "solid") }),
    ).rejects.toThrow("at most 32");
    expect(Object.keys(blobs)).toHaveLength(0);

    withRepresentations([foreign]);
    await callTool("attach_representation", { name: "bracket", file: tmpFile("x.stl", "solid") });
    expect(current("asset_bracket").representations.map((r) => r.id)).toEqual(["plan", "stl"]);
  });

  // A Studio save lands while the file uploads: the attach must not replace it.
  test("refuses to replace an entry that moved while it was uploading", async () => {
    onWrite = () => {
      manifests.bafyStudio = { ...manifests.bafyBracket, version: 3, prev_asset_manifest_cid: "bafyBracket" };
      manifests.bafyCol1b = { ...manifests.bafyCol1, assets: { ...manifests.bafyCol1.assets, asset_bracket: "bafyStudio" } };
      tokenURIs[1] = "bafyCol1b";
      return true;
    };
    const err = await callTool("attach_representation", { name: "bracket", file: tmpFile("b.stl", "solid") }).then(() => null, (e) => e);
    expect(err.code).toBe("CONFLICT");
    expect(current("asset_bracket")).toBe(manifests.bafyStudio);
    expect(relayMock).not.toHaveBeenCalled();
  });

  test("an asset stored as a bare composite is wrapped in an asset manifest first", async () => {
    await callTool("attach_representation", { name: "raw", file: tmpFile("raw.stl", "solid") });
    const m = current("asset_raw");
    expect(m).toMatchObject({ type: "asset", name: "raw", asset_id: "asset_raw", version: 2, prev_asset_manifest_cid: "bafyRaw" });
    expect(m.scene.nodes[0].source).toEqual({ cid: "bafyRaw", format: "gltf", path: "composite.gltf" });
    expect(m.representations[0].derived_from).toEqual({ ref: "primary", cid: "bafyRaw", transform_matrix: IDENTITY });
  });
});

describe("detach_representation", () => {
  test("writes the next version without it; the previous version keeps it", async () => {
    withRepresentations([BLEND]);
    const r = await callTool("detach_representation", { name: "bracket", id: "source" });
    expect(r).toMatchObject({ detached: "source" });
    const m = current("asset_bracket");
    expect(m.version).toBe(3);
    expect(m.representations).toBeUndefined();
    expect(manifests[m.prev_asset_manifest_cid].representations).toEqual([BLEND]);
  });

  test("refuses an unknown id", async () => {
    const err = await callTool("detach_representation", { name: "bracket", id: "nope" }).then(() => null, (e) => e);
    expect(err.message).toContain("No representation nope (the asset has none)");
    expect(err.code).toBe("NOT_FOUND");
    expect(written).toHaveLength(0);
  });
});

describe("asset_info and download_asset", () => {
  test("asset_info lists representations with a stale marker", async () => {
    withRepresentations([
      BLEND,
      { ...BLEND, id: "stl", role: "mesh", format: "stl", name: "a.stl", cid: "bafyStl", derived_from: { ref: "primary", cid: "bafyOldModel" } },
    ]);
    const info = await callTool("asset_info", { name: "bracket" });
    expect(info.representations).toEqual([
      expect.objectContaining({ id: "source", derivedFrom: null, stale: false }),
      expect.objectContaining({ id: "stl", derivedFrom: "primary", stale: true }),
    ]);
  });

  test("download_asset with representation writes the decoded file", async () => {
    const gcode = "G28\nG1 Z0.2\n".repeat(300);
    await callTool("attach_representation", { name: "bracket", file: tmpFile("part.gcode", gcode) });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "besk-reps-dl-"));
    const r = await callTool("download_asset", { name: "bracket", directory: dir, representation: "gcode" });
    expect(r).toMatchObject({ file: path.join(dir, "part.gcode"), bytes: gcode.length, format: "gcode", representation: "gcode" });
    expect(fs.readFileSync(r.file, "utf8")).toBe(gcode);
  });

  test("download_asset names the known ids for an unknown representation", async () => {
    withRepresentations([BLEND]);
    await expect(
      callTool("download_asset", { name: "bracket", representation: "gcode" }),
    ).rejects.toThrow("No representation gcode (has: source)");
  });
});

// R3: every besk write that builds an asset's next version keeps the list.
describe("carry-forward through besk's writes", () => {
  beforeEach(() => withRepresentations([BLEND]));

  test("rename_asset", async () => {
    await callTool("rename_asset", { oldName: "bracket", newName: "bracket2" });
    expect(current("asset_bracket").representations).toEqual([BLEND]);
  });

  test("set/unset asset metadata", async () => {
    await setAssetMetadata(currentSession, "1", "asset_bracket", "bafyBracket", { role: "hero" });
    expect(current("asset_bracket").representations).toEqual([BLEND]);
    const cid = manifests[tokenURIs[1]].assets.asset_bracket;
    await unsetAssetMetadata(currentSession, "1", "asset_bracket", cid, ["role"]);
    expect(current("asset_bracket").representations).toEqual([BLEND]);
  });

  test("link (the parent's next version)", async () => {
    await linkChildAsset(currentSession, {
      parentTokenId: "1", parentAssetId: "asset_bracket", parentCid: "bafyBracket",
      childTokenId: "1", childAssetId: "asset_raw", childCid: "bafyRaw", mode: "fork",
    });
    expect(current("asset_bracket").scene.nodes).toHaveLength(2);
    expect(current("asset_bracket").representations).toEqual([BLEND]);
  });

  test("send (fork carries the same version)", async () => {
    await sendAssetToCollection(currentSession, {
      sourceTokenId: "1", targetTokenId: "2", assetId: "asset_bracket",
      assetName: "bracket", assetCid: "bafyBracket", mode: "fork",
    });
    expect(manifests[manifests[tokenURIs[2]].assets.asset_bracket].representations).toEqual([BLEND]);
  });

  test("upload over an asset with representations wraps the new model and keeps them", async () => {
    const file = tmpFile("bracket.gltf", JSON.stringify({ asset: { version: "2.0" } }));
    const r = await callTool("upload_asset", { file, name: "bracket" });
    const m = current("asset_bracket");
    expect(r.cid).toBe(manifests[tokenURIs[1]].assets.asset_bracket);
    expect(m).toMatchObject({ type: "asset", version: 3, prev_asset_manifest_cid: "bafyBracket", representations: [BLEND] });
    expect(m.scene.nodes[0].source.cid).not.toBe("bafyModel");
  });

  test("upload over an asset without representations stores the bare composite (unchanged)", async () => {
    delete manifests.bafyBracket.representations;
    const file = tmpFile("bracket.gltf", JSON.stringify({ asset: { version: "2.0" } }));
    await callTool("upload_asset", { file, name: "bracket" });
    expect(current("asset_bracket").scene).toBeUndefined();
  });

  test("a model save refuses to replace an entry that moved after it was read", async () => {
    // nextModelEntry reads the entry, then writes the wrapper: move it then.
    onWrite = (json) => {
      if (!json?.representations) return false;
      manifests.bafyCol1b = { ...manifests.bafyCol1, assets: { ...manifests.bafyCol1.assets, asset_bracket: "bafyOther" } };
      tokenURIs[1] = "bafyCol1b";
      return true;
    };
    const bytes = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));
    const err = await saveGenerated(currentSession, "1", { bytes, format: "gltf" }, "bracket", "asset_bracket")
      .then(() => null, (e) => e);
    expect(err?.code).toBe("CONFLICT");
    expect(manifests[tokenURIs[1]].assets.asset_bracket).toBe("bafyOther");
  });

  test("a saved generation (generate / retexture / retopo / rig / animate) keeps them", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));
    await saveGenerated(currentSession, "1", { bytes, format: "gltf" }, "bracket", "asset_bracket");
    const m = current("asset_bracket");
    expect(m.representations).toEqual([BLEND]);
    expect(m.prev_asset_manifest_cid).toBe("bafyBracket");
  });

  test("an attach keeps the others and a model change makes derived ones stale", async () => {
    await callTool("attach_representation", { name: "bracket", file: tmpFile("b.stl", "solid") });
    const bytes = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, nodes: [{}] }));
    await saveGenerated(currentSession, "1", { bytes, format: "gltf" }, "bracket", "asset_bracket");
    const info = await callTool("asset_info", { name: "bracket" });
    expect(info.representations.map((r) => [r.id, r.stale])).toEqual([["source", false], ["stl", true]]);
  });
});

describe("history (spec R4)", () => {
  test("representationChanges names added, replaced and removed entries", () => {
    const gcode = {
      ...BLEND, id: "gcode-mk4", role: "machine", format: "gcode", name: "a.gcode", cid: "bafyG1",
      profile: { printer: "Original Prusa MK4", material: "PETG" },
    };
    expect(representationChanges(null, { representations: [gcode] }).map((c) => c.text)).toEqual([
      "Added G-code (Original Prusa MK4, PETG)",
    ]);
    const changes = representationChanges(
      { representations: [BLEND, gcode] },
      { representations: [{ ...gcode, cid: "bafyG2" }] },
    );
    expect(changes).toEqual([
      { change: "replaced", id: "gcode-mk4", text: "Replaced G-code (Original Prusa MK4, PETG)" },
      { change: "removed", id: "source", text: "Removed Blender file" },
    ]);
    expect(representationChanges({ representations: [BLEND] }, { representations: [BLEND] })).toEqual([]);
  });

  test("asset_history reports what each attach and detach changed", async () => {
    await callTool("attach_representation", { name: "bracket", file: tmpFile("b.gcode", "G1"), printer: "MK4" });
    await callTool("detach_representation", { name: "bracket", id: "gcode-mk4" });
    const history = await callTool("asset_history", { name: "bracket" });
    expect(history.map((v) => v.representationChanges?.map((c) => c.text))).toEqual([
      undefined,
      ["Added G-code (MK4)"],
      ["Removed G-code (MK4)"],
    ]);
  });
});
