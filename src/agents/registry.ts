import { Agent, type AgentEvent } from "../core/agent";
import { pipelineIdentitySuffix } from "./pipeline";

export type AgentId = "conversante" | "curador-chat" | "curador-call" | "analisador-call" | "recuperador-jev" | "resposta-memoria";

/** Etapas sem tool-calling: Jev seleciona; Responses API pede leituras estruturadas e redige. */
export const MEMORY_CHAT_PROFILES = {
  curation: {
    id: "curador-chat", model: "gpt-6-luna", provider: "responses-chatgpt",
    instructionsFile: "src/agents/curador-chat/instructions.md", allowedTools: [],
  },
  retrieval: {
    id: "recuperador-jev", model: "jev-latest", provider: "typesafe",
    instructionsFile: "src/agents/recuperador-jev/instructions.md",
    allowedTools: [],
  },
  answer: {
    id: "resposta-memoria", model: "gpt-6-luna", provider: "responses-chatgpt",
    instructionsFile: "src/agents/conversante/resposta-memoria.md",
    inspectionInstructionsFile: "src/agents/conversante/inspecao-memoria.md",
    allowedTools: [],
  },
} as const;

export function memoryChatEnabled(): boolean {
  const mode = process.env.CHAT_MODE?.trim() || "jev";
  if (mode !== "jev" && mode !== "legacy") throw new Error("CHAT_MODE deve ser jev ou legacy.");
  return mode === "jev";
}

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
    model: profile.model,
    instructionsFile: profile.instructionsFile,
    toolsDir: profile.toolsDir,
    allowedTools: profile.allowedTools,
    maxSteps: profile.maxSteps,
    maxTokens: profile.maxTokens,
    temperature: profile.temperature,
    systemSuffix,
  });
}
