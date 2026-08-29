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
import { jest } from "@jest/globals";

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

const mockResolveCompositeSourceCid = jest.fn();

jest.unstable_mockModule("../packages/besk/src/auth.ts", () => ({ login: mockLogin }));
jest.unstable_mockModule("../packages/besk/src/session.ts", () => ({
  whoami: mockWhoami,
  logout: mockLogout,
  loadSession: mockLoadSession,
  setActiveCollection: mockSetActiveCollection,
}));
jest.unstable_mockModule("@arbesk/asset-core/catalog/index.js", () => ({
  resolveCompositeSourceCid: mockResolveCompositeSourceCid,
}));
jest.unstable_mockModule("../packages/besk/src/catalog.ts", () => ({
  listCollections: mockListCollections,
  getCollectionAssets: mockGetCollectionAssets,
  resolveCollectionByName: mockResolveCollectionByName,
  resolveAssetByName: mockResolveAssetByName,
  getManifest: mockGetManifest,
  writeManifest: mockWriteManifest,
  clearCatalogCache: mockClearCatalogCache,
  updateCollection: mockUpdateCollection,
  uploadAsset: mockUploadAsset,
  getVersionHistory: mockGetVersionHistory,
  downloadAsset: mockDownloadAsset,
  detectFormat: mockDetectFormat,
}));
jest.unstable_mockModule("../packages/besk/src/collections.ts", () => ({
  createCollection: mockCreateCollection,
}));
jest.unstable_mockModule("../packages/besk/src/burn.ts", () => ({
  burnCollection: mockBurnCollection,
}));
jest.unstable_mockModule("../packages/besk/src/link.ts", () => ({
  linkChildAsset: mockLinkChildAsset,
}));
jest.unstable_mockModule("../packages/besk/src/send.ts", () => ({
  sendAssetToCollection: mockSendAssetToCollection,
}));
jest.unstable_mockModule("../packages/besk/src/show.ts", () => ({
  showAsset: mockShowAsset,
}));
jest.unstable_mockModule("../packages/besk/src/generate.ts", () => ({
  runGeneration: mockRunGeneration,
  cancelGeneration: mockCancelGeneration,
  getProviderBalance: mockGetProviderBalance,
  resolveSourceCid: mockResolveSourceCid,
}));
jest.unstable_mockModule("../packages/besk/src/helpers.ts", () => ({
  displayName: mockDisplayName,
  currentCollectionTokenId: mockCurrentCollectionTokenId,
  makeNodeId: mockMakeNodeId,
  sanitizeFileName: mockSanitizeFileName,
  extFor: mockExtFor,
  readImageFile: mockReadImageFile,
  saveGenerated: mockSaveGenerated,
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
  process.exitCode = undefined;
});

/** Import cli.ts fresh with the given argv and let main() run to completion. */
async function runCli(argv) {
  jest.resetModules();
  process.argv = ["node", "besk", ...argv];
  process.exitCode = undefined;
  await import("../packages/besk/src/cli.ts");
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return { exitCode: process.exitCode };
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

test("generate: --key goes out as providerKey; mock never sends one", async () => {
  await runCli(["generate", "a", "cube", "--provider", "tripo3d", "--key", "tsk_1"]);
  expect(mockRunGeneration.mock.calls[0][1].providerKey).toBe("tsk_1");
});

test("generate: provider key falls back to ARBESK_PROVIDER_KEY env", async () => {
  process.env.ARBESK_PROVIDER_KEY = "tsk_env";
  await runCli(["generate", "a", "cube", "--provider", "tripo3d"]);
  expect(mockRunGeneration.mock.calls[0][1].providerKey).toBe("tsk_env");
});

test("generate: --quality flag wins, env ARBESK_TEXTURE_QUALITY is the fallback", async () => {
  await runCli(["generate", "a", "cube", "--provider", "mock", "--quality", "detailed"]);
  expect(mockRunGeneration.mock.calls[0][1].textureQuality).toBe("detailed");

  jest.clearAllMocks();
  process.env.ARBESK_TEXTURE_QUALITY = "extreme";
  await runCli(["generate", "a", "cube", "--provider", "mock"]);
  expect(mockRunGeneration.mock.calls[0][1].textureQuality).toBe("extreme");
});

test("generate: provider falls back to ARBESK_PROVIDER env", async () => {
  process.env.ARBESK_PROVIDER = "mock";
  await runCli(["generate", "a", "cube"]);
  expect(mockRunGeneration.mock.calls[0][1].provider).toBe("mock");
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

test("link: missing args prints usage, exit 2", async () => {
  const { exitCode } = await runCli(["link", "only-child"]);
  expect(errors.join("\n")).toContain("Usage: besk link <child> <parent>");
  expect(exitCode).toBe(2);
});

test("link: unsupported mode exits 2", async () => {
  const { exitCode } = await runCli(["link", "c", "p", "mirror"]);
  expect(errors.join("\n")).toContain("Unsupported link mode: mirror");
  expect(exitCode).toBe(2);
});

test("link: malformed --position and non-positive --scale exit 2", async () => {
  let r = await runCli(["link", "c", "p", "--position", "1,2"]);
  expect(errors.join("\n")).toContain('--position needs three numbers: "x,y,z"');
  expect(r.exitCode).toBe(2);

  jest.clearAllMocks();
  errors = [];
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
