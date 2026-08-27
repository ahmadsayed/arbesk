import type { FormatCodec, DecomposeResult } from "../codec.ts";
import { isGLB, decompose } from "./glb-parser.ts";

function toArrayBuffer(input: unknown): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  if (input instanceof Uint8Array) {
    return input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength
    ) as ArrayBuffer;
  }
  throw new Error("glb codec: decompose requires GLB bytes");
}

export const glbCodec: FormatCodec = {
  format: "glb",
  extensions: [".glb"],

  sniff(bytes: Uint8Array): boolean {
    return isGLB(toArrayBuffer(bytes));
  },

  // GLB is a source-only format: it is decomposed to a composite glTF on
  // save and never composed back (loaders read the raw blob directly).

  async decompose(input: unknown, opts = {}): Promise<DecomposeResult> {
    const { composite, compositeCid } = await decompose(toArrayBuffer(input), undefined, {
      storeComposite: opts.store !== false,
      credential: opts.credential,
      compress: opts.compress,
      assetName: opts.assetName,
      assetId: opts.assetId,
      dedupMap: opts.dedupMap,
    });
    return { composite, compositeCid };
  },
};
