/**
 * Shared Jev wiring for the routes that call Jev (generation advice,
 * follow-up intent). Server-side only because the Jev key is a secret
 * (ARCHITECTURE section 1.5).
 */
import type { JevConfig } from "@arbesk/cad-gen/backend/index.js";

export interface JevRouteDeps {
  /** Jev transport, injected by tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Jev wiring from the environment, read per request.
 * @returns null when JEV_API_KEY is unset.
 */
export function jevConfig(fetchImpl?: typeof fetch): JevConfig | null {
  const apiKey = (process.env.JEV_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.JEV_BASE_URL ?? "").trim();
  const model = (process.env.JEV_MODEL ?? "").trim();
  return {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}
