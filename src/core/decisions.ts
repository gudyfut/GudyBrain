/** Contrato oficial: https://developers.openai.com/api/docs/guides/decisions */
export const DECISIONS_MODEL = "gpt-6-luna";
const ENDPOINT = "https://api.openai.com/v1/decisions";

export interface DecisionPredicate {
  type: "predicate";
  instructions: string | Record<string, unknown>;
}
export type EvaluateDecisions = (state: unknown, questions: Record<string, DecisionPredicate>, signal?: AbortSignal) => Promise<Record<string, number>>;
export type ChooseDecision = (state: unknown, instructions: string, criteria: Record<string, string>, signal?: AbortSignal) => Promise<{ choice: string; confidence: number }>;
interface ClientOptions { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }
type Question = { type: "predicate"; name: string; instructions: string }
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description: string }[] };

export class DecisionsError extends Error {
  constructor(message: string, readonly kind: "configuration" | "http" | "refusal" | "protocol" | "network" | "timeout", readonly status?: number) {
    super(message);
    this.name = "DecisionsError";
  }
}

export function createDecisionsClient(options: ClientOptions): EvaluateDecisions {
  return async (state, questions, signal) => {
    const entries = Object.entries(questions);
    const payload: Question[] = entries.map(([name, question]) => ({
      type: "predicate", name, instructions: typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions),
    }));
    const answers = await request(options, state, payload, signal);
    const scores: [string, number][] = [];
    for (const [name] of entries) {
      const answer = answers.get(name)!;
      if (answer.type !== "predicate" || !probability(answer.probability)) throw invalid();
      scores.push([name, answer.probability]);
    }
    return Object.fromEntries(scores);
  };
}

export function createDecisionsChoiceClient(options: ClientOptions): ChooseDecision {
  return async (state, instructions, criteria, signal) => {
    const choices = Object.entries(criteria).map(([value, description]) => ({ value, description }));
    if (choices.length < 2 || choices.length > 255) throw new DecisionsError("Decisions exige entre 2 e 255 opções por escolha.", "configuration");
    const answers = await request(options, state, [{ type: "choice", name: "route", instructions, choices }], signal);
    const answer = answers.get("route")!;
    if (answer.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice)
      || !probability(answer.confidence) || !Array.isArray(answer.probabilities) || answer.probabilities.length !== choices.length) throw invalid();
    const seen = new Set<string>();
    let sum = 0;
    for (const entry of answer.probabilities) {
      if (!record(entry) || typeof entry.value !== "string" || !Object.hasOwn(criteria, entry.value)
        || seen.has(entry.value) || !probability(entry.probability)) throw invalid();
      seen.add(entry.value);
      sum += entry.probability;
    }
    if (Math.abs(sum - 1) > 0.02) throw invalid();
    return { choice: answer.choice, confidence: answer.confidence };
  };
}

async function request(options: ClientOptions, state: unknown, questions: Question[], signal?: AbortSignal): Promise<Map<string, Record<string, unknown>>> {
  signal?.throwIfAborted();
  if (!options.apiKey.trim()) throw new DecisionsError("Configure GPT_API_KEY no .env para usar a Decisions API.", "configuration");
  if (!questions.length || questions.length > 400) throw new DecisionsError("Decisions exige entre 1 e 400 perguntas por chamada.", "configuration");
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let raw: unknown;
  try {
    const response = await (options.fetch ?? fetch)(ENDPOINT, {
      method: "POST", redirect: "error", signal: combined,
      headers: { Authorization: "Bearer " + options.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: DECISIONS_MODEL, input: JSON.stringify(state), questions }),
    });
    combined.throwIfAborted();
    if (!response.ok) {
      // Error bodies may echo personal input or credentials. Never expose them.
      void response.body?.cancel().catch(() => {});
      const message = response.status === 401 ? "GPT_API_KEY não foi aceita pela Decisions API. Confira a chave no .env."
        : response.status === 403 || response.status === 404 ? "O projeto OpenAI não tem acesso à Decisions API com gpt-6-luna. Confira as permissões."
        : response.status === 429 ? "O limite ou saldo de créditos da API OpenAI foi atingido. Confira a cota da Decisions API."
        : response.status >= 500 ? "A Decisions API está temporariamente indisponível. Tente novamente mais tarde."
        : "A Decisions API não aceitou a solicitação. Confira a configuração do projeto.";
      throw new DecisionsError(`${message} [HTTP ${response.status}]`, "http", response.status);
    }
    try { raw = await response.json(); }
    catch { combined.throwIfAborted(); throw invalid(); }
    combined.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw new DecisionsError("A Decisions API excedeu o tempo limite. Tente novamente.", "timeout");
    if (error instanceof DecisionsError) throw error;
    throw new DecisionsError("Não foi possível conectar à Decisions API. Confira a conexão.", "network");
  }
  if (!record(raw) || !Array.isArray(raw.answers) || raw.answers.length !== questions.length) throw invalid();
  const expected = new Set(questions.map((question) => question.name));
  const answers = new Map<string, Record<string, unknown>>();
  for (const answer of raw.answers) {
    if (!record(answer) || typeof answer.name !== "string" || !expected.has(answer.name) || answers.has(answer.name)) throw invalid();
    if (answer.type === "refusal") throw new DecisionsError("A Decisions API recusou uma avaliação. Nenhuma decisão será presumida; reformule o pedido.", "refusal");
    answers.set(answer.name, answer);
  }
  return answers;
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function probability(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function invalid(): DecisionsError { return new DecisionsError("Resposta inválida ou incompleta da Decisions API. A operação foi interrompida.", "protocol"); }
