import { type AgentEvent, type Agent } from "../../core/agent";
import { gerarArvoreMemoria } from "../../tools/memoria/arvore";
import { AGENT_PROFILES, createAgentFromProfile, resolveModel } from "../registry";

export interface ConversanteConfigurado {
  readonly agent: Agent;
  readonly model: string;
  readonly arvoreMemoria: string;
  readonly niveisArvore: number;
}

export function criarConversante(options: {
  apiKey: string;
  onStep?: (event: AgentEvent) => void;
}): ConversanteConfigurado {
  const niveisArvore = Number(process.env.MEMORIA_ARVORE_NIVEIS) || 4;
  let arvoreMemoria = "";
  try {
    arvoreMemoria = gerarArvoreMemoria(niveisArvore);
  } catch {
    // A conversa ainda funciona sem a visão prévia da árvore.
  }

  const systemSuffix = arvoreMemoria
    ? `## Pastas do bundle de memória\n\nHierarquia de \`memory/\` (somente diretórios). Pra ver o conteúdo de uma pasta (quem/o quê existe lá), use \`memoria_listar\`; pra achar por nome/termo, \`memoria_buscar\`; pra abrir um conceito, \`memoria_ler\`.\n\n\`\`\`\n${arvoreMemoria}\n\`\`\``
    : undefined;

  return {
    agent: createAgentFromProfile(AGENT_PROFILES.conversante, {
      ...options,
      systemSuffix,
    }),
    model: resolveModel(AGENT_PROFILES.conversante),
    arvoreMemoria,
    niveisArvore,
  };
}
