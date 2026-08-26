import { loadEnv } from "../core/env";
import { analisarCall } from "../agents/analisador-call/index";

loadEnv();

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Uso: npm run call:analyze -- <sessão> [--forcar]");
  console.log("Gera analise-call.json e analise-call.md a partir de conversa.txt.");
  process.exit(0);
}
const force = args.includes("--force") || args.includes("--forcar");
const session = args.find((arg) => !arg.startsWith("--"));
if (!session) {
  console.error("Uso: npm run call:analyze -- <sessão> [--forcar]");
  process.exit(2);
}
const apiKey = process.env.GLM_API_KEY?.trim();
if (!apiKey) {
  console.error("Erro: GLM_API_KEY não definida no .env da raiz.");
  process.exit(2);
}

try {
  const result = await analisarCall({
    session,
    apiKey,
    force,
    onProgress: (message) => console.log(`[análise] ${message}`),
    onStep: (event) => {
      if (
        (process.env.GUDMAN_DEBUG === "1" || process.env.GUDY_DEBUG === "1")
        && event.type === "tool_call"
      ) {
        console.log(`[análise:tool] ${event.name}`);
      }
    },
  });
  console.log(`Análise JSON: ${result.json_path}`);
  console.log(`Relatório: ${result.markdown_path}`);
  console.log(`Blocos de memória: ${result.analysis.memory_blocks.map((block) => `${block.signal}=${block.observation_ids.length}`).join(" · ")}`);
  console.log(`Recomendação ao curador: ${result.analysis.conversation_context.curator_recommendation.rationale}`);
  console.log(`Observações: ${result.analysis.observations.length}`);
} catch (error) {
  console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
