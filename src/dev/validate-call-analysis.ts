import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { PROJECT_ROOT } from "../core/project-root";
import { parseFrontmatter } from "../tools/memoria/frontmatter";
import {
  renderCallAnalysisMarkdown,
  writeCallAnalysis,
} from "../agents/analisador-call/report";
import {
  ANALYSIS_REDUCTION_BATCH_CHARACTERS,
  buildMemoryBlocks,
  isVideoPlatformBoilerplate,
  knowledgeEvidenceBelongsToCreator,
  splitObservationBatches,
} from "../agents/analisador-call/index";
import {
  chunkCallTranscript,
  loadCallTranscript,
} from "../agents/analisador-call/transcript";
import {
  CALL_ANALYSIS_PROMPT_VERSION,
  CALL_ANALYSIS_SCHEMA_VERSION,
  type CallAnalysis,
  type CallUtterance,
  type ModelObservation,
} from "../agents/analisador-call/types";
import {
  auditCallCoverage,
  CALL_CURATION_BATCH_CHARACTERS,
  observationRequiresCuration,
  splitCurationObservationBatches,
} from "../agents/curador-call/index";
import type { Candidato } from "../tools/memoria/candidato";
import { attachPossibleMemoryMatches } from "../agents/analisador-call/grounding";
import { memoriaContextualizar } from "../tools/memoria/contextualizar";
import {
  iniciarContextualizacao,
  limparContextualizacao,
  memoriaClassificarNovidade,
  obterIdsSemAvaliacaoNovidade,
} from "../tools/memoria/contextualizacao";
import { memoriaListar } from "../tools/memoria/listar";
import { memoriaLer } from "../tools/memoria/ler";
import {
  coberturaFinalizada,
  iniciarCobertura,
  limparCobertura,
  memoriaFinalizarCobertura,
  obterDisposicoes,
} from "../tools/memoria/cobertura";

const utterances: CallUtterance[] = Array.from({ length: 40 }, (_, index) => ({
  id: `fala_${String(index + 1).padStart(6, "0")}`,
  user_id: String(index % 2),
  person_id: `mem_00000000-0000-4000-8000-00000000000${index % 2}`,
  speaker: index % 2 ? "Pessoa B" : "Pessoa A",
  start: index * 2,
  end: index * 2 + 1,
  absolute_start: null,
  absolute_end: null,
  text: `Fala sintética ${index + 1} ${"x".repeat(70)}`,
}));

const chunks = chunkCallTranscript(utterances, 2_000, 2);
if (chunks.length < 2) throw new Error("chunking não dividiu uma call longa");
for (const utterance of utterances) {
  if (!chunks.some((chunk) => chunk.utterances.some((item) => item.id === utterance.id))) {
    throw new Error(`fala perdida no chunking: ${utterance.id}`);
  }
}

const creatorId = utterances[0]?.person_id ?? null;
const knowledge: ModelObservation = {
  memory_type: "Conhecimento",
  section: "Detalhes",
  subject: { name: "Tópico", memory_id: null, memory_path: null },
  target: null,
  about: [],
  claimants: [{
    name: "Pessoa A",
    memory_id: creatorId,
    memory_path: null,
  }],
  statement: "Aprendizado sintético",
  basis: "explicita",
  epistemic_kind: "declaracao_propria",
  confidence: "alta",
  memory_signal: "alto",
  temporal_context: null,
  utterance_ids: [utterances[0]?.id ?? ""],
  notes: null,
};
const utteranceMap = new Map(utterances.map((utterance) => [utterance.id, utterance]));
if (!knowledgeEvidenceBelongsToCreator(knowledge, utteranceMap, creatorId)) {
  throw new Error("conhecimento do Criador foi rejeitado");
}
const thirdPartyKnowledge = { ...knowledge, utterance_ids: [utterances[1]?.id ?? ""] };
if (knowledgeEvidenceBelongsToCreator(thirdPartyKnowledge, utteranceMap, creatorId)) {
  throw new Error("conhecimento de terceiro passou pela trava do Criador");
}
const reductionInput = Array.from({ length: 20 }, (_, index) => ({
  ...knowledge,
  statement: `Observação extensa ${index} ${"x".repeat(1_500)}`,
  utterance_ids: [utterances[index]?.id ?? utterances[0]?.id ?? ""],
}));
const reductionBatches = splitObservationBatches(reductionInput);
if (reductionBatches.length < 2) {
  throw new Error("redução não subdividiu uma consolidação extensa");
}
for (const batch of reductionBatches) {
  if (JSON.stringify(batch).length > ANALYSIS_REDUCTION_BATCH_CHARACTERS) {
    throw new Error("lote de redução excedeu o limite preventivo");
  }
}
if (!isVideoPlatformBoilerplate("Pessoal, se inscreva no canal e ative o sininho.")) {
  throw new Error("frase típica de vídeo não foi filtrada");
}
if (!isVideoPlatformBoilerplate("Obrigado por assistir, compartilhe com seus amigos.")) {
  throw new Error("encerramento típico de vídeo não foi filtrado");
}
if (isVideoPlatformBoilerplate("Eu criei um canal no YouTube para publicar minhas músicas.")) {
  throw new Error("declaração factual sobre canal foi filtrada indevidamente");
}

