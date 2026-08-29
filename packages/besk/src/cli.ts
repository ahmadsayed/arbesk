#!/usr/bin/env node
/**
 * besk — the Arbesk command-line client. Node type-stripping (no build step).
 */
import { createInterface } from "readline/promises";
import fs from "fs";
import path from "path";
import { login } from "./auth.ts";
import { whoami, logout, loadSession, setActiveCollection } from "./session.ts";
import type { Session } from "./session.ts";
import { resolveCompositeSourceCid } from "@arbesk/asset-core/catalog/index.js";
import {
  listCollections,
  getCollectionAssets,
  resolveCollectionByName,
  resolveAssetByName,
  getManifest,
  writeManifest,
  clearCatalogCache,
  updateCollection,
  uploadAsset,
  getVersionHistory,
  downloadAsset,
  detectFormat,
} from "./catalog.ts";
import { createCollection } from "./collections.ts";
import { sendAssetToCollection } from "./send.ts";
import {
  runGeneration,
  cancelGeneration,
  getProviderBalance,
  resolveSourceCid,
} from "./generate.ts";
import type { GenerationBody, GeneratedModel } from "./generate.ts";

const args = process.argv.slice(2);
const command = args[0];

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function help(): void {
  console.log("Arbesk CLI — besk");
  console.log("");
  console.log("Usage: besk <command> [args]");
  console.log("");
  console.log("Commands:");
  console.log("  login <email>     sign in with email");
  console.log("  whoami            show the current identity");
  console.log("  logout            sign out");
  console.log("  collections       list your collections");
  console.log("  create <name>     mint a new collection");
  console.log("  use <name>        switch to a collection");
  console.log("  list              list assets in the current collection");
  console.log("  info <name>       show an asset's identity card");
  console.log("  history <name>    show an asset's version chain");
  console.log("  download <name> [version]  pull a model to a local file");
  console.log("  upload <file>     save a local model to the current collection");
  console.log("  delete <name>     remove from the collection (only confirmation)");
  console.log("  rename <old> <new>  rename an asset");
  console.log("  send <name> <collection> [fork|live-ref]  link an asset into another collection");
  console.log("  generate <prompt> [--image f | --view <front|left|back|right> f ...] [--provider mock|tripo3d] [--key k] [--quality standard|detailed|extreme] [--name n]  generate a 3D model");
  console.log("  retexture <name> <prompt> [--quality q]  retexture an asset (Tripo3D key required)");
  console.log("  retopo <name> [faceLimit]  smart retopology (500-20000 tris, blank = adaptive)");
  console.log("  rig <name>            auto-rig an asset (Tripo3D key required)");
  console.log("  animate <name> <preset> [preset...] [--no-in-place]  rig + retarget animations");
  console.log("  balance [--key k]     show the Tripo3D credit balance");
  console.log("  cancel <taskId>       stop an in-flight generation task");
}

function requireSession(): Session | null {
  const s = loadSession();
  if (!s) {
    console.error("Not logged in. Run `besk login <email>`.");
    process.exitCode = 3;
    return null;
  }
  return s;
}

function displayName(name: string | null): string {
  return name ?? "My Library";
}

async function currentCollectionTokenId(s: Session): Promise<string> {
  if (s.activeCollectionTokenId) return s.activeCollectionTokenId;
  const cols = await listCollections(s.address);
  const def = cols.find((c) => c.name === null) ?? cols[0];
  if (!def) throw new Error("No collections found");
  return def.tokenId;
}

async function cmdCollections(): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const cols = await listCollections(s.address);
  if (cols.length === 0) {
    console.log("No collections yet.");
    return;
  }
  for (const c of cols) {
    const marker = c.tokenId === s.activeCollectionTokenId ? "*" : " ";
    console.log(marker + " " + displayName(c.name).padEnd(18) + c.assetCount + " assets");
  }
}

