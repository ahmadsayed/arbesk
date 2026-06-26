/**
 * Type declarations for globals loaded via CDN script tags in the Pug templates.
 *
 * These are intentionally loose (`any`) to get the type-checker running quickly
 * without fighting Babylon.js / Web3 / IPFS global shapes. Tighten them later
 * if needed (e.g. install `babylonjs` or `@types/web3`).
 */

declare const BABYLON: any;
declare const Web3: any;
declare const IpfsHttpClient: any;

declare namespace BABYLON {
  export type AbstractMesh = any;
  export type Animation = any;
  export type ArcRotateCamera = any;
  export type Camera = any;
  export type Color3 = any;
  export type Color4 = any;
  export type DirectionalLight = any;
  export type Engine = any;
  export type GizmoManager = any;
  export type HemisphericLight = any;
  export type HighlightLayer = any;
  export type Matrix = any;
  export type MeshBuilder = any;
  export type PointerEventTypes = any;
  export type Quaternion = any;
  export type Scene = any;
  export type SceneLoader = any;
  export type StandardMaterial = any;
  export type TransformNode = any;
  export type Vector3 = any;
}

interface Window {
  ethereum?: any;
  web3?: any;
  Web3?: any;
  __ARBESK_CONFIG__?: any;
}
