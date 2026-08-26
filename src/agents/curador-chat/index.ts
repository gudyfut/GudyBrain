import type { AgentEvent } from "../../core/agent";
import type { Message } from "../../core/glm";
import { limparFila, obterFila, type Candidato } from "../../tools/memoria/candidato";
import { limparCobertura } from "../../tools/memoria/cobertura";
import { iniciarContextualizacao, limparContextualizacao } from "../../tools/memoria/contextualizacao";
import { AGENT_PROFILES, createAgentFromProfile } from "../registry";
import { suffixCuradoria } from "../curadoria/contexto";

export interface ExtrairCandidatosChatOptions {
  readonly history: Message[];
  readonly apiKey: string;
  readonly onStep?: (event: AgentEvent) => void;
}

/** Curadoria exclusiva da conversa direta entre o usuário e Gudman. */
export async function extrairCandidatosChat(
  options: ExtrairCandidatosChatOptions,
): Promise<Candidato[]> {
  const transcript = montarTranscript(options.history);
  if (!transcript.trim()) return [];
  limparFila();
  limparCobertura();
  iniciarContextualizacao({ source: "chat" });
  try {
    const curador = createAgentFromProfile(AGENT_PROFILES.curadorChat, {
      apiKey: options.apiKey,
      systemSuffix: suffixCuradoria(),
      onStep: options.onStep,
    });
    await curador.run(transcript);
    return obterFila();
  } finally {
    limparContextualizacao();
  }
}

function montarTranscript(history: Message[]): string {
  const linhas: string[] = [];
  for (const mensagem of history) {
    if (mensagem.role === "user" && mensagem.content.trim()) {
      linhas.push(`Usuário: ${mensagem.content}`);
    } else if (mensagem.role === "assistant" && mensagem.content.trim()) {
      linhas.push(`Gudman: ${mensagem.content}`);
    }
  }
  return linhas.join("\n\n");
}
