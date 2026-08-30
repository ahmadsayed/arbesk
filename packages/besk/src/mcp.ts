/**
 * MCP tool layer for besk — the transport-free core behind `besk mcp`.
 *
 * Every tool is a thin dispatch onto the same modules the interactive CLI
 * uses (catalog/generate/send/link/burn/collections); the only new code here
 * is argument validation and result shaping. Handlers THROW on any failure —
 * the stdio transport (mcp-server.ts) maps thrown errors to MCP isError
 * results. Nothing in this module may print to stdout: stdio is the JSON-RPC
 * channel.
 *
 * Non-interactive by design: no pickers, no prompts. `generate_model` takes an
 * explicit `provider`; destructive tools take explicit confirmation fields.
 */
import fs from "fs";
import path from "path";
import {
  listCollections,
  getCollectionAssets,
  resolveCollectionByName,
  resolveAssetByName,
  getManifest,
  writeManifest,
  updateCollection,
  uploadAsset,
  getVersionHistory,
  downloadAsset,
  detectFormat,
  clearCatalogCache,
} from "./catalog.ts";
import { createCollection } from "./collections.ts";
import { burnCollection } from "./burn.ts";
import { linkChildAsset } from "./link.ts";
import { sendAssetToCollection } from "./send.ts";
import { showAsset } from "./show.ts";
import {
  runGeneration,
  cancelGeneration,
  getProviderBalance,
  resolveSourceCid,
} from "./generate.ts";
import type { GenerationBody } from "./generate.ts";
import { loadSession, setActiveCollection, clearSession } from "./session.ts";
import type { Session } from "./session.ts";
import {
  displayName,
  currentCollectionTokenId,
  loadAssetSource,
  makeNodeId,
  resolveVersionCid,
  sanitizeFileName,
  extFor,
  readImageFile,
  saveGenerated,
} from "./helpers.ts";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type Args = Record<string, any>;
type Handler = (s: Session, args: Args) => Promise<unknown>;

/* ---------- shared resolution helpers ---------- */

function requireString(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error("Missing required argument: " + key);
  }
  return v.trim();
}

