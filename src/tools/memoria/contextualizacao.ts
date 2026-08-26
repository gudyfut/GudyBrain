import { obterEstruturaMemoria } from "./estrutura";

export type ClassificacaoNovidade =
  | "nova"
  | "complementar"
  | "reforco"
  | "contradicao"
  | "ja_memorizada"
  | "efemera"
  | "ambigua";

export interface AvaliacaoNovidade {
  readonly observationId: string;
  readonly memoryType: string;
  readonly classification: ClassificacaoNovidade;
  readonly reason: string;
  readonly comparedPath?: string;
}

interface ContextualizationState {
  readonly source: "chat" | "call";
  readonly allowedObservationIds: Set<string>;
  readonly requiredObservationIds: Set<string>;
  readonly listedFolders: Set<string>;
  readonly scopedTypes: Set<string>;
  readonly readPaths: Set<string>;
  readonly resultPaths: Set<string>;
  readonly noveltyByObservation: Map<string, AvaliacaoNovidade>;
}

let state: ContextualizationState | null = null;

export function iniciarContextualizacao(options: {
  source: "chat" | "call";
  allowedObservationIds?: readonly string[];
  requiredObservationIds?: readonly string[];
}): void {
  state = {
    source: options.source,
    allowedObservationIds: new Set(options.allowedObservationIds ?? []),
    requiredObservationIds: new Set(options.requiredObservationIds ?? []),
    listedFolders: new Set(),
    scopedTypes: new Set(),
    readPaths: new Set(),
    resultPaths: new Set(),
    noveltyByObservation: new Map(),
  };
}

export function limparContextualizacao(): void {
  state = null;
}

export function registrarListagem(pasta: string): void {
  state?.listedFolders.add(normalizarPath(pasta));
}

export function registrarBusca(options: {
  type?: string;
  pasta?: string;
  resultPaths?: readonly string[];
}): void {
  if (!state) return;
  if (options.type) state.scopedTypes.add(normalizarTipo(options.type));
  if (options.pasta) state.listedFolders.add(normalizarPath(options.pasta));
  for (const path of options.resultPaths ?? []) state.resultPaths.add(normalizarPath(path));
}

export function registrarLeitura(path: string): void {
  state?.readPaths.add(normalizarPath(path));
}

export function obterAvaliacoesNovidade(): AvaliacaoNovidade[] {
  return [...(state?.noveltyByObservation.values() ?? [])];
}

export function obterAvaliacoesPara(ids: readonly string[]): AvaliacaoNovidade[] {
  if (!state) return [];
  return ids.flatMap((id) => {
    const item = state?.noveltyByObservation.get(id);
    return item ? [item] : [];
  });
}

export function obterContextoConsultado(): string[] {
  if (!state) return [];
  return [...new Set([...state.readPaths, ...state.resultPaths])].sort();
}

export function obterIdsSemAvaliacaoNovidade(): string[] {
  if (!state) return [];
  return [...state.requiredObservationIds].filter((id) => !state?.noveltyByObservation.has(id));
}

export async function memoriaClassificarNovidade(
  args: Record<string, unknown>,
): Promise<string> {
  if (!state || state.source !== "call") {
    return "Erro: não há curadoria de call com contextualização ativa.";
  }
  const raw = Array.isArray(args.avaliacoes) ? args.avaliacoes : [];
  if (!raw.length) return "Erro: informe ao menos uma avaliação de novidade.";
  const staged: AvaliacaoNovidade[] = [];
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `Erro: avaliacoes[${index}] precisa ser um objeto.`;
    }
    const item = value as Record<string, unknown>;
    const observationId = texto(item.observation_id);
    if (!state.allowedObservationIds.has(observationId)) {
      return `Erro: observação desconhecida: "${observationId || "(vazia)"}".`;
    }
    const memoryType = texto(item.tipo_memoria);
    const structure = obterEstruturaMemoria(memoryType);
    if (!structure) return `Erro: tipo de memória inválido para ${observationId}.`;
    const classification = normalizarClassificacao(item.classificacao);
    if (!classification) return `Erro: classificação inválida para ${observationId}.`;
    const reason = texto(item.motivo);
    if (!reason) return `Erro: informe o motivo de ${observationId}.`;
    const comparedPath = texto(item.path_comparado);
    const contextError = validarConsultaDoTipo(memoryType);
    if (contextError) return `Erro: ${observationId}: ${contextError}`;
    if (exigeLeitura(classification)) {
      if (!comparedPath) return `Erro: ${observationId}: '${classification}' exige path_comparado.`;
      if (!state.readPaths.has(normalizarPath(comparedPath))) {
        return `Erro: ${observationId}: leia "${comparedPath}" antes de classificá-la como ${classification}.`;
      }
    }
    staged.push({
      observationId,
      memoryType: structure.type,
      classification,
      reason: reason.slice(0, 500),
      ...(comparedPath ? { comparedPath } : {}),
    });
  }
  for (const item of staged) state.noveltyByObservation.set(item.observationId, item);
  return `Novidade classificada para ${staged.length} observação(ões).`;
}

