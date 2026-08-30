/**
 * Shared helpers between the interactive CLI (cli.ts) and the MCP tool layer
 * (mcp.ts) — kept transport-free: no prompts, no process.exitCode. Errors are
 * thrown; cli.ts catches and maps them to exit codes, mcp.ts lets them surface
 * as MCP tool errors.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getManifest, getVersionHistory, listCollections, updateCollection, uploadAsset } from "./catalog.ts";
import { resolveCompositeSourceCid } from "@arbesk/asset-core/catalog/index.js";
import type { GeneratedModel } from "./generate.ts";
import type { Session } from "./session.ts";

/** Fire-and-forget open of a URL in the system browser. */
export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

export function displayName(name: string | null): string {
  return name ?? "My Library";
}

/**
 * Fetch an asset manifest and resolve its composite source document.
 * `source` falls back to the manifest itself when it is not composite.
 */
export async function loadAssetSource(
  cid: string,
): Promise<{ manifest: Record<string, any>; srcCid: string; source: Record<string, any> }> {
  const m = (await getManifest(cid)) as Record<string, any>;
  const srcCid = resolveCompositeSourceCid(m) ?? cid;
  const source = srcCid === cid ? m : ((await getManifest(srcCid)) as Record<string, any>);
  return { manifest: m, srcCid, source };
}

/** Resolve a version number to its manifest CID; null when not found. */
export async function resolveVersionCid(cid: string, version: string): Promise<string | null> {
  const chain = await getVersionHistory(cid);
  const target = chain.find((e) => String(e.version) === String(version));
  return target ? target.cid : null;
}

export async function currentCollectionTokenId(s: Session): Promise<string> {
  if (s.activeCollectionTokenId) return s.activeCollectionTokenId;
  const cols = await listCollections(s.address);
  const def = cols.find((c) => c.name === null) ?? cols[0];
  if (!def) throw new Error("No collections found");
  return def.tokenId;
}

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Read an image file for a generation request; throws with a `code` marker. */
export function readImageFile(file: string): { imageData: string; imageMime: string } {
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error("File not found: " + file), { code: "FILE_NOT_FOUND" });
  }
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) {
    throw Object.assign(
      new Error("Unsupported image type: " + file + " (JPEG, PNG, or WebP)"),
      { code: "UNSUPPORTED_TYPE" },
    );
  }
  return { imageData: fs.readFileSync(file).toString("base64"), imageMime: mime };
}

export function makeNodeId(seed: string): string {
  const slug =
    seed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) ||
    "asset";
  return slug + "_" + Date.now();
}

export function extFor(format: string): string {
  return { gltf: ".gltf", glb: ".glb", "3mf": ".3mf", example: ".example" }[format] ?? ".gltf";
}

export function sanitizeFileName(name: string): string {
  const base = String(name).trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base || "asset";
}

/** Save a generated model into a collection as a (new version of an) asset. */
export async function saveGenerated(
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
