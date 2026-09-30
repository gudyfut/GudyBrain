import { chatGPTAuth } from "./chatgpt-auth";
import type { AnswerProvider, AnswerRequest } from "./llm";
import { openAIError } from "./openai-errors";

const ENDPOINT = "https://api.openai.com/v1/responses";

/** Apenas estrutura e contagens; nunca texto, histórico ou credenciais. */
export interface ResponsesDiagnostic {
  phase: "http" | "completed";
  model: string;
  httpStatus: number;
  contentType: string | null;
  protocol?: "sse" | "json";
  eventTypes?: string[];
  streamedChars?: number;
  output?: Array<{ type: string; role?: string; content: Array<{ type: string; chars: number }> }>;
}

/** Somente geração: sem ferramentas, subprocessos ou acesso ao sistema de arquivos. */
export function responsesBody(request: AnswerRequest): Record<string, unknown> {
  return {
    model: request.model, instructions: request.instructions,
    input: [{ role: "user", content: request.input }], store: false, stream: true,
    ...(request.outputSchema ? { text: { format: { type: "json_schema", name: "assistant_result", strict: true, schema: request.outputSchema } } } : {}),
  };
}

export function createResponsesProvider(options: {
  fetch?: typeof fetch; accessToken?: (signal?: AbortSignal) => Promise<string>; timeoutMs?: number;
  onDiagnostic?: (diagnostic: ResponsesDiagnostic) => void;
} = {}): AnswerProvider {
  const fetcher = options.fetch ?? fetch;
  const accessToken = options.accessToken ?? ((signal) => chatGPTAuth.accessToken(signal));
  return async (request) => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 180_000);
    const signal = AbortSignal.any([timeout, ...(request.signal ? [request.signal] : []),
      ...(!options.accessToken ? [chatGPTAuth.sessionSignal()] : [])]);
    signal.throwIfAborted();
    try {
      const token = await accessToken(signal);
      signal.throwIfAborted();
      const response = await fetcher(ENDPOINT, { method: "POST", redirect: "error", signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(responsesBody(request)) });
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("openai-request-id") ?? undefined;
      const diagnostic: ResponsesDiagnostic = { phase: "http", model: request.model, httpStatus: response.status, contentType: response.headers.get("content-type") };
      options.onDiagnostic?.(diagnostic);
      if (!response.ok) throw openAIError(response.status, await response.json().catch(() => undefined), requestId);
      const metadata = responseMetadata(response, requestId);
      if (!response.body) throw new Error(`A OpenAI retornou uma resposta sem conteúdo. ${metadata}`);
      // O corpo define o protocolo: gateways podem omitir ou alterar Content-Type.
      // Uma resposta JSON só é aceita com a mesma confirmação terminal exigida no SSE.
      const content = await readResponseStream(response.body, request, signal, requestId, metadata,
        (detail) => options.onDiagnostic?.({ ...diagnostic, phase: "completed", ...detail }));
      signal.throwIfAborted();
      if (request.outputSchema) {
        try { JSON.parse(content); } catch { throw new Error("A Responses API não entregou a saída JSON esperada."); }
      }
      return content;
    } catch (error) {
      if (request.signal?.aborted) request.signal.throwIfAborted();
      if (timeout.aborted) throw new Error("A Responses API excedeu o limite de tempo da resposta.");
      if (error instanceof TypeError) throw new Error("Não foi possível conectar à Responses API. Confira a conexão e tente novamente.");
      throw error;
    }
  };
}

export const answerWithResponses = createResponsesProvider();

function responseMetadata(response: Response, requestId?: string): string {
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const safeType = type && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : "não informado";
  const safeId = requestId && /^[a-zA-Z0-9_.-]{1,150}$/.test(requestId) ? `; ${requestId}` : "";
  return `[HTTP ${response.status}; tipo ${safeType}${safeId}]`;
}

