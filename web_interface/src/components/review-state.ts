export interface DecidableCandidate {
  readonly id: string;
  readonly decision: "pendente" | "aprovada" | "rejeitada" | "erro";
}

export function isActionable(candidate: DecidableCandidate): boolean {
  return candidate.decision === "pendente" || candidate.decision === "erro";
}

export function actionableCandidates<T extends DecidableCandidate>(candidates: readonly T[]): T[] {
  return candidates.filter(isActionable);
}

export function nextActionableId(
  candidates: readonly DecidableCandidate[],
  preferredId?: string | null,
): string | null {
  const pending = candidates.filter(isActionable);
  return pending.find((candidate) => candidate.id === preferredId)?.id
    ?? pending[0]?.id
    ?? null;
}

export function resolvedCount(candidates: readonly DecidableCandidate[]): number {
  return candidates.filter((candidate) => !isActionable(candidate)).length;
}

export function candidateStatusCounts(candidates: readonly DecidableCandidate[]): Record<DecidableCandidate["decision"], number> {
  const counts = { pendente: 0, aprovada: 0, rejeitada: 0, erro: 0 };
  for (const candidate of candidates) counts[candidate.decision] += 1;
  return counts;
}

export function candidateStatusLabel(decision: DecidableCandidate["decision"]): string {
  return {
    pendente: "Pendente",
    aprovada: "Aprovada",
    rejeitada: "Rejeitada",
    erro: "Erro ao aplicar",
  }[decision];
}