function optionalString(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Active collection by default; `collection` (name) overrides. */
async function tokenIdFor(s: Session, args: Args): Promise<string> {
  const name = optionalString(args, "collection");
  if (!name) return currentCollectionTokenId(s);
  const c = await resolveCollectionByName(s.address, name);
  if (!c) throw new Error("No collection named " + name);
  return c.tokenId;
}

async function assetFor(
  s: Session,
  args: Args,
): Promise<{ tokenId: string; assetID: string; cid: string; name: string }> {
  const name = requireString(args, "name");
  const tokenId = await tokenIdFor(s, args);
  const hit = await resolveAssetByName(tokenId, name);
  if (!hit) throw new Error("No asset named " + name);
  return { tokenId, assetID: hit.assetID, cid: hit.cid, name };
}

function providerKeyOf(args: Args): string | undefined {
  return (
    optionalString(args, "key") ?? process.env.ARBESK_PROVIDER_KEY ?? process.env.TRIPO_API_KEY
  );
}

function requireProviderKey(args: Args): string {
  const k = providerKeyOf(args);
  if (!k) {
    throw new Error(
      "A Tripo3D API key is required (key argument, ARBESK_PROVIDER_KEY, or TRIPO_API_KEY).",
    );
  }
  return k;
}

function linkMode(args: Args, fallback: "fork" | "live-ref"): "fork" | "live-ref" {
  const mode = optionalString(args, "mode") ?? fallback;
  if (mode !== "fork" && mode !== "live-ref") {
    throw new Error("Unsupported link mode: " + mode + " (fork or live-ref)");
  }
  return mode;
}

/* ---------- read handlers ---------- */

async function hWhoami(s: Session): Promise<unknown> {
  return {
    email: s.email,
    address: s.address,
    authMethod: s.authMethod,
    activeCollectionTokenId: s.activeCollectionTokenId ?? null,
  };
}

async function hLogout(): Promise<unknown> {
  clearSession();
  return { loggedOut: true };
}

async function hListCollections(s: Session): Promise<unknown> {
  const cols = await listCollections(s.address);
  return cols.map((c) => ({
    name: displayName(c.name),
    tokenId: c.tokenId,
    assetCount: c.assetCount,
    active: c.tokenId === s.activeCollectionTokenId,
  }));
}

async function hUseCollection(s: Session, args: Args): Promise<unknown> {
  const name = requireString(args, "name");
  const c = await resolveCollectionByName(s.address, name);
  if (!c) throw new Error("No collection named " + name);
  setActiveCollection(c.tokenId);
  return { active: c.tokenId, name: displayName(c.name) };
}

async function hCreateCollection(s: Session, args: Args): Promise<unknown> {
  const result = await createCollection(s, requireString(args, "name"));
  clearCatalogCache();
  if (result.isNew) setActiveCollection(result.tokenId);
  return result;
}

async function hBurnCollection(s: Session, args: Args): Promise<unknown> {
  const name = requireString(args, "name");
  const c = await resolveCollectionByName(s.address, name);
  if (!c) throw new Error("No collection named " + name);
  const label = displayName(c.name);
  const confirm = optionalString(args, "confirm");
  if (confirm !== label) {
    throw new Error(
      'Confirmation mismatch: pass confirm: "' + label + '" to burn this collection.',
    );
  }
  const receipt = (await burnCollection(s, c.tokenId)) as { transactionHash?: string };
  return { burned: label, tokenId: c.tokenId, transactionHash: receipt.transactionHash };
}

async function hListAssets(s: Session, args: Args): Promise<unknown> {
  const assets = await getCollectionAssets(await tokenIdFor(s, args));
  return assets.map((a) => ({
    name: a.name ?? "(unnamed)",
    assetId: a.assetID,
    version: a.version,
    format: a.format,
  }));
}

async function hAssetInfo(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  const { manifest: m, source } = await loadAssetSource(hit.cid);
  const nodes = m?.scene?.nodes ?? (Array.isArray(m.nodes) ? m.nodes : []);
  return {
    name: m.name ?? "(unnamed)",
    assetId: m.assetID ?? m.asset_id ?? hit.assetID,
    version: m.version ?? 1,
    format: detectFormat(source),
    cid: hit.cid,
    created: m.timestamp ? new Date(m.timestamp).toISOString() : null,
    nodes: nodes.length,
    previous: m.prev_asset_manifest_cid ?? null,
  };
}

async function hAssetHistory(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  const chain = await getVersionHistory(hit.cid);
  // getVersionHistory walks newest → oldest; report oldest → newest.
  const ordered = [...chain].reverse();
  return ordered.map((e, i) => ({
    version: e.version,
    cid: e.cid,
    name: e.name ?? "(unnamed)",
    nodeCount: e.nodeCount,
    current: i === ordered.length - 1,
  }));
}

async function hDownloadAsset(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  let cid = hit.cid;
  const version = optionalString(args, "version");
  if (version) {
    const versionCid = await resolveVersionCid(hit.cid, version);
    if (!versionCid) throw new Error("Version " + version + " not found for " + hit.name);
    cid = versionCid;
  }
  const { manifest: m, srcCid, source } = await loadAssetSource(cid);
  const format = detectFormat(source);
  const bytes = await downloadAsset(srcCid, format);
  const dir = optionalString(args, "directory") ?? process.cwd();
  const outPath = path.join(dir, sanitizeFileName((m.name as string) ?? hit.name) + extFor(format));
  fs.writeFileSync(outPath, bytes);
  return { file: outPath, bytes: bytes.length, format, version: m.version ?? 1 };
}

/* ---------- write handlers ---------- */

async function hUploadAsset(s: Session, args: Args): Promise<unknown> {
  const file = requireString(args, "file");
  if (!fs.existsSync(file)) throw new Error("File not found: " + file);
  const base = path.basename(file);
  const name = optionalString(args, "name") ??
    (base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base);
  const tokenId = await tokenIdFor(s, args);
  const existing = await resolveAssetByName(tokenId, name);
  const assetId = existing?.assetID ?? "asset_" + Date.now();
  const bytes = new Uint8Array(fs.readFileSync(file));
  const { compositeCid } = await uploadAsset(bytes, name, assetId);
  await updateCollection(s, tokenId, (draft) => {
    draft.assets[assetId] = compositeCid;
  });
  return { saved: name, assetId, cid: compositeCid, collection: tokenId };
}

async function hDeleteAsset(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  await updateCollection(s, hit.tokenId, (draft) => {
    delete draft.assets[hit.assetID];
  });
  return { deleted: hit.name, historyIntact: true };
}

async function hRenameAsset(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, { ...args, name: requireString(args, "oldName") });
  const newName = requireString(args, "newName");
  const assetManifest = (await getManifest(hit.cid)) as Record<string, any>;
  assetManifest.name = newName;
  const newAssetCid = await writeManifest(assetManifest);
  await updateCollection(s, hit.tokenId, (draft) => {
    draft.assets[hit.assetID] = newAssetCid;
  });
  return { renamed: newName, cid: newAssetCid };
}

