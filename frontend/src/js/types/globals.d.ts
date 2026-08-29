/**
 * Minimal ambient declarations for libraries loaded via CDN script tags.
 *
 * These are intentionally broad (`any`) because the project does not pull
 * Babylon.js or IpfsHttpClient from npm, so full type packages are
 * not available. Keep this file small and only declare globals that are
 * actually referenced by the checked source files.
 */

declare const IpfsHttpClient: any;

declare namespace BABYLON {
  type Engine = any;
  type Scene = any;
  type TransformNode = any;
  type Matrix = any;
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
  type AnimationGroup = any;
}

declare const BABYLON: any;

// Loaded via the importmap in app.pug; no bundled type declarations.
declare module "alpinejs";
