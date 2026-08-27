import type { FormatCodec, DecomposeResult } from "../codec.ts";
import { compose } from "./composer.ts";
import { decompose as decompose3mf, isComposite3mf } from "./decomposer.ts";
import { unzipBytes, isZipBytes } from "./zip.ts";

function toBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error("3mf codec: decompose requires raw .3mf bytes");
}

export const threeMfCodec: FormatCodec = {
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

  isStoredForm(data: unknown): boolean {
    return isComposite3mf(data);
  },

  async compose(composite: unknown): Promise<Uint8Array> {
    return compose(composite as Parameters<typeof compose>[0]);
  },

  async decompose(input: unknown, opts = {}): Promise<DecomposeResult> {
    const result = await decompose3mf(toBytes(input), {
      assetName: opts.assetName,
      assetId: opts.assetId,
      dedupMap: opts.dedupMap,
      credential: opts.credential,
    });
    return { composite: result.composite as Record<string, unknown>, compositeCid: result.compositeCid };
  },
};
