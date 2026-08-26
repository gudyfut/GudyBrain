import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Agent, AgentEvent } from "../../core/agent";
import { PROJECT_ROOT } from "../../core/project-root";
import { AGENT_PROFILES, createAgentFromProfile } from "../registry";
import { chunkCallTranscript, loadCallTranscript } from "./transcript";
import { writeCallAnalysis } from "./report";
import { attachPossibleMemoryMatches } from "./grounding";
import {
  CALL_ANALYSIS_PROMPT_VERSION,
  CALL_ANALYSIS_SCHEMA_VERSION,
  MEMORY_TYPES,
  type AnalyzeCallResult,
  type CallAnalysis,
  type CallChunk,
  type CallMemoryBlock,
  type CallMemorySignal,
  type CallObservation,
  type CallUtterance,
  type ConversationContextAssessment,
  type MemoryType,
  type ModelObservation,
  type ObservationBasis,
  type ObservationConfidence,
  type ObservationEpistemicKind,
  type ObservationEvidence,
  type ObservationSubject,
} from "./types";

/** Mantém entrada e, principalmente, saída das reduções longe do limite do
 * modelo. Respostas próximas desse limite tendem a terminar com JSON truncado. */
export const ANALYSIS_REDUCTION_BATCH_CHARACTERS = 18_000;
const MEMORY_ID = /^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ModelPhaseOutput {
  readonly summary: string;
  readonly observations: readonly ModelObservation[];
  readonly ambiguities: readonly string[];
}

interface ChunkCache {
  readonly cache: {
    readonly prompt_version: string;
    readonly model: string;
    readonly chunk_sha256: string;
  };
  readonly output: ModelPhaseOutput;
}

export interface AnalyzeCallOptions {
  readonly session: string;
  readonly apiKey: string;
  readonly force?: boolean;
  readonly maximumChunkCharacters?: number;
  readonly onProgress?: (message: string) => void;
  readonly onStep?: (event: AgentEvent) => void;
}

export function criarAnalisadorCall(options: {
  apiKey: string;
  onStep?: (event: AgentEvent) => void;
}): Agent {
  return createAgentFromProfile(AGENT_PROFILES.analisadorCall, options);
}

export async function analisarCall(options: AnalyzeCallOptions): Promise<AnalyzeCallResult> {
  const transcript = loadCallTranscript(options.session);
  const profile = AGENT_PROFILES.analisadorCall;
  const memoryContextHash = memoryContextFingerprint();
  const existing = loadReusableAnalysis(
    transcript.session_dir,
    transcript.transcript_sha256,
    profile.model,
    memoryContextHash,
  );
  if (existing && !options.force) {
    const paths = writeCallAnalysis(existing, transcript.session_dir);
    options.onProgress?.("Análise existente compatível; reutilizando o resultado.");
    return {
      analysis: existing,
      json_path: paths.jsonPath,
      markdown_path: paths.markdownPath,
      reused: true,
    };
  }

  const utterances = transcript.utterances.filter((utterance) => !isVideoPlatformBoilerplate(utterance.text));
  const ignoredVideoBoilerplate = transcript.utterances.length - utterances.length;
  const chunks = chunkCallTranscript(
    utterances,
    options.maximumChunkCharacters ?? 14_000,
  );
  const analysisCacheDir = join(transcript.session_dir, "analise-call", "partes");
  mkdirSync(analysisCacheDir, { recursive: true });
  const creatorPersonId = loadCreatorPersonId();
  const summaries: string[] = [];
  const extracted: ModelObservation[] = [];
  const ambiguities: string[] = [];

  options.onProgress?.(
    `Extração factual: ${chunks.length} bloco(s), ${utterances.length} fala(s).${ignoredVideoBoilerplate ? ` ${ignoredVideoBoilerplate} frase(s) típica(s) de vídeo ignorada(s).` : ""}`,
  );
  for (const chunk of chunks) {
    const cached = options.force
      ? null
      : loadChunkCache(analysisCacheDir, chunk, profile.model);
    let output: ModelPhaseOutput;
    if (cached) {
      output = cached.output;
      options.onProgress?.(`Bloco ${chunk.index}/${chunks.length}: cache reutilizado.`);
    } else {
      options.onProgress?.(`Bloco ${chunk.index}/${chunks.length}: interpretando falas.`);
      const agent = criarAnalisadorCall({ apiKey: options.apiKey, onStep: options.onStep });
      output = await runJsonPhase(
        agent,
        extractionPrompt(chunk, chunks.length, creatorPersonId),
        chunk.utterances,
        undefined,
        true,
      );
      writeChunkCache(analysisCacheDir, chunk, profile.model, output);
    }
    if (output.summary) summaries.push(output.summary);
    extracted.push(...output.observations);
    ambiguities.push(...output.ambiguities);
  }

  const utteranceMap = new Map(utterances.map((utterance) => [utterance.id, utterance]));
  const uniqueExtracted = deduplicateModelObservations(
    extracted.filter((observation) => knowledgeEvidenceBelongsToCreator(observation, utteranceMap, creatorPersonId)),
  );

  options.onProgress?.("Avaliando o contexto global e o potencial de memória da call.");
  const conversationContext = await assessConversation({
    summaries,
    observations: uniqueExtracted,
    participants: transcript.participants.map((participant) => participant.display_name),
    utteranceCount: utterances.length,
    startedAt: transcript.started_at,
    endedAt: transcript.ended_at,
    apiKey: options.apiKey,
    onStep: options.onStep,
  });

  const consolidated: ModelObservation[] = [];
  for (const memoryType of MEMORY_TYPES) {
    const crossCutting = memoryType === "Evento" || memoryType === "Projeto";
    const categoryInput = crossCutting
      ? uniqueExtracted
      : uniqueExtracted.filter((item) => item.memory_type === memoryType);
    if (!categoryInput.length && !crossCutting) continue;
    options.onProgress?.(`Consolidando ${labelForType(memoryType)}.`);
    const result = await consolidateType({
      type: memoryType,
      observations: categoryInput,
      chunkSummaries: crossCutting ? summaries : [],
      utterances,
      apiKey: options.apiKey,
      creatorPersonId,
      onStep: options.onStep,
    });
    consolidated.push(...result.observations);
    ambiguities.push(...result.ambiguities);
  }

  const personEvidence = consolidated.filter(
    (observation) => observation.memory_type === "Pessoa" || observation.about.length > 0,
  );
  if (personEvidence.length) {
    options.onProgress?.("Fazendo a síntese transversal centrada nas pessoas.");
    const personSynthesis = await synthesizePeople({
      observations: personEvidence,
      utterances,
      apiKey: options.apiKey,
      creatorPersonId,
      onStep: options.onStep,
    });
    consolidated.push(...personSynthesis.observations);
    ambiguities.push(...personSynthesis.ambiguities);
  }

  const finalModelObservations = deduplicateModelObservations(
    consolidated.filter((observation) => knowledgeEvidenceBelongsToCreator(observation, utteranceMap, creatorPersonId)),
  );
  options.onProgress?.("Relacionando observações a possíveis conceitos já existentes.");
  const observations = attachPossibleMemoryMatches(
    enrichEvidence(finalModelObservations, utteranceMap),
  );
  const memoryBlocks = buildMemoryBlocks(observations);
  const analysis: CallAnalysis = {
    schema_version: CALL_ANALYSIS_SCHEMA_VERSION,
    session_id: transcript.session_id,
    generated_at: new Date().toISOString(),
    analyzer: {
      id: "analisador-call",
      model: profile.model,
      prompt_version: CALL_ANALYSIS_PROMPT_VERSION,
    },
    source: {
      conversation_txt: transcript.conversation_txt,
      conversation_json: transcript.conversation_json,
      transcript_sha256: transcript.transcript_sha256,
      memory_context_sha256: memoryContextHash,
    },
    started_at: transcript.started_at,
    ended_at: transcript.ended_at,
    participants: transcript.participants,
    summary: conversationContext.summary,
    conversation_context: conversationContext,
    memory_blocks: memoryBlocks,
    observations,
    ambiguities: uniqueStrings(ambiguities),
  };
  const paths = writeCallAnalysis(analysis, transcript.session_dir);
  options.onProgress?.(`Relatório concluído com ${observations.length} observação(ões).`);
  return {
    analysis,
    json_path: paths.jsonPath,
    markdown_path: paths.markdownPath,
    reused: false,
  };
}

