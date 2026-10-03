/**
 * CAD generation routes.
 * @remarks The server's entire runtime job here is: authenticate, meter, call
 *   the provider, run the STATIC gates, return code. It never runs the kernel,
 *   never returns geometry and never exports a file - the client does all three
 *   (spec section 7). Both endpoints share one admission sequence, so a repair
 *   cannot reach the provider by a cheaper path than a generation can.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { CadDesign } from "@arbesk/cad-gen";
import { createCadGenerator } from "@arbesk/cad-gen/backend/index.js";
import type {
  CadFailure, CadGenerateInput, CadGenerateResult, CadGenerator, CadLimits,
} from "@arbesk/cad-gen/backend/index.js";
import {
  acquireCadSlot, cadLockTtlMs, cadQuotaHeaders, refundCadUnit, releaseCadSlot,
  CAD_DEFAULT_REQUEST_LIMITS,
} from "../cad-quota.ts";
import type { CadRequestLimits, QuotaDecision, QuotaOptions } from "../cad-quota.ts";
import { cadGenerateSchema, cadRepairSchema } from "../schemas.ts";
import { validateBody } from "../validation.ts";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import type { AuthVariables } from "../authentication.ts";
import { cadRateLimit } from "../rate-limiter.ts";

/** Environment the route reads; injectable so a test needs no process globals. */
type Env = Record<string, string | undefined>;

type CadGenerateBody = z.infer<typeof cadGenerateSchema>;
type CadRepairBody = z.infer<typeof cadRepairSchema>;

/** The admitted request's slot, set by admitCad for the handler. */
interface AdmittedCad {
  config: CadRuntimeConfig;
  wallet: string;
  token: string;
}

/** Hono env for the CAD routes: the session wallet plus the admitted slot. */
interface CadEnv {
  Variables: AuthVariables & { cad: AdmittedCad };
}

/**
 * Shipped default for CAD_DAILY_REQUEST_LIMIT.
 * @remarks It meters ROUNDS, not parts. Every call to either endpoint is one
 *   paid DeepSeek request, so a part that needs two client-driven repairs
 *   spends three. 50 rounds is roughly 15-25 parts on the observed repair rate,
 *   which sits above the free tier's 10 generations/day per wallet.
 */
const DEFAULT_DAILY_ROUNDS = 50;

/** Shipped default for CAD_MAX_REPAIR_ATTEMPTS. */
const DEFAULT_REPAIR_ATTEMPTS = 3;

/** Shipped default for CAD_MAX_IMAGE_BYTES (8 MiB of decoded image). */
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Provider call ceiling for an admitted request: the lock TTL derives from it. */
const PROVIDER_TIMEOUT_MS = CAD_DEFAULT_REQUEST_LIMITS.providerTimeoutMs;

export interface CadRouteDeps {
  /**
   * Injected generator; when absent one is built from the environment.
   * @remarks Named for what it holds, not for its method: a field called
   *   "generate" carrying an object with a generate method reads as a function
   *   at every call site and is wrong exactly once.
   */
  generator?: CadGenerator;
  /** Injected session middleware, so a test needs no real session store. */
  authenticateOverride?: MiddlewareHandler;
  /** Redirects the persisted quota counter; unset in production. */
  quotaStatePath?: string;
  /** Provider transport, injected by tests. */
  fetchImpl?: typeof fetch;
}

/** Everything resolved once per request from the environment. */
export interface CadRuntimeConfig {
  generator: CadGenerator;
  quota: QuotaOptions;
  maxImageBytes: number;
}

type CadConfigOutcome =
  | { ok: true; config: CadRuntimeConfig }
  | { ok: false; status: number; code: string; message: string };

/**
 * Reads a positive whole-number bound from the environment.
 * @remarks Unset or blank means the documented default; a value that is SET but
 *   unusable is returned verbatim so the caller can refuse the request. Silently
 *   defaulting would make a typo'd cap behave exactly like a cap nobody wrote,
 *   which is the failure cad-quota's own fail-closed normalization exists to
 *   stop happening one layer down. Reporting it as an unusable CONFIGURATION
 *   rather than a mysterious quota rejection is operator experience, not safety.
 */
function readBound(env: Env, name: string, fallback: number): number | string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : raw;
}

