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

/** cli.ts adapter over helpers.readImageFile: print + exit code instead of throwing. */
function readImageFileCli(file: string): { imageData: string; imageMime: string } | null {
  try {
    return readImageFile(file);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = (e as { code?: string }).code === "FILE_NOT_FOUND" ? 5 : 2;
    return null;
  }
}

import { debug, setVerbose } from "./debug.ts";

// Global flag: --verbose / -v (env: ARBESK_VERBOSE=1) — timestamped debug log
// of every backend/IPFS/relay action on stderr. Stripped before dispatch.
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--verbose") || rawArgs.includes("-v")) setVerbose(true);
const args = rawArgs.filter((a) => a !== "--verbose" && a !== "-v");
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
  console.log("  burn <name>       burn a collection token + unpin its IPFS content (irreversible, typed confirmation)");
  console.log("  use <name>        switch to a collection");
  console.log("  list              list assets in the current collection");
  console.log("  info <name>       show an asset's identity card");
  console.log("  history <name>    show an asset's version chain");
  console.log("  download <name> [version]  pull a model to a local file");
  console.log("  upload <file>     save a local model to the current collection");
  console.log("  delete <name>     remove from the collection (only confirmation)");
  console.log("  rename <old> <new>  rename an asset");
  console.log("  send <name> <collection> [fork|live-ref]  link an asset into another collection");
  console.log("  link <child> <parent> [live-ref|fork] [--from <collection>] [--position \"x,y,z\"] [--scale s]  nest an asset inside another asset");
  console.log("  show <name> [--version N] [--collection c] [--print]  open an asset in the Studio browser UI");
  console.log("  generate <prompt> [--image f | --view <front|left|back|right> f ...] [--provider mock|tripo3d] [--key k] [--quality standard|detailed|extreme] [--name n]  generate a 3D model (asks for provider/key interactively)");
  console.log("  retexture <name> <prompt> [--quality q]  retexture an asset (Tripo3D key required)");
  console.log("  retopo <name> [faceLimit]  smart retopology (500-20000 tris, blank = adaptive)");
  console.log("  rig <name>            auto-rig an asset (Tripo3D key required)");
  console.log("  animate <name> <preset> [preset...] [--no-in-place]  rig + retarget animations");
  console.log("  balance [--key k]     show the Tripo3D credit balance");
  console.log("  cancel <taskId>       stop an in-flight generation task");
  console.log("  mcp                 start an MCP server (stdio) exposing all besk tools to AI agents");
  console.log("");
  console.log("Global flags:");
  console.log("  --verbose, -v       timestamped debug log of every action on stderr (env: ARBESK_VERBOSE=1)");
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

/**
 * Shared command preamble: session + named-asset resolution in the active
 * collection. Prints the usage/error, sets exitCode, and returns null on
 * failure.
 */
async function requireNamedAsset(name: string | undefined, usage: string) {
  const s = requireSession();
  if (!s) return null;
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
  return { s, tokenId, hit };
}

/**
 * Shared command preamble: named-collection resolution. Prints the
 * usage/error, sets exitCode, and returns null on failure.
 */
