import type { AgentEvent } from "../../core/agent";
import { limparFila, obterFila, type Candidato } from "../../tools/memoria/candidato";
import {
  coberturaFinalizada,
  iniciarCobertura,
  limparCobertura,
  obterDisposicoes,
  obterIdsPendentesCobertura,
  type ObservationDisposition,
} from "../../tools/memoria/cobertura";
import { CALL_ANALYSIS_SCHEMA_VERSION } from "../analisador-call/types";
import {
  iniciarContextualizacao,
  limparContextualizacao,
  obterAvaliacoesNovidade,
  obterIdsSemAvaliacaoNovidade,
  type AvaliacaoNovidade,
} from "../../tools/memoria/contextualizacao";
import { AGENT_PROFILES, createAgentFromProfile } from "../registry";
import { suffixCuradoria } from "../curadoria/contexto";

export const CALL_CURATION_BATCH_CHARACTERS = 40_000;

export interface ExtrairCandidatosCallOptions {
  readonly analysis: string;
  readonly apiKey: string;
  readonly onStep?: (event: AgentEvent) => void;
}

export interface CallCurationCoverage {
  readonly attempts: number;
  readonly requiredObservationIds: readonly string[];
  readonly dispositions: readonly ObservationDisposition[];
  readonly noveltyAssessments: readonly AvaliacaoNovidade[];
  readonly noveltySummary: Readonly<Record<string, number>>;
  readonly unresolvedObservationIds: readonly string[];
  readonly issues: readonly string[];
}

export interface CallCurationOutcome {
  readonly candidates: readonly Candidato[];
  readonly coverage: CallCurationCoverage;
}

/** Curadoria exclusiva do relatório estruturado produzido pelo Analista de call. */
export async function extrairCandidatosCall(
  options: ExtrairCandidatosCallOptions,
): Promise<CallCurationOutcome> {
  if (!options.analysis.trim()) return resultadoVazio();
  const report = validarRelatorio(options.analysis);
  const observations = report.observations.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    return /^obs_\d{5}$/u.test(id)
      ? [{ id, required: observationRequiresCuration(item) }]
      : [];
  });
  const allowedIds = observations.map((item) => item.id);
  const requiredIds = observations.filter((item) => item.required).map((item) => item.id);
  limparFila();
  iniciarCobertura(allowedIds, requiredIds);
  iniciarContextualizacao({
    source: "call",
    allowedObservationIds: allowedIds,
    requiredObservationIds: requiredIds,
  });
  let attempts = 1;

  try {
    const batches = splitCurationObservationBatches(report.observations);
    for (const [index, batch] of batches.entries()) {
      options.onStep?.({
        type: "tool_result",
        name: "curadoria_lote",
        result: `Curando lote ${index + 1}/${batches.length} (${batch.length} observações)`,
      });
      const curador = createAgentFromProfile(AGENT_PROFILES.curadorCall, {
        apiKey: options.apiKey,
        systemSuffix: suffixCuradoria(),
        onStep: options.onStep,
      });
      await curador.run(curationBatchInput(
        report,
        batch,
        index + 1,
        batches.length,
        obterFila(),
      ));
    }
    let dispositions = obterDisposicoes();
    let candidates = reconcileCandidateObservationIds(obterFila(), dispositions);
    let issues = auditCallCoverage({
      allowedIds,
      requiredIds,
      candidates,
      dispositions,
      finalized: coberturaFinalizada(),
    });

    if (issues.length) {
      attempts = 2;
      const recoveryIds = [...new Set([
        ...obterIdsPendentesCobertura(),
        ...unresolvedIds(requiredIds, dispositions, issues),
      ])];
      const recoveryObservations = report.observations.filter((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        return recoveryIds.includes(String((value as Record<string, unknown>).id ?? ""));
      });
      try {
        const recoveryBatches = splitCurationObservationBatches(recoveryObservations);
        for (const [index, batch] of recoveryBatches.entries()) {
          options.onStep?.({
            type: "tool_result",
            name: "curadoria_lote",
            result: `Recuperando lote ${index + 1}/${recoveryBatches.length} (${batch.length} observações)`,
          });
          const recoveryAgent = createAgentFromProfile(AGENT_PROFILES.curadorCall, {
            apiKey: options.apiKey,
            systemSuffix: suffixCuradoria(),
            onStep: options.onStep,
          });
          await recoveryAgent.run(recoveryBatchInput(
            batch,
            index + 1,
            recoveryBatches.length,
            issues,
            obterFila(),
          ));
        }
        dispositions = obterDisposicoes();
        candidates = reconcileCandidateObservationIds(obterFila(), dispositions);
        issues = auditCallCoverage({
          allowedIds,
          requiredIds,
          candidates,
          dispositions,
          finalized: coberturaFinalizada(),
        });
      } catch (error) {
        issues = [...issues, `A recuperação incremental falhou sem apagar candidatos: ${error instanceof Error ? error.message : String(error)}`];
      }
    }

    return {
      candidates,
      coverage: {
        attempts,
        requiredObservationIds: requiredIds,
        dispositions,
        noveltyAssessments: obterAvaliacoesNovidade(),
        noveltySummary: summarizeNovelty(obterAvaliacoesNovidade()),
        unresolvedObservationIds: unresolvedIds(requiredIds, dispositions, issues),
        issues,
      },
    };
  } finally {
    limparCobertura();
    limparContextualizacao();
  }
}