/** The three numeric bounds, or the name and value of the first unusable one. */
function readBounds(
  env: Env,
): { ok: true; bounds: Record<string, number> } | { ok: false; name: string; bad: string } {
  const specs: [string, string, number][] = [
    ["dailyRounds", "CAD_DAILY_REQUEST_LIMIT", DEFAULT_DAILY_ROUNDS],
    ["maxRepairAttempts", "CAD_MAX_REPAIR_ATTEMPTS", DEFAULT_REPAIR_ATTEMPTS],
    ["maxImageBytes", "CAD_MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES],
  ];
  const bounds: Record<string, number> = {};
  for (const [key, name, fallback] of specs) {
    const value = readBound(env, name, fallback);
    if (typeof value === "string") return { ok: false, name, bad: value };
    bounds[key] = value;
  }
  return { ok: true, bounds };
}

/**
 * Whether the kill switch permits serving at all.
 * @remarks Unset means enabled, because the key check below is the real gate:
 *   the switch exists to turn the feature OFF deliberately, not to duplicate
 *   the check that it is configured.
 */
function isEnabled(env: Env): boolean {
  const flag = (env.CAD_GENERATION_ENABLED ?? "").trim().toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "no";
}

/** Provider thinking mode, off unless explicitly asked for. */
function isThinkingEnabled(env: Env): boolean {
  const flag = (env.CAD_THINKING ?? "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/** Builds the shaped options object the DeepSeek client takes. */
function providerOptions(env: Env, deps: CadRouteDeps, limits: CadLimits) {
  const baseUrl = (env.DEEPSEEK_BASE_URL ?? "").trim();
  const model = (env.DEEPSEEK_MODEL ?? "").trim();
  return {
    apiKey: (env.DEEPSEEK_API_KEY ?? "").trim(),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    thinking: isThinkingEnabled(env),
    limits,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...jevOptions(env, deps),
  };
}

/**
 * Jev library selection, when JEV_API_KEY is set.
 * @remarks Optional by design: without it every request sees the whole
 *   library catalog, which is how the service worked before selection existed.
 */
function jevOptions(env: Env, deps: CadRouteDeps) {
  const apiKey = (env.JEV_API_KEY ?? "").trim();
  if (!apiKey) return {};
  const baseUrl = (env.JEV_BASE_URL ?? "").trim();
  const model = (env.JEV_MODEL ?? "").trim();
  return {
    jev: {
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    },
  };
}

/**
 * Resolves the runtime configuration, or says why the service cannot serve.
 * @remarks Every refusal here is a 503 and names the variable at fault. That
 *   distinction matters: an unusable CAD_DAILY_REQUEST_LIMIT that fell through
 *   to the quota path would look like "you are out of quota" to a user who has
 *   never made a request.
 */
export function cadConfigFromEnv(env: Env = process.env, deps: CadRouteDeps = {}): CadConfigOutcome {
  if (!isEnabled(env)) {
    return {
      ok: false, status: 503, code: "CAD_NOT_CONFIGURED",
      message: "CAD generation is disabled (CAD_GENERATION_ENABLED)",
    };
  }

  const read = readBounds(env);
  if (!read.ok) {
    return {
      ok: false, status: 503, code: "CAD_NOT_CONFIGURED",
      message: read.name + "=" + read.bad + " is not a whole number >= 1",
    };
  }

  const apiKey = (env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey && !deps.generator) {
    return {
      ok: false, status: 503, code: "CAD_NOT_CONFIGURED",
      message: "DEEPSEEK_API_KEY is not set",
    };
  }

  const requestLimits: CadRequestLimits = {
    attempts: read.bounds.maxRepairAttempts,
    providerTimeoutMs: PROVIDER_TIMEOUT_MS,
  };

  return {
    ok: true,
    config: {
      generator: deps.generator
        ?? createCadGenerator(providerOptions(env, deps, { maxRepairAttempts: read.bounds.maxRepairAttempts })),
      quota: {
        dailyLimit: read.bounds.dailyRounds,
        lockTtlMs: cadLockTtlMs(requestLimits, env),
        ...(deps.quotaStatePath ? { statePath: deps.quotaStatePath } : {}),
      },
      maxImageBytes: read.bounds.maxImageBytes,
    },
  };
}

/** Decoded size of a base64 payload, ignoring the padding characters. */
function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * Admission step (c): everything that must be refused BEFORE the wallet is
 * charged.
 * @remarks A request the server was never going to serve must not cost a round.
 *   Charging for one is the single metering bug a user notices immediately and
 *   cannot work around, so these checks run ahead of the quota.
 * @returns the refusal response, or null when the request may proceed.
 */
function precheck(
  c: Context,
  body: CadGenerateBody | CadRepairBody,
  maxImageBytes: number,
): Response | null {
  if ("sourceRef" in body && body.sourceRef) {
    // Deliberately 501, not the 400 the plan first specified. A 400 tells a
    // client "fix your request", and there is nothing to fix: the resolution
    // path does not exist yet. 501 says do not retry until this ships.
    return sendError(
      c, 501, "SOURCE_ASSET_RESOLUTION_UNAVAILABLE",
      "sourceRef is part of this contract but CID/asset resolution is not wired yet; " +
        "send the full priorDesign instead",
    );
  }

  const images = "images" in body ? body.images ?? [] : [];
  const oversized = images.find((image) => base64Bytes(image.data) > maxImageBytes);
  if (oversized) {
    return sendError(c, 413, "IMAGE_TOO_LARGE", "Attached image exceeds CAD_MAX_IMAGE_BYTES", {
      limit: maxImageBytes,
      actual: base64Bytes(oversized.data),
    });
  }
  return null;
}

/** Sets the quota headers on the response being built. */
function setQuotaHeaders(c: Context, wallet: string, config: CadRuntimeConfig): void {
  for (const [name, value] of Object.entries(cadQuotaHeaders(wallet, config.quota))) {
    c.header(name, value);
  }
}

/** Refuses a request the quota or the in-flight lock turned away. */
function refuseAdmission(
  c: Context,
  wallet: string,
  config: CadRuntimeConfig,
  decision: Extract<QuotaDecision, { ok: false }>,
): Response {
  if (decision.reason === "IN_PROGRESS") {
    const heldMs = Date.now() - decision.startedAt;
    const retryAfter = Math.max(1, Math.ceil((config.quota.lockTtlMs - heldMs) / 1000));
    c.header("Retry-After", String(retryAfter));
    return sendError(c, 409, "GENERATION_IN_PROGRESS",
      "This wallet already has a CAD request in flight", { startedAt: decision.startedAt });
  }
  setQuotaHeaders(c, wallet, config);
  return sendError(c, 429, "DAILY_QUOTA_EXCEEDED", "Daily CAD request limit reached", {
    limit: decision.limit,
    used: decision.used,
    resetsAt: decision.resetsAt,
  });
}

/**
 * Admits or refuses one request: steps (c) to (e) of the spec's sequence.
 * @remarks The quota check and the lock acquire happen in ONE synchronous call,
 *   so nothing can slip between them and a quota rejection therefore never
 *   takes the lock. The hourly limiter runs after this, as its own middleware -
 *   which is why the slot is freed in a finally around the rest of the chain:
 *   a limiter rejection, a handler failure and a normal response must all
 *   release it.
 */
function admitCad(
  deps: CadRouteDeps,
): MiddlewareHandler<CadEnv, string, { out: { json: CadGenerateBody | CadRepairBody } }> {
  return async (c, next) => {
    const outcome = cadConfigFromEnv(process.env, deps);
    if (!outcome.ok) {
      return sendError(c, outcome.status, outcome.code, outcome.message);
    }

    const { config } = outcome;
    const refused = precheck(c, c.req.valid("json"), config.maxImageBytes);
    if (refused) return refused;

    const wallet = c.get("userAddress");
    const decision = acquireCadSlot(wallet, config.quota);
    if (!decision.ok) {
      return refuseAdmission(c, wallet, config, decision);
    }

    c.set("cad", { config, wallet, token: decision.token });
    setQuotaHeaders(c, wallet, config);
    console.log("[CAD] admit wallet=" + wallet + " used=" + decision.used + "/" + decision.limit);
    try {
      await next();
    } finally {
      releaseCadSlot(wallet, decision.token);
    }
  };
}

/**
 * The response body.
 * @remarks There is deliberately no validation field: the server ran no
 *   kernel, so it cannot claim the design is geometrically sound; what it
 *   guarantees is that the design passed every static gate, which is what
 *   diagnostics.attempts records. attribution is always present, never
 *   model-authored, and computed from the helpers the script actually calls -
 *   an empty array is the claim that nothing licensed was used, which is a
 *   claim the server can support.
 */
function toWireResult(result: CadGenerateResult) {
  return {
    design: result.design,
    runtime: result.runtime,
    provider: result.provider,
    attribution: result.attribution,
    diagnostics: result.diagnostics,
  };
}

/**
 * Maps a generation failure onto the documented error table.
 * @remarks Dispatch is on err.code, with err.status advisory: the DeepSeek
 *   client invents a 502 for transport failures that carry no HTTP status, so
 *   status alone cannot tell a provider outage from a bug in here. Provider
 *   failures are always reported as 502 whatever upstream said, because
 *   passing a provider 401 through would read as "your session is invalid"
 *   when the session is perfectly good.
 */
function respondWithFailure(c: Context<CadEnv>, err: unknown): Response {
  const e = err as Error & { code?: string; diagnostics?: unknown; suitability?: number; alternative?: unknown };
  if (e.name === "CadRequestUnsuitable") {
    // Refused before any DeepSeek call, so the unit is given back.
    const { config, wallet } = c.get("cad");
    refundCadUnit(wallet, config.quota);
    setQuotaHeaders(c, wallet, config);
    console.log("[CAD] unsuitable wallet=" + wallet + " suitability=" + e.suitability);
    return sendError(c, 422, "CAD_REQUEST_UNSUITABLE", e.message, {
      suitability: e.suitability,
      alternative: e.alternative,
    });
  }
  if (e.name === "CadGenerationFailed") {
    console.error("[CAD] generation failed: " + e.message);
    return sendError(c, 500, "CAD_GENERATION_FAILED", e.message, e.diagnostics ?? null);
  }
  if (e.name === "ProviderError") {
    console.error("[CAD] provider error: " + e.message);
    return sendError(c, 502, e.code ?? "PROVIDER_ERROR", "The CAD provider request failed");
  }
  console.error("[CAD] unexpected error: " + e.message);
  return sendError(c, 500, "CAD_GENERATION_FAILED", "CAD generation failed");
}

/** Runs one admitted request; admitCad frees its slot once this returns. */
async function runAdmitted(c: Context<CadEnv>, input: CadGenerateInput): Promise<Response> {
  const { config, wallet } = c.get("cad");
  try {
    const result = await config.generator.generate(input);
    console.log(
      "[CAD] ok wallet=" + wallet + " turn=" + result.design.turn +
      " attempts=" + result.diagnostics.attempts.length +
      " attribution=" + result.attribution.length +
      " in " + result.diagnostics.durationMs + "ms",
    );
    return c.json(toWireResult(result));
  } catch (err) {
    return respondWithFailure(c, err);
  }
}

/** Maps a validated request body onto the generator's input. */
function generateInput(body: CadGenerateBody): CadGenerateInput {
  return {
    prompt: body.prompt,
    ...(body.priorDesign ? { priorDesign: body.priorDesign as CadDesign } : {}),
    ...(body.images && body.images.length > 0 ? { images: body.images } : {}),
    ...(body.repairAttempts !== undefined ? { repairAttempts: body.repairAttempts } : {}),
  };
}

/** A repair round: the same input, plus the failures the client's kernel found. */
function repairInput(body: CadRepairBody): CadGenerateInput {
  return {
    prompt: body.prompt,
    priorDesign: body.priorDesign as CadDesign,
    failures: body.failures as CadFailure[],
    ...(body.repairAttempts !== undefined ? { repairAttempts: body.repairAttempts } : {}),
  };
}

/**
 * Mounts the CAD endpoints.
 * @remarks One generator instance is resolved per request rather than held for
 *   the process lifetime, so a key rotation or a corrected limit takes effect
 *   without a restart, and so an unconfigured server answers 503 per request
 *   instead of failing at boot.
 */
export default function cadRoutes(deps: CadRouteDeps = {}) {
  const app = new Hono<CadEnv>();
  const auth: MiddlewareHandler = deps.authenticateOverride ?? authenticate;

  app.post(
    "/generations",
    auth,
    validateBody(cadGenerateSchema),
    admitCad(deps),
    cadRateLimit,
    (c) => runAdmitted(c, generateInput(c.req.valid("json"))),
  );

  app.post(
    "/repairs",
    auth,
    validateBody(cadRepairSchema),
    admitCad(deps),
    cadRateLimit,
    (c) => runAdmitted(c, repairInput(c.req.valid("json"))),
  );

  return app;
}