const projetoAlvo = listarProjetosComParticipantes()[0];
if (!projetoAlvo) {
  console.log("⚠ Bundle sem Projeto com participantes; etapa contextual dinâmica ignorada.");
} else {
  const contextualProject = await memoriaContextualizar({
    consulta: projetoAlvo.title,
    tipo_memoria: "Projeto",
    entidade_ids: projetoAlvo.participantes.slice(0, 2),
  });
  if (!contextualProject.includes(projetoAlvo.path)) {
    throw new Error("recuperação contextual não localizou o Projeto existente");
  }
  const grounded = attachPossibleMemoryMatches([{
    id: "obs_00001",
    memory_type: "Projeto",
    section: "Estado Atual",
    subject: { name: projetoAlvo.title, memory_id: null, memory_path: null },
    target: null,
    about: [{
      name: projetoAlvo.title,
      memory_id: projetoAlvo.participantes[0] ?? null,
      memory_path: null,
    }],
    claimants: [],
    statement: `O grupo discutiu o andamento e as próximas etapas de ${projetoAlvo.title}.`,
    basis: "explicita",
    epistemic_kind: "relato_de_terceiro",
    confidence: "alta",
    memory_signal: "alto",
    temporal_context: null,
    notes: null,
    evidence: [],
    possible_memory_matches: [],
  }]);
  if (!grounded[0]?.possible_memory_matches.some((item) => item.path === projetoAlvo.path)) {
    throw new Error("grounding pós-extração não anexou correspondência de Projeto");
  }

  iniciarContextualizacao({
    source: "call",
    allowedObservationIds: ["obs_00001"],
    requiredObservationIds: ["obs_00001"],
  });
  const prematureNovelty = await memoriaClassificarNovidade({
    avaliacoes: [{
      observation_id: "obs_00001",
      tipo_memoria: "Projeto",
      classificacao: "complementar",
      motivo: "Teste.",
      path_comparado: projetoAlvo.path,
    }],
  });
  if (!prematureNovelty.startsWith("Erro:")) {
    throw new Error("classificação de novidade aceitou decisão sem consulta prévia");
  }
  await memoriaListar({ pasta: "projetos" });
  await memoriaLer({ path: projetoAlvo.path });
  const validNovelty = await memoriaClassificarNovidade({
    avaliacoes: [{
      observation_id: "obs_00001",
      tipo_memoria: "Projeto",
      classificacao: "complementar",
      motivo: "Acrescenta uma decisão ao projeto já cadastrado.",
      path_comparado: projetoAlvo.path,
    }],
  });
  if (!validNovelty.startsWith("Novidade classificada") || obterIdsSemAvaliacaoNovidade().length) {
    throw new Error("classificação contextualizada de novidade falhou");
  }
  limparContextualizacao();
}