export function observationRequiresCuration(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const signal = (value as Record<string, unknown>).memory_signal;
  return signal === "alto" || signal === "medio";
}

export function splitCurationObservationBatches(
  observations: readonly unknown[],
  maximumCharacters = CALL_CURATION_BATCH_CHARACTERS,
): unknown[][] {
  const groups = new Map<string, unknown[]>();
  const ordered = [...observations].sort((left, right) =>
    observationSignalRank(right) - observationSignalRank(left));
  for (const value of ordered) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const observation = value as Record<string, unknown>;
    const key = curationTargetKey(observation);
    const group = groups.get(key) ?? [];
    group.push(compactObservation(observation));
    groups.set(key, group);
  }

  const batches: unknown[][] = [];
  let current: unknown[] = [];
  let length = 2;
  for (const group of groups.values()) {
    const groupLength = JSON.stringify(group).length;
    if (current.length && length + groupLength > maximumCharacters) {
      batches.push(current);
      current = [];
      length = 2;
    }
    current.push(...group);
    length += groupLength;
  }
  if (current.length) batches.push(current);
  return batches;
}

function curationBatchInput(
  report: Record<string, unknown>,
  observations: readonly unknown[],
  batch: number,
  totalBatches: number,
  candidates: readonly Candidato[],
): string {
  return [
    "# Fonte: lote do relatório estruturado de uma call",
    "",
    `Lote ${batch}/${totalBatches}. Este lote contém entidades completas; outras observações serão tratadas separadamente.`,
    "Use conversation_context somente para entender a situação. Ele nunca pode rebaixar uma observação de Alto ou Médio porque a maior parte da call foi recreativa. Use apenas observations como evidência.",
    "Dê destino a toda observação de potencial Alto/Médio deste lote. Examine Alto primeiro. Antes de candidato/cobertura, consulte o tipo, localize equivalentes, leia destinos e chame memoria_classificar_novidade. Depois chame memoria_finalizar_cobertura para os IDs deste lote uma vez; uma resposta global parcial é esperada.",
    "Prepare candidato para o destino semanticamente correto da observação. Papéis, propostas e competências discutidos apenas dentro de uma iniciativa pertencem ao Projeto, não à Personalidade das pessoas. Não crie candidato secundário para pessoas em about sem evidência pessoal independente.",
    "Não prepare novamente paths já listados. Se algum aparecer por ambiguidade, apenas dê destino às observações sem duplicar o candidato.",
    "Falante, timestamp e IDs ficam somente nas evidências da revisão, nunca na memória permanente.",
    "",
    "## Contexto da conversa",
    JSON.stringify(report.conversation_context ?? {}),
    "",
    "## Índice dos blocos Alto/Médio/Baixo",
    JSON.stringify(report.memory_blocks ?? []),
    "",
    "## Paths já preparados em lotes anteriores",
    JSON.stringify(candidateSummary(candidates)),
    "",
    "## Observações deste lote",
    JSON.stringify(observations),
  ].join("\n");
}