async function hSendAsset(s: Session, args: Args): Promise<unknown> {
  const mode = linkMode(args, "fork");
  const hit = await assetFor(s, args);
  const targetName = requireString(args, "targetCollection");
  const target = await resolveCollectionByName(s.address, targetName);
  if (!target) throw new Error("No collection named " + targetName);
  const result = await sendAssetToCollection(s, {
    sourceTokenId: hit.tokenId,
    targetTokenId: target.tokenId,
    assetId: hit.assetID,
    assetName: hit.name,
    assetCid: hit.cid,
    mode,
  });
  return {
    mode,
    asset: hit.name,
    targetCollection: displayName(target.name),
    targetAssetId: result.targetAssetId,
    targetCid: result.targetCid,
  };
}

async function hLinkAsset(s: Session, args: Args): Promise<unknown> {  const mode = linkMode(args, "live-ref");
  const parentName = requireString(args, "parent");
  const childName = requireString(args, "child");
  let position: { x: number; y: number; z: number } | undefined;
  if (args.position !== undefined) {
    const p = args.position;
    if (!Array.isArray(p) || p.length !== 3 || p.some((n) => !Number.isFinite(n))) {
      throw new Error("position must be an array of three numbers: [x, y, z]");
    }
    position = { x: p[0], y: p[1], z: p[2] };
  }
  let scale: number | undefined;
  if (args.scale !== undefined) {
    scale = Number(args.scale);
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error("scale must be a positive number.");
    }
  }
  const parentTokenId = await tokenIdFor(s, args);
  const parentHit = await resolveAssetByName(parentTokenId, parentName);
  if (!parentHit) throw new Error("No asset named " + parentName + " in the target collection");
  let childTokenId = parentTokenId;
  const from = optionalString(args, "from");
  if (from) {
    const fromCol = await resolveCollectionByName(s.address, from);
    if (!fromCol) throw new Error("No collection named " + from);
    childTokenId = fromCol.tokenId;
  }
  const childHit = await resolveAssetByName(childTokenId, childName);
  if (!childHit) {
    throw new Error("No asset named " + childName + (from ? " in " + from : ""));
  }
  const result = await linkChildAsset(s, {
    parentTokenId,
    parentAssetId: parentHit.assetID,
    parentCid: parentHit.cid,
    childTokenId,
    childAssetId: childHit.assetID,
    childCid: childHit.cid,
    mode,
    position,
    scale,
  });
  return { linked: childName, parent: parentName, mode, nodeId: result.nodeId };
}

async function hShowAsset(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  return showAsset({
    tokenId: hit.tokenId,
    assetID: hit.assetID,
    cid: hit.cid,
    version: optionalString(args, "version"),
    open: args.open !== false,
  });
}

/* ---------- generation handlers ---------- */

