import { readFileSync } from "node:fs";
import { loadInstructions, type AgentEvent } from "../../core/agent";
import { answerWithResponses } from "../../core/responses";
import { configuredOpenAIModel } from "../../core/llm";
import { chatGPTAuth } from "../../core/chatgpt-auth";
import { createDecisionsClient, createDecisionsChoiceClient } from "../../core/decisions";
import type { Message } from "../../core/glm";
import { carregarCatalogoMemoria } from "../../tools/memoria/catalogo";
import { resolverCaminho } from "../../tools/memoria/caminhos";
import { MemoryBrowser } from "../../tools/memoria/navegador";
import { MEMORY_CHAT_PROFILES } from "../registry";
import { selectChatMemories, type ChatSelection } from "./selection";

export async function extrairCandidatosChat(options: {
  history: readonly Message[]; onStep?: (event: AgentEvent) => void; signal?: AbortSignal;
}): Promise<ChatSelection> {
  const apiKey = process.env.GPT_API_KEY?.trim();
  if (!apiKey) throw new Error("Configure GPT_API_KEY para selecionar memórias com Decisions.");
  const signal = AbortSignal.any([chatGPTAuth.sessionSignal(), ...(options.signal ? [options.signal] : []), AbortSignal.timeout(10 * 60_000)]);
  await chatGPTAuth.accessToken(signal);
  const decisions = { apiKey };
  const browser = new MemoryBrowser(resolverCaminho(""));
  return selectChatMemories({
    history: options.history, signal,
    model: configuredOpenAIModel(MEMORY_CHAT_PROFILES.curation.model),
    instructions: loadInstructions(MEMORY_CHAT_PROFILES.curation.instructionsFile),
    answer: answerWithResponses, evaluate: createDecisionsClient(decisions), choose: createDecisionsChoiceClient(decisions),
    catalog: carregarCatalogoMemoria(), read: (path) => readFileSync(resolverCaminho(path), "utf8"),
    browseFolders: (folder) => browser.list(folder),
    onProgress: (message) => options.onStep?.({ type: "retrieval", message }),
  });
}
