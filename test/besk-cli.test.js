/**
 * Characterization tests for besk's cli.ts: main() dispatch, cmdGenerate
 * (CC 31) and cmdLink (CC 19). cli.ts runs main() at import time off
 * process.argv, so each test resets modules, sets argv, imports, and waits
 * for the fire-and-forget main() promise to settle. All sibling modules are
 * mocked; console output and process.exitCode are captured per run.
 *
 * jest runs non-TTY, so the interactive pickers take their documented
 * fallbacks: pickProvider errors out, requireProviderKey requires --key/env,
 * pickCollection falls back to the active/default collection.
 */

import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { resetModules } from "./helpers/module-registry.js";
const SESSION = {
  token: "t",
  expiresAt: Date.now() + 3600_000,
  address: "0xabc",
  email: "a@b.c",
  authMethod: "siwe",
};

const mockLogin = jest.fn();
const mockWhoami = jest.fn();
const mockLogout = jest.fn();
const mockLoadSession = jest.fn();
const mockSetActiveCollection = jest.fn();

const mockListCollections = jest.fn();
const mockGetCollectionAssets = jest.fn();
const mockResolveCollectionByName = jest.fn();
const mockResolveAssetByName = jest.fn();
const mockGetManifest = jest.fn();
const mockWriteManifest = jest.fn();
const mockClearCatalogCache = jest.fn();
const mockUpdateCollection = jest.fn();
const mockUploadAsset = jest.fn();
const mockGetVersionHistory = jest.fn();
const mockDownloadAsset = jest.fn();
const mockDetectFormat = jest.fn();

const mockCreateCollection = jest.fn();
const mockBurnCollection = jest.fn();
const mockLinkChildAsset = jest.fn();
const mockSendAssetToCollection = jest.fn();
const mockShowAsset = jest.fn();

const mockRunGeneration = jest.fn();
const mockCancelGeneration = jest.fn();
const mockGetProviderBalance = jest.fn();
const mockResolveSourceCid = jest.fn();

const mockDisplayName = jest.fn((n) => n ?? "Default");
const mockCurrentCollectionTokenId = jest.fn();
const mockMakeNodeId = jest.fn((p) => "node_" + String(p).replace(/\W+/g, "_"));
const mockSanitizeFileName = jest.fn((n) => n);
const mockExtFor = jest.fn(() => ".glb");
const mockReadImageFile = jest.fn();
const mockSaveGenerated = jest.fn();
const mockSaveModelVersion = jest.fn();
const mockAttachRepresentation = jest.fn();
const mockDetachRepresentation = jest.fn();
const mockReadRepresentation = jest.fn();
const mockDescribeRepresentations = jest.fn(() => []);
const mockHistoryRepresentationChanges = jest.fn(async (entries) => entries.map(() => []));
const mockLoadAssetSource = jest.fn();
const mockResolveVersionCid = jest.fn();

const mockResolveCompositeSourceCid = jest.fn();