async function requireNamedCollection(s: Session, name: string | undefined, usage: string) {
  if (!name) {
    console.error("Usage: besk " + usage);
    process.exitCode = 2;
    return null;
  }
  const c = await resolveCollectionByName(s.address, name);
  if (!c) {
    console.error("No collection named " + name + ". Run `besk collections`.");
    process.exitCode = 5;
    return null;
  }
  return c;
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
  const c = await requireNamedCollection(s, name, "use <collection>");
  if (!c) return;
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
  const ctx = await requireNamedAsset(name, "Usage: besk delete <name>");
  if (!ctx) return;
  const { s, tokenId, hit } = ctx;
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
  if (!oldName || !newName) {
    console.error("Usage: besk rename <old> <new>");
    process.exitCode = 2;
    return;
  }
  const ctx = await requireNamedAsset(oldName, "Usage: besk rename <old> <new>");
  if (!ctx) return;
  const { s, tokenId, hit } = ctx;
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

async function cmdInfo(name?: string): Promise<void> {
  const ctx = await requireNamedAsset(name, "Usage: besk info <name>");
  if (!ctx) return;
  const { hit } = ctx;
  const { manifest: m, source } = await loadAssetSource(hit.cid);
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
  const ctx = await requireNamedAsset(name, "Usage: besk history <name>");
  if (!ctx) return;
  const { hit } = ctx;
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
  const ctx = await requireNamedAsset(name, "Usage: besk download <name> [version]");
  if (!ctx) return;
  const { hit } = ctx;
  let cid = hit.cid;
  if (version) {
    const versionCid = await resolveVersionCid(hit.cid, version);
    if (!versionCid) {
      console.error("Version " + version + " not found for " + name);
      process.exitCode = 5;
      return;
    }
    cid = versionCid;
  }
  const { manifest: m, srcCid, source } = await loadAssetSource(cid);
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
    } else if (a === "--print" || a.startsWith("--no-")) {
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

async function requireProviderKey(flags: Record<string, string[]>): Promise<string | null> {
  let k = providerKey(flags);
  if (!k && process.stdin.isTTY) {
    k = (await prompt("Tripo3D API key: ")).trim();
  }
  if (!k) {
    console.error("A Tripo3D API key is required (--key, ARBESK_PROVIDER_KEY, or TRIPO_API_KEY).");
    process.exitCode = 2;
    return null;
  }
  return k;
}

/**
 * Arrow-key menu on a TTY (raw-mode keypress loop). Returns the chosen index,
 * or -1 when stdin is not a TTY so callers can fall back to flags/env.
 * `initial` pre-selects an entry (e.g. the active collection).
 */
async function selectOption(question: string, options: string[], initial = 0): Promise<number> {
  if (!process.stdin.isTTY) return -1;
  const { emitKeypressEvents } = await import("readline");
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  let index = Math.min(Math.max(initial, 0), options.length - 1);
  const lines = options.length + 1;
  const draw = (first: boolean): void => {
    if (!first) process.stdout.write("\x1b[" + lines + "A\x1b[0J");
    let out = question + "\n";
    for (let i = 0; i < options.length; i++) {
      out += (i === index ? "❯ " : "  ") + options[i] + "\n";
    }
    process.stdout.write(out);
  };
  draw(true);
  return new Promise((resolve) => {
    const done = (value: number): void => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      resolve(value);
    };
    const onKey = (_s: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        done(-1);
        process.stdout.write("\n");
        process.exit(130);
      } else if (key.name === "up") {
        index = (index - 1 + options.length) % options.length;
        draw(false);
      } else if (key.name === "down") {
        index = (index + 1) % options.length;
        draw(false);
      } else if (key.name === "return") {
        done(index);
      }
    };
    process.stdin.on("keypress", onKey);
  });
}

/** Interactive provider picker; null when no selection is possible. */
async function pickProvider(): Promise<string | null> {
  const idx = await selectOption("Select a generation provider (↑/↓, Enter):", [
    "Mock (local, free)",
    "Tripo 3D (BYOK)",
  ]);
  if (idx < 0) {
    console.error("No provider selected. Non-interactive? Pass --provider mock|tripo3d.");
    process.exitCode = 2;
    return null;
  }
  return idx === 0 ? "mock" : "tripo3d";
}

/**
 * Interactive collection picker for generated results — the active collection
 * is pre-selected. Non-TTY runs fall back to the active/default collection.
 */
async function pickCollection(s: Session): Promise<string> {
  const cols = await listCollections(s.address);
  if (cols.length === 0) throw new Error("No collections found");
  const fallbackId =
    s.activeCollectionTokenId ?? (cols.find((c) => c.name === null) ?? cols[0]).tokenId;
  if (!process.stdin.isTTY) return fallbackId;
  const initial = Math.max(0, cols.findIndex((c) => c.tokenId === fallbackId));
  const idx = await selectOption(
    "Store in which collection? (↑/↓, Enter):",
    cols.map(
      (c) =>
        displayName(c.name) +
        " (" + c.assetCount + " assets)" +
        (c.tokenId === fallbackId ? " — active" : ""),
    ),
    initial,
  );
  return idx < 0 ? fallbackId : cols[idx].tokenId;
}

const PROGRESS_BAR_WIDTH = 24;
let progressBarDrawn = false;