export function validarContextoCandidato(options: {
  action: "criar" | "atualizar";
  memoryType: string;
  sourcePath?: string;
  observationIds: readonly string[];
  chatNovelty?: ClassificacaoNovidade;
}): string | null {
  if (!state) return null;
  const typeError = validarConsultaDoTipo(options.memoryType);
  if (typeError) return typeError;
  if (options.action === "atualizar") {
    const path = normalizarPath(options.sourcePath ?? "");
    if (!path || !state.readPaths.has(path)) {
      return `leia integralmente "${options.sourcePath ?? "(origem)"}" antes de preparar uma atualização.`;
    }
  }
  if (state.source === "chat") {
    if (!options.chatNovelty || !eProdutiva(options.chatNovelty)) {
      return "a curadoria de chat precisa informar avaliacao_novidade como nova, complementar ou contradicao.";
    }
    return null;
  }
  if (!options.observationIds.length) {
    return "candidato de call precisa indicar observacao_ids.";
  }
  for (const id of options.observationIds) {
    const assessment = state.noveltyByObservation.get(id);
    if (!assessment) return `classifique a novidade de ${id} antes de preparar o candidato.`;
    if (!eProdutiva(assessment.classification)) {
      return `${id} foi classificada como ${assessment.classification} e não pode gerar candidato.`;
    }
  }
  return null;
}

export function validarCompatibilidadeDisposicao(
  observationId: string,
  decision: string,
): string | null {
  if (!state || state.source !== "call") return null;
  const assessment = state.noveltyByObservation.get(observationId);
  if (!assessment) return `classifique a novidade de ${observationId} antes da cobertura.`;
  if (["proposta", "incorporada_em_evento", "incorporada_em_projeto"].includes(decision)) {
    return eProdutiva(assessment.classification)
      ? null
      : `${observationId} classificada como ${assessment.classification} não pode gerar proposta.`;
  }
  if (decision === "ja_memorizada") {
    return ["ja_memorizada", "reforco"].includes(assessment.classification)
      ? null
      : `${observationId}: decisão ja_memorizada é incompatível com ${assessment.classification}.`;
  }
  if (decision === "descartada") {
    return ["efemera", "ambigua"].includes(assessment.classification)
      ? null
      : `${observationId}: decisão descartada é incompatível com ${assessment.classification}.`;
  }
  return null;
}

function validarConsultaDoTipo(type: string): string | null {
  if (!state) return null;
  const structure = obterEstruturaMemoria(type);
  if (!structure) return `tipo de memória desconhecido: "${type}".`;
  const folder = normalizarPath(structure.pasta);
  const consulted = state.listedFolders.has(folder)
    || state.scopedTypes.has(normalizarTipo(structure.type));
  return consulted
    ? null
    : `consulte ${structure.type} com memoria_listar, memoria_buscar ou memoria_contextualizar antes de decidir.`;
}

function normalizarClassificacao(value: unknown): ClassificacaoNovidade | null {
  return ["nova", "complementar", "reforco", "contradicao", "ja_memorizada", "efemera", "ambigua"]
    .find((item) => item === value) as ClassificacaoNovidade | undefined ?? null;
}

function exigeLeitura(value: ClassificacaoNovidade): boolean {
  return ["complementar", "reforco", "contradicao", "ja_memorizada"].includes(value);
}

function eProdutiva(value: ClassificacaoNovidade): boolean {
  return value === "nova" || value === "complementar" || value === "contradicao";
}

function normalizarTipo(value: string): string {
  return value.trim().toLowerCase();
}

function normalizarPath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").replace(/\.md$/iu, "").toLowerCase();
}

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