async function cmdUse(name?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!name) {
    console.error("Usage: besk use <collection>");
    process.exitCode = 2;
    return;
  }
  const c = await resolveCollectionByName(s.address, name);
  if (!c) {
    console.error("No collection named " + name + ". Run `besk collections`.");
    process.exitCode = 5;
    return;
  }
  setActiveCollection(c.tokenId);
  console.log("Now using " + displayName(c.name));
}

async function cmdList(): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const tokenId = await currentCollectionTokenId(s);
  const assets = await getCollectionAssets(tokenId);
  if (assets.length === 0) {
    console.log("No assets.");
    return;
  }
  for (const a of assets) {
    const fmt = a.format === "gltf" ? "glb" : a.format;
    console.log((a.name ?? "(unnamed)").padEnd(18) + "v" + a.version + "  " + fmt);
  }
}

async function cmdDelete(name?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!name) {
    console.error("Usage: besk delete <name>");
    process.exitCode = 2;
    return;
  }
  const tokenId = await currentCollectionTokenId(s);
  const hit = await resolveAssetByName(tokenId, name);
  if (!hit) {
    console.error("No asset named " + name);
    process.exitCode = 5;
    return;
  }
  const answer = (await prompt("Delete " + name + " from your library? [y/N] ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    console.log("Cancelled");
    return;
  }
  await updateCollection(s, tokenId, (draft) => {
    delete draft.assets[hit.assetID];
  });
  console.log("Deleted " + name + " (history intact)");
}

async function cmdRename(oldName?: string, newName?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!oldName || !newName) {
    console.error("Usage: besk rename <old> <new>");
    process.exitCode = 2;
    return;
  }
  const tokenId = await currentCollectionTokenId(s);
  const hit = await resolveAssetByName(tokenId, oldName);
  if (!hit) {
    console.error("No asset named " + oldName);
    process.exitCode = 5;
    return;
  }
  const assetManifest = (await getManifest(hit.cid)) as Record<string, any>;
  assetManifest.name = newName;
  const newAssetCid = await writeManifest(assetManifest);
  await updateCollection(s, tokenId, (draft) => {
    draft.assets[hit.assetID] = newAssetCid;
  });
  console.log("Renamed " + oldName + " to " + newName);
}

async function cmdUpload(file?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!file) {
    console.error("Usage: besk upload <file>");
    process.exitCode = 2;
    return;
  }
  if (!fs.existsSync(file)) {
    console.error("File not found: " + file);
    process.exitCode = 5;
    return;
  }
  const base = path.basename(file);
  const name = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const tokenId = await currentCollectionTokenId(s);
  const existing = await resolveAssetByName(tokenId, name);
  const assetId = existing?.assetID ?? "asset_" + Date.now();
  const bytes = new Uint8Array(fs.readFileSync(file));
  console.log("Uploading " + file + "…");
  const { compositeCid } = await uploadAsset(bytes, name, assetId);
  await updateCollection(s, tokenId, (draft) => {
    draft.assets[assetId] = compositeCid;
  });
  console.log("Saved as " + name);
}

function extFor(format: string): string {
  return { gltf: ".gltf", glb: ".glb", "3mf": ".3mf", example: ".example" }[format] ?? ".gltf";
}

function sanitizeFileName(name: string): string {
  const base = String(name).trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base || "asset";
}

async function cmdInfo(name?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!name) {
    console.error("Usage: besk info <name>");
    process.exitCode = 2;
    return;
  }
  const tokenId = await currentCollectionTokenId(s);
  const hit = await resolveAssetByName(tokenId, name);
  if (!hit) {
    console.error("No asset named " + name);
    process.exitCode = 5;
    return;
  }
  const m = (await getManifest(hit.cid)) as Record<string, any>;
  const srcCid = resolveCompositeSourceCid(m);
  const source = srcCid ? ((await getManifest(srcCid)) as Record<string, any>) : m;
  // Asset manifests carry scene.nodes; CLI uploads store the composite glTF
  // JSON directly, whose nodes sit at the top level.
  const nodes = m?.scene?.nodes ?? (Array.isArray(m.nodes) ? m.nodes : []);
  console.log("Name:      " + (m.name ?? "(unnamed)"));
  console.log("Asset ID:  " + (m.assetID ?? m.asset_id ?? hit.assetID));
  console.log("Version:   " + (m.version ?? 1));
  console.log("Format:    " + detectFormat(source));
  console.log("CID:       " + hit.cid);
  if (m.timestamp) console.log("Created:   " + new Date(m.timestamp).toISOString());
  console.log("Nodes:     " + nodes.length);
  if (m.prev_asset_manifest_cid) console.log("Previous:  " + m.prev_asset_manifest_cid);
}

