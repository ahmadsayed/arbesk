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
