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
  /** @type {BABYLON.StandardMaterial|null} */
  defaultWoodMaterial: null,
  /** @type {Function|null} */
  resizeEngineHandler: null,
  /** @type {ResizeObserver|null} */
  resizeObserverInstance: null,
  /** @type {Function|null} */
  pointerObservableCallback: null,
};
