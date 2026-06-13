/**
 * Arbesk Scene Graph — Shared State
 *
 * Mutable module-level state shared across engine sub-modules.
 * Uses an object wrapper because ESM imported bindings are read-only.
 */

export const DEFAULT_WOOD_COLOR = "#C19A6B";
export const MAX_CHILD_WORLD_DEPTH = 5;
export const PLACEHOLDER_COLOR = "#E8D5B7";
export const ERROR_PLACEHOLDER_COLOR = "#CC6666";

export const state = {
  /** @type {BABYLON.Engine} */
  engine: null,
  /** @type {BABYLON.Scene} */
  scene: null,
  /** @type {Map<string, BABYLON.TransformNode>} */
  nodeAnchors: new Map(),
  /** @type {Map<string, BABYLON.AbstractMesh[]>} */
  nodeMeshes: new Map(),
  /** @type {BABYLON.TransformNode|null} */
  rootSceneAnchor: null,
  /** @type {Array<Object>} */
  pendingChildRefs: [],
  /**
   * Post-processor edits (color/scale/meshOverrides) accumulated in the
   * inspector but not yet persisted. Keyed by node_id. Picked up by
   * `asset-save.js → prepareManifestForWrite` and cleared on save.
   * For decomposed glTFs, edits are baked into the composite JSON;
   * for monolithic glTFs, they're stored as `node.post_processor`.
   * @type {Map<string, {color?: string, scale?: {x:number,y:number,z:number}, meshOverrides?: object}>}
   */
  pendingPostProcessorEdits: new Map(),
  /** @type {BABYLON.StandardMaterial|null} */
  defaultWoodMaterial: null,
  /** @type {Function|null} */
  resizeEngineHandler: null,
  /** @type {ResizeObserver|null} */
  resizeObserverInstance: null,
  /** @type {Function|null} */
  pointerObservableCallback: null,
  /** @type {BABYLON.HighlightLayer|null} */
  highlightLayer: null,
  /** @type {string|null} */
  highlightedNodeId: null,
  /** @type {string|null} Name of the currently selected sub-mesh within highlightedNodeId */
  highlightedSubMeshName: null,
  /** @type {BABYLON.ArcRotateCamera|null} */
  camera: null,
  /** @type {BABYLON.GizmoManager|null} */
  gizmoManager: null,
  /** @type {'translate' | 'rotate' | 'scale' | null} */
  transformMode: null,
};