async function cmdHistory(name?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!name) {
    console.error("Usage: besk history <name>");
    process.exitCode = 2;
    return;
  }
  const tokenId = await currentCollectionTokenId(s);
  const hit = await resolveAssetByName(tokenId, name);
  if (!hit) {
    console.error("No asset named " + name);
    process.exitCode = 5;
    return;
  }
  const chain = await getVersionHistory(hit.cid);
  if (chain.length === 0) {
    console.log("No history.");
    return;
  }
  // getVersionHistory walks newest → oldest; print oldest → newest.
  const ordered = [...chain].reverse();
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    const marker = i === ordered.length - 1 ? " (current)" : "";
    console.log("v" + e.version + marker);
    console.log("  " + e.cid);
    console.log("  " + (e.name ?? "(unnamed)") + " · " + e.nodeCount + " nodes");
  }
}

async function cmdDownload(name?: string, version?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!name) {
    console.error("Usage: besk download <name> [version]");
    process.exitCode = 2;
    return;
  }
  const tokenId = await currentCollectionTokenId(s);
  const hit = await resolveAssetByName(tokenId, name);
  if (!hit) {
    console.error("No asset named " + name);
    process.exitCode = 5;
    return;
  }
  let cid = hit.cid;
  if (version) {
    const chain = await getVersionHistory(hit.cid);
    const target = chain.find((e) => String(e.version) === String(version));
    if (!target) {
      console.error("Version " + version + " not found for " + name);
      process.exitCode = 5;
      return;
    }
    cid = target.cid;
  }
  const m = (await getManifest(cid)) as Record<string, any>;
  const srcCid = resolveCompositeSourceCid(m) ?? cid;
  const source = srcCid === cid ? m : ((await getManifest(srcCid)) as Record<string, any>);
  const format = detectFormat(source);
  console.log("Downloading " + name + " (v" + (m.version ?? 1) + ", " + format + ")…");
  const bytes = await downloadAsset(srcCid, format);
  const outName = sanitizeFileName((m.name as string) ?? name) + extFor(format);
  fs.writeFileSync(outName, bytes);
  console.log("Saved " + outName + " (" + bytes.length + " bytes)");
}

async function cmdCreate(name?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!name) {
    console.error("Usage: besk create <name>");
    process.exitCode = 2;
    return;
  }
  console.log("Creating collection " + name + "…");
  const result = await createCollection(s, name);
  clearCatalogCache();
  if (!result.isNew) {
    console.log("Collection already exists: " + name + " (token " + result.tokenId + ")");
    return;
  }
  setActiveCollection(result.tokenId);
  console.log("Created collection " + name + " (token " + result.tokenId + ")");
  if (result.transactionHash) console.log("Tx: " + result.transactionHash);
}

