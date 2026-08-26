export type DispositionDecision =
  | "proposta"
  | "ja_memorizada"
  | "descartada"
  | "incorporada_em_evento"
  | "incorporada_em_projeto";
import { validarCompatibilidadeDisposicao } from "./contextualizacao";

export interface ObservationDisposition {
  readonly observationId: string;
  readonly decision: DispositionDecision;
  readonly reason: string;
  readonly candidatePath?: string;
}

interface CoverageState {
  readonly allowed: Set<string>;
  readonly required: Set<string>;
  dispositions: ObservationDisposition[];
  finalized: boolean;
}

let state: CoverageState | null = null;

export function iniciarCobertura(
  allowedObservationIds: readonly string[],
  requiredObservationIds: readonly string[],
): void {
  state = {
    allowed: new Set(allowedObservationIds),
    required: new Set(requiredObservationIds),
    dispositions: [],
    finalized: requiredObservationIds.length === 0,
  };
}

export function limparCobertura(): void {
  state = null;
}

export function obterDisposicoes(): ObservationDisposition[] {
  return state?.dispositions.map((item) => ({ ...item })) ?? [];
}

export function coberturaFinalizada(): boolean {
  return state?.finalized ?? false;
}

export function obterIdsPendentesCobertura(): string[] {
  if (!state) return [];
  const covered = new Set(state.dispositions.map((item) => item.observationId));
  return [...state.required].filter((id) => !covered.has(id));
}

/** Fecha a auditoria da call sem escrever nada. O curador precisa classificar
 * cada observação de potencial Alto/Médio, impedindo que trechos importantes
 * desapareçam por causa do tom geral da conversa. */
export async function memoriaFinalizarCobertura(
  args: Record<string, unknown>,
): Promise<string> {
  if (!state) return "Erro: não há relatório de call com cobertura ativa.";
  const raw = Array.isArray(args.disposicoes) ? args.disposicoes : [];
  if (!raw.length) return "Erro: informe ao menos uma disposição.";
  const merged = new Map(
    state.dispositions.map((item) => [item.observationId, item] as const),
  );
  const seen = new Set<string>();

  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return "Erro: cada disposição precisa ser um objeto.";
    }
    const item = value as Record<string, unknown>;
    const observationId = typeof item.observation_id === "string"
      ? item.observation_id.trim()
      : "";
    if (!state.allowed.has(observationId)) {
      return `Erro: observação desconhecida na cobertura: "${observationId || "(vazia)"}".`;
    }
    if (seen.has(observationId)) {
      return `Erro: observação repetida na cobertura: "${observationId}".`;
    }
    seen.add(observationId);
    const decision = normalizeDecision(item.decisao);
    if (!decision) {
      return `Erro: decisão inválida para "${observationId}".`;
    }
    const erroNovidade = validarCompatibilidadeDisposicao(observationId, decision);
    if (erroNovidade) return `Erro: ${erroNovidade}`;
    const reason = typeof item.motivo === "string" ? item.motivo.trim() : "";
    if (!reason) return `Erro: informe o motivo da decisão de "${observationId}".`;
    const candidatePath = typeof item.path_candidato === "string"
      ? item.path_candidato.trim()
      : undefined;
    if (
      (decision === "proposta"
        || decision === "incorporada_em_evento"
        || decision === "incorporada_em_projeto")
      && !candidatePath
    ) {
      return `Erro: "${observationId}" precisa indicar path_candidato.`;
    }
    merged.set(observationId, {
      observationId,
      decision,
      reason: reason.slice(0, 500),
      ...(candidatePath ? { candidatePath } : {}),
    });
  }

  state.dispositions = [...merged.values()];
  const missing = obterIdsPendentesCobertura();
  state.finalized = missing.length === 0;
  if (missing.length) {
    return `Cobertura parcial registrada: ${state.required.size - missing.length}/${state.required.size} obrigatória(s). Continue com os IDs pendentes: ${missing.join(", ")}.`;
  }
  return `Cobertura concluída: ${state.dispositions.length} observação(ões), ${state.required.size} obrigatória(s).`;
}

function normalizeDecision(value: unknown): DispositionDecision | null {
  const decision = [
    "proposta", "ja_memorizada", "descartada",
    "incorporada_em_evento", "incorporada_em_projeto",
  ]
    .find((item) => item === value) as DispositionDecision | undefined;
  return decision ?? null;
}
