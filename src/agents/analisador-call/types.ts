export const CALL_ANALYSIS_SCHEMA_VERSION = 5;
export const CALL_ANALYSIS_PROMPT_VERSION = "7";

export const MEMORY_TYPES = [
  "Pessoa",
  "Grupo",
  "Lugar",
  "Evento",
  "Projeto",
  "Conhecimento",
] as const;

export type MemoryType = typeof MEMORY_TYPES[number];
export type ObservationBasis = "explicita" | "sintese_interpretativa";
export type ObservationConfidence = "alta" | "media" | "baixa";
export type ObservationEpistemicKind =
  | "declaracao_propria"
  | "relato_de_terceiro"
  | "opiniao_atribuida"
  | "episodio_narrado"
  | "padrao_inferido";
export type CallMemorySignal = "alto" | "medio" | "baixo";
export interface ConversationContextAssessment {
  readonly summary: string;
  readonly primary_activity: string | null;
  readonly tone: string;
  readonly interaction_dynamics: string;
  readonly dominant_topics: readonly string[];
  readonly curator_recommendation: {
    readonly rationale: string;
    readonly focus: readonly string[];
    readonly avoid_overinterpreting: readonly string[];
  };
}

export interface CallParticipant {
  readonly user_id: string | null;
  readonly person_id: string | null;
  readonly display_name: string;
}

export interface CallUtterance {
  readonly id: string;
  readonly user_id: string | null;
  readonly person_id: string | null;
  readonly speaker: string;
  readonly start: number;
  readonly end: number;
  readonly absolute_start: string | null;
  readonly absolute_end: string | null;
  readonly text: string;
}

export interface LoadedCallTranscript {
  readonly session_dir: string;
  readonly session_id: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly participants: readonly CallParticipant[];
  readonly utterances: readonly CallUtterance[];
  readonly transcript_sha256: string;
  readonly conversation_txt: string;
  readonly conversation_json: string | null;
}

export interface CallChunk {
  readonly index: number;
  readonly utterances: readonly CallUtterance[];
  readonly text: string;
  readonly sha256: string;
}

export interface ObservationSubject {
  readonly name: string;
  readonly memory_id: string | null;
  readonly memory_path: string | null;
}

export interface ModelObservation {
  readonly memory_type: MemoryType;
  readonly section: string;
  readonly subject: ObservationSubject;
  readonly target: ObservationSubject | null;
  /** Pessoas ou entidades sobre as quais o conteúdo efetivamente informa. */
  readonly about: readonly ObservationSubject[];
  /** Pessoas às quais o relato, opinião ou interpretação deve ser atribuído. */
  readonly claimants: readonly ObservationSubject[];
  readonly statement: string;
  readonly basis: ObservationBasis;
  readonly epistemic_kind: ObservationEpistemicKind;
  readonly confidence: ObservationConfidence;
  /** Importância/durabilidade potencial, independente da confiança factual. */
  readonly memory_signal: CallMemorySignal;
  readonly temporal_context: string | null;
  readonly utterance_ids: readonly string[];
  readonly notes: string | null;
}

export interface ObservationEvidence {
  readonly utterance_id: string;
  readonly speaker_name: string;
  readonly speaker_person_id: string | null;
  readonly start: number;
  readonly end: number;
  readonly absolute_start: string | null;
  readonly absolute_end: string | null;
  readonly text: string;
}

export interface PossibleMemoryMatch {
  readonly path: string;
  readonly memory_id: string | null;
  readonly title: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface CallObservation extends Omit<ModelObservation, "utterance_ids"> {
  readonly id: string;
  readonly evidence: readonly ObservationEvidence[];
  /** Pistas determinísticas obtidas após a extração. O curador deve verificar
   * a memória vigente; isto não é uma decisão de destino. */
  readonly possible_memory_matches: readonly PossibleMemoryMatch[];
}

/** Os blocos são índices explícitos para que um trecho importante não seja
 * diluído pelo tom predominante da call. A informação completa permanece nas
 * observações referenciadas. */
export interface CallMemoryBlock {
  readonly signal: CallMemorySignal;
  readonly observation_ids: readonly string[];
}

export interface CallAnalysis {
  readonly schema_version: number;
  readonly session_id: string;
  readonly generated_at: string;
  readonly analyzer: {
    readonly id: "analisador-call";
    readonly model: string;
    readonly prompt_version: string;
  };
  readonly source: {
    readonly conversation_txt: string;
    readonly conversation_json: string | null;
    readonly transcript_sha256: string;
    readonly memory_context_sha256: string;
  };
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly participants: readonly CallParticipant[];
  readonly summary: string;
  readonly conversation_context: ConversationContextAssessment;
  readonly memory_blocks: readonly CallMemoryBlock[];
  readonly observations: readonly CallObservation[];
  readonly ambiguities: readonly string[];
}

export interface AnalyzeCallResult {
  readonly analysis: CallAnalysis;
  readonly json_path: string;
  readonly markdown_path: string;
  readonly reused: boolean;
}