function printProgress(p: { status: string; progress?: number; stage?: string; taskId?: string }): void {
  if (p.taskId) {
    console.log("  task " + p.taskId + " (cancel with: besk cancel " + p.taskId + ")");
    return;
  }
  const pct = p.progress ?? 0;
  const filled = Math.round((pct / 100) * PROGRESS_BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(PROGRESS_BAR_WIDTH - filled);
  const line =
    "  [" + bar + "] " + String(pct).padStart(3) + "%" +
    (p.stage ? " · " + p.stage : p.status ? " · " + p.status : "");
  if (process.stdout.isTTY) {
    process.stdout.write("\r" + line.padEnd(72));
    progressBarDrawn = true;
  } else {
    console.log(line);
  }
}

/** End the in-place progress bar before printing a final result line. */
function endProgress(): void {
  if (progressBarDrawn && process.stdout.isTTY) process.stdout.write("\n");
  progressBarDrawn = false;
}

async function cmdShow(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const name = positional[0];
  if (!name) {
    console.error("Usage: besk show <name> [--version N] [--collection c] [--print]");
    process.exitCode = 2;
    return;
  }
  let tokenId = await currentCollectionTokenId(s);
  const colOverride = flagValue(flags, "--collection");
  if (colOverride) {
    const c = await resolveCollectionByName(s.address, colOverride);
    if (!c) {
      console.error("No collection named " + colOverride + ". Run `besk collections`.");
      process.exitCode = 5;
      return;
    }
    tokenId = c.tokenId;
  }
  const hit = await resolveAssetByName(tokenId, name);
  if (!hit) {
    console.error("No asset named " + name);
    process.exitCode = 5;
    return;
  }
  const open = !flags["--print"];
  const result = await showAsset({
    tokenId,
    assetID: hit.assetID,
    cid: hit.cid,
    version: flagValue(flags, "--version"),
    open,
  });
  console.log(result.url);
  if (open) console.log("Opened in your browser");
}

interface LinkArgs {
  child: string;
  parent: string;
  mode: "live-ref" | "fork";
  position?: { x: number; y: number; z: number };
  scale?: number;
  from?: string;
}

/**
 * Parse and validate `besk link` args. Returns null when usage/validation
 * fails (error printed, exit code set).
 */
function parseLinkArgs(argv: string[]): LinkArgs | null {
  const { positional, flags } = parseFlags(argv);
  const [child, parent, modeArg] = positional;
  if (!child || !parent) {
    console.error("Usage: besk link <child> <parent> [live-ref|fork] [--from <collection>] [--position \"x,y,z\"] [--scale s]");
    process.exitCode = 2;
    return null;
  }
  const mode = modeArg ?? "live-ref";
  if (mode !== "live-ref" && mode !== "fork") {
    console.error("Unsupported link mode: " + mode + " (live-ref or fork)");
    process.exitCode = 2;
    return null;
  }
  let position: { x: number; y: number; z: number } | undefined;
  const posRaw = flagValue(flags, "--position");
  if (posRaw !== undefined) {
    const parts = posRaw.split(",").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      console.error("--position needs three numbers: \"x,y,z\"");
      process.exitCode = 2;
      return null;
    }
    position = { x: parts[0], y: parts[1], z: parts[2] };
  }
  let scale: number | undefined;
  const scaleRaw = flagValue(flags, "--scale");
  if (scaleRaw !== undefined) {
    scale = Number(scaleRaw);
    if (!Number.isFinite(scale) || scale <= 0) {
      console.error("--scale must be a positive number.");
      process.exitCode = 2;
      return null;
    }
  }
  return { child, parent, mode, position, scale, from: flagValue(flags, "--from") };
}

/**
 * Resolve both link endpoints: the parent in the active collection, the
 * child in the active or --from collection. Returns null when any lookup
 * fails (error printed, exit code set).
 */
async function resolveLinkEndpoints(
  s: Session,
  { child, parent, from }: LinkArgs,
): Promise<{
  parentTokenId: string;
  parentHit: { assetID: string; cid: string };
  childTokenId: string;
  childHit: { assetID: string; cid: string };
} | null> {
  const parentTokenId = await currentCollectionTokenId(s);
  const parentHit = await resolveAssetByName(parentTokenId, parent);
  if (!parentHit) {
    console.error("No asset named " + parent + " in the active collection");
    process.exitCode = 5;
    return null;
  }
  let childTokenId = parentTokenId;
  if (from) {
    const fromCol = await resolveCollectionByName(s.address, from);
    if (!fromCol) {
      console.error("No collection named " + from + ". Run `besk collections`.");
      process.exitCode = 5;
      return null;
    }
    childTokenId = fromCol.tokenId;
  }
  const childHit = await resolveAssetByName(childTokenId, child);
  if (!childHit) {
    console.error("No asset named " + child + (from ? " in " + from : " in the active collection"));
    process.exitCode = 5;
    return null;
  }
  return { parentTokenId, parentHit, childTokenId, childHit };
}

