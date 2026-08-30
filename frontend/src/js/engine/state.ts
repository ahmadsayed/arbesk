/**
 * Arbesk Scene Graph - Shared State
 *
 * Mutable module-level state shared across engine sub-modules.
 * Uses an object wrapper because ESM imported bindings are read-only.
 */

export const DEFAULT_WOOD_COLOR = "#C19A6B";
export const MAX_CHILD_ASSET_DEPTH = 5;
export const PLACEHOLDER_COLOR = "#E8D5B7";
export const ERROR_PLACEHOLDER_COLOR = "#CC6666";

export interface PendingPostProcessorEdit {
  color?: string;
  scale?: { x: number; y: number; z: number };
  meshOverrides?: object;
}

export interface PendingSourceOverride {
  source: { cid: string; path: string; format: string };
  name: string;
}

export interface CollectionRef {
  chainId: number;
  contractAddress: string;
  tokenId: string;
}

export type TransformMode = "translate" | "rotate" | "scale" | "time" | null;

export interface EngineState {
  engine: BABYLON.Engine;
  scene: BABYLON.Scene;
  nodeAnchors: Map<string, BABYLON.TransformNode>;
  nodeMeshes: Map<string, BABYLON.AbstractMesh[]>;
  nodeAnimationGroups: Map<string, BABYLON.AnimationGroup[]>;
  rootSceneAnchor: BABYLON.TransformNode | null;
  pendingChildRefs: Array<any>;
  /**
   * node_ids of saved child_ref nodes the user unlinked this session. Applied
   * by manifest-builder after the prevManifest snapshot (symmetric to pending
   * adds) and cleared on save. Unsaved (pending) unlinks splice
   * pendingChildRefs directly and never touch this set.
   */
  pendingChildRefRemovals: Set<string>;
  /**
   * Post-processor edits (color/scale/meshOverrides) accumulated in the
   * inspector but not yet persisted. Keyed by node_id. Picked up by
   * `asset-save.js → prepareManifestForWrite` and cleared on save.
   * For decomposed glTFs, edits are baked into the composite JSON;
   * for monolithic glTFs, they're stored as `node.post_processor`.
   */
  pendingPostProcessorEdits: Map<string, PendingPostProcessorEdit>;
  defaultWoodMaterial: BABYLON.StandardMaterial | null;
  resizeEngineHandler: EventListenerOrEventListenerObject | null;
  resizeObserverInstance: ResizeObserver | null;
  /** The render-loop callback, stored so the router can pause/resume it on SPA view changes. */
  renderLoopFn: (() => void) | null;
  pointerObservableCallback: ((pointerInfo: BABYLON.PointerInfo) => void) | null;
  highlightLayer: BABYLON.HighlightLayer | null;
  highlightedNodeId: string | null;
  /** Name of the currently selected sub-mesh within highlightedNodeId */
  highlightedSubMeshName: string | null;
  /**
   * The full multi-selection set. `highlightedNodeId` is the primary
   * (last-added) member; single-node consumers (inspector, sub-mesh toggle,
   * model clock) should only act when this set has exactly one entry.
   */
  selectedNodeIds: Set<string>;
  camera: BABYLON.ArcRotateCamera | null;
  gizmoManager: BABYLON.GizmoManager | null;
  transformMode: TransformMode;
  /**
   * True while the move/rotate/scale gizmo is being dragged. Legacy: the model
   * clock used to read this to suppress its per-frame update, but Time mode is
   * now mutually exclusive with the transform gizmos, so only transform-gizmo
   * code should set or inspect this flag.
   */
  isGizmoDragging: boolean;
  /**
   * Transform edits (move/rotate/scale) accumulated by the viewport gizmo
   * but not yet persisted. Keyed by node_id. Picked up by
   * `asset-save.js → prepareManifestForWrite` and cleared on save.
   * Value is a 16-element column-major transform_matrix array.
   */
  pendingTransformEdits: Map<string, number[]>;
  /**
   * Viewport file-drop source overrides staged but not yet persisted.
   * Keyed by node_id. Picked up by `asset-save.js → prepareManifestForWrite`
   * (replaces the node's source and resets its post_processor) and cleared
   * on save.
   */
  pendingSourceOverrides: Map<string, PendingSourceOverride>;
  /**
   * The `assets` map of the collection currently open in the Studio.
   * Populated by loadCollectionManifest(); used to resolve `child_ref`
   * nodes whose `collection` field is `"self"`.
   */
  activeCollectionAssets: Record<string, any> | null;
  /** Identity of the collection currently open in the Studio. */
  activeCollectionRef: CollectionRef | null;
  /**
   * The assetID of the asset manifest currently being loaded/rendered
   * within the active collection. Used to reject direct self-references
   * (collection:"self" pointing at the same assetID being resolved).
   */
  activeCollectionCurrentAssetID: string | null;
  /** Cached non-chrome meshes for frameAll/frameSelected */
  _nonChromeMeshCache: BABYLON.AbstractMesh[] | null;
}

export const state: EngineState = {
  engine: null,
  scene: null,
  nodeAnchors: new Map(),
  nodeMeshes: new Map(),
  nodeAnimationGroups: new Map(),
  rootSceneAnchor: null,
  pendingChildRefs: [],
  pendingChildRefRemovals: new Set(),
  pendingPostProcessorEdits: new Map(),
  defaultWoodMaterial: null,
  resizeEngineHandler: null,
  resizeObserverInstance: null,
  renderLoopFn: null,
  pointerObservableCallback: null,
  highlightLayer: null,
  highlightedNodeId: null,
  highlightedSubMeshName: null,
  selectedNodeIds: new Set(),
  camera: null,
  gizmoManager: null,
  transformMode: null,
  isGizmoDragging: false,
  pendingTransformEdits: new Map(),
  pendingSourceOverrides: new Map(),
  activeCollectionAssets: null,
  activeCollectionRef: null,
  activeCollectionCurrentAssetID: null,
  _nonChromeMeshCache: null,
};
