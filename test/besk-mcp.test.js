/**
 * besk mcp: the MCP tool layer (listTools/callTool) exposes the CLI feature
 * surface to AI agents over the same catalog/generation modules the human CLI
 * uses — session guard, name resolution, argument validation, and dispatch.
 * Transport (stdio JSON-RPC) is not covered here; this tests the tool core.
 */
import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

process.env.ARBESK_CACHE_PATH = path.join(os.tmpdir(), "besk-mcp-test-cache-" + process.pid + ".json");

const relayMock = jest.fn(async () => ({}));
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const runGenerationMock = jest.fn();
const cancelGenerationMock = jest.fn(async () => ({ status: "cancelled" }));
const getProviderBalanceMock = jest.fn(async () => ({ balance: 42, frozen: 3 }));
jest.unstable_mockModule("../packages/besk/src/generate.ts", () => ({
  runGeneration: runGenerationMock,
  cancelGeneration: cancelGenerationMock,
  getProviderBalance: getProviderBalanceMock,
  resolveSourceCid: jest.fn(async (cid) => "src:" + cid),
}));

let currentSession = null;
const setActiveMock = jest.fn((id) => {
  if (currentSession) currentSession.activeCollectionTokenId = id;
});
const clearSessionMock = jest.fn(() => {
  currentSession = null;
});
jest.unstable_mockModule("../packages/besk/src/session.ts", () => ({
  loadSession: jest.fn(() => currentSession),
  saveSession: jest.fn(),
  clearSession: clearSessionMock,
  setActiveCollection: setActiveMock,
}));

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const manifests = {};
const written = [];
const tokenURIs = { 1: "bafyCol1", 2: "bafyCol2" };
const unpinMock = jest.fn(async () => ({ count: 2 }));

function resetStore() {
  for (const k of Object.keys(manifests)) delete manifests[k];
  manifests.bafyCol1 = {
    type: "collection", name: null, asset_id: "c1", version: 1,
    assets: { asset_world: "bafyWorld" },
  };
  manifests.bafyCol2 = {
    type: "collection", name: "props", asset_id: "c2", version: 1,
    assets: { asset_tree: "bafyTree" },
  };
  manifests.bafyWorld = {
    type: "asset", name: "world", asset_id: "asset_world", version: 1, timestamp: 1,
    scene: { nodes: [{ node_id: "node_1", transform_matrix: IDENTITY, source: { cid: "bafyWorldSrc" } }] },
  };
  manifests.bafyWorldSrc = { asset: { version: "2.0" }, nodes: [] };
  manifests.bafyTree = {
    type: "asset", name: "tree", asset_id: "asset_tree", version: 3, timestamp: 2,
    scene: { nodes: [{ node_id: "node_1", transform_matrix: IDENTITY, source: { cid: "bafyTreeSrc" } }] },
  };
  manifests.bafyTreeSrc = { asset: { version: "2.0" }, nodes: [] };
}

jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({
    contractAddress: "0x0",
    ipfsGatewayUrl: "http://gw",
    networkConfigs: { 84532: { contractAddress: "0xContract84532", rpcUrl: "http://rpc" } },
  })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async (tokenId) => {
      const cid = tokenURIs[String(tokenId)];
      if (!cid) throw new Error("no token " + tokenId);
      return cid;
    }),
    listTokens: jest.fn(async ({ scope }) => (scope === "owned" ? ["1", "2"] : [])),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async (cid) => {
      if (!(cid in manifests)) throw new Error("unknown cid " + cid);
      return structuredClone(manifests[cid]);
    }),
    getBytes: jest.fn(),
    getRawBytes: jest.fn(),
  })),
  createIpfsWritePort: jest.fn(() => ({
    write: jest.fn(async () => "bafyBin"),
    writeJSON: jest.fn(async (json) => {
      written.push(json);
      const cid = "bafyWritten" + written.length;
      manifests[cid] = structuredClone(json);
      return cid;
    }),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
  unpinCids: unpinMock,
}));

const { listTools, callTool } = await import("../packages/besk/src/mcp.ts");
const { clearCatalogCache } = await import("../packages/besk/src/catalog.ts");

const SESSION = {
  token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc",
  email: "a@b.c", authMethod: "siwe", activeCollectionTokenId: "1",
};