async function cmdLink(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const linkArgs = parseLinkArgs(argv);
  if (!linkArgs) return;
  const { child, parent, mode, position, scale } = linkArgs;
  const endpoints = await resolveLinkEndpoints(s, linkArgs);
  if (!endpoints) return;
  const result = await linkChildAsset(s, {
    parentTokenId: endpoints.parentTokenId,
    parentAssetId: endpoints.parentHit.assetID,
    parentCid: endpoints.parentHit.cid,
    childTokenId: endpoints.childTokenId,
    childAssetId: endpoints.childHit.assetID,
    childCid: endpoints.childHit.cid,
    mode,
    position,
    scale,
  });
  console.log(
    (mode === "fork" ? "Forked " : "Linked ") + child + " into " + parent +
      " (node " + result.nodeId + ")",
  );
}

/**
 * Resolve the generation provider (flag → env → interactive picker) and, for
 * non-mock providers, the BYOK key. Returns null when the command should stop
 * (the picker/key helper already set the exit code).
 */
async function resolveProviderAndKey(
  flags: Record<string, string[]>,
): Promise<{ provider: string; key?: string } | null> {
  let provider = flagValue(flags, "--provider") ?? process.env.ARBESK_PROVIDER;
  if (!provider) {
    provider = (await pickProvider()) ?? undefined;
    if (!provider) return null;
  }
  let key: string | undefined;
  if (provider !== "mock") {
    key = (await requireProviderKey(flags)) ?? undefined;
    if (!key) return null;
  }
  return { provider, key };
}

/**
 * Apply --image / --view flags to the generation body. Wire contract: a
 * single image rides as imageData/imageMime; 2-4 views become images[] in
 * canonical order with exactly one front. Returns false when validation
 * fails or an image can't be read (exit code already set).
 */
function applyImageFlags(
  body: GenerationBody,
  imageFile: string | undefined,
  viewFlags: string[],
): boolean {
  if (imageFile) {
    const img = readImageFileCli(imageFile);
    if (!img) return false;
    body.imageData = img.imageData;
    body.imageMime = img.imageMime;
  }
  if (viewFlags.length > 0) {
    if (viewFlags.length < 2 || viewFlags.length > 4) {
      console.error("Multiview needs 2-4 views.");
      process.exitCode = 2;
      return false;
    }
    const views = viewFlags.map((v) => v.split("=")[0]);
    if (new Set(views).size !== views.length || views.filter((v) => v === "front").length !== 1) {
      console.error("Views must be unique and include exactly one front view.");
      process.exitCode = 2;
      return false;
    }
    body.images = [];
    for (const v of viewFlags) {
      const [view, file] = v.split("=");
      const img = readImageFileCli(file);
      if (!img) return false;
      body.images.push({ ...img, view });
    }
  }
  return true;
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
  const pk = await resolveProviderAndKey(flags);
  if (!pk) return;
  const body: GenerationBody = {
    nodeId: makeNodeId(prompt || "image"),
    prompt: prompt || undefined,
    provider: pk.provider,
  };
  if (pk.key) body.providerKey = pk.key;
  const quality = flagValue(flags, "--quality") ?? process.env.ARBESK_TEXTURE_QUALITY;
  if (quality) body.textureQuality = quality;
  if (!applyImageFlags(body, imageFile, viewFlags)) return;
  console.log("Generating (" + pk.provider + ")…");
  const model = await runGeneration(s, body, { onProgress: printProgress });
  endProgress();
  const name = flagValue(flags, "--name") ?? (prompt ? prompt.slice(0, 60) : "image_" + Date.now());
  const tokenId = await pickCollection(s);
  const existing = await resolveAssetByName(tokenId, name);
  const assetId = existing?.assetID ?? "asset_" + Date.now();
  await saveGenerated(s, tokenId, model, name, assetId);
  console.log("Saved as " + name + " (" + model.format + ")");
}

/** Shared preamble for follow-up ops: resolve the asset and its source CID. */
async function resolveSourceAsset(
  name: string | undefined,
  usage: string,
): Promise<{ tokenId: string; assetId: string; srcCid: string } | null> {
  const ctx = await requireNamedAsset(name, usage);
  if (!ctx) return null;
  const srcCid = await resolveSourceCid(ctx.hit.cid);
  return { tokenId: ctx.tokenId, assetId: ctx.hit.assetID, srcCid };
}

