/**
 * Format-handler registry.
 *
 * Cycle-proof root: this file must not import any project modules.
 * Handlers are plain objects keyed by canonical lowercase format name.
 */

export interface FormatLoadContext {
  /** Babylon scene instance */
  scene: any;
  /** CID being loaded */
  cid: string;
  importFromBlob: (
    blob: Blob,
    extension: string
  ) => Promise<{
    meshes: any[];
    transformNodes?: any[];
    animationGroups?: any[];
  }>;
  /** optional byte-level download progress (0..1) for the source fetch */
  onProgress?: (fraction: number) => void;
}

export interface FormatSaveContext {
  assetName: string;
  assetId: string;
  dedupMap?: Map<string, string>;
}

export interface FormatDecomposeResult {
  cid: string;
  path: string;
  format?: string;
  normalizeOnly?: boolean;
}

export interface FormatHandler {
  /** canonical lowercase key (e.g. "gltf", "glb") */
  format: string;
  /** file extensions (e.g. [".glb"]) */
  extensions: string[];
  sniff?: (bytes: Uint8Array) => boolean;
  load: (
    src: any,
    ctx: FormatLoadContext
  ) => Promise<{
    meshes: any[];
    transformNodes?: any[];
    animationGroups?: any[];
  }>;
  decomposeForSave: (
    node: any,
    ctx: FormatSaveContext
  ) => Promise<FormatDecomposeResult | null>;
  isStoredForm: (node: any) => boolean;
  isDedupSource?: (node: any) => boolean;
  editSourceColors?: (
    node: any,
    colorMap: Record<string, string>,
    ctx: FormatSaveContext
  ) => Promise<any>;
  editCompositeColors?: (
    node: any,
    meshOverrides: any,
    color: any,
    ctx: FormatSaveContext
  ) => Promise<any>;
}

const handlers = new Map<string, FormatHandler>();
const warnedFormats = new Set<string>();

/**
 * Register a format handler.
 *
 * @throws {TypeError} on duplicate format or missing required hooks
 */
export function registerFormatHandler(handler: FormatHandler): void {
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
  const h = handler as Record<string, any>;
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
 */
export function getFormatHandler(format: string): FormatHandler | null {
  if (!format) return null;
  return handlers.get(format.toLowerCase()) || null;
}

/**
 * Detect the asset format from its source reference.
 */
export function detectAssetFormat(src: any): string {
  if (src && typeof src === "object" && src.format) {
    return src.format.toLowerCase();
  }
  return "gltf";
}

/**
 * Detect the format and return its registered handler, falling back to gltf.
 */
export function resolveFormatHandler(src: any): FormatHandler {
  const detected = detectAssetFormat(src);
  const handler = getFormatHandler(detected);
  if (handler) return handler;
  if (!warnedFormats.has(detected)) {
    console.warn(
      `[FORMATS] unknown format "${detected}", falling back to gltf`
    );
    warnedFormats.add(detected);
  }
  return handlers.get("gltf") as FormatHandler;
}

/**
 * List all registered handlers.
 */
export function listFormatHandlers(): FormatHandler[] {
  return Array.from(handlers.values());
}

/**
 * Reset the registry. Used only by tests.
 */
export function _resetFormatRegistry(): void {
  handlers.clear();
  warnedFormats.clear();
}
