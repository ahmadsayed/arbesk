/**
 * Minimal ambient declarations for libraries loaded via CDN script tags.
 * @remarks Declarations are broad (`any`) because Babylon.js and IpfsHttpClient
 *   come from CDNs, not npm, so full type packages are unavailable. Keep this
 *   file small and only declare globals the checked sources reference.
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
