/**
 * Format-handler registry.
 *
 * Cycle-proof root: this file must not import any project modules.
 * Handlers are plain objects keyed by canonical lowercase format name.
 */

/**
 * @typedef {Object} FormatLoadContext
 * @property {any} scene - Babylon scene instance
 * @property {string} cid - CID being loaded
 * @property {(blob: Blob, extension: string) => Promise<{meshes: any[], transformNodes?: any[]}>} importFromBlob
 */

/**
 * @typedef {Object} FormatSaveContext
 * @property {string} assetName
 * @property {string} assetId
 * @property {Map<string, string>} [dedupMap]
 */

/**
 * @typedef {Object} FormatDecomposeResult
 * @property {string} cid
 * @property {string} path
 * @property {string} [format]
 * @property {boolean} [normalizeOnly]
 */

/**
 * @typedef {Object} FormatHandler
 * @property {string} format - canonical lowercase key (e.g. "gltf", "glb")
 * @property {string[]} extensions - file extensions (e.g. [".glb"])
 * @property {(bytes: Uint8Array) => boolean} [sniff]
 * @property {(src: any, ctx: FormatLoadContext) => Promise<{meshes: any[], transformNodes?: any[]}>} load
 * @property {(node: any, ctx: FormatSaveContext) => Promise<FormatDecomposeResult | null>} decomposeForSave
 * @property {(node: any) => boolean} isStoredForm
 * @property {(node: any) => boolean} [isDedupSource]
 * @property {(node: any, colorMap: Record<string, string>, ctx: FormatSaveContext) => Promise<any>} [editSourceColors]
 * @property {(node: any, meshOverrides: any, color: any, ctx: FormatSaveContext) => Promise<any>} [editCompositeColors]
 */

/** @type {Map<string, FormatHandler>} */
const handlers = new Map();

/** @type {Set<string>} */
const warnedFormats = new Set();

/**
 * Register a format handler.
 *
 * @param {FormatHandler} handler
 * @throws {TypeError} on duplicate format or missing required hooks
 */
export function registerFormatHandler(handler) {
  if (!handler || typeof handler !== "object") {
    throw new TypeError("registerFormatHandler: handler must be an object");
  }
  if (typeof handler.format !== "string" || handler.format.length === 0) {
    throw new TypeError(
      "registerFormatHandler: handler.format must be a non-empty string"
    );
  }
  const key = handler.format.toLowerCase();
  if (handlers.has(key)) {
    throw new TypeError(
      `registerFormatHandler: format "${key}" is already registered`
    );
  }
  /** @type {Record<string, any>} */
  const h = /** @type {Record<string, any>} */ (handler);
  for (const required of ["load", "decomposeForSave", "isStoredForm"]) {
    if (typeof h[required] !== "function") {
      throw new TypeError(
        `registerFormatHandler: handler.${required} must be a function`
      );
    }
  }
  handlers.set(key, handler);
}

/**
 * Look up a handler by canonical format key.
 *
 * @param {string} format
 * @returns {FormatHandler | null}
 */
export function getFormatHandler(format) {
  if (!format) return null;
  return handlers.get(format.toLowerCase()) || null;
}

/**
 * Detect the asset format from its source reference.
 *
 * @param {any} src
 * @returns {string}
 */
export function detectAssetFormat(src) {
  if (src && typeof src === "object" && src.format) {
    return src.format.toLowerCase();
  }
  return "gltf";
}

/**
 * Detect the format and return its registered handler, falling back to gltf.
 *
 * @param {any} src
 * @returns {FormatHandler}
 */
export function resolveFormatHandler(src) {
  const detected = detectAssetFormat(src);
  const handler = getFormatHandler(detected);
  if (handler) return handler;
  if (!warnedFormats.has(detected)) {
    console.warn(
      `[FORMATS] unknown format "${detected}", falling back to gltf`
    );
    warnedFormats.add(detected);
  }
  return /** @type {FormatHandler} */ (handlers.get("gltf"));
}

/**
 * List all registered handlers.
 *
 * @returns {FormatHandler[]}
 */
export function listFormatHandlers() {
  return Array.from(handlers.values());
}

/**
 * Reset the registry. Used only by tests.
 */
export function _resetFormatRegistry() {
  handlers.clear();
  warnedFormats.clear();
}
