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

export function createDeepSeekClient(config: DeepSeekConfig): DeepSeekClient {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 120000;

  return {
    async complete(messages, signal) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      linkAbort(controller, signal);

      let response: Response;
      try {
        response = await doFetch(config.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + config.apiKey,
          },
          body: JSON.stringify(buildPayload(config, messages)),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderError(
          "deepseek " + response.status + ": " + body.slice(0, 300),
          response.status,
          providerErrorCode(response.status),
        );
      }

      return readCompletion(await response.json());
    },
  };
}
