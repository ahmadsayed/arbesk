/**
 * DeepSeek chat-completions client (OpenAI-compatible).
 * @remarks Images ride inline as base64 data URLs - the same shape the repo
 *   already uses for generation input. The API key is never logged.
 */
import type { TokenUsage } from "../types.ts";

export interface LlmContentBlock {
  type: "text" | "image";
  text?: string;
  data?: string;
  mime?: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentBlock[];
}

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Transport/auth failure from the provider, carrying the documented code. */
export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }
}

export interface DeepSeekClient {
  complete(
    messages: LlmMessage[],
    signal?: AbortSignal,
  ): Promise<{ text: string; usage: TokenUsage }>;
}

/** Why a request failed, when there is no HTTP status to report. */
type TransportReason = "timeout" | "abort" | "network";

/** Status for failures that carry no HTTP status of their own (gateway-class). */
const PROVIDER_FAILURE_STATUS = 502;

/** Maps an HTTP status to the documented provider error code. */
function providerErrorCode(status: number): string {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_FAILED";
  if (status === 402) return "PROVIDER_CREDITS_EXHAUSTED";
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  return "PROVIDER_ERROR";
}

function toWireContent(content: LlmMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((b) =>
    b.type === "image"
      ? { type: "image_url", image_url: { url: "data:" + b.mime + ";base64," + b.data } }
      : { type: "text", text: b.text ?? "" });
}

/** Links a caller-supplied signal to the request controller, if one was given. */
function linkAbort(controller: AbortController, signal?: AbortSignal): void {
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
}

/** Builds the OpenAI-compatible request body for one turn. */
function buildPayload(config: DeepSeekConfig, messages: LlmMessage[]): unknown {
  return {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: toWireContent(m.content) })),
    response_format: { type: "json_object" },
    temperature: 0.2,
  };
}

/**
 * Extracts the completion text and token usage.
 * @remarks An empty completion is a failure, not a silent empty string: a
 *   design document cannot be empty, and the caller would otherwise hand an
 *   unparseable result to the design parser.
 */
function readCompletion(json: any): { text: string; usage: TokenUsage } {
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    throw new ProviderError("deepseek returned no content", 502, "PROVIDER_ERROR");
  }
  return {
    text,
    usage: {
      prompt: Number(json?.usage?.prompt_tokens ?? 0),
      completion: Number(json?.usage?.completion_tokens ?? 0),
    },
  };
}

/**
 * Classifies why a request ended: the caller gave up, our timeout fired, or the
 * network did.
 */
function failureReason(
  input: AbortSignal | undefined,
  controller: AbortController,
): TransportReason {
  if (input?.aborted) return "abort";
  return controller.signal.aborted ? "timeout" : "network";
}

/**
 * Normalizes anything the transport layer throws into the documented contract.
 * @remarks Nothing is swallowed - the original message travels in the text, so
 *   a timeout still reads as a timeout - but every failure reaches the caller
 *   as one type, instead of every caller needing its own instanceof fallback.
 */
function transportFailure(
  err: unknown,
  reason: TransportReason,
  timeoutMs: number,
): ProviderError {
  if (err instanceof ProviderError) return err;
  const detail = err instanceof Error ? err.message : String(err);
  const what = reason === "timeout"
    ? "request timed out after " + timeoutMs + "ms"
    : reason === "abort" ? "request aborted by the caller" : "transport failure";
  return new ProviderError(
    "deepseek " + what + ": " + detail,
    PROVIDER_FAILURE_STATUS,
    "PROVIDER_ERROR",
  );
}

/** True for the abort error a fetch body read raises when its signal fires. */
function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null
    && (err as { name?: string }).name === "AbortError";
}

/**
 * Reads the completion body, reporting an unparseable one as a provider failure.
 * @remarks An abort is re-thrown untouched so the caller can report it as the
 *   timeout or caller-cancel that it is, rather than as malformed JSON.
 */
async function readJsonBody(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch (err) {
    if (isAbort(err)) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProviderError(
      "deepseek returned a body that is not valid JSON: " + detail,
      PROVIDER_FAILURE_STATUS,
      "PROVIDER_ERROR",
    );
  }
}

export function createDeepSeekClient(config: DeepSeekConfig): DeepSeekClient {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 120000;

  return {
    async complete(messages, signal) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      linkAbort(controller, signal);

      try {
        const response = await doFetch(
          config.baseUrl.replace(/\/+$/, "") + "/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer " + config.apiKey,
            },
            body: JSON.stringify(buildPayload(config, messages)),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new ProviderError(
            "deepseek " + response.status + ": " + body.slice(0, 300),
            response.status,
            providerErrorCode(response.status),
          );
        }

        return readCompletion(await readJsonBody(response));
      } catch (err) {
        throw transportFailure(err, failureReason(signal, controller), timeoutMs);
      } finally {
        // Cleared here and nowhere earlier: the timer stays armed through the
        // body read, so a server that sends headers then stalls still times out.
        clearTimeout(timer);
      }
    },
  };
}
