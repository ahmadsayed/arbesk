/** DeepSeek chat-completions client (OpenAI-compatible). The API key is never logged. */
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
  /** Off unless a caller asks - see buildPayload. */
  thinking?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  /** Set when there is no HTTP status, so a timeout can be retried but a user cancel not. */
  readonly reason?: TransportReason;
  constructor(message: string, status: number, code: string, reason?: TransportReason) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
    if (reason) this.reason = reason;
  }
}

export interface DeepSeekClient {
  complete(
    messages: LlmMessage[],
    signal?: AbortSignal,
  ): Promise<{ text: string; usage: TokenUsage }>;
}

export type TransportReason = "timeout" | "abort" | "network";

const PROVIDER_FAILURE_STATUS = 502;

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

function linkAbort(controller: AbortController, signal?: AbortSignal): void {
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
}

/**
 * Thinking mode is disabled on purpose: the provider default (effort "high")
 * did not answer within 240s on a test prompt, while disabled answered in 2s.
 * Enabling it needs a larger `timeoutMs`, and makes `temperature` a no-op.
 */
function buildPayload(config: DeepSeekConfig, messages: LlmMessage[]): unknown {
  return {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: toWireContent(m.content) })),
    response_format: { type: "json_object" },
    thinking: { type: config.thinking ? "enabled" : "disabled" },
    temperature: 0.2,
  };
}

/** An empty completion is a failure: a design document cannot be empty. */
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

function failureReason(
  input: AbortSignal | undefined,
  controller: AbortController,
): TransportReason {
  if (input?.aborted) return "abort";
  return controller.signal.aborted ? "timeout" : "network";
}

/** Normalises any transport failure into a ProviderError, keeping the original message. */
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
    reason,
  );
}

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null
    && (err as { name?: string }).name === "AbortError";
}

/** Re-throws an abort untouched, so it reads as a timeout or cancel, not bad JSON. */
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
        // Cleared only after the body read, so a stalled body still times out.
        clearTimeout(timer);
      }
    },
  };
}
