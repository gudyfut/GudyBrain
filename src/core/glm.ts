/**
 * Cliente minimo para a API da z.ai (GLM), compativel com o formato OpenAI.
 * Ponto de entrada para construir agentes: mantem o historico e faz
 * chamadas com streaming opcional.
 */

const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";
const RATE_LIMIT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;
const NON_RETRYABLE_RATE_LIMIT_CODES = new Set([
  "1304",
  "1308",
  "1309",
  "1310",
  "1311",
  "1313",
]);

/** Base URL da z.ai. Override com GLM_BASE_URL pra usar o endpoint do Coding
 *  Plan (https://api.z.ai/api/coding/paas/v4) — ver docs.z.ai/devpack. */
function apiUrl(): string {
  const base = (process.env.GLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

/** Mensagem de sistema ou usuario. */
export interface BasicMessage {
  role: "system" | "user";
  content: string;
}

/** Uma chamada de ferramenta feita pelo modelo. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Mensagem do assistente (pode incluir chamadas de ferramenta). */
export interface AssistantMessage {
  role: "assistant";
  content: string;
  tool_calls?: ToolCall[];
}

/** Resultado de uma ferramenta, devolvido ao modelo. */
export interface ToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}

export type Message = BasicMessage | AssistantMessage | ToolMessage;

/** Definicao de uma ferramenta no formato OpenAI. */
export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object; // JSON Schema
  };
}

export type ToolChoice = "auto" | "none" | { type: "function"; function: { name: string } };

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  thinking?: "enabled" | "disabled";
  signal?: AbortSignal;
}

/** Callbacks opcionais para streaming. O glm-4.5-flash e um modelo de
 *  raciocinio: ele gera onReasoning (pensamento) primeiro e depois
 *  onContent (resposta final). */
export interface StreamCallbacks {
  onContent?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
}

export class GlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly apiCode: string | null = null,
  ) {
    super(message);
    this.name = "GlmError";
  }
}

interface ApiMessage {
  role: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
}
interface ApiResponse {
  choices?: {
    finish_reason?: string;
    message?: ApiMessage;
    delta?: ApiMessage;
  }[];
  usage?: Record<string, number>;
}

interface GlmApiErrorDetails {
  readonly code: string | null;
  readonly message: string | null;
  readonly nextReset: string | null;
}

/**
 * Envia o historico de mensagens e retorna a resposta final (content).
 * Com `callbacks`, faz streaming: onReasoning durante o pensamento e
 * onContent na resposta final.
 */
export async function chat(
  messages: Message[],
  apiKey: string,
  options: ChatOptions = {},
  callbacks?: StreamCallbacks,
): Promise<string> {
  const {
    model = "glm-5-turbo",
    temperature = 0.7,
    maxTokens = 4096,
    responseFormat,
    thinking,
    signal,
  } = options;

  const res = await requestGlm(apiKey, {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: Boolean(callbacks),
      ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
      ...(thinking ? { thinking: { type: thinking } } : {}),
    }, signal);

  if (!callbacks) {
    const data = (await res.json()) as ApiResponse;
    return data.choices?.[0]?.message?.content ?? "";
  }

  return streamResponse(res, callbacks);
}

/**
 * Chamada NAO-streaming usada no loop do agente. Retorna a mensagem
 * completa do assistente, incluindo eventuais chamadas de ferramenta
 * (tool_calls) e o finish_reason.
 */
export async function chatStep(
  messages: Message[],
  apiKey: string,
  options: ChatOptions & { tools?: Tool[]; toolChoice?: ToolChoice } = {},
  callbacks?: StreamCallbacks,
): Promise<{ message: AssistantMessage; finishReason: string }> {
  const {
    model = "glm-5-turbo",
    temperature = 0.7,
    maxTokens = 4096,
    responseFormat,
    thinking,
    tools,
    toolChoice,
    signal,
  } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: Boolean(callbacks),
  };
  if (responseFormat) body.response_format = { type: responseFormat };
  if (thinking) body.thinking = { type: thinking };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? "auto";
  }

  const res = await requestGlm(apiKey, body, signal);

  if (callbacks) return streamStepResponse(res, callbacks);

  const data = (await res.json()) as ApiResponse;
  const choice = data.choices?.[0];
  const msg = choice?.message;
  return {
    message: {
      role: "assistant",
      content: msg?.content ?? "",
      tool_calls: msg?.tool_calls,
    },
    finishReason: choice?.finish_reason ?? "stop",
  };
}