mock.module("../packages/besk/src/auth.ts", () => ({ login: mockLogin }));
mock.module("../packages/besk/src/session.ts", () => ({
  whoami: mockWhoami,
  logout: mockLogout,
  loadSession: mockLoadSession,
  setActiveCollection: mockSetActiveCollection,
}));
mock.module("@arbesk/asset-core/catalog/index.js", () => ({
  resolveCompositeSourceCid: mockResolveCompositeSourceCid,
}));
mock.module("../packages/besk/src/catalog.ts", () => ({
  listCollections: mockListCollections,
  getCollectionAssets: mockGetCollectionAssets,
  resolveCollectionByName: mockResolveCollectionByName,
  resolveAssetByName: mockResolveAssetByName,
  getManifest: mockGetManifest,
  writeManifest: mockWriteManifest,
  clearCatalogCache: mockClearCatalogCache,
  updateCollection: mockUpdateCollection,
  replaceAssetEntry: (draft, assetID, _expected, newCid) => {
    draft.assets[assetID] = newCid;
  },
  uploadAsset: mockUploadAsset,
  getVersionHistory: mockGetVersionHistory,
  downloadAsset: mockDownloadAsset,
  detectFormat: mockDetectFormat,
}));
mock.module("../packages/besk/src/representations.ts", () => ({
  attachRepresentation: mockAttachRepresentation,
  detachRepresentation: mockDetachRepresentation,
  readRepresentation: mockReadRepresentation,
  describeRepresentations: mockDescribeRepresentations,
  historyRepresentationChanges: mockHistoryRepresentationChanges,
  profileFrom: (o) => {
    const p = {};
    if (o.printer) p.printer = o.printer;
    if (o.material) p.material = o.material;
    if (o.layer !== undefined) p.layer_mm = Number(o.layer);
    return Object.keys(p).length ? p : undefined;
  },
}));
mock.module("../packages/besk/src/collections.ts", () => ({
  createCollection: mockCreateCollection,
}));
mock.module("../packages/besk/src/burn.ts", () => ({
  burnCollection: mockBurnCollection,
}));
mock.module("../packages/besk/src/link.ts", () => ({
  linkChildAsset: mockLinkChildAsset,
}));
mock.module("../packages/besk/src/send.ts", () => ({
  sendAssetToCollection: mockSendAssetToCollection,
}));
mock.module("../packages/besk/src/show.ts", () => ({
  showAsset: mockShowAsset,
}));
mock.module("../packages/besk/src/generate.ts", () => ({
  runGeneration: mockRunGeneration,
  cancelGeneration: mockCancelGeneration,
  getProviderBalance: mockGetProviderBalance,
  resolveSourceCid: mockResolveSourceCid,
}));
mock.module("../packages/besk/src/helpers.ts", () => ({
  displayName: mockDisplayName,
  currentCollectionTokenId: mockCurrentCollectionTokenId,
  makeNodeId: mockMakeNodeId,
  sanitizeFileName: mockSanitizeFileName,
  extFor: mockExtFor,
  readImageFile: mockReadImageFile,
  saveGenerated: mockSaveGenerated,
  saveModelVersion: mockSaveModelVersion,
  loadAssetSource: mockLoadAssetSource,
  resolveVersionCid: mockResolveVersionCid,
}));

let logs = [];
let errors = [];

const ENV_KEYS = [
  "ARBESK_PROVIDER",
  "ARBESK_TEXTURE_QUALITY",
  "ARBESK_PROVIDER_KEY",
  "TRIPO_API_KEY",
];
let savedEnv = {};

beforeEach(() => {
  jest.clearAllMocks();
  logs = [];
  errors = [];
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  jest.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
  jest.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));

  mockLoadSession.mockReturnValue(SESSION);
  mockListCollections.mockResolvedValue([{ tokenId: "tok-default", name: null, assetCount: 0 }]);
  mockCurrentCollectionTokenId.mockResolvedValue("tok-default");
  mockResolveAssetByName.mockResolvedValue(null);
  mockRunGeneration.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    format: "glb",
    path: "asset.glb",
  });
  mockReadImageFile.mockReturnValue({ imageData: "YmFzZTY0", imageMime: "image/png" });
  mockLinkChildAsset.mockResolvedValue({ nodeId: "node-1" });
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  process.exitCode = 0;
});

/** Import cli.ts fresh with the given argv and let main() run to completion. */
async function runCli(argv) {
  resetModules();
  process.argv = ["node", "besk", ...argv];
  // 0, not undefined: Bun ignores an undefined assignment.
  process.exitCode = 0;
  await import("../packages/besk/src/cli.ts");
  // main() is fire-and-forget inside cli.ts; let it settle. Bun schedules
  // setImmediate callbacks differently from Node, so wait on real timer turns
  // too, or a run's late exitCode lands in the next test.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 0));
  }
  return { exitCode: process.exitCode || undefined };
}

// ─── main() dispatch ───

test("no command prints help and exits cleanly", async () => {
  const { exitCode } = await runCli([]);
  expect(logs.join("\n")).toContain("Usage: besk <command> [args]");
  expect(errors).toHaveLength(0);
  expect(exitCode).toBeUndefined();
});

test("unknown command prints an error plus help and exits 2", async () => {
  const { exitCode } = await runCli(["frobnicate"]);
  expect(errors.join("\n")).toContain("Unknown command: frobnicate");
  expect(logs.join("\n")).toContain("Usage: besk <command> [args]");
  expect(exitCode).toBe(2);
});

