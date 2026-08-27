import type { FormatCodec, DecomposeResult } from "../codec.ts";
import { compose } from "./composer.ts";
import { decompose as decomposeExample } from "./decomposer.ts";
import { isCompositeExample, EXAMPLE_MAGIC } from "./format.ts";

function toBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error("example codec: decompose requires raw .example bytes");
}

export const exampleCodec: FormatCodec = {
  format: "example",
  extensions: [".example"],

  sniff(bytes: Uint8Array): boolean {
    if (bytes.length < EXAMPLE_MAGIC.length + 1) return false;
    return new TextDecoder().decode(bytes.subarray(0, EXAMPLE_MAGIC.length)) === EXAMPLE_MAGIC;
  },

  isStoredForm(data: unknown): boolean {
    return isCompositeExample(data);
  },

  async compose(composite: unknown): Promise<Uint8Array> {
    return compose(composite as Parameters<typeof compose>[0]);
  },

  async decompose(input: unknown, opts = {}): Promise<DecomposeResult> {
    const result = await decomposeExample(toBytes(input), {
      assetName: opts.assetName,
      assetId: opts.assetId,
      dedupMap: opts.dedupMap,
      credential: opts.credential,
    });
    return { composite: result.composite as Record<string, unknown>, compositeCid: result.compositeCid };
  },
};