async function cmdSend(name?: string, collection?: string, mode?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  if (!name || !collection) {
    console.error("Usage: besk send <asset> <collection> [fork|live-ref]");
    process.exitCode = 2;
    return;
  }
  const linkMode = mode ?? "fork";
  if (linkMode !== "fork" && linkMode !== "live-ref") {
    console.error("Unsupported link mode: " + linkMode + " (fork or live-ref)");
    process.exitCode = 2;
    return;
  }
  const sourceTokenId = await currentCollectionTokenId(s);
  const hit = await resolveAssetByName(sourceTokenId, name);
  if (!hit) {
    console.error("No asset named " + name);
    process.exitCode = 5;
    return;
  }
  const target = await resolveCollectionByName(s.address, collection);
  if (!target) {
    console.error("No collection named " + collection + ". Run `besk collections`.");
    process.exitCode = 5;
    return;
  }
  const result = await sendAssetToCollection(s, {
    sourceTokenId,
    targetTokenId: target.tokenId,
    assetId: hit.assetID,
    assetName: name,
    assetCid: hit.cid,
    mode: linkMode,
  });
  console.log(
    linkMode === "fork"
      ? "Forked " + name + " into " + displayName(target.name)
      : "Linked " + name + " into " + displayName(target.name) + " as " + result.targetAssetId + " (live reference)",
  );
}

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string[]> } {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--view") {
      const view = argv[++i];
      const file = argv[++i];
      if (!view || !file) throw new Error("Usage: --view <front|left|back|right> <file>");
      (flags["--view"] ??= []).push(view + "=" + file);
    } else if (a.startsWith("--no-")) {
      flags[a] = ["true"];
    } else if (a.startsWith("--")) {
      const v = argv[++i];
      if (v === undefined) throw new Error("Flag " + a + " needs a value");
      (flags[a] ??= []).push(v);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flagValue(flags: Record<string, string[]>, name: string): string | undefined {
  return flags[name]?.[0];
}

function providerKey(flags: Record<string, string[]>): string | undefined {
  return flagValue(flags, "--key") ?? process.env.ARBESK_PROVIDER_KEY ?? process.env.TRIPO_API_KEY;
}

function requireProviderKey(flags: Record<string, string[]>): string | null {
  const k = providerKey(flags);
  if (!k) {
    console.error("A Tripo3D API key is required (--key, ARBESK_PROVIDER_KEY, or TRIPO_API_KEY).");
    process.exitCode = 2;
    return null;
  }
  return k;
}

function readImageFile(file: string): { imageData: string; imageMime: string } | null {
  if (!fs.existsSync(file)) {
    console.error("File not found: " + file);
    process.exitCode = 5;
    return null;
  }
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) {
    console.error("Unsupported image type: " + file + " (JPEG, PNG, or WebP)");
    process.exitCode = 2;
    return null;
  }
  return { imageData: fs.readFileSync(file).toString("base64"), imageMime: mime };
}

function makeNodeId(seed: string): string {
  const slug =
    seed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) ||
    "asset";
  return slug + "_" + Date.now();
}

function printProgress(p: { status: string; progress?: number; stage?: string; taskId?: string }): void {
  if (p.taskId) {
    console.log("  task " + p.taskId + " (cancel with: besk cancel " + p.taskId + ")");
    return;
  }
  const parts = [p.status];
  if (p.stage) parts.push(p.stage);
  if (p.progress !== undefined) parts.push(p.progress + "%");
  console.log("  " + parts.join(" · "));
}

/** Save a generated model into a collection as a (new version of an) asset. */
async function saveGenerated(
  s: Session,
  tokenId: string,
  model: GeneratedModel,
  name: string,
  assetId: string,
): Promise<void> {
  const { compositeCid } = await uploadAsset(model.bytes, name, assetId);
  await updateCollection(s, tokenId, (draft) => {
    draft.assets[assetId] = compositeCid;
  });
}