const EXPECTED_TOOLS = [
  "whoami", "logout",
  "list_collections", "use_collection", "create_collection", "burn_collection",
  "list_assets", "asset_info", "asset_history", "download_asset", "upload_asset",
  "delete_asset", "rename_asset", "send_asset", "link_asset", "show_asset",
  "generate_model", "retexture_model", "retopo_model", "rig_model", "animate_model",
  "get_asset_metadata", "get_collection_metadata",
  "set_asset_metadata", "delete_asset_metadata",
  "set_collection_metadata", "delete_collection_metadata",
  "provider_balance", "cancel_generation",
];

beforeEach(() => {
  currentSession = { ...SESSION };
  resetStore();
  written.length = 0;
  relayMock.mockClear();
  unpinMock.mockClear();
  setActiveMock.mockClear();
  clearSessionMock.mockClear();
  runGenerationMock.mockReset();
  cancelGenerationMock.mockClear();
  getProviderBalanceMock.mockClear();
  clearCatalogCache();
});

describe("besk mcp listTools", () => {
  test("exposes the full CLI surface with JSON schemas", () => {
    const tools = listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });
});

describe("besk mcp session guard", () => {
  test("rejects every tool when not logged in", async () => {
    currentSession = null;
    await expect(callTool("list_collections", {})).rejects.toThrow(/Not logged in/);
  });

  test("rejects unknown tools", async () => {
    await expect(callTool("nope", {})).rejects.toThrow(/Unknown tool/);
  });
});

describe("besk mcp identity + collections", () => {
  test("whoami returns the session identity", async () => {
    const me = await callTool("whoami", {});
    expect(me).toMatchObject({ email: "a@b.c", address: "0xabc", authMethod: "siwe" });
  });

  test("logout clears the session", async () => {
    await callTool("logout", {});
    expect(clearSessionMock).toHaveBeenCalled();
  });

  test("list_collections marks the active collection", async () => {
    const cols = await callTool("list_collections", {});
    expect(cols).toEqual([
      { name: "My Library", tokenId: "1", assetCount: 1, active: true },
      { name: "props", tokenId: "2", assetCount: 1, active: false },
    ]);
  });

  test("use_collection switches the active collection", async () => {
    const r = await callTool("use_collection", { name: "props" });
    expect(setActiveMock).toHaveBeenCalledWith("2");
    expect(r).toMatchObject({ active: "2", name: "props" });
  });

  test("use_collection rejects an unknown name", async () => {
    await expect(callTool("use_collection", { name: "nope" })).rejects.toThrow(/No collection named/);
  });

  test("burn_collection requires a typed confirmation matching the collection name", async () => {
    await expect(
      callTool("burn_collection", { name: "props", confirm: "wrong" }),
    ).rejects.toThrow(/Confirmation mismatch/);
    expect(relayMock).not.toHaveBeenCalled();
  });

  test("burn_collection unpins then relays the burn on a matching confirmation", async () => {
    const r = await callTool("burn_collection", { name: "props", confirm: "props" });
    expect(unpinMock).toHaveBeenCalled();
    expect(relayMock).toHaveBeenCalledWith(currentSession, "burn", "2", { proof: [] });
    expect(r).toMatchObject({ burned: "props", tokenId: "2" });
  });

  test("create_collection rejects a blank name", async () => {
    await expect(callTool("create_collection", { name: "  " })).rejects.toThrow(/required/);
  });
});

describe("besk mcp asset reads", () => {
  test("list_assets lists the active collection by default", async () => {
    const assets = await callTool("list_assets", {});
    expect(assets).toEqual([
      { name: "world", assetId: "asset_world", version: 1, format: "gltf" },
    ]);
  });

  test("list_assets accepts a collection override", async () => {
    const assets = await callTool("list_assets", { collection: "props" });
    expect(assets).toEqual([
      { name: "tree", assetId: "asset_tree", version: 3, format: "gltf" },
    ]);
  });

  test("asset_info returns the identity card", async () => {
    const info = await callTool("asset_info", { name: "world" });
    expect(info).toMatchObject({
      name: "world", assetId: "asset_world", version: 1, cid: "bafyWorld",
      format: "gltf", nodes: 1,
    });
  });

  test("asset_history walks the version chain oldest to newest", async () => {
    const history = await callTool("asset_history", { name: "world" });
    expect(history).toEqual([
      { version: 1, cid: "bafyWorld", name: "world", nodeCount: 1, current: true },
    ]);
  });

  test("download_asset rejects an unknown version", async () => {
    await expect(
      callTool("download_asset", { name: "world", version: "99" }),
    ).rejects.toThrow(/Version 99 not found/);
  });

  test("download_asset writes the composed model to a file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "besk-mcp-dl-"));
    const r = await callTool("download_asset", { name: "world", directory: dir });
    expect(r.file).toBe(path.join(dir, "world.gltf"));
    expect(fs.existsSync(r.file)).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);
  });
});

