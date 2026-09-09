/**
 * Type declarations for vendored bundles copied into dist at build time.
 *
 * The runtime loads these via relative paths, so we map those paths to the
 * types of the underlying packages.
 */

declare module "*/vendor/gltf-transform-core-4.1.2.js" {
  export * from "@gltf-transform/core";
}

declare module "*/vendor/workerpool-10.0.2.mjs" {
  import workerpool from "workerpool";
  export default workerpool;
  export * from "workerpool";
}
