/** Contrato HTTP oficial: https://docs.typesafe.ai/api (Noul). */
export interface JevQuestion {
  type: "noul";
  instructions: string | Record<string, unknown>;
  criteria?: { true: string; false: string };
}

export type EvaluateJev = (
  state: unknown,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
) => Promise<Record<string, number>>;

export function createJevClient(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): EvaluateJev {
  return async (state, questions, signal) => {
    signal?.throwIfAborted();
    if (!options.apiKey.trim()) throw new Error("Configure TYPESAFE_API_KEY no .env para consultar a memória com Jev.");
    const timeout = AbortSignal.timeout(30_000);
    const response = await (options.fetch ?? fetch)("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model, state, questions }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      // O corpo remoto pode repetir dados pessoais enviados; não o exponha na UI/log.
      throw new Error(`Jev indisponível (HTTP ${response.status}). Verifique a chave, o acesso e a cota da TypeSafe.`);
    }
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.answers)) throw new Error("Resposta inválida do Jev: answers ausente.");
    const result: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      const answer: unknown = body.answers[key];
      if (!isRecord(answer) || answer.type !== "noul" || typeof answer.noul !== "number"
        || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
        throw new Error("Resposta inválida ou incompleta do Jev.");
      }
      result[key] = answer.noul;
    }
    return result;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ChooseJev = (state: unknown, instructions: string, criteria: Record<string, string>, signal?: AbortSignal) => Promise<{ choice: string; confidence: number }>;

export function createJevChoiceClient(options: { apiKey: string; model: string; fetch?: typeof fetch }): ChooseJev {
  return async (state, instructions, criteria, signal) => {
    signal?.throwIfAborted();
    if (!options.apiKey.trim()) throw new Error("Configure TYPESAFE_API_KEY para selecionar memórias.");
    const response = await (options.fetch ?? fetch)("https://api.typesafe.ai/v1/systemone", {
      method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model, state, questions: { route: { type: "choice", instructions, criteria } } }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Seleção Jev indisponível (HTTP ${response.status}).`);
    const body: unknown = await response.json();
    const answer = isRecord(body) && isRecord(body.answers) ? body.answers.route : undefined;
    if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string"
      || !Object.hasOwn(criteria, answer.choice) || typeof answer.confidence !== "number"
      || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1
      || !isRecord(answer.probabilities)) throw new Error("Seleção Jev inválida.");
    let sum = 0;
    for (const key of Object.keys(criteria)) {
      const probability = answer.probabilities[key];
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("Probabilidades Jev inválidas.");
      sum += probability;
    }
    if (Math.abs(sum - 1) > 0.02) throw new Error("Distribuição Jev inválida.");
    return { choice: answer.choice, confidence: answer.confidence };
  };
}
