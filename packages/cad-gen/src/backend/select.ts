/**
 * Stage one of two-stage generation: choose the catalog entries a request needs.
 * @remarks Jev (see jev.ts) scores every catalog entry against the request in
 *   one call, and the entries at or above FIT_THRESHOLD - with their scores -
 *   are what the DeepSeek prompt documents. So the generation prompt stays the
 *   size of what was asked, however large the library grows.
 *
 *   Selection can only ever ADD documentation. The guard still accepts every
 *   prelude helper, so a missed entry costs quality, never a rejected script;
 *   a follow-up keeps every entry its current design already calls; and any
 *   Jev failure falls back to the whole catalog - the single prompt this stage
 *   replaced - so Jev being down never fails a request.
 */
import type { TokenUsage } from "../types.ts";
import type { TurnInput } from "./prompt.ts";
import type { JevClient, LibraryFit } from "./jev.ts";
import { CATALOG, CATALOG_IDS, entriesUsedBy } from "./catalog.ts";
import { referencedIdentifiers } from "../core/document.ts";

/**
 * The lowest Jev score that selects an entry: "Possibly useful" on the 0-2 FIT_LEVELS scale.
 * @remarks Measured live: needed entries land at 1.8-2.0 and unrelated ones
 *   below 0.3. Erring low is deliberate - an extra entry costs a few hundred
 *   prompt tokens, a missing one costs a wrong part.
 */
export const FIT_THRESHOLD = 1.0;

/** Where a selection came from, so diagnostics can tell a pick from a fallback. */
export type SelectionSource = "jev" | "prior" | "fallback";

export interface LibrarySelection {
  libraries: string[];
  /** Jev's fit per selected entry; absent for entries kept from the prior design. */
  fit: Record<string, LibraryFit>;
  source: SelectionSource;
  /** Jev's own token usage, kept apart from DeepSeek's. */
  tokens: TokenUsage;
  /** Why the fallback was taken, when it was. */
  error?: string;
  /**
   * Jev's probability that the request intends separate, unjoined pieces.
   * @remarks The client's connected gate allows more than one body when this
   *   is at least SEPARATE_PARTS_THRESHOLD. Absent when Jev was not asked.
   */
  separateParts?: number;
}

/** Jev's separate-parts probability above which several bodies are the intent. */
export const SEPARATE_PARTS_THRESHOLD = 0.5;

const NO_TOKENS: TokenUsage = { prompt: 0, completion: 0 };

/** Catalog order, no duplicates. */
const ordered = (ids: Iterable<string>): string[] => {
  const wanted = new Set(ids);
  return CATALOG_IDS.filter((id) => wanted.has(id));
};

/** The whole catalog: what a request saw before selection existed. */
const fallback = (error?: string): LibrarySelection => ({
  libraries: [...CATALOG_IDS], fit: {}, source: "fallback", tokens: NO_TOKENS,
  ...(error ? { error } : {}),
});

/** The request as Jev sees it: the ask, plus what already exists on a follow-up. */
function requestText(input: TurnInput): string {
  return input.priorDesign
    ? input.prompt + "\n(Editing an existing part: " + input.priorDesign.summary + ")"
    : input.prompt;
}

/**
 * Chooses the catalog entries for one request.
 * @param jev The Jev client, or undefined when no key is configured.
 */
export async function selectLibraries(
  jev: JevClient | undefined,
  input: TurnInput & { failures?: unknown[] },
  signal?: AbortSignal,
): Promise<LibrarySelection> {
  const prior = input.priorDesign
    ? entriesUsedBy(referencedIdentifiers(input.priorDesign.code))
    : [];
  // A client-reported repair: the design exists and its code names its entries.
  if (input.priorDesign && (input.failures?.length ?? 0) > 0) {
    return { libraries: prior, fit: {}, source: "prior", tokens: NO_TOKENS };
  }
  if (!jev) return fallback();

  try {
    const candidates = Object.fromEntries(CATALOG.map((e) => [e.id, e.summary]));
    const { fit, usage, separateParts } = await jev.scoreFit(requestText(input), candidates, signal);
    const chosen = Object.entries(fit).filter(([, f]) => f.score >= FIT_THRESHOLD).map(([id]) => id);
    const libraries = ordered([...chosen, ...prior]);
    const kept = Object.fromEntries(libraries.filter((id) => fit[id]).map((id) => [id, fit[id]]));
    return {
      libraries, fit: kept, source: "jev", tokens: usage,
      ...(separateParts === undefined ? {} : { separateParts }),
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return fallback((err as Error).message);
  }
}