function generationBase(args: Args, seed: string): GenerationBody {
  const body: GenerationBody = {
    nodeId: makeNodeId(seed),
    provider: "tripo3d",
    providerKey: requireProviderKey(args),
  };
  const quality = optionalString(args, "quality") ?? process.env.ARBESK_TEXTURE_QUALITY;
  if (quality) body.textureQuality = quality;
  return body;
}

/** Follow-up ops resolve the asset + its composite source CID. */
async function sourceFor(s: Session, args: Args) {
  const hit = await assetFor(s, args);
  const srcCid = await resolveSourceCid(hit.cid);
  return { ...hit, srcCid };
}

async function hGenerateModel(s: Session, args: Args): Promise<unknown> {
  const prompt = optionalString(args, "prompt");
  const imageFile = optionalString(args, "imageFile");
  const views = Array.isArray(args.views) ? (args.views as { view: string; file: string }[]) : [];
  if (!prompt && !imageFile && views.length === 0) {
    throw new Error("Provide a prompt, an imageFile, or 2-4 views.");
  }
  const provider = optionalString(args, "provider");
  if (!provider) {
    throw new Error('A provider is required ("mock" or "tripo3d") — no interactive picker in MCP.');
  }
  const body: GenerationBody = {
    nodeId: makeNodeId(prompt || "image"),
    prompt: prompt || undefined,
    provider,
  };
  if (provider !== "mock") body.providerKey = requireProviderKey(args);
  const quality = optionalString(args, "quality") ?? process.env.ARBESK_TEXTURE_QUALITY;
  if (quality) body.textureQuality = quality;
  if (imageFile) Object.assign(body, readImageFile(imageFile));
  if (views.length > 0) {
    if (views.length < 2 || views.length > 4) {
      throw new Error("Multiview needs 2-4 views.");
    }
    const names = views.map((v) => v.view);
    if (new Set(names).size !== names.length || names.filter((v) => v === "front").length !== 1) {
      throw new Error("Views must be unique and include exactly one front view.");
    }
    body.images = views.map((v) => ({ ...readImageFile(v.file), view: v.view }));
  }
  const model = await runGeneration(s, body, {});
  const name = optionalString(args, "name") ??
    (prompt ? prompt.slice(0, 60) : "image_" + Date.now());
  const tokenId = await tokenIdFor(s, args);
  const existing = await resolveAssetByName(tokenId, name);
  const assetId = existing?.assetID ?? "asset_" + Date.now();
  await saveGenerated(s, tokenId, model, name, assetId);
  return { saved: name, assetId, format: model.format, collection: tokenId };
}

function makeFollowUp(
  build: (args: Args, src: { srcCid: string; name: string }) => GenerationBody,
): Handler {
  return async (s, args) => {
    const src = await sourceFor(s, args);
    const body = build(args, src);
    const model = await runGeneration(s, body, {});
    await saveGenerated(s, src.tokenId, model, src.name, src.assetID);
    return { saved: src.name, assetId: src.assetID, format: model.format };
  };
}

const hRetexture = makeFollowUp((args, src) => ({
  ...generationBase(args, src.name),
  sourceAssetCid: src.srcCid,
  retexture: true,
  prompt: requireString(args, "prompt"),
}));

const hRetopo = makeFollowUp((args, src) => {
  let faceLimit: number | undefined;
  if (args.faceLimit !== undefined) {
    faceLimit = Number(args.faceLimit);
    if (!Number.isInteger(faceLimit) || faceLimit < 500 || faceLimit > 20000) {
      throw new Error("faceLimit must be an integer between 500 and 20000.");
    }
  }
  return {
    ...generationBase(args, src.name),
    sourceAssetCid: src.srcCid,
    retopo: true,
    faceLimit,
  };
});

const hRig = makeFollowUp((args, src) => ({
  ...generationBase(args, src.name),
  sourceAssetCid: src.srcCid,
  animate: true,
  rigOnly: true,
}));

const hAnimate = makeFollowUp((args, src) => {
  const presets = Array.isArray(args.presets) ? args.presets.map(String) : [];
  if (presets.length < 1 || presets.length > 5) {
    throw new Error("Pick 1-5 animation presets (e.g. preset:idle preset:biped:dance_01).");
  }
  return {
    ...generationBase(args, src.name),
    sourceAssetCid: src.srcCid,
    animate: true,
    animations: presets,
    animateInPlace: args.inPlace !== false,
  };
});

