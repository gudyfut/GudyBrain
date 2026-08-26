import { createAgentFromProfile, AGENT_PROFILES, resolveModel } from "../agents/registry";
import { parseGlmApiError } from "../core/glm";
import { AGENT_PIPELINE } from "../agents/pipeline";

for (const profile of Object.values(AGENT_PROFILES)) {
  if (!AGENT_PIPELINE[profile.id]) throw new Error(`Agente sem identidade na esteira: ${profile.id}`);
  const agent = createAgentFromProfile(profile, { apiKey: "validacao-local" });
  const model = resolveModel(profile);
  if (agent.model !== model) {
    throw new Error(`${profile.id}: modelo executado diverge do modelo efetivo do registry.ts`);
  }
  console.log(
    `✓ ${profile.nome} (${profile.id}) · ${model}: ${agent.toolNames().join(", ")}`,
  );
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