iniciarCobertura(["obs_00001", "obs_00002"], ["obs_00001", "obs_00002"]);
const incompleteCoverage = await memoriaFinalizarCobertura({
  disposicoes: [{
    observation_id: "obs_00001",
    decisao: "descartada",
    motivo: "Exemplo local sem informação durável.",
  }],
});
if (!incompleteCoverage.startsWith("Cobertura parcial registrada") || obterDisposicoes().length !== 1) {
  throw new Error("cobertura parcial não preservou o primeiro lote");
}
const completeCoverage = await memoriaFinalizarCobertura({
  disposicoes: [
    {
      observation_id: "obs_00001",
      decisao: "proposta",
      motivo: "Informação incorporada à ficha.",
      path_candidato: "social/pessoas/pessoa-a",
    },
    {
      observation_id: "obs_00002",
      decisao: "descartada",
      motivo: "Apenas reação momentânea.",
    },
  ],
});
if (!completeCoverage.startsWith("Cobertura concluída") || !coberturaFinalizada()) {
  throw new Error("cobertura completa não foi finalizada");
}
const syntheticCandidate: Candidato = {
  acao: "atualizar",
  path: "social/pessoas/pessoa-a",
  pathOrigem: "social/pessoas/pessoa-a",
  frontmatter: {},
  corpo: "## Informações Gerais",
  motivo: "Teste local.",
  naturezaProposta: "explicita",
  evidencias: ["Evidência local."],
  observationIds: ["obs_00001"],
  noveltyAssessments: [],
  consultedPaths: [],
};
const auditIssues = auditCallCoverage({
  allowedIds: ["obs_00001", "obs_00002"],
  requiredIds: ["obs_00001", "obs_00002"],
  candidates: [syntheticCandidate],
  dispositions: obterDisposicoes(),
  finalized: coberturaFinalizada(),
});
if (auditIssues.length) throw new Error(`auditoria válida falhou: ${auditIssues.join("; ")}`);
limparCobertura();

const analysis: CallAnalysis = {
  schema_version: CALL_ANALYSIS_SCHEMA_VERSION,
  session_id: "sessao-sintetica",
  generated_at: new Date(0).toISOString(),
  analyzer: {
    id: "analisador-call",
    model: "modelo-local-de-validacao",
    prompt_version: CALL_ANALYSIS_PROMPT_VERSION,
  },
  source: {
    conversation_txt: "conversa.txt",
    conversation_json: "conversa.json",
    transcript_sha256: "hash",
    memory_context_sha256: "memory-hash",
  },
  started_at: null,
  ended_at: null,
  participants: [],
  summary: "Validação local.",
  conversation_context: {
    summary: "Duas pessoas conversaram brevemente durante um teste local.",
    primary_activity: "teste local",
    tone: "neutro",
    interaction_dynamics: "interação breve e colaborativa",
    dominant_topics: ["validação"],
    curator_recommendation: {
      rationale: "Leia os blocos sem extrapolar o teste.",
      focus: [],
      avoid_overinterpreting: ["A brevidade do teste não caracteriza as pessoas."],
    },
  },
  memory_blocks: buildMemoryBlocks([]),
  observations: [],
  ambiguities: [],
};
if (
  analysis.memory_blocks.length !== 3
  || analysis.memory_blocks.map((block) => block.signal).join(",") !== "alto,medio,baixo"
) {
  throw new Error("relatório não criou os três blocos canônicos na ordem de prioridade");
}
const largeCurationInput = Array.from({ length: 30 }, (_, index) => ({
  id: `obs_${String(index + 1).padStart(5, "0")}`,
  memory_type: index < 10 ? "Pessoa" : "Evento",
  subject: index < 10
    ? { name: "Pessoa A", memory_id: creatorId, memory_path: "social/pessoas/pessoa-a.md" }
    : { name: `Evento ${index}`, memory_id: null, memory_path: null },
  statement: `Afirmação consolidada ${index} ${"y".repeat(800)}`,
  confidence: "alta",
  memory_signal: index < 5 ? "alto" : index < 20 ? "medio" : "baixo",
  evidence: [{
    utterance_id: utterances[index]?.id,
    speaker_name: "Pessoa A",
    start: index,
    end: index + 1,
    absolute_start: new Date(index * 1_000).toISOString(),
    text: `Evidência ${index} ${"x".repeat(1_500)}`,
  }],
}));
const curationBatches = splitCurationObservationBatches(largeCurationInput, 20_000);
if (curationBatches.length < 2) {
  throw new Error("curadoria não subdividiu um relatório extenso");
}
const personBatchCount = curationBatches.filter((batch) => batch.some((value) => (
  (value as { subject?: { memory_id?: string } }).subject?.memory_id === creatorId
))).length;
if (personBatchCount !== 1) {
  throw new Error("curadoria separou observações da mesma pessoa em lotes distintos");
}
if (CALL_CURATION_BATCH_CHARACTERS < 20_000) {
  throw new Error("limite padrão da curadoria é excessivamente baixo");
}
if (!observationRequiresCuration({ confidence: "baixa", memory_signal: "alto" })) {
  throw new Error("curadoria ignorou observação importante por causa da confiança factual");
}
if (observationRequiresCuration({ confidence: "alta", memory_signal: "baixo" })) {
  throw new Error("curadoria tratou confiança alta como potencial de memória alto");
}
const priorityBatches = splitCurationObservationBatches([
  { id: "obs_90001", memory_type: "Evento", memory_signal: "baixo", subject: { name: "Ruído" } },
  { id: "obs_90002", memory_type: "Projeto", memory_signal: "alto", subject: { name: "Iniciativa" } },
], 20_000);
if ((priorityBatches[0]?.[0] as { memory_signal?: string } | undefined)?.memory_signal !== "alto") {
  throw new Error("curadoria não priorizou o bloco Alto antes do Baixo");
}
const markdown = renderCallAnalysisMarkdown(analysis);
if (
  !markdown.includes("# Análise da call")
  || !markdown.includes("## Contexto geral da conversa")
  || !markdown.includes("## Recomendação ao curador")
  || !markdown.includes("## Blocos por potencial de memória")
  || !markdown.includes("### Alto potencial")
  || !markdown.includes("### Médio potencial")
  || !markdown.includes("### Baixo potencial")
) {
  throw new Error("relatório Markdown incompleto");
}