function recoveryBatchInput(
  observations: readonly unknown[],
  batch: number,
  totalBatches: number,
  issues: readonly string[],
  candidates: readonly Candidato[],
): string {
  return [
    "# Recuperação incremental da cobertura",
    "",
    `Lote de recuperação ${batch}/${totalBatches}. Não refaça a curadoria.`,
    "Dê destino somente às observações deste lote. Complete primeiro qualquer classificação de novidade ausente; então use memoria_finalizar_cobertura. Prepare candidato novo apenas se indispensável e nunca duplique um path já preparado.",
    "Uma resposta de cobertura global parcial é esperada enquanto existirem outros lotes.",
    "",
    "## Candidatos já preparados",
    JSON.stringify(candidateSummary(candidates)),
    "",
    "## Problemas detectados",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "## Observações pendentes deste lote",
    JSON.stringify(observations),
  ].join("\n");
}

function candidateSummary(candidates: readonly Candidato[]): Record<string, unknown>[] {
  return candidates.map((candidate) => ({
    path: candidate.path,
    motivo: candidate.motivo,
    observacao_ids: candidate.observationIds,
    novidade: candidate.noveltyAssessments,
  }));
}

function curationTargetKey(observation: Record<string, unknown>): string {
  const subject = observation.subject && typeof observation.subject === "object"
    && !Array.isArray(observation.subject)
    ? observation.subject as Record<string, unknown>
    : {};
  const identity = String(
    subject.memory_id ?? subject.memory_path ?? subject.name ?? observation.id ?? "desconhecido",
  ).trim().toLowerCase().replace(/\\/gu, "/").replace(/\.md$/u, "");
  return `${String(observation.memory_type ?? "desconhecido")}|${identity}`;
}

function compactObservation(observation: Record<string, unknown>): Record<string, unknown> {
  const evidence = Array.isArray(observation.evidence)
    ? observation.evidence.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        return [{
          utterance_id: item.utterance_id,
          speaker_name: item.speaker_name,
          speaker_person_id: item.speaker_person_id,
          text: String(item.text ?? "").slice(0, 400),
        }];
      }).slice(0, 2)
    : [];
  return { ...observation, evidence };
}

function observationSignalRank(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const signal = (value as Record<string, unknown>).memory_signal;
  return signal === "alto" ? 3 : signal === "medio" ? 2 : signal === "baixo" ? 1 : 0;
}

function validarRelatorio(analysis: string): Record<string, unknown> & { observations: unknown[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(analysis); } catch { throw new Error("analise-call.json inválido."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("analise-call.json precisa conter um objeto.");
  }
  const report = parsed as Record<string, unknown>;
  if (
    report.schema_version !== CALL_ANALYSIS_SCHEMA_VERSION
    || !report.conversation_context
    || typeof report.conversation_context !== "object"
    || Array.isArray(report.conversation_context)
    || !Array.isArray(report.memory_blocks)
    || !Array.isArray(report.observations)
  ) throw new Error("analise-call.json possui schema incompatível.");
  validarBlocosMemoria(report.memory_blocks, report.observations);
  return report as Record<string, unknown> & { observations: unknown[] };
}

function validarBlocosMemoria(blocks: unknown[], observations: unknown[]): void {
  const observationSignals = new Map<string, string>();
  for (const value of observations) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.id === "string" && typeof item.memory_signal === "string") {
      observationSignals.set(item.id, item.memory_signal);
    }
  }
  const seenSignals = new Set<string>();
  const seenIds = new Set<string>();
  for (const value of blocks) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("bloco de potencial de memória inválido.");
    }
    const block = value as Record<string, unknown>;
    const signal = typeof block.signal === "string" ? block.signal : "";
    if (!["alto", "medio", "baixo"].includes(signal) || seenSignals.has(signal)) {
      throw new Error("blocos de potencial precisam ser Alto, Médio e Baixo, sem repetição.");
    }
    seenSignals.add(signal);
    if (!Array.isArray(block.observation_ids)) throw new Error(`bloco ${signal} sem observation_ids.`);
    for (const id of block.observation_ids) {
      if (typeof id !== "string" || seenIds.has(id) || observationSignals.get(id) !== signal) {
        throw new Error(`observação inválida ou classificada no bloco errado: ${String(id)}.`);
      }
      seenIds.add(id);
    }
  }
  if (seenSignals.size !== 3 || seenIds.size !== observationSignals.size) {
    throw new Error("os blocos Alto/Médio/Baixo precisam classificar todas as observações exatamente uma vez.");
  }
}

