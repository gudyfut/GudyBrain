import type { Candidato } from "@gudybrain/tools/memoria/candidato";

export interface ApplicationCandidateState {
  decision: "pendente" | "aprovada" | "rejeitada" | "erro";
  result: string | null;
}

/** Copia o conteúdo humano aprovado antes de gravar os metadados da decisão.
 * Essa ordem é intencional: candidatos de revisão possuem campos extras em
 * runtime e uma cópia indiscriminada não pode rebaixar `aprovada` de volta a
 * `pendente`. */
export function recordApplicationResult<T extends Candidato & ApplicationCandidateState>(
  candidate: T,
  selected: Candidato,
  result: string,
): void {
  Object.assign(candidate, selected);
  candidate.result = result;
  candidate.decision = applicationSucceeded(result) ? "aprovada" : "erro";
}

export function applicationSucceeded(result: string): boolean {
  return result.startsWith("Criado") || result.startsWith("Atualizado");
}