async function assessConversation(options: {
  summaries: readonly string[];
  observations: readonly ModelObservation[];
  participants: readonly string[];
  utteranceCount: number;
  startedAt: string | null;
  endedAt: string | null;
  apiKey: string;
  onStep?: (event: AgentEvent) => void;
}): Promise<ConversationContextAssessment> {
  const summaryBatches = splitStringBatches(options.summaries, 38_000);
  const batches = summaryBatches.length ? summaryBatches : [[]];
  const partials: ConversationContextAssessment[] = [];
  const observationSignals = sampleEvenly(options.observations, 80).map((observation) => ({
    memory_type: observation.memory_type,
    subject: observation.subject.name,
    target: observation.target?.name ?? null,
    about: observation.about.map((item) => item.name),
    statement: observation.statement,
    epistemic_kind: observation.epistemic_kind,
    confidence: observation.confidence,
    memory_signal: observation.memory_signal,
  }));
  const observationStats = summarizeObservationStats(options.observations);

  for (const [index, summaries] of batches.entries()) {
    const agent = criarAnalisadorCall({ apiKey: options.apiKey, onStep: options.onStep });
    partials.push(await runContextAssessmentPhase(
      agent,
      contextAssessmentPrompt({
        summaries,
        observationSignals,
        observationStats,
        participants: options.participants,
        utteranceCount: options.utteranceCount,
        startedAt: options.startedAt,
        endedAt: options.endedAt,
        batch: index + 1,
        totalBatches: batches.length,
      }),
    ));
  }

  if (partials.length === 1) return partials[0] ?? fallbackContextAssessment();
  const agent = criarAnalisadorCall({ apiKey: options.apiKey, onStep: options.onStep });
  return runContextAssessmentPhase(
    agent,
    finalContextAssessmentPrompt(partials),
  );
}

async function runContextAssessmentPhase(
  agent: Agent,
  prompt: string,
): Promise<ConversationContextAssessment> {
  let response = await agent.run(prompt, {
    disableTools: true,
    responseFormat: "json_object",
    thinking: "disabled",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return normalizeContextAssessment(parseJsonObject(response));
    } catch (error) {
      if (attempt === 1) throw error;
      response = await agent.run(
        "A avaliação anterior não respeitou o contrato JSON. Corrija-a e devolva somente o objeto solicitado, sem markdown nem comentários.",
        { disableTools: true, responseFormat: "json_object", thinking: "disabled" },
      );
    }
  }
  return fallbackContextAssessment();
}