function resultadoVazio(): CallCurationOutcome {
  return {
    candidates: [],
    coverage: {
      attempts: 0,
      requiredObservationIds: [],
      dispositions: [],
      noveltyAssessments: [],
      noveltySummary: {},
      unresolvedObservationIds: [],
      issues: [],
    },
  };
}

function summarizeNovelty(
  assessments: readonly AvaliacaoNovidade[],
): Readonly<Record<string, number>> {
  const summary: Record<string, number> = {};
  for (const assessment of assessments) {
    summary[assessment.classification] = (summary[assessment.classification] ?? 0) + 1;
  }
  return summary;
}

function reconcileCandidateObservationIds(
  candidates: readonly Candidato[],
  dispositions: readonly ObservationDisposition[],
): Candidato[] {
  return candidates.map((candidate) => {
    const mapped = dispositions
      .filter((item) => (
        item.decision === "proposta"
        || item.decision === "incorporada_em_evento"
        || item.decision === "incorporada_em_projeto"
      ) && sameMemoryPath(candidate.path, item.candidatePath ?? ""))
      .map((item) => item.observationId);
    return { ...candidate, observationIds: [...new Set([...candidate.observationIds, ...mapped])] };
  });
}

function unresolvedIds(
  requiredIds: readonly string[],
  dispositions: readonly ObservationDisposition[],
  issues: readonly string[],
): string[] {
  const disposed = new Set(dispositions.map((item) => item.observationId));
  const mentionedInIssues = new Set(issues.flatMap((issue) => issue.match(/obs_\d{5}/gu) ?? []));
  return requiredIds.filter((id) => !disposed.has(id) || mentionedInIssues.has(id));
}

export function auditCallCoverage(options: {
  readonly allowedIds: readonly string[];
  readonly requiredIds: readonly string[];
  readonly candidates: readonly Candidato[];
  readonly dispositions: readonly ObservationDisposition[];
  readonly finalized: boolean;
}): string[] {
  const issues: string[] = [];
  if (!options.finalized) issues.push("memoria_finalizar_cobertura não foi chamada com sucesso");
  const semNovidade = obterIdsSemAvaliacaoNovidade();
  for (const id of semNovidade) issues.push(`${id} ficou sem classificação de novidade`);
  const allowed = new Set(options.allowedIds);
  const dispositionById = new Map(options.dispositions.map((item) => [item.observationId, item]));
  for (const id of options.requiredIds) {
    if (!dispositionById.has(id)) issues.push(`${id} ficou sem disposição`);
  }
  for (const candidate of options.candidates) {
    for (const id of candidate.observationIds) {
      if (!allowed.has(id)) issues.push(`${candidate.path} referencia observação desconhecida ${id}`);
    }
  }
  for (const disposition of options.dispositions) {
    if (
      disposition.decision !== "proposta"
      && disposition.decision !== "incorporada_em_evento"
      && disposition.decision !== "incorporada_em_projeto"
    ) continue;
    const candidate = options.candidates.find((item) => sameMemoryPath(item.path, disposition.candidatePath ?? ""));
    if (!candidate) {
      issues.push(`${disposition.observationId} aponta para candidato inexistente ${disposition.candidatePath ?? "(sem path)"}`);
    } else if (!candidate.observationIds.includes(disposition.observationId)) {
      issues.push(`${disposition.observationId} não consta em observacao_ids de ${candidate.path}`);
    }
  }
  return issues;
}

function sameMemoryPath(left: string, right: string): boolean {
  const normalize = (value: string): string => value
    .trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\.md$/iu, "").toLowerCase();
  return Boolean(left && right) && normalize(left) === normalize(right);
}