const recordingsRoot = resolve(PROJECT_ROOT, "discordbot", "gravacoes");
mkdirSync(recordingsRoot, { recursive: true });
const temporarySession = mkdtempSync(join(recordingsRoot, ".validate-call-"));
try {
  writeFileSync(
    join(temporarySession, "conversa.txt"),
    "[00:00:01.000 - 00:00:02.000] Pessoa A: Teste local.\n",
    "utf8",
  );
  const loaded = loadCallTranscript(temporarySession);
  if (loaded.utterances.length !== 1 || loaded.utterances[0]?.speaker !== "Pessoa A") {
    throw new Error("loader não interpretou conversa.txt");
  }
  const paths = writeCallAnalysis(analysis, temporarySession);
  if (!existsSync(paths.jsonPath) || !existsSync(paths.markdownPath)) {
    throw new Error("artefatos finais não foram gravados");
  }
} finally {
  const inside = relative(recordingsRoot, temporarySession);
  if (!inside.startsWith("..") && inside.startsWith(".validate-call-")) {
    rmSync(temporarySession, { recursive: true, force: true });
  }
}

console.log(`✓ Análise de call: chunking preservou ${utterances.length} falas em ${chunks.length} blocos.`);

interface ProjetoCadastrado {
  readonly path: string;
  readonly title: string;
  readonly id: string;
  readonly participantes: readonly string[];
}

/** Projeto do bundle local usado nas verificações contextuais, sem dados fixos. */
function listarProjetosComParticipantes(): ProjetoCadastrado[] {
  const diretorio = resolve(PROJECT_ROOT, "memory", "projetos");
  if (!existsSync(diretorio)) return [];
  return readdirSync(diretorio)
    .filter((nome) => nome.endsWith(".md") && nome !== "index.md")
    .flatMap((nome) => {
      const { campos } = parseFrontmatter(readFileSync(join(diretorio, nome), "utf8"));
      const participantes = Array.isArray(campos.participantes)
        ? campos.participantes.filter((item): item is string => typeof item === "string")
        : [];
      const id = typeof campos.id === "string" ? campos.id : "";
      const title = typeof campos.title === "string" ? campos.title : "";
      if (!id || !title || !participantes.length) return [];
      return [{ path: `projetos/${nome}`, title, id, participantes }];
    });
}