async function consolidateType(options: {
  type: MemoryType;
  observations: readonly ModelObservation[];
  chunkSummaries: readonly string[];
  utterances: readonly CallUtterance[];
  apiKey: string;
  creatorPersonId: string | null;
  onStep?: (event: AgentEvent) => void;
}): Promise<ModelPhaseOutput> {
  let batches = splitObservationBatches(options.observations);
  if (!batches.length) batches = [[]];
  let summaries: string[] = [];
  let ambiguities: string[] = [];
  let results: ModelObservation[] = [];

  for (const [index, batch] of batches.entries()) {
    const output = await consolidateBatchWithFallback({
      ...options,
      observations: batch,
      batch: index + 1,
      totalBatches: batches.length,
    });
    if (output.summary) summaries.push(output.summary);
    results.push(...output.observations);
    ambiguities.push(...output.ambiguities);
  }

  results = deduplicateModelObservations(results);
  if (
    batches.length > 1
    && JSON.stringify(results).length <= ANALYSIS_REDUCTION_BATCH_CHARACTERS
  ) {
    const ids = new Set(results.flatMap((observation) => observation.utterance_ids));
    const relevantUtterances = options.utterances.filter((utterance) => ids.has(utterance.id));
    const agent = criarAnalisadorCall({ apiKey: options.apiKey, onStep: options.onStep });
    const output = await runJsonPhase(
      agent,
      consolidationPrompt(options.type, results, summaries, options.creatorPersonId, 1, 1),
      relevantUtterances,
      options.type,
      false,
    );
    results = [...output.observations];
    summaries = output.summary ? [output.summary] : summaries;
    ambiguities = [...ambiguities, ...output.ambiguities];
  }
  return {
    summary: summaries.join(" "),
    observations: deduplicateModelObservations(results),
    ambiguities: uniqueStrings(ambiguities),
  };
}

async function consolidateBatchWithFallback(options: {
  type: MemoryType;
  observations: readonly ModelObservation[];
  chunkSummaries: readonly string[];
  utterances: readonly CallUtterance[];
  apiKey: string;
  creatorPersonId: string | null;
  onStep?: (event: AgentEvent) => void;
  batch: number;
  totalBatches: number;
}): Promise<ModelPhaseOutput> {
  const ids = new Set(options.observations.flatMap((item) => item.utterance_ids));
  const relevantUtterances = options.utterances.filter((item) => ids.has(item.id));
  const agent = criarAnalisadorCall({ apiKey: options.apiKey, onStep: options.onStep });
  try {
    return await runJsonPhase(
      agent,
      consolidationPrompt(
        options.type,
        options.observations,
        options.chunkSummaries,
        options.creatorPersonId,
        options.batch,
        options.totalBatches,
      ),
      relevantUtterances.length ? relevantUtterances : options.utterances,
      options.type,
      false,
    );
  } catch (error) {
    if (!isStructuredOutputError(error) || options.observations.length <= 1) {
      throw error;
    }
    const [left, right] = bisectObservationBatch(options.observations);
    options.onStep?.({
      type: "answer",
      content: `JSON inválido em ${options.type}; subdividindo lote de ${options.observations.length} observações em ${left.length} + ${right.length}.`,
    });
    const halves = [];
    halves.push(await consolidateBatchWithFallback({
      ...options,
      observations: left,
      batch: 1,
      totalBatches: 2,
    }));
    halves.push(await consolidateBatchWithFallback({
      ...options,
      observations: right,
      batch: 2,
      totalBatches: 2,
    }));
    return {
      summary: halves.map((item) => item.summary).filter(Boolean).join(" "),
      observations: deduplicateModelObservations(
        halves.flatMap((item) => item.observations),
      ),
      ambiguities: uniqueStrings(halves.flatMap((item) => item.ambiguities)),
    };
  }
}

function isStructuredOutputError(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /JSON|contrato|resposta do analista/i.test(message);
}

function bisectObservationBatch(
  observations: readonly ModelObservation[],
): [ModelObservation[], ModelObservation[]] {
  const midpoint = Math.max(1, Math.ceil(observations.length / 2));
  return [observations.slice(0, midpoint), observations.slice(midpoint)];
}

/** Reagrupa evidências já consolidadas por pessoa. Esta etapa não relê a call
 * inteira e não cria fatos: ela evita que informações sobre alguém fiquem
 * escondidas apenas em Relações ou Eventos. */
async function synthesizePeople(options: {
  observations: readonly ModelObservation[];
  utterances: readonly CallUtterance[];
  apiKey: string;
  creatorPersonId: string | null;
  onStep?: (event: AgentEvent) => void;
}): Promise<ModelPhaseOutput> {
  const results: ModelObservation[] = [];
  const ambiguities: string[] = [];
  const batches = splitPersonEvidenceBatches(options.observations);

  for (const [index, batch] of batches.entries()) {
    const ids = new Set(batch.flatMap((observation) => observation.utterance_ids));
    const relevantUtterances = options.utterances.filter((utterance) => ids.has(utterance.id));
    const agent = criarAnalisadorCall({ apiKey: options.apiKey, onStep: options.onStep });
    const output = await runJsonPhase(
      agent,
      personSynthesisPrompt(batch, options.creatorPersonId, index + 1, batches.length),
      relevantUtterances,
      "Pessoa",
      false,
    );
    results.push(...output.observations);
    ambiguities.push(...output.ambiguities);
  }

  return {
    summary: "Síntese transversal por pessoa concluída.",
    observations: deduplicateModelObservations(results),
    ambiguities: uniqueStrings(ambiguities),
  };
}

async function runJsonPhase(
  agent: Agent,
  prompt: string,
  allowedUtterances: readonly CallUtterance[],
  expectedType: MemoryType | undefined,
  disableTools: boolean,
): Promise<ModelPhaseOutput> {
  let response = await agent.run(prompt, {
    disableTools,
    responseFormat: "json_object",
    thinking: disableTools ? "disabled" : "enabled",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return normalizeModelOutput(parseJsonObject(response), allowedUtterances, expectedType);
    } catch (error) {
      if (attempt === 1) throw error;
      response = await agent.run(
        "A resposta anterior não respeitou o contrato JSON. Corrija-a e devolva somente o objeto JSON solicitado, sem markdown nem explicações.",
        { disableTools: true, responseFormat: "json_object", thinking: "disabled" },
      );
    }
  }
  throw new Error("Não foi possível obter JSON válido do analista.");
}

