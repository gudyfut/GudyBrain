import { Agent, type AgentEvent } from "../core/agent";
import { pipelineIdentitySuffix } from "./pipeline";

export type AgentId = "conversante" | "curador-chat" | "curador-call" | "analisador-call";

export interface AgentProfile {
  readonly id: AgentId;
  readonly nome: string;
  readonly responsabilidade: string;
  readonly model: string;
  readonly instructionsFile: string;
  readonly toolsDir: string;
  readonly allowedTools: readonly string[];
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly temperature: number;
}

/** Fonte canônica das fronteiras e permissões dos agentes. */
export const AGENT_PROFILES = {
  conversante: {
    id: "conversante",
    nome: "Gudman",
    responsabilidade: "Conduzir a conversa e consultar memória sem alterá-la.",
    model: "glm-5.2",
    instructionsFile: "src/agents/conversante/instructions.md",
    toolsDir: "src/agents/conversante/tools",
    allowedTools: ["hora", "memoria_listar", "memoria_buscar", "memoria_ler"],
    maxSteps: 8,
    maxTokens: 4096,
    temperature: 0.4,
  },
  curadorChat: {
    id: "curador-chat",
    nome: "Curador de chat",
    responsabilidade: "Converter a conversa direta entre o usuário e Gudman em propostas de memória.",
    model: "glm-5.2",
    instructionsFile: "src/agents/curador-chat/instructions.md",
    toolsDir: "src/agents/curador-chat/tools",
    allowedTools: [
      "memoria_listar",
      "memoria_buscar",
      "memoria_contextualizar",
      "memoria_ler",
      "memoria_template",
      "memoria_preparar_candidato",
    ],
    maxSteps: 32,
    maxTokens: 8192,
    temperature: 0.3,
  },
  curadorCall: {
    id: "curador-call",
    nome: "Curador de call",
    responsabilidade: "Converter o relatório do Analista de call em propostas atribuídas e auditáveis.",
    model: "glm-5.2",
    instructionsFile: "src/agents/curador-call/instructions.md",
    toolsDir: "src/agents/curador-call/tools",
    allowedTools: [
      "memoria_listar",
      "memoria_buscar",
      "memoria_contextualizar",
      "memoria_ler",
      "memoria_template",
      "memoria_classificar_novidade",
      "memoria_preparar_candidato",
      "memoria_finalizar_cobertura",
    ],
    maxSteps: 48,
    maxTokens: 8192,
    temperature: 0.2,
  },
  analisadorCall: {
    id: "analisador-call",
    nome: "Analista de call",
    responsabilidade: "Interpretar calls transcritas e produzir observações atribuídas, sem propor ou escrever memória.",
    model: "glm-5.2",
    instructionsFile: "src/agents/analisador-call/instructions.md",
    toolsDir: "src/agents/analisador-call/tools",
    allowedTools: ["memoria_listar", "memoria_buscar", "memoria_ler"],
    maxSteps: 16,
    maxTokens: 16_384,
    temperature: 0.15,
  },
} as const satisfies Record<string, AgentProfile>;

export interface CreateAgentOptions {
  readonly apiKey: string;
  readonly systemSuffix?: string;
  readonly onStep?: (event: AgentEvent) => void;
}

/**
 * Modelo efetivo de um agente. Cada perfil define o próprio padrão; a variável
 * `GLM_MODEL` do `.env` sobrescreve apenas o agente conversante, que é o modelo
 * com quem o usuário conversa. Curadores e analista mantêm os modelos ajustados
 * por perfil para preservar a qualidade da curadoria.
 */
export function resolveModel(profile: AgentProfile): string {
  if (profile.id === "conversante") {
    const override = process.env.GLM_MODEL?.trim();
    if (override) return override;
  }
  return profile.model;
}

export function createAgentFromProfile(
  profile: AgentProfile,
  options: CreateAgentOptions,
): Agent {
  const systemSuffix = [
    pipelineIdentitySuffix(profile.id),
    options.systemSuffix?.trim(),
  ].filter(Boolean).join("\n\n");
  return new Agent({
    apiKey: options.apiKey,
    onStep: options.onStep,
    model: resolveModel(profile),
    instructionsFile: profile.instructionsFile,
    toolsDir: profile.toolsDir,
    allowedTools: profile.allowedTools,
    maxSteps: profile.maxSteps,
    maxTokens: profile.maxTokens,
    temperature: profile.temperature,
    systemSuffix,
  });
}
