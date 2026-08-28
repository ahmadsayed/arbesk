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
  getCollectionManifest,
  clearCatalogCache,
  uploadAsset,
} from "./catalog.ts";
import { relay } from "./relay.ts";

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
  console.log("  use <name>        switch to a collection");
  console.log("  list              list assets in the current collection");
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
  const { manifest } = await getCollectionManifest(tokenId);
  const assets = { ...(manifest.assets ?? {}) };
  delete assets[hit.assetID];
  manifest.assets = assets;
  const newCid = await writeManifest(manifest);
  await relay(s, "updateUri", tokenId, { newUri: newCid, proof: [] });
  clearCatalogCache();
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
  const { manifest } = await getCollectionManifest(tokenId);
  manifest.assets = { ...(manifest.assets ?? {}) };
  manifest.assets[hit.assetID] = newAssetCid;
  const newCid = await writeManifest(manifest);
  await relay(s, "updateUri", tokenId, { newUri: newCid, proof: [] });
  clearCatalogCache();
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
  const { manifest } = await getCollectionManifest(tokenId);
  manifest.assets = { ...(manifest.assets ?? {}) };
  manifest.assets[assetId] = compositeCid;
  const newCid = await writeManifest(manifest);
  await relay(s, "updateUri", tokenId, { newUri: newCid, proof: [] });
  clearCatalogCache();
  console.log("Saved as " + name);
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
  else if (command === "use") await cmdUse(args[1]);
  else if (command === "list") await cmdList();
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