describe("besk mcp asset writes", () => {
  test("rename_asset writes a renamed manifest and relays the collection update", async () => {
    const r = await callTool("rename_asset", { oldName: "world", newName: "earth" });
    expect(r).toMatchObject({ renamed: "earth" });
    expect(written[0].name).toBe("earth");
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1", { newUri: "bafyWritten2", proof: [], assetId: "asset_world" },
    );
  });

  test("delete_asset removes the entry from the collection", async () => {
    await callTool("delete_asset", { name: "world" });
    expect(written[0].assets).toEqual({});
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1", { newUri: "bafyWritten1", proof: [], assetId: "asset_world" },
    );
  });

  test("rename_asset rejects an unknown asset", async () => {
    await expect(
      callTool("rename_asset", { oldName: "nope", newName: "x" }),
    ).rejects.toThrow(/No asset named/);
  });

  test("upload_asset stores a local model and relays the collection update", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "besk-mcp-up-")), "widget.gltf");
    fs.writeFileSync(file, JSON.stringify({ asset: { version: "2.0" } }));
    const r = await callTool("upload_asset", { file, name: "widget" });
    expect(r).toMatchObject({ saved: "widget" });
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1",
      { newUri: expect.stringMatching(/^bafyWritten/), proof: [], assetId: expect.any(String) },
    );
  });

  test("upload_asset rejects a missing file", async () => {
    await expect(callTool("upload_asset", { file: "/no/such.glb" })).rejects.toThrow(/File not found/);
  });
});

describe("besk mcp metadata writes", () => {
  test("set_asset_metadata merges annotations and links the previous manifest", async () => {
    const r = await callTool("set_asset_metadata", { name: "world", patch: { role: "hero" } });
    expect(r).toMatchObject({ set: ["role"], cid: "bafyWritten1" });
    expect(written[0].metadata.annotations).toEqual({ role: "hero" });
    expect(written[0].prev_asset_manifest_cid).toBe("bafyWorld");
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1", { newUri: "bafyWritten2", proof: [], assetId: "asset_world" },
    );
  });

  test("delete_asset_metadata removes keys and links the previous manifest", async () => {
    const r = await callTool("delete_asset_metadata", { name: "world", keys: ["role"] });
    expect(r).toMatchObject({ unset: ["role"], cid: "bafyWritten1" });
    expect(written[0].prev_asset_manifest_cid).toBe("bafyWorld");
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1", { newUri: "bafyWritten2", proof: [], assetId: "asset_world" },
    );
  });

  test("set_collection_metadata merges annotations on the collection", async () => {
    const r = await callTool("set_collection_metadata", { patch: { theme: "scifi" } });
    expect(r).toMatchObject({ set: ["theme"], cid: "bafyWritten1" });
    expect(written[0].metadata.annotations).toEqual({ theme: "scifi" });
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1", { newUri: "bafyWritten1", proof: [] },
    );
  });

  test("delete_collection_metadata removes collection annotation keys", async () => {
    const r = await callTool("delete_collection_metadata", { keys: ["theme"] });
    expect(r).toMatchObject({ unset: ["theme"], cid: "bafyWritten1" });
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1", { newUri: "bafyWritten1", proof: [] },
    );
  });

  test("set_asset_metadata requires an object patch", async () => {
    await expect(callTool("set_asset_metadata", { name: "world" })).rejects.toThrow(/patch must be an object/);
    await expect(callTool("set_asset_metadata", { name: "world", patch: "x" })).rejects.toThrow(/patch must be an object/);
  });

  test("delete_asset_metadata requires a string array of keys", async () => {
    await expect(callTool("delete_asset_metadata", { name: "world", keys: "x" })).rejects.toThrow(/keys must be/);
    await expect(callTool("delete_asset_metadata", { name: "world", keys: [1] })).rejects.toThrow(/keys must be/);
  });
});