function extractionPrompt(chunk: CallChunk, total: number, creatorPersonId: string | null): string {
  return `## Etapa: extração factual e prioridade local\n\nBloco ${chunk.index} de ${total}. As tools estão indisponíveis nesta etapa.\nCriador autorizado para Conhecimento: ${creatorPersonId ?? "não identificado; não extraia Conhecimento"}.\n\nLeia todas as falas uma vez e extraia observações de todos os tipos. Em Eventos, considere Periodo, Acontecimento e Encontro. Em Projeto, procure objetivos compartilhados, iniciativas em ideia/planejamento/execução, participantes, decisões, pendências e marcos. IDs em utterance_ids devem existir exatamente no bloco. O campo summary deve contextualizar o trecho mesmo quando não houver memória: diga o que as pessoas estavam fazendo, o tom predominante e os assuntos.\n\nAtribua memory_signal a CADA observação sem usar a proporção da call inteira: alto para decisão, plano, projeto, mudança, compromisso ou fato pessoal claramente durável/importante; medio para informação potencialmente útil mas contextual, incompleta ou ainda hipotética; baixo para coordenação momentânea, reação, brincadeira, repetição e detalhe efêmero. Confiança mede sustentação factual; memory_signal mede valor potencial. Um trecho alto continua alto mesmo cercado de horas de conversa recreativa.\n\nSepare rigorosamente alegação útil, insulto, hipérbole e episódio independente. Uma observação contém uma única alegação. Preencha claimants com quem fez ou sustentou a afirmação e about com as pessoas/entidades sobre as quais ela informa, mesmo quando subject for um Evento, Projeto ou o dono de uma Relação.\n\nContrato exato:\n${observationOutputContract("Pessoa|Grupo|Lugar|Evento|Projeto|Conhecimento", "resumo contextual e factual curto do bloco")}\n\nPara Relações, subject é quem expressa a opinião e target é a outra Pessoa, mas só quando a fala revela sua visão durável sobre o caráter, personalidade, valores, motivações, qualidades, defeitos ou confiabilidade do alvo. Aptidão para tarefa, papel em empresa, coordenação, parentesco e reação a episódio não são Relações. Para Projeto, subject é a iniciativa, não uma pessoa que apenas opinou sobre ela. Para Conhecimento, subject.name é o tópico, toda evidência deve ser fala do Criador e conteúdo casual não entra nesse tipo. No bloco Baixo, registre somente exemplos representativos que expliquem descartes prováveis; não transforme cada comando de jogo ou piada repetida em observação.\n\nTRANSCRIÇÃO DO BLOCO:\n${chunk.text}`;
}

function contextAssessmentPrompt(input: {
  summaries: readonly string[];
  observationSignals: readonly Record<string, unknown>[];
  observationStats: Readonly<Record<string, unknown>>;
  participants: readonly string[];
  utteranceCount: number;
  startedAt: string | null;
  endedAt: string | null;
  batch: number;
  totalBatches: number;
}): string {
  return `## Etapa: contexto global da conversa\n\nAvalie este conjunto de resumos somente como CONVERSA: determine atividade principal, tom, dinâmica e assuntos dominantes. Brincadeiras, provocações e coordenação de partida podem explicar a call sem caracterizar permanentemente ninguém. Não produza uma nota global de memória e não rebaixe um trecho importante por ele ocupar uma proporção pequena da duração. A prioridade é definida por observação e organizada nos blocos Alto/Médio/Baixo pelo código.\n\nfocus indica temas que merecem leitura cuidadosa, não uma lista exclusiva. Em avoid_overinterpreting, descreva saltos interpretativos específicos a evitar; nunca proíba genericamente todas as observações sobre uma pessoa ou assunto.\n\nLote contextual ${input.batch}/${input.totalBatches}. Participantes: ${JSON.stringify(input.participants)}. Falas totais: ${input.utteranceCount}. Início: ${input.startedAt ?? "desconhecido"}. Fim: ${input.endedAt ?? "desconhecido"}.\n\nContrato exato:\n${contextAssessmentContract()}\n\nRESUMOS CONTEXTUAIS DOS BLOCOS:\n${JSON.stringify(input.summaries)}\n\nSINAIS DE OBSERVAÇÕES ENCONTRADAS (amostra distribuída, não use como contagem absoluta):\n${JSON.stringify(input.observationSignals)}\n\nCONTAGENS COMPLETAS DAS OBSERVAÇÕES EXTRAÍDAS:\n${JSON.stringify(input.observationStats)}`;
}

function finalContextAssessmentPrompt(
  partials: readonly ConversationContextAssessment[],
): string {
  return `## Etapa: síntese global do contexto\n\nUna todas as avaliações parciais numa descrição da call inteira. O contexto explica a conversa, mas não decide a importância das observações: não use a predominância de brincadeira para rebaixar decisões, projetos ou acontecimentos importantes. focus é prioridade, nunca lista exclusiva; avoid_overinterpreting deve apontar apenas saltos interpretativos específicos.\n\nContrato exato:\n${contextAssessmentContract()}\n\nAVALIAÇÕES PARCIAIS:\n${JSON.stringify(partials)}`;
}

function contextAssessmentContract(): string {
  return '{"summary":"resumo da conversa inteira em um parágrafo","primary_activity":null,"tone":"tom predominante","interaction_dynamics":"como os participantes interagiram","dominant_topics":["assunto"],"curator_recommendation":{"rationale":"como ler a call sem diluir trechos importantes","focus":["tema que merece atenção"],"avoid_overinterpreting":["o que não deve virar memória por si só"]}}';
}

