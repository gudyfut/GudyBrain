import { createAgentFromProfile, AGENT_PROFILES, MEMORY_CHAT_PROFILES } from "../agents/registry";
import { loadInstructions, loadToolDefinitions } from "../core/agent";
import { SCHEMA_INSERCOES } from "../tools/memoria/contrato-escrita";
import { parseGlmApiError } from "../core/glm";
import { AGENT_PIPELINE } from "../agents/pipeline";

for (const profile of Object.values(AGENT_PROFILES)) {
  if (!AGENT_PIPELINE[profile.id]) throw new Error(`Agente sem identidade na esteira: ${profile.id}`);
  const agent = createAgentFromProfile(profile, { apiKey: "validacao-local" });
  if (profile.id === "curador-call") {
    const tool = loadToolDefinitions(profile.toolsDir).find((item) => item.tool.function.name === "memoria_preparar_candidato");
    const schema = tool?.tool.function.parameters as { properties?: { alteracoes?: unknown; versao?: { const?: number } } };
    if (JSON.stringify(schema?.properties?.alteracoes) !== JSON.stringify(SCHEMA_INSERCOES) || schema?.properties?.versao?.const !== 2) {
      throw new Error("Schema de escrita divergente. Execute npx tsx src/dev/sync-memory-contract.ts.");
    }
  }
  if (agent.model !== profile.model) {
    throw new Error(`${profile.id}: modelo executado diverge do registry.ts`);
  }
  console.log(
    `✓ ${profile.nome} (${profile.id}) · ${profile.model}: ${agent.toolNames().join(", ")}`,
  );
}

for (const profile of Object.values(MEMORY_CHAT_PROFILES)) {
  if (!AGENT_PIPELINE[profile.id] || !loadInstructions(profile.instructionsFile).trim() || profile.allowedTools.length) {
    throw new Error(`Perfil de recuperação/resposta inválido: ${profile.id}`);
  }
  console.log(`✓ ${profile.id} · ${profile.model}: sem ferramentas, transporte ${profile.provider}`);
}

const temporaryLimit = parseGlmApiError(
  '{"error":{"code":"1305","message":"The API has triggered a rate limit."}}',
);
if (temporaryLimit.code !== "1305" || !temporaryLimit.message?.includes("rate limit")) {
  throw new Error("cliente GLM não interpretou o erro estruturado da z.ai");
}
const windowLimit = parseGlmApiError(
  '{"code":1308,"msg":"Usage limit reached","next_flush_time":"2026-08-13T05:00:00Z"}',
);
if (windowLimit.code !== "1308" || !windowLimit.nextReset) {
  throw new Error("cliente GLM não preservou a renovação da cota");
}

console.log("Perfis, prompts, definições e handlers estão consistentes.");
