import { answerWithResponses } from "../core/responses";
import { configuredOpenAIModel } from "../core/llm";
import { loadEnv } from "../core/env";

// Diagnóstico EXPLÍCITO: consome a cota ChatGPT e usa somente uma pergunta sintética.
loadEnv();
const answer = await answerWithResponses({
  model: configuredOpenAIModel(),
  instructions: "Responda em português, somente ao texto fornecido.",
  input: "Teste de integração. Responda exatamente: Integração funcionando.",
  onContent: (chunk) => process.stdout.write(chunk),
});
if (!answer.trim()) throw new Error("Resposta vazia.");
process.stdout.write("\n");