function consolidationPrompt(
  type: MemoryType,
  observations: readonly ModelObservation[],
  chunkSummaries: readonly string[],
  creatorPersonId: string | null,
  batch: number,
  totalBatches: number,
): string {
  return `## Etapa: consolidação de ${type}\n\nLote ${batch}/${totalBatches}. Consolide somente observações do tipo ${type}, remova duplicatas, preserve contradições e mantenha todos os IDs de fala que sustentam cada resultado. Use as tools apenas para resolver ID/path de entidades já citadas; memória anterior não é evidência da call.\nCriador autorizado para Conhecimento: ${creatorPersonId ?? "não identificado"}.\n\nNunca funda insulto ou hipérbole com uma alegação comportamental útil. Preserve epistemic_kind, claimants, about e memory_signal; ao unir relatos equivalentes, una também os claimants e todas as evidências. Mantenha o maior memory_signal sustentado entre observações equivalentes. Nunca rebaixe uma observação por causa do tom geral da call.\n${type === "Evento" ? "Faça uma passagem global inclusiva por Periodos, Acontecimentos e Encontros. Você pode conectar observações distantes, mas liste como evidência todas as falas necessárias e não invente causalidade. Marque em about todas as pessoas envolvidas sobre as quais o episódio informa.\n" : ""}${type === "Projeto" ? "Consolide a iniciativa como Projeto quando houver objetivo compartilhado ou trabalho planejado/em execução. Preserve como proposta, hipótese, decisão ou estado atual exatamente conforme as falas; discussão de empresa ainda não formalizada pode ser Projeto em estado Ideia.\n" : ""}\nContrato exato:\n${observationOutputContract(type, "síntese curta da categoria")}\n\nRESUMOS DOS BLOCOS:\n${JSON.stringify(chunkSummaries)}\n\nOBSERVAÇÕES EXTRAÍDAS:\n${JSON.stringify(observations)}`;
}

function personSynthesisPrompt(
  observations: readonly ModelObservation[],
  creatorPersonId: string | null,
  batch: number,
  totalBatches: number,
): string {
  return `## Etapa: síntese transversal centrada em pessoas\n\nLote ${batch}/${totalBatches}. Releia as observações consolidadas de todos os tipos agrupadas pelas pessoas em about. Crie somente observações de Pessoa que revelem informação durável sobre a própria pessoa e que ficaria escondida apenas em Relações, Eventos ou Projetos. Não repita fatos diretos que já sejam observações de Pessoa e não converta papel hipotético em Projeto em traço de personalidade.\n\nRegras de inferência:\n- opinião isolada: só permanece como Relação quando revela como o autor vê o núcleo pessoal do alvo; competência contextual, papel, convivência e episódio não bastam;\n- uma Relação usa subject = autor da opinião e target = alvo, nunca o inverso;\n- episódio isolado: preserve como histórico episódico, nunca padrão;\n- papel, competência ou proposta discutida num Projeto pertence ao Projeto, salvo declaração independente e durável sobre a pessoa;\n- dois episódios concretos distintos OU relatos independentes de duas pessoas podem sustentar padrao_inferido de confiança média;\n- redija padrões como percepção sustentada ("amigos relataram episódios..."), sem diagnóstico ou certeza absoluta;\n- insultos, memes e hipérboles não contam como apoio;\n- mantenha versões contraditórias separadas;\n- subject é a pessoa caracterizada nesta síntese; claimants são as pessoas que sustentam a leitura; about contém a própria pessoa;\n- preserve memory_signal sem aumentá-lo por mera síntese;\n- use todos os IDs de fala necessários e não introduza informação ausente.\n\nUse as tools somente para resolver a pessoa já citada. Criador: ${creatorPersonId ?? "não identificado"}.\n\nContrato exato:\n${observationOutputContract("Pessoa", "síntese curta dos perfis encontrados")}\n\nEVIDÊNCIAS CONSOLIDADAS:\n${JSON.stringify(observations)}`;
}

function observationOutputContract(memoryType: string, summary: string): string {
  return `{"summary":"${summary}","observations":[{"memory_type":"${memoryType}","section":"seção adequada da memória","subject":{"name":"entidade principal","memory_id":null,"memory_path":null},"target":null,"about":[{"name":"entidade sobre a qual isto informa","memory_id":null,"memory_path":null}],"claimants":[{"name":"pessoa que sustenta a afirmação","memory_id":null,"memory_path":null}],"statement":"uma única alegação atômica","basis":"explicita|sintese_interpretativa","epistemic_kind":"declaracao_propria|relato_de_terceiro|opiniao_atribuida|episodio_narrado|padrao_inferido","confidence":"alta|media|baixa","memory_signal":"alto|medio|baixo","temporal_context":null,"utterance_ids":["fala_000001"],"notes":null}],"ambiguities":[]}`;
}

function normalizeModelOutput(
  value: Record<string, unknown>,
  allowedUtterances: readonly CallUtterance[],
  expectedType?: MemoryType,
): ModelPhaseOutput {
  const allowedIds = new Set(allowedUtterances.map((utterance) => utterance.id));
  const rawObservations = Array.isArray(value.observations) ? value.observations : [];
  const observations = rawObservations.flatMap((raw) => {
    const observation = normalizeObservation(raw, allowedIds, expectedType);
    return observation ? [observation] : [];
  });
  return {
    summary: cleanText(value.summary),
    observations,
    ambiguities: stringArray(value.ambiguities),
  };
}

function normalizeContextAssessment(
  value: Record<string, unknown>,
): ConversationContextAssessment {
  const recommendationValue = value.curator_recommendation;
  const recommendation = recommendationValue
    && typeof recommendationValue === "object"
    && !Array.isArray(recommendationValue)
    ? recommendationValue as Record<string, unknown>
    : {};
  const summary = cleanText(value.summary);
  if (!summary) throw new Error("Avaliação global sem summary.");
  return {
    summary,
    primary_activity: nullableCleanText(value.primary_activity),
    tone: cleanText(value.tone) || "não determinado",
    interaction_dynamics: cleanText(value.interaction_dynamics) || "não determinada",
    dominant_topics: stringArray(value.dominant_topics),
    curator_recommendation: {
      rationale: cleanText(recommendation.rationale)
        || "Leia cada bloco de potencial separadamente e preserve os trechos importantes.",
      focus: stringArray(recommendation.focus),
      avoid_overinterpreting: stringArray(recommendation.avoid_overinterpreting),
    },
  };
}

