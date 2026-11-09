import { loadEnv } from "../core/env";
import { resolveProjectPath } from "../core/project-root";
import { createDecisionsClient } from "../core/decisions";
import { answerWithResponses } from "../core/responses";
import type { AnswerProvider } from "../core/llm";
import { MemoryConversation } from "../agents/conversante/memory-conversation";
import type { MemoryNode } from "../tools/memoria/navegador";

// Diagnóstico explícito com memórias fictícias; faz chamadas reais ao Decisions e Responses API.
loadEnv(resolveProjectPath(".env"));
const key = process.env.GPT_API_KEY?.trim();
if (!key) throw new Error("GPT_API_KEY não configurada.");
const seconds = (duration: number) => `${(duration / 1000).toFixed(2)} s`;
const timed = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  try { return await task(); }
  finally { console.log(`${label}: ${seconds(performance.now() - start)}`); }
};
const decisions = createDecisionsClient({ apiKey: key });
let decisionsCalls = 0;
let inspectionCalls = 0;
const files: Record<string, string> = {
  "aurora.md": "---\ntitle: Projeto Aurora\ndescription: Protótipo fictício da equipe Aurora.\n---\n# Projeto Aurora\nA equipe fará um encontro na sexta-feira para revisar o protótipo.",
  "compras.md": "---\ntitle: Lista de compras\ndescription: Compras fictícias de uma festa.\n---\n# Compras\nPão e café.",
};
const nodes: MemoryNode[] = [
  { path: "aurora.md", kind: "file", title: "Projeto Aurora", description: "Protótipo fictício da equipe Aurora." },
  { path: "compras.md", kind: "file", title: "Lista de compras", description: "Compras fictícias de uma festa." },
];
const browser = {
  list: (path: string): MemoryNode[] => path ? [] : nodes,
  read: (path: string): string => {
    if (!Object.hasOwn(files, path)) throw new Error("Arquivo sintético desconhecido.");
    return files[path]!;
  },
};
const answer: AnswerProvider = (request) => timed("Responses API, resposta final", () => answerWithResponses(request));
const inspect: AnswerProvider = (request) => {
  inspectionCalls++;
  return timed(`Responses API, inspeção ${inspectionCalls}`, () => answerWithResponses(request));
};
const agent = new MemoryConversation({ browser, answer, inspect,
  evaluate: (state, questions, signal) => {
    decisionsCalls++;
    return timed(`Decisions, chamada ${decisionsCalls} (${Object.keys(questions).length} decisão/decisões)`, () => decisions(state, questions, signal));
  },
});
const start = performance.now();
await agent.run("O que a equipe do projeto Aurora fará na sexta-feira?");
console.log(`Cérebro completo: ${seconds(performance.now() - start)}`);
console.log(`Chamadas: Decisions ${decisionsCalls}; inspeção Responses API ${inspectionCalls}; arquivos finais ${agent.lastRetrieval?.files.length ?? 0}.`);
