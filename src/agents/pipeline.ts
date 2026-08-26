import type { AgentId } from "./registry";

export interface AgentPipelineIdentity {
  readonly stage: string;
  readonly receives: string;
  readonly upstream: string;
  readonly upstreamGuarantees: readonly string[];
  readonly upstreamLimitations: readonly string[];
  readonly produces: string;
  readonly downstream: string;
  readonly forbidden: readonly string[];
}

/** Posição operacional canônica de cada agente na esteira. Isso complementa
 * modelo/permissões do registry e evita que prompts locais redefinam papéis. */
export const AGENT_PIPELINE: Readonly<Record<AgentId, AgentPipelineIdentity>> = {
  conversante: {
    stage: "Conversa",
    receives: "Mensagens diretas do usuário.",
    upstream: "Usuário",
    upstreamGuarantees: ["A mensagem do usuário é a fonte primária da conversa."],
    upstreamLimitations: ["Uma fala pode ser parcial, hipotética ou informal."],
    produces: "Resposta útil apoiada por consultas de memória quando necessário.",
    downstream: "Curador de chat, quando o usuário solicita memorização.",
    forbidden: ["Persistir memória", "inventar fatos ausentes"],
  },
  "analisador-call": {
    stage: "Interpretação e evidência",
    receives: "Transcrição cronológica atribuída por participante.",
    upstream: "Transcritor determinístico da sessão Discord",
    upstreamGuarantees: ["Cada fala possui ID, participante e intervalo temporal."],
    upstreamLimitations: ["Transcrições podem conter erros, homófonos e artefatos."],
    produces: "Observações atribuídas, potencial local e correspondências possíveis com a memória atual.",
    downstream: "Curador de call",
    forbidden: ["Decidir a redação permanente", "escrever ou propor deltas de memória"],
  },
  "curador-chat": {
    stage: "Contextualização e proposta",
    receives: "Conversa direta entre o usuário e Gudman.",
    upstream: "Agente conversante e usuário",
    upstreamGuarantees: ["Falas do usuário podem sustentar fatos explícitos."],
    upstreamLimitations: ["Falas do assistente não confirmadas não são fatos."],
    produces: "Deltas estruturados comparados com a memória vigente.",
    downstream: "Revisão humana",
    forbidden: ["Escrever memória", "propor repetição sem novidade", "reconstruir documentos completos"],
  },
  "curador-call": {
    stage: "Contextualização, novidade e proposta",
    receives: "Relatório estruturado do Analista de call.",
    upstream: "Analista de call",
    upstreamGuarantees: ["Observações possuem evidências, atribuição e potencial local."],
    upstreamLimitations: ["Correspondências com memória são indícios e podem estar desatualizadas ou ambíguas."],
    produces: "Classificações de novidade, cobertura auditável e deltas estruturados.",
    downstream: "Revisão humana",
    forbidden: ["Reinterpretar transcrição bruta", "escrever memória", "aceitar sugestão de destino sem verificar a memória atual"],
  },
};

export function pipelineIdentitySuffix(agentId: AgentId): string {
  const identity = AGENT_PIPELINE[agentId];
  return [
    "## Identidade operacional na esteira",
    `- **Etapa:** ${identity.stage}`,
    `- **Recebe:** ${identity.receives}`,
    `- **Vem depois de:** ${identity.upstream}`,
    `- **Garantias da entrada:** ${identity.upstreamGuarantees.join("; ")}`,
    `- **Limites da entrada:** ${identity.upstreamLimitations.join("; ")}`,
    `- **Entrega:** ${identity.produces}`,
    `- **Entrega para:** ${identity.downstream}`,
    `- **Nunca faz:** ${identity.forbidden.join("; ")}`,
  ].join("\n");
}
