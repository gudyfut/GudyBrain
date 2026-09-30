/** Contrato do modelo; a orquestração e a memória pertencem ao assistente. */
export interface AnswerRequest {
  model: string;
  instructions: string;
  input: string;
  signal?: AbortSignal;
  onContent?: (chunk: string) => void;
  outputSchema?: Record<string, unknown>;
}

export type AnswerProvider = (request: AnswerRequest) => Promise<string>;

export function configuredOpenAIModel(fallback = "gpt-6-luna"): string {
  return process.env.OPENAI_MODEL?.trim() || fallback;
}