function fallbackContextAssessment(): ConversationContextAssessment {
  return {
    summary: "A call foi processada, mas o contexto global não pôde ser determinado com segurança.",
    primary_activity: null,
    tone: "não determinado",
    interaction_dynamics: "não determinada",
    dominant_topics: [],
    curator_recommendation: {
      rationale: "Revise cada observação segundo seu potencial local e sua evidência.",
      focus: [],
      avoid_overinterpreting: ["Não inferir características permanentes a partir do tom geral da call."],
    },
  };
}

function normalizeObservation(
  raw: unknown,
  allowedIds: ReadonlySet<string>,
  expectedType?: MemoryType,
): ModelObservation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const memoryType = MEMORY_TYPES.find((type) => type === item.memory_type);
  if (!memoryType || (expectedType && memoryType !== expectedType)) return null;
  const subject = normalizeSubject(item.subject);
  const statement = cleanText(item.statement);
  const utteranceIds = stringArray(item.utterance_ids).filter((id) => allowedIds.has(id));
  if (!subject || !statement || !utteranceIds.length) return null;
  return {
    memory_type: memoryType,
    section: cleanText(item.section) || defaultSection(memoryType),
    subject,
    target: normalizeSubject(item.target),
    about: normalizeSubjectArray(item.about, memoryType === "Pessoa" ? [subject] : []),
    claimants: normalizeSubjectArray(item.claimants),
    statement,
    basis: normalizeBasis(item.basis),
    epistemic_kind: normalizeEpistemicKind(item.epistemic_kind, item.basis),
    confidence: normalizeConfidence(item.confidence),
    memory_signal: normalizeMemorySignal(item.memory_signal),
    temporal_context: nullableCleanText(item.temporal_context),
    utterance_ids: [...new Set(utteranceIds)],
    notes: nullableCleanText(item.notes),
  };
}

function normalizeSubject(value: unknown): ObservationSubject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = cleanText(item.name);
  if (!name) return null;
  const memoryId = nullableCleanText(item.memory_id);
  return {
    name,
    memory_id: memoryId && MEMORY_ID.test(memoryId) ? memoryId : null,
    memory_path: nullableCleanText(item.memory_path),
  };
}