async function requestGlm(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(apiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (response.ok) return response;

    const responseBody = await response.text().catch(() => "");
    const details = parseGlmApiError(responseBody);
    const retryable = response.status === 429
      && !isPermanentRateLimit(details)
      && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length;
    if (!retryable) {
      throw new GlmError(
        formatGlmApiError(response.status, details, attempt),
        response.status,
        responseBody,
        details.code,
      );
    }

    const configuredDelay = RATE_LIMIT_RETRY_DELAYS_MS[attempt] ?? 30_000;
    const delay = Math.max(configuredDelay, retryAfterMilliseconds(response));
    console.warn(
      `[z.ai] limite temporário${details.code ? ` ${details.code}` : ""}; `
      + `nova tentativa ${attempt + 2}/${RATE_LIMIT_RETRY_DELAYS_MS.length + 1} `
      + `em ${Math.ceil(delay / 1_000)}s.`,
    );
    await wait(delay, signal);
  }
}

export function parseGlmApiError(body: string): GlmApiErrorDetails {
  if (!body.trim()) return { code: null, message: null, nextReset: null };
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const nested = parsed.error && typeof parsed.error === "object"
      ? parsed.error as Record<string, unknown>
      : {};
    return {
      code: cleanApiValue(nested.code ?? parsed.code),
      message: cleanApiValue(
        nested.message ?? nested.msg ?? parsed.message ?? parsed.msg ?? parsed.error,
      ),
      nextReset: cleanApiValue(
        nested.next_flush_time ?? nested.next_reset_time
          ?? parsed.next_flush_time ?? parsed.next_reset_time,
      ),
    };
  } catch {
    return { code: null, message: cleanApiValue(body), nextReset: null };
  }
}

function isPermanentRateLimit(details: GlmApiErrorDetails): boolean {
  if (details.code && NON_RETRYABLE_RATE_LIMIT_CODES.has(details.code)) return true;
  return /(?:balance|saldo|daily|weekly|monthly|expired|subscription|quota.*(?:exhausted|reached)|fair use)/i
    .test(details.message ?? "");
}

function formatGlmApiError(
  status: number,
  details: GlmApiErrorDetails,
  attempts: number,
): string {
  const detail = [
    details.code ? `código ${details.code}` : null,
    details.message,
    details.nextReset ? `renovação: ${details.nextReset}` : null,
  ].filter(Boolean).join(" · ");
  const exhausted = status === 429 && attempts >= RATE_LIMIT_RETRY_DELAYS_MS.length
    ? ` após ${attempts + 1} tentativas`
    : "";
  return `Falha na API z.ai (${status})${exhausted}${detail ? `: ${detail}` : ""}`;
}

function cleanApiValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : null;
}

function retryAfterMilliseconds(response: Response): number {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

async function streamStepResponse(
  res: Response,
  cb: StreamCallbacks,
): Promise<{ message: AssistantMessage; finishReason: string }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Resposta sem corpo (streaming).");

  const decoder = new TextDecoder();
  const toolCalls = new Map<number, ToolCall>();
  let buffer = "";
  let content = "";
  let finishReason = "stop";

  const consume = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return true;
    try {
      const json = JSON.parse(payload) as ApiResponse;
      const choice = json.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta;
      if (!delta) return false;

      const reasoning = delta.reasoning_content ?? "";
      const text = delta.content ?? "";
      if (reasoning) cb.onReasoning?.(reasoning);
      if (text) {
        content += text;
        cb.onContent?.(text);
      }

      for (const partial of delta.tool_calls ?? []) {
        const indexed = partial as ToolCall & { index?: number };
        const index = indexed.index ?? toolCalls.size;
        const current = toolCalls.get(index) ?? {
          id: "",
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (partial.id) current.id += partial.id;
        if (partial.function?.name) current.function.name += partial.function.name;
        if (partial.function?.arguments) {
          current.function.arguments += partial.function.arguments;
        }
        toolCalls.set(index, current);
      }
    } catch {
      // Evento SSE desconhecido: o proximo evento ainda pode ser valido.
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (consume(line)) {
        return {
          message: {
            role: "assistant",
            content,
            tool_calls: toolCalls.size ? [...toolCalls.values()] : undefined,
          },
          finishReason,
        };
      }
    }
  }

  if (buffer) consume(buffer);
  return {
    message: {
      role: "assistant",
      content,
      tool_calls: toolCalls.size ? [...toolCalls.values()] : undefined,
    },
    finishReason,
  };
}

async function streamResponse(
  res: Response,
  cb: StreamCallbacks,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Resposta sem corpo (streaming).");

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return full;

      try {
        const json = JSON.parse(payload) as ApiResponse;
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        const content = delta.content ?? "";
        const reasoning = delta.reasoning_content ?? "";
        if (reasoning) cb.onReasoning?.(reasoning);
        if (content) {
          full += content;
          cb.onContent?.(content);
        }
      } catch {
        // pedaco JSON incompleto, ignora
      }
    }
  }

  return full;
}