async function cmdRetexture(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const [name, ...promptParts] = positional;
  const prompt = promptParts.join(" ");
  const src = await resolveSourceAsset(name, "Usage: besk retexture <name> <prompt>");
  if (!src) return;
  if (!prompt) {
    console.error("Usage: besk retexture <name> <prompt>");
    process.exitCode = 2;
    return;
  }
  const key = await requireProviderKey(flags);
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
  endProgress();
  console.log("Retextured " + name);
}

async function cmdRetopo(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const [name, face] = positional;
  const src = await resolveSourceAsset(name, "Usage: besk retopo <name> [faceLimit]");
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
  const key = await requireProviderKey(flags);
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
  endProgress();
  console.log("Retopologized " + name);
}

async function cmdRig(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const src = await resolveSourceAsset(positional[0], "Usage: besk rig <name>");
  if (!src) return;
  const key = await requireProviderKey(flags);
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
  endProgress();
  console.log("Rigged " + positional[0]);
}

async function cmdAnimate(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { positional, flags } = parseFlags(argv);
  const [name, ...presets] = positional;
  const src = await resolveSourceAsset(name, "Usage: besk animate <name> <preset> [preset...] [--no-in-place]");
  if (!src) return;
  if (presets.length < 1 || presets.length > 5) {
    console.error("Pick 1-5 animation presets (e.g. preset:idle preset:biped:dance_01).");
    process.exitCode = 2;
    return;
  }
  const key = await requireProviderKey(flags);
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
  endProgress();
  console.log("Animated " + name + " (" + presets.join(", ") + ")");
}

async function cmdBalance(argv: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { flags } = parseFlags(argv);
  const key = await requireProviderKey(flags);
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

async function cmdBurn(name?: string): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const c = await requireNamedCollection(s, name, "burn <collection>");
  if (!c) return;
  const label = displayName(c.name);
  const answer = await prompt(
    "Are you sure you want to delete the collection \"" + label +
      "\" and all non-referenced assets? This burns the token on-chain and cannot be undone. Type the collection name (" +
      label + ") to confirm: ",
  );
  if (answer.trim() !== label) {
    console.log("Cancelled");
    return;
  }
  const receipt = await burnCollection(s, c.tokenId);
  console.log("Burned collection " + label + " (token " + c.tokenId + ")");
  if (receipt.transactionHash) console.log("Tx: " + receipt.transactionHash);
}

/** Command dispatch table — each handler receives nothing; args are module state. */
const COMMANDS: Record<string, () => void | Promise<void>> = {
  login: () => login(args[1]),
  whoami: () => whoami(),
  logout: () => logout(),
  collections: () => cmdCollections(),
  create: () => cmdCreate(args[1]),
  burn: () => cmdBurn(args[1]),
  use: () => cmdUse(args[1]),
  list: () => cmdList(),
  info: () => cmdInfo(args[1]),
  history: () => cmdHistory(args[1]),
  download: () => cmdDownload(args[1], args[2]),
  upload: () => cmdUpload(args[1]),
  delete: () => cmdDelete(args[1]),
  rename: () => cmdRename(args[1], args[2]),
  send: () => cmdSend(args[1], args[2], args[3]),
  link: () => cmdLink(args.slice(1)),
  show: () => cmdShow(args.slice(1)),
  generate: () => cmdGenerate(args.slice(1)),
  retexture: () => cmdRetexture(args.slice(1)),
  retopo: () => cmdRetopo(args.slice(1)),
  rig: () => cmdRig(args.slice(1)),
  animate: () => cmdAnimate(args.slice(1)),
  balance: () => cmdBalance(args.slice(1)),
  cancel: () => cmdCancel(args.slice(1)),
  mcp: async () => {
    const { startMcpServer } = await import("./mcp-server.ts");
    await startMcpServer();
  },
};

async function main(): Promise<void> {
  if (!command || command === "help" || command === "--help") {
    help();
    return;
  }
  const commandStart = Date.now();
  debug("command:", command, ...args.slice(1));
  const handler = COMMANDS[command];
  if (handler) {
    await handler();
  } else {
    console.error("Unknown command: " + command);
    help();
    process.exitCode = 2;
  }
  debug("command done:", command, "(" + (Date.now() - commandStart) + "ms)");
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exitCode = 1;
});
