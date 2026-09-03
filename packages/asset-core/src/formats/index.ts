/**
 * Format dispatcher — the single public entry point for compose/decompose.
 * @remarks Callers invoke only `compose`/`decompose`, never a format-named
 *   function.
 */

import type {
  FormatCodec,
  ComposeOptions,
  DecomposeOptions,
  DecomposeResult,
} from "./codec.ts";
import { gltfCodec } from "./gltf/codec.ts";
import { glbCodec } from "./gltf/glb-codec.ts";
import { threeMfCodec } from "./3mf/codec.ts";
import { exampleCodec } from "./example/codec.ts";

export type {
  FormatCodec,
  ComposeOptions,
  DecomposeOptions,
  DecomposeResult,
} from "./codec.ts";

const CODECS: FormatCodec[] = [gltfCodec, glbCodec, threeMfCodec, exampleCodec];

const byFormat = new Map<string, FormatCodec>(
  CODECS.map((c) => [c.format, c])
);

export function getCodec(format: string): FormatCodec | undefined {
  if (!format) return undefined;
  return byFormat.get(format.toLowerCase());
}

export function listCodecs(): FormatCodec[] {
  return CODECS.slice();
}

function toUint8(input: unknown): Uint8Array | null {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return null;
}

/**
 * Resolves the format of `input`.
 * @remarks Detection order: explicit hint, then the `arbesk_format` marker
 *   on a parsed document, then magic-byte sniff, then fallback to "gltf".
 */
export function detectFormat(input: unknown, hint?: string): string {
  if (hint) return hint.toLowerCase();

  if (input && typeof input === "object" && !(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
    const marker = (input as { arbesk_format?: string }).arbesk_format;
    if (marker === "composite-3mf") return "3mf";
    if (marker === "composite-example") return "example";
    return "gltf";
  }

  const bytes = toUint8(input);
  if (bytes) {
    for (const c of CODECS) {
      if (c.sniff?.(bytes)) return c.format;
    }
    // Unknown binary: try to parse as glTF JSON before giving up.
    try {
      JSON.parse(new TextDecoder().decode(bytes));
      return "gltf";
    } catch {
      throw new Error("asset-core: could not detect format of input bytes");
    }
  }

  return "gltf";
}

/**
 * Restores the native/renderable artifact of `input` as bytes.
 * @throws when the detected format has no compose (e.g. source-only GLB).
 */
export async function compose(
  input: unknown,
  opts: ComposeOptions = {}
): Promise<Uint8Array> {
  const codec = getCodec(detectFormat(input, opts.format));
  if (!codec?.compose) {
    throw new Error(
      "asset-core: format " + detectFormat(input, opts.format) + " does not support compose"
    );
  }
  return codec.compose(input, opts);
}

/**
 * Decomposes a raw artifact (glTF JSON, GLB, 3MF, or example bytes) into a
 * content-addressed composite.
 */
export async function decompose(
  input: unknown,
  opts: DecomposeOptions = {}
): Promise<DecomposeResult> {
  const format = detectFormat(input, opts.format);
  const codec = getCodec(format);
  if (!codec) throw new Error("asset-core: unknown format " + format);
  return codec.decompose(input, opts);
}
