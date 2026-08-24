/**
 * Download an asset's source model file to the user's machine.
 *
 * Resolves the asset manifest from IPFS, finds the primary source node
 * (type "source_asset" with a source.cid), and saves the bytes as a file:
 * - GLB (and other binary formats): downloaded raw from IPFS as-is.
 * - Composite glTF: buffers/images are inlined as data URIs first (the same
 *   compose step used at render time) so the downloaded .gltf is
 *   self-contained.
 */

import {
  getFromRemoteIPFS,
  getBlobFromRemoteIPFS,
} from "../ipfs/remote-ipfs.ts";
import { initAssetCoreBrowser } from "../asset-core-init.ts";
import type { ArbeskCore } from "@arbesk/asset-core/facade.js";
import { getAssetState } from "@arbesk/asset-core/domain/asset.js";
import { announceStatus } from "./api.ts";

/**
 * The shared frontend asset-core (composition root installed at Studio boot).
 */
function getCore(): ArbeskCore {
  return initAssetCoreBrowser();
}

/**
 * @returns filesystem-safe base name
 */
function sanitizeFilename(name: string): string {
  const cleaned = String(name || "")
    .replace(/[^\w\-. ]+/g, "_")
    .trim();
  return cleaned || "asset";
}

/**
 * Trigger a browser download for a Blob.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Find the primary source node in an asset manifest.
 */
function findSourceNode(
  manifest: any
): { cid: string; path?: string; format?: string } | null {
  const nodes = manifest?.scene?.nodes;
  if (!Array.isArray(nodes)) return null;
  const node = nodes.find((n: any) => n?.source?.cid);
  return node?.source || null;
}

/**
 * Download the source model referenced by an asset manifest CID.
 * @param assetName - base name for the downloaded file
 * @returns the filename the browser was told to save
 */
export async function downloadAssetByManifestCid(
  manifestCid: string,
  assetName?: string
): Promise<string> {
  announceStatus("Preparing download…");
  const manifest = await getFromRemoteIPFS(manifestCid);
  const source = findSourceNode(manifest);
  if (!source?.cid) {
    throw new Error("This asset has no downloadable source file.");
  }
  const path = source.path || `asset.${source.format || "glb"}`;
  const ext = (path.split(".").pop() || "glb").toLowerCase();
  const filename = `${sanitizeFilename(assetName || manifest?.name)}.${ext}`;

  let blob: Blob;
  if (ext === "gltf") {
    // Composite glTFs reference ipfs:// buffers — inline them as data URIs
    // so the download is self-contained.
    const composite = await getFromRemoteIPFS(source.cid);
    blob = await getCore().compose(composite);
  } else {
    blob = await getBlobFromRemoteIPFS(source.cid);
  }

  saveBlob(blob, filename);
  announceStatus(`Downloaded ${filename}`);
  return filename;
}

/**
 * Download the source model of the asset currently open in the Studio.
 * @returns the filename the browser was told to save
 */
export async function downloadActiveAsset(): Promise<string> {
  const { activeAssetManifestCid, activeAssetName } = getAssetState();
  if (!activeAssetManifestCid) {
    throw new Error("No asset is open.");
  }
  return downloadAssetByManifestCid(
    activeAssetManifestCid,
    activeAssetName || undefined
  );
}
