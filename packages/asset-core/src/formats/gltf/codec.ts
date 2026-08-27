import type { FormatCodec, DecomposeResult } from "../codec.ts";
import { compose } from "./composer.ts";
import { decompose as decomposeGltf, isComposite } from "./decomposer.ts";

function toObject(input: unknown): Record<string, unknown> {
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return input as Record<string, unknown>;
}

export const gltfCodec: FormatCodec = {
  format: "gltf",
  extensions: [".gltf"],

  isStoredForm(data: unknown): boolean {
    return isComposite(data);
  },

  async compose(composite: unknown): Promise<Uint8Array> {
    return compose(composite);
  },

  async decompose(input: unknown, opts = {}): Promise<DecomposeResult> {
    return decomposeGltf(toObject(input), opts);
  },
};
