// @ts-check
/**
 * Dummy/template format handler.
 *
 * This handler is intentionally NOT imported by `formats/index.js`.
 * It exists as a copy-paste template for adding real formats (e.g. 3MF)
 * and is registered only inside its own test to prove the extension point.
 */

/** @typedef {import("../registry.js").FormatHandler} FormatHandler */

/**
 * Factory so tests can inject spies.
 *
 * @returns {FormatHandler}
 */
export function createExampleFormatHandler() {
  return {
    format: "example",
    extensions: [".example"],

    /**
     * Sniff bytes to decide if this handler owns a raw file.
     * Optional: omit if the format is only identified by `src.format`.
     */
    sniff(bytes) {
      return (
        bytes.length >= 7 &&
        new TextDecoder().decode(bytes.slice(0, 7)) === "EXAMPLE"
      );
    },

    /**
     * Load the asset into the Babylon scene.
     *
     * Real implementation would fetch the source bytes, convert to a
     * Babylon-loadable form (e.g. glTF Blob), then call ctx.importFromBlob.
     *
     * @param {any} src
     * @param {import("../registry.js").FormatLoadContext} ctx
     */
    async load(src, ctx) {
      console.log(`[EXAMPLE] load called for cid=${ctx.cid}`);
      return { meshes: [], transformNodes: [] };
    },

    /**
     * Prepare the source for persistence.
     *
     * Strategy A: convert to composite glTF and return
     * `{ path: "composite.gltf", format: "gltf" }`.
     *
     * Strategy B: keep the native format and return
     * `{ path: "asset.example", format: "example" }`.
     * The loader must then know how to load that stored form.
     *
     * @param {any} node
     * @param {import("../registry.js").FormatSaveContext} ctx
     */
    async decomposeForSave(node, ctx) {
      console.log(
        `[EXAMPLE] decompose called | cid=${node.source.cid} asset=${ctx.assetName}`
      );
      return {
        cid: node.source.cid,
        path: "asset.example",
        format: "example",
      };
    },

    /**
     * Predicate: does this node already point to the stored form?
     */
    isStoredForm(node) {
      return (
        node.source?.format === "example" &&
        node.source?.path === "asset.example"
      );
    },

    /**
     * Optional: contribute this node to the hash->CID dedup map.
     */
    isDedupSource() {
      return false;
    },
  };
}