async function cmdGenerate(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const prompt = positional.join(" ");
  const imageFile = flagValue(flags, "--image");
  const viewFlags = flags["--view"] ?? [];
  if (!prompt && !imageFile && viewFlags.length === 0) {
    console.error("Usage: besk generate <prompt> [--image f | --view <front|left|back|right> f ...]");
    process.exitCode = 2;
    return;
  }
  const provider = flagValue(flags, "--provider") ?? process.env.ARBESK_PROVIDER ?? "mock";
  const key = providerKey(flags);
  if (provider !== "mock" && !key) {
    console.error("A Tripo3D API key is required (--key, ARBESK_PROVIDER_KEY, or TRIPO_API_KEY).");
    process.exitCode = 2;
    return;
  }
  const body: GenerationBody = {
    nodeId: makeNodeId(prompt || "image"),
    prompt: prompt || undefined,
    provider,
  };
  if (key) body.providerKey = key;
  const quality = flagValue(flags, "--quality") ?? process.env.ARBESK_TEXTURE_QUALITY;
  if (quality) body.textureQuality = quality;
  if (imageFile) {
    const img = readImageFile(imageFile);
    if (!img) return;
    body.imageData = img.imageData;
    body.imageMime = img.imageMime;
  }
  if (viewFlags.length > 0) {
    if (viewFlags.length < 2 || viewFlags.length > 4) {
      console.error("Multiview needs 2-4 views.");
      process.exitCode = 2;
      return;
    }
    const views = viewFlags.map((v) => v.split("=")[0]);
    if (new Set(views).size !== views.length || views.filter((v) => v === "front").length !== 1) {
      console.error("Views must be unique and include exactly one front view.");
      process.exitCode = 2;
      return;
    }
    body.images = [];
    for (const v of viewFlags) {
      const [view, file] = v.split("=");
      const img = readImageFile(file);
      if (!img) return;
      body.images.push({ ...img, view });
    }
  }
  console.log("Generating (" + provider + ")…");
  const model = await runGeneration(s, body, { onProgress: printProgress });
  const name = flagValue(flags, "--name") ?? (prompt ? prompt.slice(0, 60) : "image_" + Date.now());
  const tokenId = await currentCollectionTokenId(s);
  const existing = await resolveAssetByName(tokenId, name);
  const assetId = existing?.assetID ?? "asset_" + Date.now();
  await saveGenerated(s, tokenId, model, name, assetId);
  console.log("Saved as " + name + " (" + model.format + ")");
}

/** Shared preamble for follow-up ops: resolve the asset and its source CID. */
async function resolveSourceAsset(
  s: Session,
  name: string | undefined,
  usage: string,
): Promise<{ tokenId: string; assetId: string; srcCid: string } | null> {
  if (!name) {
    console.error(usage);
    process.exitCode = 2;
    return null;
  }
  const tokenId = await currentCollectionTokenId(s);
  const hit = await resolveAssetByName(tokenId, name);
  if (!hit) {
    console.error("No asset named " + name);
    process.exitCode = 5;
    return null;
  }
  const srcCid = await resolveSourceCid(hit.cid);
  return { tokenId, assetId: hit.assetID, srcCid };
}

async function cmdRetexture(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const [name, ...promptParts] = positional;
  const prompt = promptParts.join(" ");
  const src = await resolveSourceAsset(s, name, "Usage: besk retexture <name> <prompt>");
  if (!src) return;
  if (!prompt) {
    console.error("Usage: besk retexture <name> <prompt>");
    process.exitCode = 2;
    return;
  }
  const key = requireProviderKey(flags);
  if (!key) return;
  const body: GenerationBody = {
    nodeId: makeNodeId(name),
    provider: "tripo3d",
    providerKey: key,
    sourceAssetCid: src.srcCid,
    retexture: true,
    prompt,
  };
  const quality = flagValue(flags, "--quality") ?? process.env.ARBESK_TEXTURE_QUALITY;
  if (quality) body.textureQuality = quality;
  console.log("Retexturing " + name + "…");
  const model = await runGeneration(s, body, { onProgress: printProgress });
  await saveGenerated(s, src.tokenId, model, name, src.assetId);
  console.log("Retextured " + name);
}

async function cmdRetopo(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const [name, face] = positional;
  const src = await resolveSourceAsset(s, name, "Usage: besk retopo <name> [faceLimit]");
  if (!src) return;
  let faceLimit: number | undefined;
  if (face !== undefined) {
    faceLimit = Number(face);
    if (!Number.isInteger(faceLimit) || faceLimit < 500 || faceLimit > 20000) {
      console.error("faceLimit must be an integer between 500 and 20000.");
      process.exitCode = 2;
      return;
    }
  }
  const key = requireProviderKey(flags);
  if (!key) return;
  console.log("Retopologizing " + name + "…");
  const model = await runGeneration(s, {
    nodeId: makeNodeId(name),
    provider: "tripo3d",
    providerKey: key,
    sourceAssetCid: src.srcCid,
    retopo: true,
    faceLimit,
  }, { onProgress: printProgress });
  await saveGenerated(s, src.tokenId, model, name, src.assetId);
  console.log("Retopologized " + name);
}