test("--verbose is stripped before dispatch", async () => {
  await runCli(["-v", "whoami"]);
  expect(mockWhoami).toHaveBeenCalledTimes(1);
});

test("a throwing command surfaces as Error: <msg> with exit code 1", async () => {
  mockLogin.mockRejectedValue(new Error("relay down"));
  const { exitCode } = await runCli(["login", "a@b.c"]);
  expect(errors.join("\n")).toContain("Error: relay down");
  expect(exitCode).toBe(1);
});

// ─── cmdGenerate ───

test("generate: not logged in exits 3", async () => {
  mockLoadSession.mockReturnValue(null);
  const { exitCode } = await runCli(["generate", "a", "cube", "--provider", "mock"]);
  expect(errors.join("\n")).toContain("Not logged in. Run `besk login <email>`.");
  expect(exitCode).toBe(3);
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test("generate: no prompt and no image prints usage, exit 2", async () => {
  const { exitCode } = await runCli(["generate"]);
  expect(errors.join("\n")).toContain("Usage: besk generate <prompt>");
  expect(exitCode).toBe(2);
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test("generate: mock happy path saves under the prompt-derived name", async () => {
  const { exitCode } = await runCli(["generate", "a", "red", "cube", "--provider", "mock"]);
  expect(mockRunGeneration).toHaveBeenCalledTimes(1);
  const body = mockRunGeneration.mock.calls[0][1];
  expect(body).toMatchObject({ prompt: "a red cube", provider: "mock", nodeId: expect.any(String) });
  expect(body.providerKey).toBeUndefined();
  expect(body.textureQuality).toBeUndefined();

  expect(mockSaveGenerated).toHaveBeenCalledTimes(1);
  const [s, tokenId, model, name] = mockSaveGenerated.mock.calls[0];
  expect(s).toBe(SESSION);
  expect(tokenId).toBe("tok-default");
  expect(model.format).toBe("glb");
  expect(name).toBe("a red cube");
  expect(logs.join("\n")).toContain("Saved as a red cube (glb)");
  expect(exitCode).toBeUndefined();
});

test("generate: non-mock provider without a key fails with exit 2 (non-TTY)", async () => {
  const { exitCode } = await runCli(["generate", "a", "cube", "--provider", "tripo3d"]);
  expect(errors.join("\n")).toContain("A Tripo3D API key is required");
  expect(exitCode).toBe(2);
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test("generate: flags win and env fills the provider key, quality and provider", async () => {
  const cases = [
    ["--key",
      ["generate", "a", "cube", "--provider", "tripo3d", "--key", "tsk_1"], {},
      (body) => expect(body.providerKey).toBe("tsk_1")],
    ["ARBESK_PROVIDER_KEY",
      ["generate", "a", "cube", "--provider", "tripo3d"], { ARBESK_PROVIDER_KEY: "tsk_env" },
      (body) => expect(body.providerKey).toBe("tsk_env")],
    ["--quality",
      ["generate", "a", "cube", "--provider", "mock", "--quality", "detailed"], {},
      (body) => expect(body.textureQuality).toBe("detailed")],
    ["ARBESK_TEXTURE_QUALITY",
      ["generate", "a", "cube", "--provider", "mock"], { ARBESK_TEXTURE_QUALITY: "extreme" },
      (body) => expect(body.textureQuality).toBe("extreme")],
    ["ARBESK_PROVIDER",
      ["generate", "a", "cube"], { ARBESK_PROVIDER: "mock" },
      (body) => expect(body.provider).toBe("mock")],
  ];

  for (const [_label, argv, env, check] of cases) {
    jest.clearAllMocks();
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    await runCli(argv);
    check(mockRunGeneration.mock.calls[0][1]);
  }
});

test("generate: no provider anywhere (non-TTY) exits 2 with guidance", async () => {
  const { exitCode } = await runCli(["generate", "a", "cube"]);
  expect(errors.join("\n")).toContain("No provider selected. Non-interactive? Pass --provider mock|tripo3d.");
  expect(exitCode).toBe(2);
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test("generate: --image sends legacy imageData/imageMime fields", async () => {
  await runCli(["generate", "--provider", "mock", "--image", "front.png"]);
  const body = mockRunGeneration.mock.calls[0][1];
  expect(body.imageData).toBe("YmFzZTY0");
  expect(body.imageMime).toBe("image/png");
  expect(body.prompt).toBeUndefined();
  expect(mockReadImageFile).toHaveBeenCalledWith("front.png");
});

test("generate: unreadable --image exits 5 for FILE_NOT_FOUND", async () => {
  mockReadImageFile.mockImplementation(() => {
    throw Object.assign(new Error("File not found: nope.png"), { code: "FILE_NOT_FOUND" });
  });
  const { exitCode } = await runCli(["generate", "--provider", "mock", "--image", "nope.png"]);
  expect(errors.join("\n")).toContain("File not found: nope.png");
  expect(exitCode).toBe(5);
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test("generate: a single --view is rejected", async () => {
  const { exitCode } = await runCli(["generate", "--provider", "mock", "--view", "front", "f.png"]);
  expect(errors.join("\n")).toContain("Multiview needs 2-4 views.");
  expect(exitCode).toBe(2);
});

test("generate: views must be unique with exactly one front", async () => {
  const { exitCode } = await runCli([
    "generate", "--provider", "mock",
    "--view", "front", "f1.png", "--view", "front", "f2.png",
  ]);
  expect(errors.join("\n")).toContain("Views must be unique and include exactly one front view.");
  expect(exitCode).toBe(2);
});

test("generate: two views go out as images[] in canonical order", async () => {
  await runCli([
    "generate", "--provider", "mock",
    "--view", "front", "f.png", "--view", "left", "l.png",
  ]);
  const body = mockRunGeneration.mock.calls[0][1];
  expect(body.images).toEqual([
    { imageData: "YmFzZTY0", imageMime: "image/png", view: "front" },
    { imageData: "YmFzZTY0", imageMime: "image/png", view: "left" },
  ]);
  expect(body.imageData).toBeUndefined();
});

test("generate: --name overrides; an existing asset is versioned, not duplicated", async () => {
  mockResolveAssetByName.mockResolvedValue({ assetID: "asset-existing", cid: "bafyOld" });
  await runCli(["generate", "a", "cube", "--provider", "mock", "--name", "Hero"]);
  const [, , , name, assetId] = mockSaveGenerated.mock.calls[0];
  expect(name).toBe("Hero");
  expect(assetId).toBe("asset-existing");
  expect(mockResolveAssetByName).toHaveBeenCalledWith("tok-default", "Hero");
});

// ─── cmdLink ───

test("link: missing args, unsupported modes and malformed geometry exit 2", async () => {
  let r = await runCli(["link", "only-child"]);
  expect(errors.join("\n")).toContain("Usage: besk link <child> <parent>");
  expect(r.exitCode).toBe(2);

  errors = [];
  jest.clearAllMocks();
  r = await runCli(["link", "c", "p", "mirror"]);
  expect(errors.join("\n")).toContain("Unsupported link mode: mirror");
  expect(r.exitCode).toBe(2);

  errors = [];
  jest.clearAllMocks();
  r = await runCli(["link", "c", "p", "--position", "1,2"]);
  expect(errors.join("\n")).toContain('--position needs three numbers: "x,y,z"');
  expect(r.exitCode).toBe(2);

  errors = [];
  jest.clearAllMocks();
  r = await runCli(["link", "c", "p", "--scale", "0"]);
  expect(errors.join("\n")).toContain("--scale must be a positive number.");
  expect(r.exitCode).toBe(2);
});

test("link: unknown parent asset exits 5", async () => {
  const { exitCode } = await runCli(["link", "c", "missing-parent"]);
  expect(errors.join("\n")).toContain("No asset named missing-parent in the active collection");
  expect(exitCode).toBe(5);
  expect(mockLinkChildAsset).not.toHaveBeenCalled();
});

test("link: unknown --from collection exits 5", async () => {
  mockResolveAssetByName.mockImplementation(async (tokenId, name) =>
    name === "p" ? { assetID: "pa", cid: "bafyP" } : null);
  mockResolveCollectionByName.mockResolvedValue(null);
  const { exitCode } = await runCli(["link", "c", "p", "--from", "props"]);
  expect(errors.join("\n")).toContain("No collection named props. Run `besk collections`.");
  expect(exitCode).toBe(5);
});

test("link: unknown child names the --from collection in the error", async () => {
  mockResolveAssetByName.mockImplementation(async (tokenId, name) =>
    name === "p" ? { assetID: "pa", cid: "bafyP" } : null);
  mockResolveCollectionByName.mockResolvedValue({ tokenId: "tok-props" });
  const { exitCode } = await runCli(["link", "c", "p", "--from", "props"]);
  expect(errors.join("\n")).toContain("No asset named c in props");
  expect(exitCode).toBe(5);
});

test("link: fork with position and scale passes the full payload", async () => {
  mockResolveAssetByName.mockImplementation(async (tokenId, name) =>
    name === "p" ? { assetID: "pa", cid: "bafyP" } : { assetID: "ca", cid: "bafyC" });
  const { exitCode } = await runCli([
    "link", "c", "p", "fork", "--position", "1,2,3", "--scale", "2",
  ]);
  expect(mockLinkChildAsset).toHaveBeenCalledWith(SESSION, {
    parentTokenId: "tok-default",
    parentAssetId: "pa",
    parentCid: "bafyP",
    childTokenId: "tok-default",
    childAssetId: "ca",
    childCid: "bafyC",
    mode: "fork",
    position: { x: 1, y: 2, z: 3 },
    scale: 2,
  });
  expect(logs.join("\n")).toContain("Forked c into p (node node-1)");
  expect(exitCode).toBeUndefined();
});

test("link: default mode is live-ref", async () => {
  mockResolveAssetByName.mockImplementation(async (tokenId, name) =>
    name === "p" ? { assetID: "pa", cid: "bafyP" } : { assetID: "ca", cid: "bafyC" });
  await runCli(["link", "c", "p"]);
  expect(mockLinkChildAsset.mock.calls[0][1].mode).toBe("live-ref");
  expect(mockLinkChildAsset.mock.calls[0][1].position).toBeUndefined();
  expect(mockLinkChildAsset.mock.calls[0][1].scale).toBeUndefined();
  expect(logs.join("\n")).toContain("Linked c into p (node node-1)");
});

// ─── representations: attach / detach / info / download --rep ───

const HIT = { assetID: "asset_b", cid: "bafyB", name: "bracket" };

test("attach: passes role, id, from and profile; prints the public warning for a source", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "besk-cli-attach-")), "b.blend");
  fs.writeFileSync(file, "x");
  mockResolveAssetByName.mockResolvedValue(HIT);
  const warnings = [];
  jest.spyOn(console, "warn").mockImplementation((...a) => warnings.push(a.join(" ")));
  mockAttachRepresentation.mockImplementation(async (_s, opts) => {
    opts.onWarning("Everything on IPFS is public.");
    return { cid: "bafyNew", replaced: false, representation: { id: "source", role: "source", name: "b.blend" } };
  });

  const { exitCode } = await runCli([
    "attach", "bracket", file, "--role", "source", "--id", "source", "--from", "none",
    "--printer", "MK4", "--material", "PETG", "--layer", "0.2",
  ]);

  expect(exitCode).toBeUndefined();
  expect(mockAttachRepresentation).toHaveBeenCalledWith(SESSION, expect.objectContaining({
    tokenId: "tok-default", assetID: "asset_b", cid: "bafyB", file,
    role: "source", id: "source", from: "none",
    profile: { printer: "MK4", material: "PETG", layer_mm: 0.2 },
  }));
  expect(warnings.join("\n")).toContain("Warning: Everything on IPFS is public.");
  expect(logs.join("\n")).toContain("Attached source (source, b.blend) to bracket");
});

test("attach: a missing file exits 5, missing args exit 2", async () => {
  expect((await runCli(["attach", "bracket"])).exitCode).toBe(2);
  expect((await runCli(["attach", "bracket", "/no/such.gcode"])).exitCode).toBe(5);
  expect(mockAttachRepresentation).not.toHaveBeenCalled();
});

test("detach: removes by id; missing id exits 2", async () => {
  mockResolveAssetByName.mockResolvedValue(HIT);
  mockDetachRepresentation.mockResolvedValue({ cid: "bafyNew" });
  await runCli(["detach", "bracket", "gcode"]);
  expect(mockDetachRepresentation).toHaveBeenCalledWith(SESSION, expect.objectContaining({ assetID: "asset_b", cid: "bafyB", id: "gcode" }));
  expect(logs.join("\n")).toContain("Detached gcode from bracket");
  expect((await runCli(["detach", "bracket"])).exitCode).toBe(2);
});

test("info: lists representations with a stale marker", async () => {
  mockResolveAssetByName.mockResolvedValue(HIT);
  mockLoadAssetSource.mockResolvedValue({ manifest: { name: "bracket", scene: { nodes: [] } }, source: {} });
  mockDescribeRepresentations.mockReturnValue([
    { id: "source", role: "source", name: "b.blend", bytes: 2048, derivedFrom: null, stale: false },
    { id: "gcode", role: "machine", name: "b.gcode", bytes: 10, derivedFrom: "primary", stale: true },
  ]);
  await runCli(["info", "bracket"]);
  const out = logs.join("\n");
  expect(out).toContain("Representations:");
  expect(out).toMatch(/source\s+source\s+b\.blend {2}2\.0 KB/);
  expect(out).toMatch(/gcode\s+machine\s+b\.gcode {2}10 B {2}from primary \(stale\)/);
});

test("download --rep writes the representation; an unknown id exits 5", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const cwd = process.cwd();
  process.chdir(fs.mkdtempSync(os.tmpdir() + "/besk-cli-rep-"));
  try {
    mockResolveAssetByName.mockResolvedValue(HIT);
    mockGetManifest.mockResolvedValue({ representations: [] });
    mockReadRepresentation.mockResolvedValue({ representation: { name: "b.gcode" }, bytes: new Uint8Array([71, 49]) });
    await runCli(["download", "bracket", "--rep", "gcode"]);
    expect(fs.readFileSync("b.gcode", "utf8")).toBe("G1");
    expect(mockDownloadAsset).not.toHaveBeenCalled();

    mockReadRepresentation.mockRejectedValue(Object.assign(new Error("No representation x"), { code: "NOT_FOUND" }));
    const { exitCode } = await runCli(["download", "bracket", "--rep", "x"]);
    expect(exitCode).toBe(5);
    expect(errors.join("\n")).toContain("No representation x");
  } finally {
    process.chdir(cwd);
  }
});

test("upload: saves through saveModelVersion (keeps representations)", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "besk-cli-up-")), "bracket.glb");
  fs.writeFileSync(file, "glb");
  mockResolveAssetByName.mockResolvedValue(HIT);
  await runCli(["upload", file]);
  expect(mockSaveModelVersion).toHaveBeenCalledWith(SESSION, "tok-default", expect.any(Uint8Array), "bracket", "asset_b");
});

test("detach: an unknown id exits 5 like download --rep", async () => {
  mockResolveAssetByName.mockResolvedValue(HIT);
  mockDetachRepresentation.mockRejectedValue(
    Object.assign(new Error("No representation x (has: gcode)"), { code: "NOT_FOUND" }),
  );
  const { exitCode } = await runCli(["detach", "bracket", "x"]);
  expect(exitCode).toBe(5);
  expect(errors.join("\n")).toContain("No representation x (has: gcode)");
});

test("history: prints each version's representation changes", async () => {
  mockResolveAssetByName.mockResolvedValue(HIT);
  mockGetVersionHistory.mockResolvedValue([
    { version: 2, cid: "bafyV2", name: "bracket", nodeCount: 1 },
    { version: 1, cid: "bafyV1", name: "bracket", nodeCount: 1 },
  ]);
  mockHistoryRepresentationChanges.mockImplementation(async () => [
    [],
    [{ change: "added", id: "gcode", text: "Added G-code (Original Prusa MK4, PETG)" }],
  ]);
  await runCli(["history", "bracket"]);
  const out = logs.join("\n");
  expect(out).toMatch(/v2 \(current\)\n {2}bafyV2\n {2}bracket · 1 nodes\n {2}Added G-code \(Original Prusa MK4, PETG\)/);
});
