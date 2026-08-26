import "server-only";

import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@gudybrain/core/glm";
import type { AgentEvent } from "@gudybrain/core/agent";
import { extrairCandidatosChat } from "@gudybrain/agents/curador-chat";
import {
  extrairCandidatosCall,
  type CallCurationCoverage,
} from "@gudybrain/agents/curador-call";
import { AGENT_PROFILES } from "@gudybrain/agents/registry";
import {
  removerMarcadoresEvidencia,
  type Candidato,
} from "@gudybrain/tools/memoria/candidato";
import {
  memoriaAtualizar,
  memoriaCriar,
  normalizarCaminhoRelativo,
} from "@gudybrain/tools/memoria/escrever";
import { parseFrontmatter } from "@gudybrain/tools/memoria/frontmatter";
import { interpretarDocumentoEditavel } from "@gudybrain/tools/memoria/documento-editavel";
import {
  mesclarCorposMarkdown,
  mesclarFrontmatterExistente,
} from "@gudybrain/tools/memoria/mesclar-corpo";
import { chatHistory } from "./chat";
import { recordApplicationResult } from "./candidate-application";
import { readMemory } from "./memory";
import { requireSecret, resolveSessionDir } from "./paths";

export type CandidateDecision = "pendente" | "aprovada" | "rejeitada" | "erro";

export interface ReviewCandidate extends Candidato {
  readonly id: string;
  decision: CandidateDecision;
  result: string | null;
}

export interface MemoryReview {
  readonly id: string;
  readonly source: { kind: "chat"; id: string } | { kind: "call"; id: string };
  status: "na_fila" | "analisando" | "revisao" | "concluida" | "erro";
  createdAt: string;
  updatedAt: string;
  progress: string[];
  candidates: ReviewCandidate[];
  coverage: CallCurationCoverage | null;
  error: string | null;
}

interface ReviewRuntime {
  readonly reviews: Map<string, MemoryReview>;
  tail: Promise<void>;
}

const globalRuntime = globalThis as typeof globalThis & { __gudyReviews?: ReviewRuntime };
const runtime: ReviewRuntime = globalRuntime.__gudyReviews ?? {
  reviews: new Map<string, MemoryReview>(),
  tail: Promise.resolve(),
};
globalRuntime.__gudyReviews = runtime;

export function createReview(
  source: MemoryReview["source"],
): MemoryReview {
  const review: MemoryReview = {
    id: randomUUID(),
    source,
    status: "na_fila",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: [],
    candidates: [],
    coverage: null,
    error: null,
  };
  runtime.reviews.set(review.id, review);
  runtime.tail = runtime.tail.then(() => generateReview(review)).catch(() => undefined);
  return copyReview(review);
}

export function getReview(id: string): MemoryReview | null {
  const review = runtime.reviews.get(id);
  if (!review) return null;
  normalizarErrosTecnicos(review);
  return copyReview(review);
}

