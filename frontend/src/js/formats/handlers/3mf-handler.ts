/**
 * Built-in handler for 3MF assets.
 *
 * 3MF stays the native stored form: decomposeForSave turns a raw .3mf OPC
 * package into a composite 3MF JSON (XML verbatim + binary parts by CID).
 * Rendering parses the package and converts it to glTF in memory — the glTF
 * is never persisted. Color/scale edits stay as post_processor overlays.
 */

import { getArrayBufferFromRemoteIPFS } from "../../ipfs/remote-ipfs.ts";
import { unzipBytes, isZipBytes, strFromU8 } from "@arbesk/asset-core/formats/3mf/zip.js";
import { parse3mfModel } from "@arbesk/asset-core/formats/3mf/parser.js";
import { parsed3mfToGltf } from "@arbesk/asset-core/formats/3mf/to-gltf.js";
import type {
  FormatHandler,
  FormatLoadContext,
  FormatSaveContext,
} from "../registry.ts";

// Canonical composite-3MF markers. Mirror COMPOSITE_3MF_FORMAT and
// COMPOSITE_3MF_PATH from @arbesk/asset-core/formats/3mf/decomposer.js, which is
// imported lazily (and only where a real decomposition uploads parts) so that
// read-side paths — load, and the already-composite normalize below — never
// pull the IPFS write chain into the module graph.
const COMPOSITE_3MF_FORMAT = "composite-3mf";
const COMPOSITE_3MF_PATH = "composite.3mf.json";

export const threeMfHandler: FormatHandler = {
  format: "3mf",
  extensions: [".3mf"],

  sniff(bytes: Uint8Array): boolean {
    if (!isZipBytes(bytes)) return false;
    try {
      const entries = unzipBytes(bytes);
      return Object.keys(entries).some((p) => p.endsWith(".model"));
    } catch {
      return false;
    }
  },

  /**
   * Load a raw or composite 3MF source into the scene.
   */
  async load(src: any, ctx: FormatLoadContext) {
    const cid = ctx.cid || src.cid;
    console.log(`[FORMATS-3mf] fetching 3MF | cid=${cid}`);
    // Gzip-sniffing reader: uncompressed today, but tolerant if compression
    // is ever enabled on source uploads (glTF/GLB handlers use it too).
    const raw = new Uint8Array(await getArrayBufferFromRemoteIPFS(cid, ctx.onProgress));

    let packageBytes = raw;
    if (!isZipBytes(raw)) {
      const composite = JSON.parse(strFromU8(raw));
      const { compose3mf } = await import("@arbesk/asset-core/formats/3mf/composer.js");
      packageBytes = await compose3mf(composite);
    }

    const entries = unzipBytes(packageBytes);
    const modelPath = Object.keys(entries).find((p) => p.endsWith(".model"));
    if (!modelPath) {
      throw new Error(`[FORMATS-3mf] no .model part in package | cid=${cid}`);
    }
    const parsed = parse3mfModel(strFromU8(entries[modelPath]));
    const gltf = parsed3mfToGltf(parsed);
    const blob = new Blob([JSON.stringify(gltf)], {
      type: "model/gltf+json",
    });
    console.log(
      `[FORMATS-3mf] converted to glTF | cid=${cid} objects=${parsed.objects.length}`
    );
    return ctx.importFromBlob(blob, ".gltf");
  },

  /**
   * Decompose a raw .3mf source into composite 3MF for save/publish.
   */
  async decomposeForSave(node: any, ctx: FormatSaveContext) {
    const cid = node.source.cid;
    const raw = new Uint8Array(await getArrayBufferFromRemoteIPFS(cid));
    if (!isZipBytes(raw)) {
      const composite = JSON.parse(strFromU8(raw));
      if (composite?.arbesk_format === COMPOSITE_3MF_FORMAT) {
        console.log(
          `[FORMATS-3mf] already composite, normalizing path | cid=${cid}`
        );
        return {
          cid,
          path: COMPOSITE_3MF_PATH,
          format: "3mf",
          normalizeOnly: true,
        };
      }
      throw new Error(`[FORMATS-3mf] unrecognized 3MF source | cid=${cid}`);
    }
    const { decompose3mf } = await import("@arbesk/asset-core/formats/3mf/decomposer.js");
    const { compositeCid } = await decompose3mf(raw, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
    if (!compositeCid) {
      throw new Error(
        `[FORMATS-3mf] decomposition produced no CID | cid=${cid}`
      );
    }
    return { cid: compositeCid, path: COMPOSITE_3MF_PATH, format: "3mf" };
  },

  isStoredForm(node: any): boolean {
    return (
      node.source?.format === "3mf" &&
      node.source?.path === COMPOSITE_3MF_PATH
    );
  },

  isDedupSource(): boolean {
    return false;
  },
};
