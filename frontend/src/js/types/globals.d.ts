/**
 * Minimal ambient declarations for libraries loaded via CDN script tags.
 *
 * These are intentionally broad (`any`) because the project does not pull
 * Babylon.js, Web3, or IpfsHttpClient from npm, so full type packages are
 * not available. Keep this file small and only declare globals that are
 * actually referenced by the checked source files.
 */

declare const Web3: any;
declare const IpfsHttpClient: any;

declare namespace BABYLON {
  type Engine = any;
  type Scene = any;
  type TransformNode = any;
  type Mesh = any;
  type AbstractMesh = any;
  type PointerInfo = any;
  type ArcRotateCamera = any;
  type GizmoManager = any;
  type HighlightLayer = any;
  type StandardMaterial = any;
  type Color3 = any;
  type Color4 = any;
  type Vector3 = any;
  type Camera = any;
  type HemisphericLight = any;
  type DirectionalLight = any;
}

declare const BABYLON: any;
