/**
 * Stage one of generation: Jev scores every catalog entry and those at or
 * above FIT_THRESHOLD are documented in the prompt. Selection only adds
 * documentation and fails open to the whole catalog, so Jev never fails a request.
 */
import type { TokenUsage } from "../types.ts";
import type { TurnInput } from "./prompt.ts";
import type { JevClient, LibraryFit } from "./jev.ts";
import { CATALOG, CATALOG_IDS, entriesUsedBy } from "./catalog.ts";
import { referencedIdentifiers } from "../core/document.ts";

/** "Possibly useful". Errs low: an extra entry costs tokens, a missing one a wrong part. */
export const FIT_THRESHOLD = 1.0;

export type SelectionSource = "jev" | "prior" | "fallback";

export interface LibrarySelection {
  libraries: string[];
  /** Absent for entries kept from the prior design. */
  fit: Record<string, LibraryFit>;
  source: SelectionSource;
  tokens: TokenUsage;
  /** Set when the fallback was taken. */
  error?: string;
  /** Jev's piece count (5 = "5 or more"); see bodyAllowance in core/gates.ts. */
  expectedPieces?: number;
  /** Jev's probability that one fused solid is wrong; see bodyFloor in core/gates.ts. */
  piecesSeparate?: number;
  /** Jev's CAD-suitability probability. Absent (Jev not asked or down) never refuses. */
  suitability?: number;
}

export const SUITABILITY_THRESHOLD = 0.5;

const NO_TOKENS: TokenUsage = { prompt: 0, completion: 0 };

const ordered = (ids: Iterable<string>): string[] => {
  const wanted = new Set(ids);
  return CATALOG_IDS.filter((id) => wanted.has(id));
};

const fallback = (error?: string): LibrarySelection => ({
  libraries: [...CATALOG_IDS], fit: {}, source: "fallback", tokens: NO_TOKENS,
  ...(error ? { error } : {}),
});

function requestText(input: TurnInput): string {
  return input.priorDesign
    ? input.prompt + "\n(Editing an existing part: " + input.priorDesign.summary + ")"
    : input.prompt;
}

export async function selectLibraries(
  jev: JevClient | undefined,
  input: TurnInput & { failures?: unknown[] },
  signal?: AbortSignal,
): Promise<LibrarySelection> {
  const prior = input.priorDesign
    ? entriesUsedBy(referencedIdentifiers(input.priorDesign.code))
    : [];
  // A client repair: the design's own code names its entries.
  if (input.priorDesign && (input.failures?.length ?? 0) > 0) {
    return { libraries: prior, fit: {}, source: "prior", tokens: NO_TOKENS };
  }
  if (!jev) return fallback();

  try {
    const candidates = Object.fromEntries(CATALOG.map((e) => [e.id, e.summary]));
    const { fit, usage, expectedPieces, piecesSeparate, suitability } =
      await jev.scoreFit(requestText(input), candidates, signal);
    const chosen = Object.entries(fit).filter(([, f]) => f.score >= FIT_THRESHOLD).map(([id]) => id);
    const libraries = ordered([...chosen, ...prior]);
    const kept = Object.fromEntries(libraries.filter((id) => fit[id]).map((id) => [id, fit[id]]));
    return {
      libraries, fit: kept, source: "jev", tokens: usage,
      ...(expectedPieces === undefined ? {} : { expectedPieces }),
      ...(piecesSeparate === undefined ? {} : { piecesSeparate }),
      ...(suitability === undefined ? {} : { suitability }),
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return fallback((err as Error).message);
  }
}
