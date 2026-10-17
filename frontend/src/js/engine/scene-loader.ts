/**
 * Handles IPFS asset loading, manifest parsing, token child asset resolution,
 * collection manifest loading, and drag/drop linked asset composition.
 */

import { resolveFormatHandler } from "../formats/index.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { normalizeLegacy3mfPlacements } from "./legacy-3mf-placement.ts";
import {
  resolveChildRef,
  resolveCollectionChildRef,
  clearResolutionCache,
} from "../blockchain/token-resolver.ts";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { activateAssetManifest, getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../state/wallet-state.ts";
import { selectNodeById } from "./scene-selection.ts";
import { state, MAX_CHILD_ASSET_DEPTH } from "./state.ts";
import type { CollectionRef } from "./state.ts";
import {
  extractCid,
  getManifestNodes,
  applyTransformMatrix,
  applyDefaultMaterial,
  centerImportedAsset,
} from "./transforms.ts";
import { createPlaceholder, disposePlaceholder } from "./placeholders.ts";
import { applyColor, applyScale } from "./time-travel.ts";
import { clearScene, disposeNodeContent, disposeNodeSubtree } from "./cleanup.ts";
import { createAnchorNode } from "./anchor-node.ts";
import { identityMatrix } from "@arbesk/asset-core/utils/collections.js";
import { notifyPendingEditsChanged } from "../state/unsaved-changes.ts";

/**
 * @param src - source string or `{cid, path?, format?}` reference
 */
async function loadAsset(
  src: any,
  parentNode: BABYLON.TransformNode,
  nodeId: string,
  onProgress: ((fraction: number) => void) | null = null
): Promise<BABYLON.AbstractMesh[]> {
  const cid = extractCid(src);
  const handler = resolveFormatHandler(src);
  console.log(`[SCENE] loadAsset nodeId=${nodeId} cid=${cid} format=${handler.format}`);

  try {
    const result = await handler.load(src, {
      scene: state.scene,
      cid,
      importFromBlob,
      onProgress: onProgress ?? undefined,
    });
    attachMetadata(
      result.meshes,
      nodeId,
      parentNode,
      result.transformNodes || [],
      result.animationGroups || []
    );
    return result.meshes;
  } catch (error) {
    console.error(`[SCENE] FAILED to load asset for node ${nodeId}:`, error);
    const box = BABYLON.MeshBuilder.CreateBox(
      `placeholder_${nodeId}`,
      { size: 1 },
      state.scene
    );
    box.parent = parentNode;
    box.metadata = { nodeId, loadFailed: true };
    applyDefaultMaterial([box]);
    return [box];
  }
}

async function importFromBlob(blob: Blob, extension: string) {
  const blobUrl = URL.createObjectURL(blob);
  try {
    const result = await BABYLON.SceneLoader.ImportMeshAsync(
      "",
      blobUrl,
      "",
      state.scene,
      null,
      extension
    );
    return {
      meshes: result.meshes,
      transformNodes: result.transformNodes || [],
      animationGroups: result.animationGroups || [],
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function attachMetadata(
  meshes: BABYLON.AbstractMesh[],
  nodeId: string,
  parentNode: BABYLON.TransformNode,
  transformNodes: BABYLON.TransformNode[] = [],
  animationGroups: BABYLON.AnimationGroup[] = []
) {
  const meshArray: BABYLON.AbstractMesh[] = [];
  const importedNodes = [...transformNodes, ...meshes];

  for (const transformNode of transformNodes) {
    if (transformNode.parent === null) {
      transformNode.parent = parentNode;
    }
    transformNode.metadata = {
      ...(transformNode.metadata || {}),
      nodeId,
      isNodeRoot: transformNode.parent === parentNode,
    };
  }

  for (const mesh of meshes) {
    if (mesh.parent === null) {
      mesh.parent = parentNode;
    }
    mesh.metadata = {
      ...(mesh.metadata || {}),
      nodeId,
      isNodeRoot: mesh.parent === parentNode,
    };
    meshArray.push(mesh);
  }

  centerImportedAsset(meshArray, importedNodes, parentNode, nodeId);
  state.nodeMeshes.set(nodeId, meshArray);
  if (animationGroups.length > 0) {
    state.nodeAnimationGroups.set(nodeId, animationGroups);
  }
  state._nonChromeMeshCache = null;
}

type ChildRefResolutionPlan =
  | { kind: "invalid" }
  | {
      kind: "same-collection";
      assetID: string;
      assetsMap: Record<string, any> | null;
    }
  | {
      kind: "cross-collection-asset";
      collectionRef: any;
      assetID: string;
    };

/**
 * Decides how a node's child_ref is resolved: same-collection lookup or
 * cross-collection asset lookup.
 * @remarks Pure decision logic — no I/O.
 */
function buildChildRefResolutionPlan(
  childRef: any,
  activeCollectionAssets: Record<string, any> | null
): ChildRefResolutionPlan {
  if (!childRef) return { kind: "invalid" };

  if (childRef.assetID) {
    if (childRef.collection === "self") {
      return {
        kind: "same-collection",
        assetID: childRef.assetID,
        assetsMap: activeCollectionAssets,
      };
    }
    if (childRef.collection && childRef.collection.tokenId) {
      return {
        kind: "cross-collection-asset",
        collectionRef: childRef.collection,
        assetID: childRef.assetID,
      };
    }
  }

  return { kind: "invalid" };
}

// ═══════════════════════════════════════════════════════════════════════════
// Token child asset loading
// ═══════════════════════════════════════════════════════════════════════════

async function loadTokenChildNode(
  node: any,
  anchor: BABYLON.TransformNode,
  depth: number,
  resolvingCids: Set<string>
): Promise<BABYLON.AbstractMesh[]> {
  const childRef = node.child_ref;
  if (!childRef) return [];

  if (depth >= MAX_CHILD_ASSET_DEPTH) {
    console.warn(
      `[SCENE] max child asset depth (${MAX_CHILD_ASSET_DEPTH}) reached at node ${node.node_id}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const plan = buildChildRefResolutionPlan(
    childRef,
    state.activeCollectionAssets
  );

  // Same-collection self-reference cycle: a node referencing its own
  // assetID via collection:"self" is always a cycle, independent of depth.
  if (
    plan.kind === "same-collection" &&
    plan.assetID === state.activeCollectionCurrentAssetID
  ) {
    console.warn(
      `[SCENE] self-referencing same-collection child_ref rejected at node ${node.node_id}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const refKey =
    plan.kind === "cross-collection-asset"
      ? `${plan.collectionRef.chainId}:${plan.collectionRef.contractAddress}:${plan.collectionRef.tokenId}:${plan.assetID}`
      : `self:${(plan as any).assetID}`;

  if (resolvingCids.has(refKey)) {
    console.warn(
      `[SCENE] circular child_ref detected at node ${node.node_id}, ref=${refKey}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const loadingPlaceholder = createPlaceholder(node.node_id, anchor, "loading");

  resolvingCids.add(refKey);
  try {
    console.log(
      `[SCENE] resolving child node ${node.node_id} depth=${depth} kind=${plan.kind}`
    );

    let resolution: any;
    if (plan.kind === "invalid") {
      resolution = { resolved: false, error: "Invalid child_ref shape" };
    } else {
      resolution = await resolveCollectionChildRef(
        plan.kind === "same-collection"
          ? { collection: "self", assetID: plan.assetID }
          : { collection: plan.collectionRef, assetID: plan.assetID },
        plan.kind === "same-collection" ? plan.assetsMap : null
      );
    }

    if (resolution.nestedCollectionRef) {
      // assetID resolved to a nested collection, not a direct asset CID:
      // recurse via the cross-collection token path.
      resolution = await resolveChildRef({
        type: "token",
        chainId: resolution.nestedCollectionRef.chainId,
        contractAddress: resolution.nestedCollectionRef.contractAddress,
        tokenId: resolution.nestedCollectionRef.tokenId,
        standard: "ERC721",
        resolution: "latest",
      });
    }

    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] child resolution failed for node ${node.node_id}: ${resolution.error}`
      );
      disposePlaceholder(loadingPlaceholder);
      const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
      return [errorPlaceholder];
    }

    console.log(
      `[SCENE] child node ${node.node_id} resolved → ${resolution.manifestCid}`
    );

    const childAnchor = createAnchorNode(
      `child_anchor_${node.node_id}`,
      state.scene
    );
    childAnchor.parent = anchor;
    childAnchor.metadata = {
      childRef,
      resolvedCid: resolution.manifestCid,
      loaded: true,
      nodeId: node.node_id,
      depth,
    };

    if (!state.nodeAnchors.has(node.node_id)) {
      state.nodeAnchors.set(node.node_id, childAnchor);
    }

    disposePlaceholder(loadingPlaceholder);

    await loadAssetManifest(
      resolution.manifestCid,
      childAnchor,
      depth + 1,
      resolvingCids
    );

    return [];
  } catch (err) {
    console.error(`[SCENE] failed to load child node ${node.node_id}:`, err);
    disposePlaceholder(loadingPlaceholder);
    const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
    return [errorPlaceholder];
  } finally {
    resolvingCids.delete(refKey);
  }
}

async function loadNode(
  node: any,
  parentNode: BABYLON.TransformNode,
  depth: number,
  resolvingCids: Set<string>,
  onProgress: ((fraction: number) => void) | null = null
): Promise<{ anchor: BABYLON.TransformNode; meshes: BABYLON.AbstractMesh[] }> {
  console.log(
    `[SCENE] loadNode node_id=${node.node_id} source=${JSON.stringify(
      node.source
    )} childRef=${!!node.child_ref}`
  );
  const anchor = createAnchorNode(`anchor_${node.node_id}`, state.scene);
  anchor.parent = parentNode;
  applyTransformMatrix(anchor, node.transform_matrix);
  state.nodeAnchors.set(node.node_id, anchor);

  let meshes: BABYLON.AbstractMesh[] = [];

  if (node.child_ref) {
    // Tag the outer anchor with the child_ref so the inspector / dive button
    // can resolve it directly from the manifest node_id. transformMatrix lets
    // reloadChildRefNode rebuild nested nodes that live outside the root
    // manifest (a grandchild ref only exists in the child's manifest).
    anchor.metadata = { nodeId: node.node_id, childRef: node.child_ref, depth: depth || 0, transformMatrix: node.transform_matrix };
    meshes = await loadTokenChildNode(
      node,
      anchor,
      depth || 0,
      resolvingCids || new Set<string>()
    );
    return { anchor, meshes };
  }

  if (node.source) {
    meshes = await loadAsset(node.source, anchor, node.node_id, onProgress);
  } else {
    console.warn(
      `[SCENE] node ${node.node_id} has no source - no geometry to load`
    );
  }

  const pp = node.post_processor;
  if (meshes.length > 0 && pp) {
    applyColor(meshes, pp.color, pp.meshOverrides || null);
    applyScale(meshes, pp.scale);
  }

  return { anchor, meshes };
}

export interface LoadProgressReporter {
  setNodeCount: (count: number) => void;
  setNodeFraction: (nodeId: string, fraction: number) => void;
}

/**
 * @returns the loaded manifest
 */
async function loadAssetManifest(
  manifestCid: string,
  parentAnchor: BABYLON.TransformNode | null = null,
  depth = 0,
  resolvingCids: Set<string> = new Set(),
  reporter: LoadProgressReporter | null = null
): Promise<any> {
  console.log(`[SCENE] loadAssetManifest cid=${manifestCid} depth=${depth}`);

  if (
    !parentAnchor &&
    depth === 0 &&
    (state.rootSceneAnchor ||
      state.nodeMeshes.size > 0 ||
      state.nodeAnchors.size > 0)
  ) {
    clearScene();
  }

  if (depth === 0) {
    clearResolutionCache();
  }

  const manifest = normalizeLegacy3mfPlacements(
    await getFromRemoteIPFS(manifestCid)
  );

  // Collection manifests don't have scene.nodes - delegate to
  // loadCollectionManifest and auto-load the first asset.
  if (manifest?.type === "collection") {
    const { assetEntries } = await loadCollectionManifest(manifestCid, null);
    const firstAsset = assetEntries.find((e) => e.kind === "asset");
    if (firstAsset) {
      return loadAssetManifest(
        firstAsset.value,
        parentAnchor,
        depth,
        resolvingCids,
        reporter
      );
    }
    return manifest;
  }

  console.log(
    `[SCENE] manifest loaded | nodes=${
      getManifestNodes(manifest).length
    } version=${manifest?.version}`
  );
  if (!manifest || getManifestNodes(manifest).length === 0) {
    console.warn("[SCENE] Asset manifest has no scene nodes:", manifestCid);
    return manifest;
  }

  const rootAnchor =
    parentAnchor || createAnchorNode("root_anchor", state.scene);
  if (!parentAnchor) {
    state.rootSceneAnchor = rootAnchor;
  }

  const manifestNodes = getManifestNodes(manifest);
  if (reporter && depth === 0) reporter.setNodeCount(manifestNodes.length);

  await Promise.all(
    manifestNodes.map((node) =>
      // Each sibling branch gets its own copy of the in-progress resolution
      // set: cycle detection only cares about the root→node path, and a
      // shared set would falsely flag two siblings referencing the same
      // asset (duplicate live-ref instances) as circular.
      loadNode(
        node,
        rootAnchor,
        depth,
        new Set(resolvingCids),
        reporter && depth === 0
          ? (f: number) => reporter.setNodeFraction(node.node_id, f)
          : null
      ).then((result) => {
        reporter?.setNodeFraction(node.node_id, 1);
        return result;
      })
    )
  );

  if (!parentAnchor) {
    activateAssetManifest(manifestCid, manifest);
    emit(EVENTS.SCENE_READY, { manifest, manifestCid });
  }

  return manifest;
}

export interface CollectionAssetEntry {
  assetID: string;
  kind: string;
  value: any;
}

/**
 * Loads a collection manifest and populates the active-collection state.
 * @remarks Does NOT render 3D content; returns the manifest plus a flat list
 *   of entries so the user can pick which asset to open.
 */
async function loadCollectionManifest(
  collectionCid: string,
  collectionRef: CollectionRef | null
): Promise<{ manifest: any; assetEntries: CollectionAssetEntry[] }> {
  const manifest = await getFromRemoteIPFS(collectionCid);
  if (!manifest || manifest.type !== "collection") {
    throw new Error(`CID ${collectionCid} is not a collection manifest`);
  }

  state.activeCollectionAssets = manifest.assets || {};
  state.activeCollectionRef = collectionRef || null;

  const assetEntries = Object.entries(manifest.assets || {}).map(
    ([assetID, value]) => ({
      assetID,
      kind: typeof value === "string" ? "asset" : "collection",
      value,
    })
  );

  return { manifest, assetEntries };
}

// ═══════════════════════════════════════════════════════════════════════════
// Drag/drop - linked asset composition
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Computes a unique node_id for a newly dropped linked asset.
 * @remarks Each placement is independently keyed in the state maps so it can
 *   be moved on its own.
 */
function nextLinkedNodeId(
  existingIds: Set<string>,
  tokenId: string,
  assetID: string
): string {
  const base = `linked_${tokenId}_${assetID}`;
  if (!existingIds.has(base)) return base;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffixRe = new RegExp(`^${escaped}_(\\d+)$`);
  let max = 1;
  for (const id of existingIds) {
    const m = suffixRe.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base}_${max + 1}`;
}

export interface LinkedSceneNode {
  node_id: string;
  transform_matrix: number[];
  source?: { cid: string; path?: string; format?: string };
  post_processor?: any;
  child_ref?: object;
}

type ModelSource = { cid: string; path?: string; format?: string };

/** What a fork copies from the child's single model node. */
export interface ForkTemplate {
  source: ModelSource;
  post_processor?: any;
  transform_matrix?: number[];
}

/**
 * The fork node's own copy of the child's model node fields.
 * @remarks Deep copies: the template comes from a cached child manifest.
 */
function forkNodeFields(template: ForkTemplate) {
  const tm = template.transform_matrix;
  return {
    transform_matrix:
      Array.isArray(tm) && tm.length === 16 ? [...tm] : identityMatrix(),
    source: { ...template.source },
    ...(template.post_processor && {
      post_processor: structuredClone(template.post_processor),
    }),
  };
}

/**
 * Builds the scene node added when a user pulls in another collection's asset.
 * @remarks "fork" freezes the child's model node (source, post_processor,
 *   transform_matrix) into a plain source node; "live-ref" embeds a child_ref
 *   so future edits propagate. `nodeId` lets callers reference the same asset
 *   more than once.
 */
function buildForkOrLiveRefNode(
  choice: "fork" | "live-ref",
  ref: { collectionRef: CollectionRef },
  assetID: string,
  resolvedAssetCid: string,
  nodeId?: string,
  forkTemplate?: ForkTemplate
): LinkedSceneNode {
  const resolvedNodeId = nodeId || `linked_${ref.collectionRef.tokenId}_${assetID}`;
  const baseNode = {
    node_id: resolvedNodeId,
    transform_matrix: identityMatrix(),
  };
  if (choice === "fork") {
    return forkTemplate
      ? { node_id: resolvedNodeId, ...forkNodeFields(forkTemplate) }
      : { ...baseNode, source: { cid: resolvedAssetCid } };
  }
  if (choice === "live-ref") {
    return {
      ...baseNode,
      child_ref: { collection: ref.collectionRef, assetID },
    };
  }
  throw new Error(`Unknown fork/live-ref choice: ${choice}`);
}

/**
 * BigInt-safe token id normalization so "0x2a" and "42" compare equal.
 */
function normalizeTokenId(id: any): string {
  if (id == null) return "";
  try {
    return BigInt(id).toString();
  } catch {
    return String(id);
  }
}

/**
 * True when a dropped linked asset is the asset currently open in the Studio.
 * @remarks A live-ref to itself is a guaranteed cycle, so such drops must be
 *   fork-only.
 */
function isSelfLinkedAssetDrop(
  collectionRef: CollectionRef,
  assetID: string
): boolean {
  const active = state.activeCollectionRef;
  if (!active || !state.activeCollectionCurrentAssetID) return false;
  if (assetID !== state.activeCollectionCurrentAssetID) return false;
  if (Number(active.chainId) !== Number(collectionRef.chainId)) return false;
  const activeContract = (active.contractAddress || "").toLowerCase();
  const droppedContract = (collectionRef.contractAddress || "").toLowerCase();
  if (activeContract !== droppedContract) return false;
  return (
    normalizeTokenId(active.tokenId) === normalizeTokenId(collectionRef.tokenId)
  );
}

/**
 * In-flight linked-asset drop operations.
 * @remarks The ASSET_LINKED_DROPPED event is fire-and-forget, so a Save right
 *   after "Add to Scene" could read pendingChildRefs before the drop handler
 *   pushed its node.
 */
const _inFlightLinkedDrops = new Set<Promise<void>>();

/**
 * The model node of a single-model asset manifest, as a fork template.
 * @remarks A fork freezes the model file, not the child's manifest, because
 *   loadAsset needs a {cid, path, format} source; the node's post_processor
 *   (scale compensation, colour overlay) and transform travel with it.
 *   Composite assets (several nodes, or child_refs) cannot be flattened into
 *   one node: returns undefined.
 */
async function readSingleModelNode(
  manifestCid: string
): Promise<ForkTemplate | undefined> {
  const nodes = getManifestNodes(
    normalizeLegacy3mfPlacements(await getFromRemoteIPFS(manifestCid))
  );
  if (nodes.length !== 1 || nodes[0].child_ref || !nodes[0].source) return undefined;
  const { source, post_processor, transform_matrix } = nodes[0];
  return { source, post_processor, transform_matrix };
}

/**
 * Returns the scene's root anchor, creating it when the scene has none yet
 * (an empty draft). The Babylon scene itself is not a valid `parent`.
 */
function ensureRootSceneAnchor(): BABYLON.TransformNode {
  if (!state.rootSceneAnchor) {
    state.rootSceneAnchor = createAnchorNode("root_anchor", state.scene);
  }
  return state.rootSceneAnchor;
}

/**
 * Loads a freshly pushed insert node; on failure undoes the push.
 * @returns a failure reason, or null on success. Throws after rollback if the
 *   load itself throws (the caller's wrapper reports it).
 */
async function loadInsertedNode(
  nodeEntry: any,
  choice: "live-ref" | "fork",
  parentNode: BABYLON.TransformNode
): Promise<string | null> {
  // Undo the optimistic push so a failed insert leaves nothing behind.
  const rollback = (placeholders: BABYLON.Mesh[] = []) => {
    for (const ph of placeholders) disposePlaceholder(ph);
    const idx = state.pendingChildRefs.indexOf(nodeEntry);
    if (idx >= 0) state.pendingChildRefs.splice(idx, 1);
    disposeNodeSubtree(nodeEntry.node_id);
    notifyPendingEditsChanged();
  };
  try {
    // loadTokenChildNode reports depth/cycle/load failures as error
    // placeholders; loadAsset swallows load errors into a flagged box. A fork
    // loads through loadNode, like a saved manifest node, so its transform
    // and post_processor (colour/scale) apply on first load.
    const meshes: any[] =
      choice === "live-ref"
        ? await loadTokenChildNode(nodeEntry, parentNode, 1, new Set())
        : (await loadNode(nodeEntry, parentNode, 0, new Set())).meshes;
    const failed =
      choice === "live-ref"
        ? meshes.length > 0
        : meshes.some((m) => m?.metadata?.loadFailed);
    if (!failed) return null;
    rollback(meshes);
    return "Could not load the asset";
  } catch (err) {
    rollback();
    throw err;
  }
}

/** @param event - ASSET_LINKED_DROPPED event detail */
async function _handleLinkedAssetDropped(event: any) {
  const detail = event;
  if (!detail) return;

  const {
    token_id: tokenId,
    _standard = "ERC721",
    resolution: _resolutionMode = "latest",
    chainId: eventChainId,
    contractAddress: eventContractAddress,
  } = detail;
  if (!tokenId) return;

  if (detail.assetID) {
    const collectionRef = {
      chainId: Number(eventChainId || walletState.get().chainId),
      contractAddress:
        eventContractAddress || walletState.get().contractAddress,
      tokenId,
    };
    const isSelfDrop = isSelfLinkedAssetDrop(collectionRef, detail.assetID);

    // An explicit mode (Assets panel ⋯ / drag) skips the dialog; a self-drop can never
    // be a live-ref, so it is downgraded to a fork instead of refused.
    let choice: "live-ref" | "fork" | null | undefined;
    if (detail.mode) {
      choice = isSelfDrop ? "fork" : detail.mode;
    } else {
      const { showForkOrLiveRefDialog } = await import("../ui/dialog.ts");
      choice = await showForkOrLiveRefDialog(detail.assetID, {
        allowLiveRef: !isSelfDrop,
      });
    }
    if (!choice) return; // user cancelled
    if (isSelfDrop && choice === "live-ref") {
      console.warn(
        `[SCENE] live-ref self-add rejected for asset ${detail.assetID}`
      );
      return;
    }

    const { resolveCollectionChildRef } = await import(
      "../blockchain/token-resolver.ts"
    );
    const resolution = await resolveCollectionChildRef(
      { collection: collectionRef, assetID: detail.assetID },
      null
    );
    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] could not resolve dropped asset ${detail.assetID}: ${resolution.error}`
      );
      emit(EVENTS.ASSET_LINKED_INSERT_FAILED, {
        assetID: detail.assetID,
        reason: resolution.error || "Could not resolve the asset",
      });
      return;
    }

    // Gather every node_id already in play (saved manifest, pending drops,
    // loaded scene) so a repeat drop of the same asset gets its own id and
    // becomes an independent instance instead of replacing the first one.
    const currentManifest = getCurrentManifest();
    const existingIds = new Set([
      ...(currentManifest
        ? getManifestNodes(currentManifest).map((n) => n.node_id)
        : []),
      ...state.pendingChildRefs.map((n) => n.node_id),
      ...state.nodeAnchors.keys(),
    ]);
    let forkTemplate: ForkTemplate | undefined;
    if (choice === "fork") {
      forkTemplate = await readSingleModelNode(resolution.manifestCid);
      if (!forkTemplate) {
        emit(EVENTS.ASSET_LINKED_INSERT_FAILED, {
          assetID: detail.assetID,
          reason: "Insert a copy supports single-model assets only",
        });
        return;
      }
    }
    const nodeEntry = buildForkOrLiveRefNode(
      choice,
      { collectionRef },
      detail.assetID,
      resolution.manifestCid,
      nextLinkedNodeId(existingIds, tokenId, detail.assetID),
      forkTemplate
    );
    state.pendingChildRefs.push(nodeEntry);
    notifyPendingEditsChanged();

    const failure = await loadInsertedNode(
      nodeEntry,
      choice,
      ensureRootSceneAnchor()
    );
    if (failure) {
      emit(EVENTS.ASSET_LINKED_INSERT_FAILED, {
        assetID: detail.assetID,
        reason: failure,
      });
      return;
    }
    emit(EVENTS.ASSET_LINKED_INSERTED, {
      nodeId: nodeEntry.node_id,
      assetID: detail.assetID,
      mode: choice,
    });
    selectNodeById(nodeEntry.node_id);
    return;
  }

  // Legacy drops without assetID are no longer supported - the caller must
  // include an assetID so the drop handler can route through the collection
  // resolution path above.
  console.warn(
    `[SCENE] linked asset drop ignored: no assetID for token #${tokenId}`
  );
}

/**
 * Event-bus entry point for ASSET_LINKED_DROPPED.
 * @remarks Tracks the async work so save/publish can wait for it.
 * @param event ASSET_LINKED_DROPPED event detail
 */
function handleLinkedAssetDropped(event: any): Promise<void> {
  const p = _handleLinkedAssetDropped(event)
    .catch((err) => {
      console.warn("[SCENE] linked asset drop failed:", err?.message || err);
      emit(EVENTS.ASSET_LINKED_INSERT_FAILED, {
        assetID: event?.assetID ?? null,
        reason: err?.message || String(err),
      });
    })
    .finally(() => {
      _inFlightLinkedDrops.delete(p);
    });
  _inFlightLinkedDrops.add(p);
  return p;
}

/**
 * Resolves once every linked-asset drop started so far has finished.
 */
async function waitForPendingLinkedDrops() {
  await Promise.all([..._inFlightLinkedDrops]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Drag/drop - OS file source override
// ═══════════════════════════════════════════════════════════════════════════

export interface AssetSourceRef {
  cid: string;
  path: string;
  format: string;
}

/**
 * Replaces the model of an existing root node in place.
 * @remarks The node's anchor is kept because it carries the transform.
 * @returns false when the node has no live anchor.
 */
async function replaceRootModelSource(
  nodeId: string,
  source: AssetSourceRef
): Promise<boolean> {
  const anchor = state.nodeAnchors.get(nodeId);
  if (!anchor) {
    console.warn(`[SCENE] file-drop override ignored: no anchor for ${nodeId}`);
    return false;
  }
  disposeNodeContent(nodeId);
  await loadAsset(source, anchor, nodeId);
  return true;
}

/**
 * Creates a fresh single-node draft scene from a dropped file.
 */
async function createRootDraftSource(nodeId: string, source: AssetSourceRef) {
  const anchor = createAnchorNode(`anchor_${nodeId}`, state.scene);
  anchor.parent = ensureRootSceneAnchor();
  state.nodeAnchors.set(nodeId, anchor);
  await loadAsset(source, anchor, nodeId);
}

export {
  loadAsset,
  loadNode,
  loadAssetManifest,
  loadCollectionManifest,
  buildForkOrLiveRefNode,
  nextLinkedNodeId,
  handleLinkedAssetDropped,
  waitForPendingLinkedDrops,
  replaceRootModelSource,
  createRootDraftSource,
  ensureRootSceneAnchor,
};

/** Tears down and re-resolves a single child_ref node in place. */
export async function reloadChildRefNode(nodeId: string): Promise<void> {
  const anchor = state.nodeAnchors.get(nodeId);
  const meta = (anchor?.metadata as any) || {};
  // Root-manifest node is authoritative (its transform may have been edited);
  // nested refs (a child_ref inside a referenced child's manifest) exist only
  // as anchor metadata, so rebuild a loadable node from it.
  const manifestNode = getManifestNodes(getCurrentManifest()).find(
    (n: any) => n?.node_id === nodeId && n?.child_ref
  );
  const childRef = manifestNode?.child_ref ?? meta.childRef;
  if (!anchor || !childRef) return;
  const node = manifestNode ?? {
    node_id: nodeId,
    child_ref: childRef,
    transform_matrix: meta.transformMatrix,
  };
  const parent = anchor.parent;
  const depth = meta.depth ?? 0;
  disposeNodeSubtree(nodeId);
  await loadNode(node, parent as BABYLON.TransformNode, depth, new Set<string>());
}