function normalizeSubjectArray(
  value: unknown,
  fallback: readonly ObservationSubject[] = [],
): ObservationSubject[] {
  const normalized = Array.isArray(value)
    ? value.flatMap((item) => {
        const subject = normalizeSubject(item);
        return subject ? [subject] : [];
      })
    : [];
  const source = normalized.length ? normalized : fallback;
  const seen = new Set<string>();
  return source.filter((item) => {
    const key = item.memory_id ?? normalizeKey(item.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichEvidence(
  observations: readonly ModelObservation[],
  utterances: ReadonlyMap<string, CallUtterance>,
): CallObservation[] {
  return observations.flatMap((observation, index) => {
    const evidence = observation.utterance_ids.flatMap((id) => {
      const utterance = utterances.get(id);
      if (!utterance) return [];
      return [{
        utterance_id: utterance.id,
        speaker_name: utterance.speaker,
        speaker_person_id: utterance.person_id,
        start: utterance.start,
        end: utterance.end,
        absolute_start: utterance.absolute_start,
        absolute_end: utterance.absolute_end,
        text: utterance.text,
      } satisfies ObservationEvidence];
    });
    if (!evidence.length) return [];
    const { utterance_ids: _utteranceIds, ...rest } = observation;
    return [{
      ...rest,
      id: `obs_${String(index + 1).padStart(5, "0")}`,
      evidence,
      possible_memory_matches: [],
    } satisfies CallObservation];
  });
}

/** Cria os três blocos canônicos sem duplicar o conteúdo das observações no
 * JSON. A ordem Alto → Médio → Baixo é também a ordem de trabalho do curador. */
export function buildMemoryBlocks(
  observations: readonly CallObservation[],
): CallMemoryBlock[] {
  return (["alto", "medio", "baixo"] as const).map((signal) => ({
    signal,
    observation_ids: observations
      .filter((observation) => observation.memory_signal === signal)
      .map((observation) => observation.id),
  }));
}

export function knowledgeEvidenceBelongsToCreator(
  observation: ModelObservation,
  utterances: ReadonlyMap<string, CallUtterance>,
  creatorPersonId: string | null,
): boolean {
  if (observation.memory_type !== "Conhecimento") return true;
  if (!creatorPersonId) return false;
  const evidence = observation.utterance_ids.map((id) => utterances.get(id));
  return evidence.length > 0 && evidence.every(
    (utterance) => utterance?.person_id === creatorPersonId,
  );
}

/** Remove apenas clichês de vídeo que não carregam uma declaração factual.
 * A instrução do agente reforça a regra; este filtro impede que uma alucinação
 * conhecida chegue como evidência de Pessoa, Grupo, Evento ou Conhecimento. */
export function isVideoPlatformBoilerplate(text: string): boolean {
  const normalized = normalizeKey(text);
  if (!normalized) return false;
  const hasFactualContext = /\b(?:eu|ele|ela|nos|a gente)\s+(?:tenho|tem|criei|criou|mantenho|mantem|posto|publico|administro|administra)\b/.test(normalized);
  if (hasFactualContext) return false;
  return [
    /\b(?:se )?inscrev\w* (?:no|em) (?:meu )?canal\b/,
    /\bative (?:o )?sininho\b/,
    /\bative (?:as )?notificacoes\b/,
    /\b(?:deixe|deixem) (?:o )?like\b/,
    /\bacompanhe (?:o )?video\b/,
    /\bcompartilhe com (?:os )?(?:seus |seus )?amigos\b/,
    /\bobrigad[oa] por assistir\b/,
    /\blegendas pela comunidade\b/,
    /\blink na descricao\b/,
  ].some((pattern) => pattern.test(normalized));
}

function deduplicateModelObservations(
  observations: readonly ModelObservation[],
): ModelObservation[] {
  const result: ModelObservation[] = [];
  const byKey = new Map<string, number>();
  for (const observation of observations) {
    const key = [
      observation.memory_type,
      normalizeKey(observation.subject.name),
      normalizeKey(observation.target?.name ?? ""),
      observation.epistemic_kind,
      normalizeKey(observation.statement),
    ].join("|");
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, result.length);
      result.push(observation);
      continue;
    }
    const existing = result[existingIndex];
    if (!existing) continue;
    result[existingIndex] = {
      ...existing,
      utterance_ids: [...new Set([...existing.utterance_ids, ...observation.utterance_ids])],
      about: mergeSubjects(existing.about, observation.about),
      claimants: mergeSubjects(existing.claimants, observation.claimants),
      confidence: strongerConfidence(existing.confidence, observation.confidence),
      memory_signal: strongerMemorySignal(existing.memory_signal, observation.memory_signal),
      memory_type: existing.memory_type,
    };
  }
  return result;
}

function mergeSubjects(
  left: readonly ObservationSubject[],
  right: readonly ObservationSubject[],
): ObservationSubject[] {
  return normalizeSubjectArray([...left, ...right]);
}

export function splitObservationBatches(
  observations: readonly ModelObservation[],
): ModelObservation[][] {
  const batches: ModelObservation[][] = [];
  let current: ModelObservation[] = [];
  let length = 2;
  for (const observation of observations) {
    const itemLength = JSON.stringify(observation).length + 1;
    if (
      current.length
      && length + itemLength > ANALYSIS_REDUCTION_BATCH_CHARACTERS
    ) {
      batches.push(current);
      current = [];
      length = 2;
    }
    current.push(observation);
    length += itemLength;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Mantém, sempre que possível, todas as evidências sobre a mesma pessoa no
 * mesmo lote para que padrões recorrentes não sejam invisíveis ao modelo. */
function splitPersonEvidenceBatches(
  observations: readonly ModelObservation[],
): ModelObservation[][] {
  const groups = new Map<string, ModelObservation[]>();
  for (const observation of observations) {
    const people = observation.about.length
      ? observation.about
      : observation.memory_type === "Pessoa"
        ? [observation.subject]
        : [];
    for (const person of people) {
      const key = person.memory_id ?? normalizeKey(person.name);
      const group = groups.get(key) ?? [];
      if (!group.includes(observation)) group.push(observation);
      groups.set(key, group);
    }
  }

  const batches: ModelObservation[][] = [];
  let current: ModelObservation[] = [];
  let currentKeys = new Set<string>();
  let length = 2;
  for (const group of groups.values()) {
    const additions = group.filter((item) => !currentKeys.has(observationIdentity(item)));
    const itemLength = JSON.stringify(additions).length;
    if (
      current.length
      && length + itemLength > ANALYSIS_REDUCTION_BATCH_CHARACTERS
    ) {
      batches.push(current);
      current = [];
      currentKeys = new Set<string>();
      length = 2;
    }
    for (const observation of group) {
      const key = observationIdentity(observation);
      if (currentKeys.has(key)) continue;
      current.push(observation);
      currentKeys.add(key);
    }
    length += itemLength;
  }
  if (current.length) batches.push(current);
  return batches.length ? batches : [observations.slice()];
}

function observationIdentity(observation: ModelObservation): string {
  return [
    observation.memory_type,
    normalizeKey(observation.subject.name),
    normalizeKey(observation.statement),
    observation.utterance_ids.join(","),
  ].join("|");
}

function splitStringBatches(values: readonly string[], maximumCharacters: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 2;
  for (const value of values) {
    const itemLength = JSON.stringify(value).length + 1;
    if (current.length && length + itemLength > maximumCharacters) {
      batches.push(current);
      current = [];
      length = 2;
    }
    current.push(value);
    length += itemLength;
  }
  if (current.length) batches.push(current);
  return batches;
}

function sampleEvenly<T>(values: readonly T[], maximumItems: number): T[] {
  if (values.length <= maximumItems) return [...values];
  if (maximumItems <= 0) return [];
  if (maximumItems === 1) return values[0] === undefined ? [] : [values[0]];
  const sampled: T[] = [];
  for (let index = 0; index < maximumItems; index++) {
    const sourceIndex = Math.round(index * (values.length - 1) / (maximumItems - 1));
    const value = values[sourceIndex];
    if (value !== undefined) sampled.push(value);
  }
  return sampled;
}

function summarizeObservationStats(
  observations: readonly ModelObservation[],
): Readonly<Record<string, unknown>> {
  const byMemoryType: Record<MemoryType, number> = {
    Pessoa: 0,
    Grupo: 0,
    Lugar: 0,
    Evento: 0,
    Projeto: 0,
    Conhecimento: 0,
  };
  const byConfidence: Record<ObservationConfidence, number> = {
    alta: 0,
    media: 0,
    baixa: 0,
  };
  const byEpistemicKind: Record<ObservationEpistemicKind, number> = {
    declaracao_propria: 0,
    relato_de_terceiro: 0,
    opiniao_atribuida: 0,
    episodio_narrado: 0,
    padrao_inferido: 0,
  };
  const byMemorySignal: Record<CallMemorySignal, number> = {
    alto: 0,
    medio: 0,
    baixo: 0,
  };
  for (const observation of observations) {
    byMemoryType[observation.memory_type] += 1;
    byConfidence[observation.confidence] += 1;
    byEpistemicKind[observation.epistemic_kind] += 1;
    byMemorySignal[observation.memory_signal] += 1;
  }
  return {
    total: observations.length,
    by_memory_type: byMemoryType,
    by_confidence: byConfidence,
    by_epistemic_kind: byEpistemicKind,
    by_memory_signal: byMemorySignal,
  };
}

function loadCreatorPersonId(): string | null {
  const path = resolve(PROJECT_ROOT, "discordbot", "config", "identidades_discord.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const id = nullableCleanText(data.creator_person_id);
    return id && MEMORY_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

function loadReusableAnalysis(
  sessionDir: string,
  transcriptHash: string,
  model: string,
  memoryContextHash: string,
): CallAnalysis | null {
  const path = join(sessionDir, "analise-call.json");
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as CallAnalysis;
    if (
      value.schema_version === CALL_ANALYSIS_SCHEMA_VERSION
      && value.analyzer?.prompt_version === CALL_ANALYSIS_PROMPT_VERSION
      && value.analyzer?.model === model
      && value.source?.transcript_sha256 === transcriptHash
      && value.source?.memory_context_sha256 === memoryContextHash
      && Array.isArray(value.observations)
    ) return value;
  } catch {
    // Resultado incompleto ou antigo será refeito.
  }
  return null;
}

function memoryContextFingerprint(): string {
  const root = resolve(PROJECT_ROOT, "memory");
  const files: string[] = [];
  collectMarkdownFiles(root, files);
  const identityPath = resolve(
    PROJECT_ROOT,
    "discordbot",
    "config",
    "identidades_discord.json",
  );
  if (existsSync(identityPath)) files.push(identityPath);
  const metadata = files.sort().map((path) => {
    const stat = statSync(path);
    return `${relative(PROJECT_ROOT, path).replace(/\\/g, "/")}|${stat.size}|${stat.mtimeMs}`;
  });
  return createHash("sha256").update(metadata.join("\n"), "utf8").digest("hex");
}

function collectMarkdownFiles(directory: string, output: string[]): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(path, output);
    else if (entry.isFile() && entry.name.endsWith(".md")) output.push(path);
  }
}

function loadChunkCache(
  directory: string,
  chunk: CallChunk,
  model: string,
): ChunkCache | null {
  const path = chunkCachePath(directory, chunk.index);
  if (!existsSync(path)) return null;
  try {
    const cache = JSON.parse(readFileSync(path, "utf8")) as ChunkCache;
    if (
      cache.cache.prompt_version === CALL_ANALYSIS_PROMPT_VERSION
      && cache.cache.model === model
      && cache.cache.chunk_sha256 === chunk.sha256
      && cache.output
      && Array.isArray(cache.output.observations)
      && Array.isArray(cache.output.ambiguities)
    ) return cache;
  } catch {
    // Cache inválido é ignorado.
  }
  return null;
}

function writeChunkCache(
  directory: string,
  chunk: CallChunk,
  model: string,
  output: ModelPhaseOutput,
): void {
  const value: ChunkCache = {
    cache: {
      prompt_version: CALL_ANALYSIS_PROMPT_VERSION,
      model,
      chunk_sha256: chunk.sha256,
    },
    output,
  };
  writeAtomic(chunkCachePath(directory, chunk.index), `${JSON.stringify(value, null, 2)}\n`);
}

function chunkCachePath(directory: string, index: number): string {
  return join(directory, `parte-${String(index).padStart(3, "0")}.json`);
}

function writeAtomic(path: string, value: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(temporary, value, "utf8");
  renameSync(temporary, path);
}

function parseJsonObject(response: string): Record<string, unknown> {
  const first = response.indexOf("{");
  const last = response.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Resposta do analista não contém JSON.");
  const parsed = JSON.parse(response.slice(first, last + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Resposta JSON do analista precisa ser um objeto.");
  }
  return parsed as Record<string, unknown>;
}

function normalizeBasis(value: unknown): ObservationBasis {
  return value === "sintese_interpretativa" ? value : "explicita";
}

function normalizeEpistemicKind(
  value: unknown,
  basis: unknown,
): ObservationEpistemicKind {
  const allowed: readonly ObservationEpistemicKind[] = [
    "declaracao_propria",
    "relato_de_terceiro",
    "opiniao_atribuida",
    "episodio_narrado",
    "padrao_inferido",
  ];
  return allowed.find((item) => item === value)
    ?? (basis === "sintese_interpretativa" ? "padrao_inferido" : "relato_de_terceiro");
}

function normalizeConfidence(value: unknown): ObservationConfidence {
  return value === "alta" || value === "media" || value === "baixa" ? value : "baixa";
}

function normalizeMemorySignal(value: unknown): CallMemorySignal {
  return value === "alto" || value === "medio" || value === "baixo"
    ? value
    : "medio";
}

function strongerConfidence(
  left: ObservationConfidence,
  right: ObservationConfidence,
): ObservationConfidence {
  const order: ObservationConfidence[] = ["baixa", "media", "alta"];
  return (order.indexOf(left) >= order.indexOf(right) ? left : right);
}

function strongerMemorySignal(
  left: CallMemorySignal,
  right: CallMemorySignal,
): CallMemorySignal {
  const order: CallMemorySignal[] = ["baixo", "medio", "alto"];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

function defaultSection(type: MemoryType): string {
  return {
    Pessoa: "Informações Gerais",
    Grupo: "Sobre",
    Lugar: "Notas",
    Evento: "Detalhes",
    Projeto: "Visão Geral",
    Conhecimento: "Detalhes",
  }[type];
}

function labelForType(type: MemoryType): string {
  return {
    Pessoa: "Pessoas",
    Grupo: "Grupos",
    Lugar: "Lugares",
    Evento: "Eventos",
    Projeto: "Projetos",
    Conhecimento: "Conhecimentos",
  }[type];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function nullableCleanText(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = cleanText(item);
    return text ? [text] : [];
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = cleanText(value);
    const key = normalizeKey(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function normalizeKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