export function listReviews(): MemoryReview[] {
  return [...runtime.reviews.values()]
    .map((review) => {
      normalizarErrosTecnicos(review);
      return review;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map(copyReview);
}

export async function decideCandidate(options: {
  reviewId: string;
  candidateId: string;
  decision: "aprovar" | "rejeitar";
  edited?: Partial<Pick<Candidato, "acao" | "path" | "pathOrigem" | "frontmatter" | "corpo">> & {
    conteudo?: string;
  };
}): Promise<MemoryReview> {
  const review = runtime.reviews.get(options.reviewId);
  if (!review) throw new Error("Revisão não encontrada.");
  if (review.status !== "revisao" && review.status !== "concluida") {
    throw new Error("As propostas ainda não estão prontas.");
  }
  const candidate = review.candidates.find((item) => item.id === options.candidateId);
  if (!candidate) throw new Error("Proposta não encontrada.");
  if (candidate.decision !== "pendente" && candidate.decision !== "erro") {
    throw new Error("Esta proposta já foi decidida.");
  }

  if (options.decision === "rejeitar") {
    candidate.decision = "rejeitada";
    candidate.result = "Rejeitada na revisão humana.";
  } else {
    const edited = options.edited ?? {};
    let selected: Candidato = {
      acao: edited.acao === "atualizar" || edited.acao === "criar"
        ? edited.acao
        : candidate.acao,
      path: typeof edited.path === "string" ? edited.path : candidate.path,
      pathOrigem: typeof edited.pathOrigem === "string" ? edited.pathOrigem : candidate.pathOrigem,
      frontmatter: edited.frontmatter && typeof edited.frontmatter === "object"
        ? edited.frontmatter
        : candidate.frontmatter,
      corpo: typeof edited.corpo === "string" ? edited.corpo : candidate.corpo,
      motivo: candidate.motivo,
      naturezaProposta: candidate.naturezaProposta,
      evidencias: candidate.evidencias,
      observationIds: candidate.observationIds,
      noveltyAssessments: candidate.noveltyAssessments,
      consultedPaths: candidate.consultedPaths,
    };
    const conteudoIntegral = typeof edited.conteudo === "string";
    if (conteudoIntegral) {
      const origem = selected.pathOrigem || selected.path;
      const atual = selected.acao === "atualizar"
        ? readMemory(normalizarCaminhoRelativo(origem)).content
        : undefined;
      const documento = interpretarDocumentoEditavel(edited.conteudo ?? "", atual);
      selected = {
        ...selected,
        frontmatter: documento.campos,
        corpo: documento.corpo,
      };
    }

    // Uma criação conflitante antiga pode ser corrigida na própria bancada.
    // Preparamos uma atualização conservadora e a devolvemos para uma segunda
    // leitura humana; nada é escrito neste primeiro clique.
    if (candidate.acao === "criar" && selected.acao === "atualizar" && !conteudoIntegral) {
      const origem = selected.pathOrigem || selected.path;
      const atual = readMemory(normalizarCaminhoRelativo(origem)).content;
      const memoriaAtual = parseFrontmatter(atual);
      const corrigido: Candidato = {
        ...selected,
        pathOrigem: origem,
        frontmatter: mesclarFrontmatterExistente(
          memoriaAtual.campos,
          selected.frontmatter,
        ),
        corpo: mesclarCorposMarkdown(memoriaAtual.corpo, selected.corpo),
      };
      Object.assign(candidate, corrigido);
      candidate.decision = "pendente";
      candidate.result = "Conflito convertido em atualização. O conteúdo existente foi preservado e mesclado com a proposta; revise o resultado e aprove novamente para aplicar.";
      review.status = "revisao";
      review.updatedAt = new Date().toISOString();
      persistCallReview(review);
      return copyReview(review);
    }

    const profile = review.source.kind === "call"
      ? AGENT_PROFILES.curadorCall
      : AGENT_PROFILES.curadorChat;
    const generatedBy = `gudman/${profile.model}`;
    selected = {
      ...selected,
      corpo: removerMarcadoresEvidencia(selected.corpo),
    };
    const result = selected.acao === "criar"
      ? await memoriaCriar({
          path: selected.path,
          frontmatter: selected.frontmatter,
          corpo: selected.corpo,
        }, { generatedBy })
      : await memoriaAtualizar({
          path_origem: selected.pathOrigem,
          path: selected.path,
          frontmatter: selected.frontmatter,
          corpo: selected.corpo,
        }, { generatedBy });
    // Conserva também as correções feitas no editor caso a aplicação falhe,
    // permitindo uma nova tentativa sem perder o trabalho humano.
    recordApplicationResult(candidate, selected, result);
  }

  review.status = review.candidates.some(candidatoAcionavel) ? "revisao" : "concluida";
  review.updatedAt = new Date().toISOString();
  persistCallReview(review);
  return copyReview(review);
}

function candidatoAcionavel(candidate: ReviewCandidate): boolean {
  return candidate.decision === "pendente" || candidate.decision === "erro";
}

/** Migra revisões mantidas em memória por versões que deixavam uma falha de
 * aplicação como pendente. O estado erro continua editável e reaprovável. */
function normalizarErrosTecnicos(review: MemoryReview): void {
  let changed = false;
  for (const candidate of review.candidates) {
    if (candidate.decision === "pendente" && candidate.result?.startsWith("Erro:")) {
      candidate.decision = "erro";
      changed = true;
    }
  }
  if (changed) {
    review.status = "revisao";
    review.updatedAt = new Date().toISOString();
    persistCallReview(review);
  }
}

async function generateReview(review: MemoryReview): Promise<void> {
  review.status = "analisando";
  review.updatedAt = new Date().toISOString();
  const onStep = (event: AgentEvent): void => {
    const label = event.type === "tool_call"
      ? event.name === "memoria_preparar_candidato"
        ? "Preparando proposta no template correto"
        : event.name === "memoria_template"
          ? "Consultando contrato do tipo de memória"
          : `Consultando ${event.name}`
      : event.type === "tool_result"
        && (event.name === "memoria_finalizar_cobertura" || event.name === "curadoria_lote")
          ? event.result
      : event.type === "thinking"
        ? "Curador examinando as evidências"
        : event.type === "max_steps"
          ? "Limite de análise atingido"
          : null;
    if (label && review.progress.at(-1) !== label) review.progress.push(label);
    if (review.progress.length > 20) review.progress.shift();
    review.updatedAt = new Date().toISOString();
  };
  try {
    let candidates: readonly Candidato[];
    if (review.source.kind === "chat") {
      candidates = await extrairCandidatosChat({
          history: chatHistory(review.source.id) as Message[],
          apiKey: requireSecret("GLM_API_KEY"),
          onStep,
        });
      review.coverage = null;
    } else {
      const outcome = await extrairCandidatosCall({
          analysis: readFileSync(join(resolveSessionDir(review.source.id), "analise-call.json"), "utf8"),
          apiKey: requireSecret("GLM_API_KEY"),
          onStep,
        });
      candidates = outcome.candidates;
      review.coverage = outcome.coverage;
    }
    review.candidates = candidates.map((candidate) => ({
      ...candidate,
      id: randomUUID(),
      decision: "pendente",
      result: null,
    }));
    review.status = candidates.length ? "revisao" : "concluida";
  } catch (error) {
    review.status = "erro";
    review.error = error instanceof Error ? error.message : String(error);
  }
  review.updatedAt = new Date().toISOString();
  persistCallReview(review);
}

function persistCallReview(review: MemoryReview): void {
  if (review.source.kind !== "call") return;
  const path = join(resolveSessionDir(review.source.id), "curadoria-call.json");
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(copyReview(review), null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

function copyReview(review: MemoryReview): MemoryReview {
  return {
    ...review,
    source: { ...review.source },
    progress: [...review.progress],
    candidates: review.candidates.map((candidate) => ({
      ...candidate,
      frontmatter: { ...candidate.frontmatter },
      evidencias: [...candidate.evidencias],
      observationIds: [...(candidate.observationIds ?? [])],
      noveltyAssessments: [...(candidate.noveltyAssessments ?? [])],
      consultedPaths: [...(candidate.consultedPaths ?? [])],
    })),
    coverage: review.coverage
      ? {
          ...review.coverage,
          requiredObservationIds: [...review.coverage.requiredObservationIds],
          dispositions: review.coverage.dispositions.map((item) => ({ ...item })),
          noveltyAssessments: [...(review.coverage.noveltyAssessments ?? [])],
          noveltySummary: { ...(review.coverage.noveltySummary ?? {}) },
          unresolvedObservationIds: [...review.coverage.unresolvedObservationIds],
          issues: [...review.coverage.issues],
        }
      : null,
  };
}
