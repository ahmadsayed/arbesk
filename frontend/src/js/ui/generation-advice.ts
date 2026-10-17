/**
 * What Jev advises for a fresh generation: which engine (Parametric CAD or
 * Tripo 3D) and which curated Tripo config bundle fits the request.
 * @remarks The advice comes from POST /api/v1/generation-advice (Jev key is
 *   server-side only); this module is the policy, kept apart so thresholds
 *   are tested without the panel. Any failure - no key, an outage, a timeout
 *   - yields null advice, which maps to the pre-advisor fallback behavior.
 */

import { fetchJsonOrThrow } from "../services/backend-client.ts";

/** Confidence at or above which Jev's pick is acted on without asking. */
const AUTO_CONFIDENCE = 0.8;
/** How many options an "ask" offers (balanced always rides along). */
const ASK_OPTIONS = 3;

/** Tripo-side generation payload fields a config bundle expands to. */
export interface ConfigBundleFields {
  tripoModel?: string;
  textureQuality?: string;
  textureVersion?: string;
  delight?: boolean;
  faceLimit?: number;
}

/** One curated Tripo config bundle: label, chat blurb, generation fields. */
export interface ConfigBundle {
  id: string;
  label: string;
  /** Short suffix for the chat info line announcing the pick. */
  blurb: string;
  fields: ConfigBundleFields;
}

/**
 * The config bundles Jev picks between, keyed by id.
 * @remarks Keep the model/quality versions in step with the backend's
 *   GENERATION_CONFIGS (src/api/generation-advice.ts) and the Tripo3D adapter.
 */
export const CONFIG_BUNDLES: Record<string, ConfigBundle> = {
  "fast-draft": {
    id: "fast-draft",
    label: "Fast draft",
    blurb: "Tripo v3.1 · fast textures",
    fields: {
      tripoModel: "v3.1-20260211",
      textureQuality: "fast",
      textureVersion: "v3.5-20260815",
      delight: true,
    },
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    blurb: "Tripo v3.1 · standard quality",
    fields: {
      tripoModel: "v3.1-20260211",
      textureQuality: "standard",
    },
  },
  "hero-detail": {
    id: "hero-detail",
    label: "Hero detail",
    blurb: "Tripo v3.1 · detailed textures",
    fields: {
      tripoModel: "v3.1-20260211",
      textureQuality: "detailed",
    },
  },
  "game-ready": {
    id: "game-ready",
    label: "Game-ready (low poly)",
    blurb: "Tripo P1 · 5K faces",
    fields: {
      tripoModel: "P1-20260311",
      textureQuality: "standard",
      faceLimit: 5000,
    },
  },
  "clean-topo": {
    id: "clean-topo",
    label: "Clean topology (P2)",
    blurb: "Tripo P2 · clean topology",
    fields: {
      tripoModel: "P2-20260801",
      textureQuality: "standard",
    },
  },
};

/** Jev's reading, as POST /api/v1/generation-advice returns it. */
export interface GenerationAdvice {
  provider: "cad" | "tripo3d";
  providerConfidence: number;
  providerProbabilities: Record<string, number>;
  config: string;
  configConfidence: number;
  configProbabilities: Record<string, number>;
}

/** One option offered when the reading is too uncertain to act on. */
export interface GenerationOption {
  /** "cad" or "tripo3d:<configId>". */
  value: string;
  label: string;
  recommended: boolean;
}

/** The plan for one advice reading. */
export type GenerationPlan =
  | { kind: "fallback" }
  | { kind: "auto"; provider: "cad" }
  | { kind: "auto"; provider: "tripo3d"; configId: string }
  | { kind: "ask"; options: GenerationOption[] };

/**
 * The plan for one advice reading.
 * @remarks ctx.provider is the selector's current value: "auto" asks Jev both
 *   questions; a manual "tripo3d" pick fixes the provider (the provider answer
 *   is ignored) and uses only the config reading - above the bar it applies,
 *   below it the panel keeps today's plain standard quality. A confident CAD
 *   reading with CAD unavailable on this deployment is rerouted to the Tripo
 *   side of the advice.
 */
export function decideGenerationPlan(
  advice: GenerationAdvice | null,
  ctx: { cadAvailable: boolean; provider: string },
): GenerationPlan {
  if (!advice) return { kind: "fallback" };
  const manualTripo = ctx.provider === "tripo3d";
  const providerConfident = advice.providerConfidence >= AUTO_CONFIDENCE;
  if (!manualTripo && providerConfident && advice.provider === "cad" && ctx.cadAvailable) {
    return { kind: "auto", provider: "cad" };
  }
  const tripoEligible = manualTripo || providerConfident;
  if (tripoEligible && advice.configConfidence >= AUTO_CONFIDENCE && CONFIG_BUNDLES[advice.config]) {
    return { kind: "auto", provider: "tripo3d", configId: advice.config };
  }
  if (manualTripo) return { kind: "fallback" };
  return { kind: "ask", options: askOptions(advice, ctx.cadAvailable) };
}

/** A candidate ask option with Jev's probability attached, for ranking. */
interface WeightedOption {
  value: string;
  label: string;
  prob: number;
}

/** All candidate routes with their probabilities attached, likeliest first. */
function rankedCandidates(advice: GenerationAdvice, cadAvailable: boolean): WeightedOption[] {
  const candidates: WeightedOption[] = [];
  if (cadAvailable) {
    candidates.push({
      value: "cad",
      label: "Parametric CAD",
      prob: advice.providerProbabilities?.cad ?? 0,
    });
  }
  for (const bundle of Object.values(CONFIG_BUNDLES)) {
    candidates.push({
      value: `tripo3d:${bundle.id}`,
      label: bundle.label,
      prob: advice.configProbabilities?.[bundle.id] ?? 0,
    });
  }
  candidates.sort((a, b) => b.prob - a.prob);
  return candidates;
}

/** Balanced always rides along: append it when the top cut missed it. */
function withBalanced(top: WeightedOption[], advice: GenerationAdvice): WeightedOption[] {
  if (top.some((o) => o.value === "tripo3d:balanced")) return top;
  return [
    ...top,
    {
      value: "tripo3d:balanced",
      label: CONFIG_BUNDLES.balanced.label,
      prob: advice.configProbabilities?.balanced ?? 0,
    },
  ];
}

/**
 * The options to ask between: the likeliest mixes of CAD (when served) and
 * Tripo configs, best first, with balanced always on offer.
 */
function askOptions(advice: GenerationAdvice, cadAvailable: boolean): GenerationOption[] {
  const top = withBalanced(
    rankedCandidates(advice, cadAvailable).slice(0, ASK_OPTIONS),
    advice,
  );
  return top.map((o, index) => ({
    value: o.value,
    label: o.label,
    recommended: index === 0,
  }));
}

/** Wait this long for advice before keeping the fallback route. */
const ADVICE_TIMEOUT_MS = 4000;

/**
 * POST /api/v1/generation-advice (session auth).
 * @returns the parsed advice, or null on any failure - no Jev key, a non-2xx,
 *   a timeout - so the caller always has a plan.
 */
export async function fetchGenerationAdvice(
  prompt: string,
  { hasImage = false, cadAvailable = false }: { hasImage?: boolean; cadAvailable?: boolean } = {},
): Promise<GenerationAdvice | null> {
  try {
    return await fetchJsonOrThrow(
      "/generation-advice",
      {
        body: { prompt, hasImage, cadAvailable },
        signal: AbortSignal.timeout(ADVICE_TIMEOUT_MS),
      },
      "Generation advice failed",
    );
  } catch {
    return null;
  }
}
