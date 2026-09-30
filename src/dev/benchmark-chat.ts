import { loadEnv } from "../core/env";
import { resolveProjectPath } from "../core/project-root";
import { createJevClient } from "../core/jev";
import { answerWithResponses } from "../core/responses";
import type { AnswerProvider } from "../core/llm";
import { JevConversation } from "../agents/conversante/jev-conversation";
import type { MemoryNode } from "../tools/memoria/navegador";

// Diagnóstico explícito com memórias fictícias; faz chamadas reais ao Jev e Responses API.
loadEnv(resolveProjectPath(".env"));
const key = process.env.TYPESAFE_API_KEY?.trim();
if (!key) throw new Error("TYPESAFE_API_KEY não configurada.");
const seconds = (duration: number) => `${(duration / 1000).toFixed(2)} s`;
const timed = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  try { return await task(); }
  finally { console.log(`${label}: ${seconds(performance.now() - start)}`); }
};
const jev = createJevClient({ apiKey: key, model: process.env.JEV_MODEL?.trim() || "jev-latest" });
let jevCalls = 0;
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
const agent = new JevConversation({ browser, answer, inspect,
  evaluate: (state, questions, signal) => {
    jevCalls++;
    return timed(`Jev, chamada ${jevCalls} (${Object.keys(questions).length} decisão/decisões)`, () => jev(state, questions, signal));
  },
});
const start = performance.now();
await agent.run("O que a equipe do projeto Aurora fará na sexta-feira?");
console.log(`Cérebro completo: ${seconds(performance.now() - start)}`);
console.log(`Chamadas: Jev ${jevCalls}; inspeção Responses API ${inspectionCalls}; arquivos finais ${agent.lastRetrieval?.files.length ?? 0}.`);
