/**
 * Library operations - create collections and upload desktop files.
 *
 * These helpers run in the browser, reuse the existing IPFS writers, and
 * anchor changes on-chain via the wallet contract. They deliberately do not
 * import the Studio save module so the Library page stays lightweight.
 *
 * Every upload (glTF, GLB, 3MF) is decomposed into its canonical stored form
 * at upload time — composite.gltf / composite.3mf.json — via the same format
 * handlers the Studio save path uses (lazy-imported from formats/index.js),
 * so Library uploads and Studio-saved assets are stored identically.
 */

import { writeToIPFS, writeJSONToIPFS } from "../ipfs/write-to-ipfs.ts";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  publishAsset,
  CollaboratorRole,
} from "../blockchain/wallet.ts";
import { computeRoot, saveEditorList } from "@arbesk/asset-core/domain/editors.js";
import { updateCollectionManifest } from "./asset-delete.ts";
import { walletState } from "../state/wallet-state.ts";
import {
  deriveNamedCollectionId,
  identityMatrix,
} from "@arbesk/asset-core/utils/collections.js";
import { log, warn } from "../utils/log.ts";

function ts(): string {
  return new Date().toLocaleTimeString();
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["glb", "gltf", "3mf"]);

function getContract(): any {
  return walletState.get().contract;
}

function requireWallet(): string {
  const { walletAddress } = walletState.get();
  if (!walletAddress) throw new Error("Not signed in");
  return walletAddress;
}

/**
 * Create a new named collection for the current wallet.
 *
 * `onPending` is invoked once the collection manifest has been written to IPFS
 * but before the (potentially several-second) mint transaction is sent, so the
 * caller can render an optimistic card. It is not called when the collection
 * already exists on-chain.
 */
export async function createNamedCollection(
  name: string,
  { onPending }: { onPending?: (info: { tokenId: string; manifestCid: string }) => void } = {}
): Promise<{ tokenId: string; manifestCid: string; isNew: boolean }> {
  const start = performance.now();
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Collection name is required");

  const walletAddr = requireWallet();
  const c = getContract();
  if (!c) throw new Error("Contract not ready");

  const tokenIdHex = deriveNamedCollectionId(walletAddr, trimmed);
  // Library state stores token ids as decimal strings (matching on-chain event values).
  const tokenId = BigInt(tokenIdHex as string).toString();

  // If this wallet+name collection was already minted, return the existing one
  // instead of failing with TokenAlreadyMinted. Both calls revert for a
  // non-existent token, so run them together to save an RPC round trip.
  try {
    const [, existingCid] = await Promise.all([
      c.methods.ownerOf(tokenId).call(),
      c.methods.tokenURI(tokenId).call(),
    ]);
    return { tokenId, manifestCid: existingCid, isNew: false };
  } catch {
    // Token does not exist - proceed to mint.
  }

  const collectionManifest = {
    type: "collection",
    name: trimmed,
    asset_id: `collection_${Date.now()}`,
    version: 1,
    timestamp: Date.now(),
    assets: {},
    prev_asset_manifest_cid: null,
  };

  const collectionCid = await writeJSONToIPFS(collectionManifest, null as any, {
    type: "collection",
    assetId: collectionManifest.asset_id,
  });
  log(`[LIBRARY-OPS] collection manifest → ${collectionCid}`);

  const editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  const editorRoot = computeRoot(editorList, tokenId, 1);

  // Persist the editor list to IPFS and record its CID on-chain. localStorage
  // only caches the list; the contract's editorListURI is the source of truth.
  const editorListUri = await writeJSONToIPFS(editorList, null as any, {
    compress: true,
    type: "editors",
    assetId: `token_${tokenId}_v1`,
  });
  if (!editorListUri) throw new Error("Failed to persist editor list to IPFS");
  saveEditorList(tokenId, editorList, editorListUri);

  // Surface the (deterministic) token id + manifest CID before the mint so the
  // UI can show an optimistic "minting" card while the transaction settles.
  if (typeof onPending === "function") {
    try {
      onPending({ tokenId, manifestCid: collectionCid });
    } catch (e) {
      warn("[LIBRARY-OPS] onPending callback threw:", (e as Error).message);
    }
  }

  const txHash = await publishAsset(
    collectionCid,
    tokenId,
    editorRoot,
    editorListUri
  );
  if (!txHash) throw new Error("Publish collection transaction failed");

  log(`[${ts()}] [LIBRARY-OPS] minted collection token ${tokenId} (hex ${tokenIdHex}) → ${txHash} (${Math.round(performance.now() - start)}ms total)`);
  return { tokenId, manifestCid: collectionCid, isNew: true };
}

function fileExtension(filename: string): string {
  const parts = (filename || "").split(".");
  return parts.length > 1 ? (parts.pop() || "").toLowerCase() : "";
}

export function baseNameWithoutExtension(filename: string): string {
  const ext = fileExtension(filename);
  if (!ext) return filename || "Uploaded Asset";
  return filename.slice(0, -ext.length - 1) || "Uploaded Asset";
}

