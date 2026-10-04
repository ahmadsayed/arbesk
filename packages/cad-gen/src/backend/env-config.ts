/**
 * The CAD generator's configuration, read from environment variables.
 * @remarks ONE reading shared by the API route (src/api/routes/cad.ts) and the
 *   offline harnesses (scripts/lib/cad-harness.mjs). Before it existed the two
 *   read different variables - the harness took CAD_MODEL where the route took
 *   DEEPSEEK_MODEL, and treated CAD_THINKING=false as on - so a benchmark could
 *   score a generator production never runs. Keep every variable here.
 */
import type { CadGenConfig, CadLimits } from "./facade.ts";

export type CadEnv = Record<string, string | undefined>;

/** Shipped default for CAD_MAX_REPAIR_ATTEMPTS. */
export const DEFAULT_REPAIR_ATTEMPTS = 3;

/**
 * Reads a positive whole-number bound from the environment.
 * @remarks Unset or blank means the documented default; a value that is SET but
 *   unusable is returned verbatim so the caller can refuse the request. Silently
 *   defaulting would make a typo'd cap behave exactly like a cap nobody wrote,
 *   which is the failure cad-quota's own fail-closed normalization exists to
 *   stop happening one layer down. Reporting it as an unusable CONFIGURATION
 *   rather than a mysterious quota rejection is operator experience, not safety.
 */
export function readBound(env: CadEnv, name: string, fallback: number): number | string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : raw;
}

/** Provider thinking mode, off unless explicitly asked for. */
export function isThinkingEnabled(env: CadEnv): boolean {
  const flag = (env.CAD_THINKING ?? "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/**
 * Jev library selection, when JEV_API_KEY is set.
 * @remarks Optional by design: without it every request sees the whole
 *   library catalog, which is how the service worked before selection existed.
 */
function jevConfig(env: CadEnv, fetchImpl?: typeof fetch) {
  const apiKey = (env.JEV_API_KEY ?? "").trim();
  if (!apiKey) return {};
  const baseUrl = (env.JEV_BASE_URL ?? "").trim();
  const model = (env.JEV_MODEL ?? "").trim();
  return {
    jev: {
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
    },
  };
}

/**
 * Builds the generator config the route and the harnesses both use.
 * @param limits Already-validated bounds: the caller validates them so it can
 *   name the variable at fault in its own way (the route answers 503).
 */
export function cadGenConfigFromEnv(
  env: CadEnv, limits: Partial<CadLimits>, fetchImpl?: typeof fetch,
): CadGenConfig {
  const baseUrl = (env.DEEPSEEK_BASE_URL ?? "").trim();
  const model = (env.DEEPSEEK_MODEL ?? "").trim();
  return {
    apiKey: (env.DEEPSEEK_API_KEY ?? "").trim(),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    thinking: isThinkingEnabled(env),
    limits,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...jevConfig(env, fetchImpl),
  };
}
