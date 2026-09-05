/**
 * Catalog facade: createArbeskCore over the CLI adapters + a small file cache
 * so collections/asset listings are instant on repeat runs (the first run still
 * does the N+1 indexer → tokenURI → IPFS walk).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createArbeskCore } from "@arbesk/asset-core";
import { applyCollectionMutation } from "@arbesk/asset-core/utils/collections.js";
import { CHAIN_ID } from "./config.ts";
import { debug, trace } from "./debug.ts";
import { createCollectionReadPort, createHashPort, createIpfsReadPort, createIpfsWritePort, getBackendConfig } from "./adapters.ts";
import { relay } from "./relay.ts";
import type { Session } from "./session.ts";

let _core: ReturnType<typeof createArbeskCore> | null = null;
let _ipfsWrite: ReturnType<typeof createIpfsWritePort> | null = null;

const CACHE_PATH =
  process.env.ARBESK_CACHE_PATH ||
  path.join(os.homedir(), ".config", "besk", "catalog-cache.json");
const CACHE_TTL = Number(process.env.ARBESK_CACHE_TTL || 30 * 60 * 1000);

interface CacheEntry<T> { cachedAt: number; data: T }

function loadCache(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, any>): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch {
    /* best-effort */
  }
}

function fresh<T>(entry: CacheEntry<T> | undefined): T | null {
  if (!entry) return null;
  return Date.now() - entry.cachedAt < CACHE_TTL ? entry.data : null;
}

/** Invalidate the catalog cache (called after writes so the next read is fresh). */
export function clearCatalogCache(): void {
  try {
    fs.unlinkSync(CACHE_PATH);
  } catch {
    /* already gone */
  }
}

export async function getCore() {
  if (_core) return _core;
  const cfg = await getBackendConfig();
  debug("asset-core init: gateway " + cfg.ipfsGatewayUrl + ", chain " + CHAIN_ID);
  _ipfsWrite = createIpfsWritePort();
  _core = createArbeskCore({
    ipfsRead: createIpfsReadPort(cfg.ipfsGatewayUrl),
    ipfsWrite: _ipfsWrite,
    collection: createCollectionReadPort(),
    hash: createHashPort(),
  });
  return _core;
}

export async function getManifest(cid: string) {
  // Reads are logged at the IPFS read port (adapters.ts), which also covers
  // the SDK's internal fetches (version-chain walk, children, buffers).
  return (await getCore()).getManifest(cid);
}

/** Write an arbitrary JSON value (object or array) to IPFS, gzip-compressed. */
export async function writeJSON(json: unknown): Promise<string> {
  await getCore();
  const cid = await _ipfsWrite!.writeJSON(json as Record<string, any>);
  debug("ipfs write →", cid);
  return cid;
}

export async function writeManifest(manifest: Record<string, unknown>): Promise<string> {
  return writeJSON(manifest);
}

export async function getVersionHistory(cid: string) {
  return (await getCore()).getVersionHistory(cid);
}

/** Compose a stored manifest/source CID into a self-contained renderable artifact. */
export async function downloadAsset(cid: string, format?: string): Promise<Uint8Array> {
  const blob = await (await getCore()).download(cid, { format });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Re-export the format detector so commands can name output extensions. */
export { detectFormat } from "@arbesk/asset-core";

export async function getCollectionManifest(tokenId: string) {
  const port = createCollectionReadPort();
  const cid = await port.tokenURI(tokenId);
  const manifest = (await getManifest(cid)) as Record<string, any>;
  return { cid, manifest };
}

export async function listCollections(address: string) {
  const cache = loadCache();
  const key = "collections:" + address.toLowerCase();
  const hit = fresh(cache[key]);
  if (hit) {
    debug("collections cache hit:", address);
    return hit as any[];
  }

  debug("collections fetch:", address);
  const cols = await (await getCore()).listCollections(address, CHAIN_ID);
  debug("collections:", cols.length, "found");
  cache[key] = { cachedAt: Date.now(), data: cols };
  saveCache(cache);
  return cols;
}

export async function getCollectionAssets(tokenId: string) {
  const cache = loadCache();
  const key = "assets:" + tokenId;
  const hit = fresh(cache[key]);
  if (hit) {
    debug("assets cache hit: token", tokenId);
    return hit as any[];
  }

  debug("assets fetch: token", tokenId);
  const assets = await (await getCore()).getCollectionAssets(tokenId, CHAIN_ID);
  cache[key] = { cachedAt: Date.now(), data: assets };
  saveCache(cache);
  return assets;
}

export async function resolveCollectionByName(address: string, name: string) {
  return (await getCore()).resolveCollectionByName(address, name, CHAIN_ID);
}

export async function resolveAssetByName(tokenId: string, name: string) {
  return (await getCore()).resolveAssetByName(tokenId, name, CHAIN_ID);
}

export async function uploadAsset(bytes: Uint8Array, assetName: string, assetId: string) {
  debug("upload:", assetName, "(" + bytes.length + " bytes) as", assetId);
  const result = await (await getCore()).upload(bytes, { assetName, assetId });
  debug("upload composite →", result.compositeCid ?? result.rootCid);
  return { compositeCid: result.compositeCid ?? result.rootCid, assetId };
}

/**
 * The one CLI collection-write path: read → mutate (with version bump + prev
 * link, via the canonical asset-core helper) → write → relay updateUri →
 * invalidate the catalog cache. Returns the new collection CID.
 */
export async function updateCollection(
  session: Session,
  tokenId: string,
  mutate: (draft: Record<string, any>) => void,
): Promise<string> {
  return trace("updateCollection token=" + tokenId, async () => {
    const { cid, manifest } = await getCollectionManifest(tokenId);
    const next = applyCollectionMutation(manifest, cid, mutate);
    const newCid = await writeManifest(next);
    debug("collection manifest:", cid, "→", newCid);
    // The token identifies the collection; the changed assetID tells
    // live-update viewers exactly which entry to reload.
    const before = manifest?.assets || {};
    const after = next?.assets || {};
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => before[k] !== after[k]);
    const assetId = changed.length === 1 ? changed[0] : null;
    const relayParams: Record<string, any> = { newUri: newCid, proof: [] };
    if (assetId) relayParams.assetId = assetId;
    await relay(session, "updateUri", tokenId, relayParams);
    clearCatalogCache();
    return newCid;
  });
}
