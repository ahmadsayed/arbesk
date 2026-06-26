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

/**
 * WalletConnect provider is loaded dynamically from CDN URLs in the browser.
 * The exact URL is pinned at runtime; treat it as an opaque default export.
 */
declare module "https://esm.sh/*" {
  const provider: any;
  export default provider;
}

declare module "https://cdn.jsdelivr.net/*" {
  const provider: any;
  export default provider;
}