describe("besk mcp linking", () => {
  test("send_asset forks an asset into another collection", async () => {
    const r = await callTool("send_asset", { name: "world", targetCollection: "props", mode: "fork" });
    expect(r).toMatchObject({ mode: "fork" });
    expect(written[0].assets.asset_world).toBe("bafyWorld");
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "2", { newUri: "bafyWritten1", proof: [], assetId: "asset_world" },
    );
  });

  test("send_asset rejects an unsupported mode", async () => {
    await expect(
      callTool("send_asset", { name: "world", targetCollection: "props", mode: "copy" }),
    ).rejects.toThrow(/Unsupported link mode/);
  });

  test("link_asset nests a cross-collection child with position and scale", async () => {
    const r = await callTool("link_asset", {
      child: "tree", parent: "world", from: "props", position: [1, 2, 3], scale: 2,
    });
    expect(r.nodeId).toBe("linked_2_asset_tree");
    const parent = written[0];
    const node = parent.scene.nodes[1];
    expect(node.child_ref).toEqual({
      collection: { chainId: 84532, contractAddress: "0xContract84532", tokenId: "2" },
      assetID: "asset_tree",
    });
    expect(node.transform_matrix).toEqual([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1]);
  });

  test("link_asset rejects a malformed position", async () => {
    await expect(
      callTool("link_asset", { child: "tree", parent: "world", from: "props", position: [1, 2] }),
    ).rejects.toThrow(/position/);
  });

  test("show_asset builds the Studio deep link without launching a browser", async () => {
    const r = await callTool("show_asset", { name: "world", open: false });
    expect(r.url).toBe("http://localhost:9090/studio?asset=1&assetId=asset_world");
    expect(r.opened).toBe(false);
  });
});

describe("besk mcp generation", () => {
  const GLTF_BYTES = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));

  test("generate_model runs the provider and saves into the active collection", async () => {
    runGenerationMock.mockResolvedValue({ bytes: GLTF_BYTES, format: "gltf" });
    const r = await callTool("generate_model", { prompt: "a chair", provider: "mock", name: "chair" });
    expect(r).toMatchObject({ saved: "chair", format: "gltf" });
    const body = runGenerationMock.mock.calls[0][1];
    expect(body).toMatchObject({ prompt: "a chair", provider: "mock" });
    expect(typeof body.nodeId).toBe("string");
    expect(relayMock).toHaveBeenCalledWith(
      currentSession, "updateUri", "1",
      { newUri: expect.stringMatching(/^bafyWritten/), proof: [], assetId: expect.any(String) },
    );
  });

  test("generate_model requires an explicit provider (no interactive picker)", async () => {
    await expect(callTool("generate_model", { prompt: "x" })).rejects.toThrow(/provider/);
  });

  test("generate_model requires a key for tripo3d", async () => {
    await expect(
      callTool("generate_model", { prompt: "x", provider: "tripo3d" }),
    ).rejects.toThrow(/API key/);
  });

  test("retexture_model resolves the source CID and saves a new version", async () => {
    runGenerationMock.mockResolvedValue({ bytes: GLTF_BYTES, format: "gltf" });
    await callTool("retexture_model", { name: "world", prompt: "red metal", key: "k" });
    const body = runGenerationMock.mock.calls[0][1];
    expect(body).toMatchObject({
      retexture: true, prompt: "red metal", providerKey: "k", sourceAssetCid: "src:bafyWorld",
    });
  });

  test("retopo_model validates the face limit range", async () => {
    await expect(
      callTool("retopo_model", { name: "world", faceLimit: 100, key: "k" }),
    ).rejects.toThrow(/500/);
  });

  test("animate_model requires 1-5 presets", async () => {
    await expect(
      callTool("animate_model", { name: "world", presets: [], key: "k" }),
    ).rejects.toThrow(/1-5/);
  });

  test("rig_model passes rigOnly through", async () => {
    runGenerationMock.mockResolvedValue({ bytes: GLTF_BYTES, format: "glb" });
    await callTool("rig_model", { name: "world", key: "k" });
    expect(runGenerationMock.mock.calls[0][1]).toMatchObject({
      animate: true, rigOnly: true, providerKey: "k",
    });
  });

  test("provider_balance returns the credits", async () => {
    const b = await callTool("provider_balance", { key: "k" });
    expect(b).toEqual({ balance: 42, frozen: 3 });
  });

  test("cancel_generation cancels the task", async () => {
    const r = await callTool("cancel_generation", { taskId: "task_1" });
    expect(cancelGenerationMock).toHaveBeenCalledWith(currentSession, "task_1");
    expect(r).toMatchObject({ status: "cancelled" });
  });
});