export function validateUploadFile(file: File): string {
  if (!file) throw new Error("No file selected");
  const ext = fileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type .${ext}. Please upload .glb, .gltf, or .3mf.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large. Maximum size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
  return ext;
}

/**
 * Decompose an uploaded source into its canonical stored form — the same
 * transformation the Studio save/publish path runs via the format handlers
 * (composite.gltf for glTF/GLB, composite.3mf.json for 3MF). Best-effort,
 * mirroring Studio's save: on failure the raw upload is kept — every handler's
 * load() accepts the raw form, and a later Studio save retries decompose.
 *
 * @param assetManifest - Freshly built single-node upload manifest.
 */
async function decomposeUploadSource(assetManifest: any): Promise<void> {
  const node = assetManifest.scene?.nodes?.[0];
  if (!node?.source?.cid) return;
  try {
    // Lazy import: keeps the decompose chain (and its worker pool) out of the
    // Library page's initial module graph — same pattern as the 3MF handler.
    const { resolveFormatHandler } = await import("../formats/index.ts");
    const handler = resolveFormatHandler(node.source);
    if (handler.isStoredForm(node)) return;
    const result = await handler.decomposeForSave(node, {
      assetName: assetManifest.name,
      assetId: assetManifest.asset_id,
    });
    if (!result) return;
    node.source.cid = result.cid;
    node.source.path = result.path;
    if (result.format) node.source.format = result.format;
    log(`[LIBRARY-OPS] decomposed upload → ${result.cid} (${result.path})`);
  } catch (err) {
    warn(
      `[LIBRARY-OPS] decompose at upload failed, keeping raw source: ${(err as Error).message}`
    );
  }
}

/**
 * Validate, upload, and decompose a desktop glTF/GLB/3MF file into its
 * canonical stored form, returning the staged node source (post-decompose
 * values). Shared by uploadFileToCollection and the Studio viewport
 * file-drop flow so both store sources identically.
 *
 * @param ctx - decompose context
 */
export async function stageUploadSource(file: File, { assetName, assetId }: { assetName?: string; assetId?: string } = {}): Promise<{ cid: string; path: string; format: string }> {
  const format = validateUploadFile(file);
  const arrayBuffer = await file.arrayBuffer();
  const sourceCid = await writeToIPFS(
    new Uint8Array(arrayBuffer),
    file.name
  );
  log(`[LIBRARY-OPS] uploaded source asset → ${sourceCid}`);

  // Decompose via a scratch single-node manifest; mutates node.source in place.
  const scratchNode = {
    node_id: "node_1",
    source: { cid: sourceCid, path: file.name, format },
  };
  await decomposeUploadSource({
    name: assetName || baseNameWithoutExtension(file.name),
    asset_id: assetId || `asset_${Date.now()}`,
    scene: { nodes: [scratchNode] },
  });
  return scratchNode.source;
}

/**
 * Upload a desktop glTF/GLB/3MF file into an existing collection. The source
 * is decomposed to its canonical stored form before the manifest is written.
 *
 * @param options -
 *   stepped progress updates for the UI (no fake animation: real stages only)
 */
export async function uploadFileToCollection(
  file: File,
  collectionTokenId: string | number,
  { onStage }: { onStage?: (fraction: number, label: string) => void } = {}
): Promise<{ assetId: string; assetManifestCid: string; newCollectionCid: string }> {
  if (!collectionTokenId) throw new Error("Open a collection first to upload into it");

  requireWallet();
  const c = getContract();
  if (!c) throw new Error("Contract not ready");

  const assetId = `asset_${Date.now()}`;
  const assetName = baseNameWithoutExtension(file.name);

  onStage?.(0.1, `Uploading ${file.name} to IPFS…`);
  const source = await stageUploadSource(file, { assetName, assetId });

  onStage?.(0.55, "Writing asset manifest…");
  const assetManifest = {
    type: "asset",
    name: assetName,
    asset_id: assetId,
    version: 1,
    timestamp: Date.now(),
    scene: {
      nodes: [
        {
          node_id: "node_1",
          type: "source_asset",
          name: assetName,
          source,
          transform_matrix: identityMatrix(),
          post_processor: {
            color: null,
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
    },
  };

  const assetManifestCid = await writeJSONToIPFS(assetManifest, null as any, {
    type: "asset",
    assetId,
  });
  log(`[LIBRARY-OPS] uploaded asset manifest → ${assetManifestCid}`);

  onStage?.(0.8, "Updating collection on-chain…");
  const newCollectionCid = await updateCollectionManifest(
    collectionTokenId,
    (col) => {
      col.assets = { ...(col.assets || {}) };
      col.assets[assetId] = assetManifestCid;
      return col;
    },
    { label: "upload asset" }
  );

  log(`[LIBRARY-OPS] added ${assetId} to collection ${collectionTokenId} → ${newCollectionCid}`);

  // Surface the uploaded model in the Studio chat as an actionable bubble
  // (Retopo/Retexture/Auto-rig/Animate run off its staged source CID).
  emit(EVENTS.ASSET_FILE_STAGED, {
    name: assetName,
    source,
    assetManifestCid,
  });

  return { assetId, assetManifestCid, newCollectionCid };
}
