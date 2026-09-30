import { configuredOpenAIModel } from "./llm";
import { createResponsesProvider, type ResponsesDiagnostic } from "./responses";

/** Diagnóstico explícito, sintético e sem Jev ou leitura de memória. Consome uso do plano. */
export async function diagnoseResponses(structured = false, signal?: AbortSignal) {
  const diagnostics: ResponsesDiagnostic[] = [];
  const started = Date.now();
  const model = configuredOpenAIModel();
  const provider = createResponsesProvider({ timeoutMs: 30_000, onDiagnostic: (entry) => diagnostics.push(entry) });
  try {
    const answer = await provider({ model, signal,
      instructions: structured ? "Retorne apenas o objeto JSON solicitado." : "Teste de conexão. Responda somente OK.",
      input: structured ? 'Retorne {"ok":true}.' : "Olá. Responda OK.",
      ...(structured ? { outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } : {}),
    });
    const valid = structured ? JSON.parse(answer).ok === true : answer.trim() === "OK";
    return { ok: valid, model, elapsedMs: Date.now() - started, answerChars: answer.length, diagnostics,
      ...(!valid ? { error: "O modelo respondeu, mas não seguiu o formato do teste." } : {}) };
  } catch (error) {
    return { ok: false, model, elapsedMs: Date.now() - started, diagnostics,
      error: error instanceof Error ? error.message : "Falha ao testar a Responses API." };
  }
}