async function hBalance(s: Session, args: Args): Promise<unknown> {
  return getProviderBalance(s, requireProviderKey(args));
}

async function hCancel(s: Session, args: Args): Promise<unknown> {
  return cancelGeneration(s, requireString(args, "taskId"));
}

/* ---------- tool registry ---------- */

const S = (description: string): Record<string, unknown> => ({ type: "string", description });
const NAME = { name: S("Asset name within the collection") };
const COLLECTION = {
  collection: S("Collection name override (default: the active collection)"),
};
const KEY = {
  key: S("Tripo3D API key (default: ARBESK_PROVIDER_KEY or TRIPO_API_KEY env)"),
};
const QUALITY = {
  quality: { type: "string", enum: ["standard", "detailed", "extreme"], description: "Texture quality" },
};
const MODE = {
  mode: { type: "string", enum: ["fork", "live-ref"], description: "fork copies the current CID; live-ref tracks future edits" },
};

interface ToolEntry {
  def: McpToolDef;
  handler: Handler;
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  handler: Handler,
): ToolEntry {
  return {
    def: { name, description, inputSchema: { type: "object", properties, required } },
    handler,
  };
}

const TOOLS: ToolEntry[] = [
  tool("whoami", "Show the current besk identity (email, wallet, auth method).", {}, [], hWhoami),
  tool("logout", "Sign out and clear the local besk session.", {}, [], hLogout),
  tool(
    "list_collections",
    "List your collections with asset counts; the active one is flagged.",
    {}, [], hListCollections,
  ),
  tool(
    "use_collection",
    "Switch the active collection used by all collection-scoped tools.",
    { name: S("Collection name") }, ["name"], hUseCollection,
  ),
  tool(
    "create_collection",
    "Mint a new named collection (on-chain) and switch to it.",
    { name: S("Collection name") }, ["name"], hCreateCollection,
  ),
  tool(
    "burn_collection",
    "Burn a collection token on-chain and unpin its IPFS content. IRREVERSIBLE — requires confirm to exactly equal the collection name.",
    { name: S("Collection name"), confirm: S('Must exactly equal the collection name, e.g. confirm: "props"') },
    ["name", "confirm"], hBurnCollection,
  ),
  tool(
    "list_assets",
    "List assets in a collection (default: active).",
    { ...COLLECTION }, [], hListAssets,
  ),
  tool(
    "asset_info",
    "Show an asset's identity card: id, version, format, CID, node count.",
    { ...NAME, ...COLLECTION }, ["name"], hAssetInfo,
  ),
  tool(
    "asset_history",
    "Show an asset's version chain, oldest to newest.",
    { ...NAME, ...COLLECTION }, ["name"], hAssetHistory,
  ),
  tool(
    "download_asset",
    "Compose an asset (optionally a specific version) and write it to a local file.",
    { ...NAME, version: S("Version number (default: latest)"), directory: S("Output directory (default: cwd)"), ...COLLECTION },
    ["name"], hDownloadAsset,
  ),
  tool(
    "upload_asset",
    "Save a local model file (glTF/GLB/3MF) into a collection.",
    { file: S("Local model file path"), name: S("Asset name (default: file base name)"), ...COLLECTION },
    ["file"], hUploadAsset,
  ),
  tool(
    "delete_asset",
    "Remove an asset from the collection (version history stays on IPFS).",
    { ...NAME, ...COLLECTION }, ["name"], hDeleteAsset,
  ),
  tool(
    "rename_asset",
    "Rename an asset (writes a new manifest version).",
    { oldName: S("Current asset name"), newName: S("New asset name"), ...COLLECTION },
    ["oldName", "newName"], hRenameAsset,
  ),
  tool(
    "send_asset",
    "Link an asset into another collection: fork copies it, live-ref tracks future edits.",
    { ...NAME, targetCollection: S("Target collection name"), ...MODE, ...COLLECTION },
    ["name", "targetCollection"], hSendAsset,
  ),
  tool(
    "link_asset",
    "Nest a child asset inside a parent asset's scene (no viewer needed), with optional position and uniform scale.",
    {
      child: S("Child asset name"), parent: S("Parent asset name"),
      from: S("Collection the child lives in (default: same as parent)"),
      position: { type: "array", items: { type: "number" }, description: "[x, y, z] translation" },
      scale: { type: "number", description: "Uniform scale factor (default: 1)" },
      ...MODE, ...COLLECTION,
    },
    ["child", "parent"], hLinkAsset,
  ),
  tool(
    "show_asset",
    "Open an asset in the Studio browser UI via its deep link (opens the user's browser; pass open: false to only get the URL, version to pin a historical version).",
    { ...NAME, version: S("Version number (default: latest)"), open: { type: "boolean", description: "Launch the browser (default: true)" }, ...COLLECTION },
    ["name"], hShowAsset,
  ),
  tool(
    "generate_model",
    "Generate a 3D model (text-to-3D, image-to-3D, or multiview) and save it into a collection.",
    {
      prompt: S("Text prompt"), provider: { type: "string", enum: ["mock", "tripo3d"], description: "Generation provider" },
      imageFile: S("Single reference image (JPEG/PNG/WebP)"),
      views: { type: "array", items: { type: "object", properties: { view: { type: "string", enum: ["front", "left", "back", "right"] }, file: { type: "string" } }, required: ["view", "file"] }, description: "2-4 reference views, exactly one front" },
      name: S("Asset name for the result"), ...QUALITY, ...KEY, ...COLLECTION,
    },
    ["provider"], hGenerateModel,
  ),
  tool(
    "retexture_model",
    "Retexture an existing asset with a new text prompt (Tripo3D, BYOK). Saves a new version.",
    { ...NAME, prompt: S("Texture/style prompt"), ...QUALITY, ...KEY, ...COLLECTION },
    ["name", "prompt"], hRetexture,
  ),
  tool(
    "retopo_model",
    "Smart retopology of an asset (Tripo3D). Saves a new version.",
    { ...NAME, faceLimit: { type: "number", description: "Target face count, 500-20000 (omit for adaptive)" }, ...KEY, ...COLLECTION },
    ["name"], hRetopo,
  ),
  tool(
    "rig_model",
    "Auto-rig an asset for animation (Tripo3D). Saves a new version.",
    { ...NAME, ...KEY, ...COLLECTION }, ["name"], hRig,
  ),
  tool(
    "animate_model",
    "Rig + retarget 1-5 animation presets onto an asset (e.g. preset:idle, preset:biped:dance_01). Saves a new version.",
    {
      ...NAME,
      presets: { type: "array", items: { type: "string" }, description: "1-5 animation presets" },
      inPlace: { type: "boolean", description: "Animate in place (default: true)" },
      ...KEY, ...COLLECTION,
    },
    ["name", "presets"], hAnimate,
  ),
  tool("provider_balance", "Show the Tripo3D credit balance for a BYOK key.", { ...KEY }, [], hBalance),
  tool(
    "cancel_generation",
    "Stop an in-flight generation task (consumed credits are lost).",
    { taskId: S("Generation task id") }, ["taskId"], hCancel,
  ),
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.def.name, t]));

/** Tool definitions for the MCP `tools/list` response. */
export function listTools(): McpToolDef[] {
  return TOOLS.map((t) => t.def);
}

/**
 * Dispatch an MCP `tools/call`. Throws on unknown tools, missing sessions,
 * validation failures, and any downstream error — the transport maps thrown
 * errors to isError results.
 */
export async function callTool(name: string, args: Args = {}): Promise<unknown> {
  const entry = TOOL_MAP.get(name);
  if (!entry) throw new Error("Unknown tool: " + name);
  const s = loadSession();
  if (!s) throw new Error("Not logged in. Run `besk login <email>` first.");
  return entry.handler(s, args);
}