async function cmdRig(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const src = await resolveSourceAsset(s, positional[0], "Usage: besk rig <name>");
  if (!src) return;
  const key = requireProviderKey(flags);
  if (!key) return;
  console.log("Rigging " + positional[0] + "…");
  const model = await runGeneration(s, {
    nodeId: makeNodeId(positional[0]),
    provider: "tripo3d",
    providerKey: key,
    sourceAssetCid: src.srcCid,
    animate: true,
    rigOnly: true,
  }, { onProgress: printProgress });
  await saveGenerated(s, src.tokenId, model, positional[0], src.assetId);
  console.log("Rigged " + positional[0]);
}

async function cmdAnimate(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const [name, ...presets] = positional;
  const src = await resolveSourceAsset(s, name, "Usage: besk animate <name> <preset> [preset...] [--no-in-place]");
  if (!src) return;
  if (presets.length < 1 || presets.length > 5) {
    console.error("Pick 1-5 animation presets (e.g. preset:idle preset:biped:dance_01).");
    process.exitCode = 2;
    return;
  }
  const key = requireProviderKey(flags);
  if (!key) return;
  console.log("Animating " + name + "…");
  const model = await runGeneration(s, {
    nodeId: makeNodeId(name),
    provider: "tripo3d",
    providerKey: key,
    sourceAssetCid: src.srcCid,
    animate: true,
    animations: presets,
    animateInPlace: !flags["--no-in-place"],
  }, { onProgress: printProgress });
  await saveGenerated(s, src.tokenId, model, name, src.assetId);
  console.log("Animated " + name + " (" + presets.join(", ") + ")");
}

async function cmdBalance(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { flags } = parseFlags(argv);
  const key = requireProviderKey(flags);
  if (!key) return;
  const { balance, frozen } = await getProviderBalance(s, key);
  console.log("Tripo3D balance: " + balance + " credits (" + frozen + " frozen)");
}

async function cmdCancel(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const taskId = argv[0];
  if (!taskId) {
    console.error("Usage: besk cancel <taskId>");
    process.exitCode = 2;
    return;
  }
  const r = await cancelGeneration(s, taskId);
  console.log("Cancelled " + taskId + (r.upstreamCancelled ? " (upstream cancelled)" : ""));
}

async function main(): Promise<void> {
  if (!command || command === "help" || command === "--help") {
    help();
    return;
  }
  if (command === "login") await login(args[1]);
  else if (command === "whoami") whoami();
  else if (command === "logout") logout();
  else if (command === "collections") await cmdCollections();
  else if (command === "create") await cmdCreate(args[1]);
  else if (command === "use") await cmdUse(args[1]);
  else if (command === "list") await cmdList();
  else if (command === "info") await cmdInfo(args[1]);
  else if (command === "history") await cmdHistory(args[1]);
  else if (command === "download") await cmdDownload(args[1], args[2]);
  else if (command === "upload") await cmdUpload(args[1]);
  else if (command === "delete") await cmdDelete(args[1]);
  else if (command === "rename") await cmdRename(args[1], args[2]);
  else if (command === "send") await cmdSend(args[1], args[2], args[3]);
  else if (command === "generate") await cmdGenerate(args.slice(1));
  else if (command === "retexture") await cmdRetexture(args.slice(1));
  else if (command === "retopo") await cmdRetopo(args.slice(1));
  else if (command === "rig") await cmdRig(args.slice(1));
  else if (command === "animate") await cmdAnimate(args.slice(1));
  else if (command === "balance") await cmdBalance(args.slice(1));
  else if (command === "cancel") await cmdCancel(args.slice(1));
  else {
    console.error("Unknown command: " + command);
    help();
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exitCode = 1;
});
