/**
 * Advises which generation engine and Tripo configuration fit a new-model
 * request: CAD (parametric, client-rendered) or Tripo 3D (organic mesh), and
 * which curated Tripo config bundle matches the ask.
 * @remarks The two engines sit behind one create panel, and Tripo's own
 *   quality knobs (model version, texture tier, geometry tier, face budget,
 *   delight) are invisible to a user typing a prompt. One Jev call (see
 *   @arbesk/cad-gen's jev.ts for the transport) asks two Choices in the same
 *   request: the engine - CAD is only offered when the deployment serves it -
 *   and, speculatively, the Tripo config, so a CAD-bound request still gets a
 *   config reading the client can use if the user overrides the engine.
 *   Missing or unoffered answers are a JevError, which the route maps to a
 *   non-2xx the client treats as "no advice" and keeps its defaults.
 */
import type { JevConfig } from "@arbesk/cad-gen/backend/index.js";
import { askJev, JevError } from "@arbesk/cad-gen/backend/index.js";

/** Question id for the engine Choice. */
export const PROVIDER_QUESTION = "provider";
/** Question id for the speculative Tripo config Choice. */
export const CONFIG_QUESTION = "tripo_config";

/**
 * Curated Tripo config bundles, keyed by id.
 * @remarks `criterion` is the one-line "best for" text Jev scores on; the
 *   remaining fields are the payload the frontend forwards to the generations
 *   route. Keep the model/quality versions in step with the Tripo3D adapter
 *   (@arbesk/ai-asset-gen) and the create panel's quality selector.
 */
export const GENERATION_CONFIGS = {
  "fast-draft": {
    id: "fast-draft",
    label: "Fast draft",
    criterion: "A quick draft or iteration where the fastest result matters",
    model: "v3.1-20260211",
    textureQuality: "fast",
    textureVersion: "v3.5-20260815",
    delight: true,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    criterion: "A general-purpose model, the good-quality default",
    model: "v3.1-20260211",
    textureQuality: "standard",
  },
  "hero-detail": {
    id: "hero-detail",
    label: "Hero detail",
    criterion: "A close-up hero asset where maximum texture and geometry fidelity matter",
    model: "v3.1-20260211",
    textureQuality: "detailed",
    geometryQuality: "detailed",
  },
  "game-ready": {
    id: "game-ready",
    label: "Game-ready",
    criterion: "A game or mobile asset with clean low-poly topology and fast generation",
    model: "P1-20260311",
    textureQuality: "standard",
    faceLimit: 5000,
  },
  "clean-topo": {
    id: "clean-topo",
    label: "Clean topology",
    criterion: "A production asset that will be edited further, where the cleanest topology matters",
    model: "P2-20260801",
    textureQuality: "standard",
  },
} as const;

export type GenerationConfigId = keyof typeof GENERATION_CONFIGS;

export interface GenerationAdviceInput {
  prompt: string;
  hasImage?: boolean;
  cadAvailable: boolean;
}

export interface GenerationAdvice {
  provider: "cad" | "tripo3d";
  providerConfidence: number;
  providerProbabilities: Record<string, number>;
  config: GenerationConfigId;
  configConfidence: number;
  configProbabilities: Record<string, number>;
}

/** The two questions for one request; CAD is offered only when served. */
export function adviceQuestions(opts: { cadAvailable: boolean }): Record<string, unknown> {
  return {
    [PROVIDER_QUESTION]: {
      type: "choice",
      instructions: "The user typed `request` to generate a new 3D model. " +
        "Which generation engine fits the request?",
      criteria: {
        ...(opts.cadAvailable
          ? {
              cad: "A parametric/mechanical/engineering component: brackets, enclosures, gears, " +
                "mounts, printable parts defined by dimensions",
            }
          : {}),
        tripo3d: "An organic, artistic, decorative or freeform object: characters, creatures, " +
          "statues, props, scenery",
      },
    },
    [CONFIG_QUESTION]: {
      type: "choice",
      instructions: "If this request were generated with the Tripo 3D mesh generator, " +
        "which configuration fits what the user is asking for?",
      criteria: Object.fromEntries(
        Object.values(GENERATION_CONFIGS).map((c) => [c.id, c.criterion]),
      ),
    },
  };
}

/**
 * Reads a Jev reply into a GenerationAdvice.
 * @throws JevError when the reply lacks either answer or names an option that
 *   was not offered.
 */
export function readGenerationAdvice(body: any, opts: { cadAvailable: boolean }): GenerationAdvice {
  const answers = body?.answers ?? {};
  const provider = answers[PROVIDER_QUESTION];
  if (typeof provider?.choice !== "string") throw new JevError("jev reply has no provider answer", 502);
  if (provider.choice !== "tripo3d" && !(opts.cadAvailable && provider.choice === "cad")) {
    throw new JevError("jev chose a provider that was not offered: " + provider.choice, 502);
  }
  const config = answers[CONFIG_QUESTION];
  if (typeof config?.choice !== "string") throw new JevError("jev reply has no tripo config answer", 502);
  if (!(config.choice in GENERATION_CONFIGS)) {
    throw new JevError("jev chose a config that was not offered: " + config.choice, 502);
  }
  return {
    provider: provider.choice,
    providerConfidence: typeof provider.confidence === "number" ? provider.confidence : 0,
    providerProbabilities: provider.probabilities ?? {},
    config: config.choice,
    configConfidence: typeof config.confidence === "number" ? config.confidence : 0,
    configProbabilities: config.probabilities ?? {},
  };
}

/** One Jev call for one generation request. */
export async function judgeGenerationAdvice(
  config: JevConfig,
  input: GenerationAdviceInput,
  signal?: AbortSignal,
): Promise<GenerationAdvice> {
  const state = { request: input.prompt, has_reference_image: !!input.hasImage };
  const body = await askJev(config, state, adviceQuestions({ cadAvailable: input.cadAvailable }), signal);
  return readGenerationAdvice(body, { cadAvailable: input.cadAvailable });
}
