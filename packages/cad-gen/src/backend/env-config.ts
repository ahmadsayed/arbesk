/**
 * CAD generator configuration from the environment, shared by the API route and
 * the offline harnesses so a benchmark scores what production runs.
 */
import type { CadGenConfig, CadLimits } from "./facade.ts";

export type CadEnv = Record<string, string | undefined>;

export const DEFAULT_REPAIR_ATTEMPTS = 3;

/**
 * Unset or blank gives the default; a set but unusable value is returned
 * verbatim so the caller can refuse it rather than silently default.
 */
export function readBound(env: CadEnv, name: string, fallback: number): number | string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : raw;
}

/** Off unless explicitly asked for. */
export function isThinkingEnabled(env: CadEnv): boolean {
  const flag = (env.CAD_THINKING ?? "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/** Repair rounds think unless CAD_REPAIR_THINKING turns it off. */
function repairThinkingDisabled(env: CadEnv): boolean {
  const flag = (env.CAD_REPAIR_THINKING ?? "").trim().toLowerCase();
  return flag === "false" || flag === "0" || flag === "no" || flag === "off";
}

/** Optional: without JEV_API_KEY every request sees the whole catalog. */
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

/** `limits` are already validated, so the caller can name the variable at fault. */
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
    ...(repairThinkingDisabled(env) ? { repairThinking: false } : {}),
    limits,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...jevConfig(env, fetchImpl),
  };
}