async function readResponseStream(body: ReadableStream<Uint8Array>, request: AnswerRequest, signal: AbortSignal, requestId?: string, metadata = "",
  onDiagnostic?: (detail: Pick<ResponsesDiagnostic, "protocol" | "eventTypes" | "streamedChars" | "output">) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", data: string[] = [], text = "", result: string | undefined, bytes = 0;
  let protocol: "sse" | "json" | undefined;
  const eventTypes = new Set<string>();
  const finishedItems = new Map<string, Record<string, unknown>>();
  const finishedTexts = new Map<string, string>();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const dispatchEvent = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`A Responses API retornou um evento inválido. ${metadata}`);
    const event = value as Record<string, unknown>;
    if (typeof event.type === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(event.type)) eventTypes.add(event.type);
    const response = event.response && typeof event.response === "object" ? event.response as Record<string, unknown> : undefined;
    if (event.type === "error" || event.type === "response.failed") {
      const error = response?.error ?? event.error ?? event;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const status = code.includes("usage_limit") ? 429 : code.includes("not_eligible") || code.includes("route_not_supported") ? 403
        : code.includes("invalid_user") ? 401 : code.includes("unsupported_capability") ? 400 : code.includes("unavailable") ? 503 : 502;
      throw openAIError(status, error, requestId);
    }
    if (event.type === "response.incomplete") throw new Error("A OpenAI encerrou a resposta antes de concluí-la. Tente novamente.");
    if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type && (typeof item.type !== "string" || !["message", "reasoning"].includes(item.type))) throw new Error("O modelo tentou usar uma ação fora do contrato de geração de resposta.");
      if (event.type === "response.output_item.done" && item && typeof item === "object") {
        const key = typeof event.output_index === "number" ? String(event.output_index)
          : typeof item.id === "string" ? item.id : `item-${finishedItems.size}`;
        finishedItems.set(key, item);
      }
    }
    if (event.type === "response.refusal.delta") throw new Error("O modelo recusou esta solicitação.");
    if (event.type === "response.output_text.delta") {
      if (typeof event.delta !== "string") throw new Error("O modelo retornou um fragmento inválido.");
      text += event.delta;
      if (!request.outputSchema) request.onContent?.(event.delta);
    }
    if (event.type === "response.output_text.done") {
      if (typeof event.text !== "string") throw new Error("O modelo retornou um texto final inválido.");
      finishedTexts.set(`${event.output_index ?? 0}:${event.content_index ?? 0}`, event.text);
    }
    if (event.type === "response.completed") {
      if (!response || response.status !== "completed" || !Array.isArray(response.output)) throw new Error("A Responses API não confirmou a conclusão da resposta.");
      const safeType = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) ? value : "unknown";
      onDiagnostic?.({ protocol, eventTypes: [...eventTypes], streamedChars: text.length,
        output: response.output.map((item: Record<string, unknown>) => ({ type: safeType(item?.type), role: item?.role === "assistant" ? "assistant" : undefined,
          content: Array.isArray(item?.content) ? item.content.map((part: Record<string, unknown>) => ({ type: safeType(part?.type), chars: typeof part?.text === "string" ? part.text.length : 0 })) : [] })) });
      const parts: string[] = [];
      // A confirmação pode trazer só metadados. Os itens/textos já chegaram pelo SSE.
      const output = response.output.length ? response.output : [...finishedItems.values()];
      for (const item of output as Array<{ type?: string; role?: string; content?: Array<{ type?: string; text?: string }> }>) {
        if (!item || typeof item !== "object") throw new Error("A saída do modelo está fora do contrato de resposta.");
        if (item.type === "reasoning") continue;
        if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) throw new Error("A saída do modelo está fora do contrato de resposta.");
        for (const part of item.content) {
          if (!part || typeof part !== "object") throw new Error("O modelo retornou conteúdo incompatível com uma resposta textual.");
          if (part.type === "refusal") throw new Error("O modelo recusou esta solicitação.");
          if (part.type !== "output_text" || typeof part.text !== "string") throw new Error("O modelo retornou conteúdo incompatível com uma resposta textual.");
          parts.push(part.text);
        }
      }
      result = parts.join("");
      if (!output.length && protocol === "sse") result = finishedTexts.size ? [...finishedTexts.values()].join("") : text;
      if (!result.trim()) throw new Error(`A OpenAI confirmou a conclusão, mas não entregou texto para responder (itens: ${response.output.length}; fragmentos: ${text.length} caracteres). ${metadata}`);
      // Alguns servidores entregam apenas o item final. Nunca duplicar texto já transmitido.
      if (!request.outputSchema && !text) request.onContent?.(result);
      else if (!request.outputSchema && text !== result) throw new Error("A resposta final diverge do texto transmitido. Tente novamente.");
    }
  };
  const dispatch = () => {
    if (!data.length) return;
    const payload = data.join("\n"); data = [];
    if (payload === "[DONE]") return;
    let event: unknown;
    try { event = JSON.parse(payload); }
    catch { throw new Error(`A Responses API retornou um evento inválido. ${metadata}`); }
    dispatchEvent(event);
  };
  const finishJSON = () => {
    let value: unknown;
    try { value = JSON.parse(buffer); }
    catch { throw new Error(`A OpenAI retornou um JSON inválido. ${metadata}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`A OpenAI retornou um formato incompatível. ${metadata}`);
    const object = value as Record<string, unknown>;
    if (object.object === "response") {
      const type = object.status === "completed" ? "response.completed" : object.status === "incomplete" ? "response.incomplete" : "response.failed";
      dispatchEvent({ type, response: object });
    } else if (object.error || object.type === "error") {
      dispatchEvent({ type: "error", error: object.error ?? object });
    } else if (["response.completed", "response.failed", "response.incomplete"].includes(String(object.type))) {
      dispatchEvent(object);
    } else throw new Error(`A OpenAI retornou um formato incompatível. ${metadata}`);
  };
  const lines = (final = false) => {
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, ""); buffer = buffer.slice(end + 1);
      if (!line) dispatch();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      if (result !== undefined) return;
    }
    if (final) {
      if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, "").replace(/\r$/, ""));
      dispatch();
    }
  };
  try {
    while (result === undefined) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) {
        buffer += decoder.decode();
        if (protocol === "json") finishJSON(); else lines(true);
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 2_000_000) throw new Error("A resposta da OpenAI excedeu o limite de tamanho.");
      buffer += decoder.decode(chunk.value, { stream: true });
      if (!protocol && buffer.trimStart()) protocol = buffer.trimStart().startsWith("{") ? "json" : "sse";
      if (protocol === "sse") lines();
    }
    if (result === undefined) throw new Error(`A conexão terminou sem confirmar a resposta completa. ${metadata}`);
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
