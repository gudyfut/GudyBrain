import { loadInstructions, type AgentEvent, type AgentRunOptions } from "../../core/agent";
import { answerWithResponses } from "../../core/responses";
import { configuredOpenAIModel, type AnswerProvider } from "../../core/llm";
import { createJevClient, type EvaluateJev } from "../../core/jev";
import type { Message } from "../../core/glm";
import { resolveProjectPath } from "../../core/project-root";
import { MemoryBrowser } from "../../tools/memoria/navegador";
import { retrieveMemory, type RetrievalResult } from "../recuperador-jev";
import { MEMORY_CHAT_PROFILES } from "../registry";
import { buildMemoryIndex, locateMemory, mentionedMemories } from "../../tools/memoria/indice-contexto";

export const MEMORY_INSPECTION_SCHEMA = {
  type: "object", properties: {
    paths: { type: "array", items: { type: "string" }, maxItems: 8 },
    folders: { type: "array", items: { type: "string" }, maxItems: 4 },
    query: { type: "string", maxLength: 160 },
  },
  required: ["paths", "folders", "query"], additionalProperties: false,
};

export class JevConversation {
  readonly history: Message[] = [];
  readonly model: string;
  lastRetrieval?: RetrievalResult;
  private busy = false;
  private readonly evaluate: EvaluateJev;
  private readonly answer: AnswerProvider;
  private readonly inspect: AnswerProvider;
  private readonly browser: Pick<MemoryBrowser, "list" | "read">;
  private readonly retrievalInstructions = loadInstructions(MEMORY_CHAT_PROFILES.retrieval.instructionsFile);
  private readonly answerInstructions = loadInstructions(MEMORY_CHAT_PROFILES.answer.instructionsFile);
  private readonly inspectionInstructions = loadInstructions(MEMORY_CHAT_PROFILES.answer.inspectionInstructionsFile);

  constructor(private readonly options: {
    onStep?: (event: AgentEvent) => void;
    evaluate?: EvaluateJev;
    answer?: AnswerProvider;
    inspect?: AnswerProvider;
    browser?: Pick<MemoryBrowser, "list" | "read">;
  } = {}) {
    this.model = configuredOpenAIModel(MEMORY_CHAT_PROFILES.answer.model);
    this.evaluate = options.evaluate ?? createJevClient({
      apiKey: process.env.TYPESAFE_API_KEY ?? "",
      model: process.env.JEV_MODEL?.trim() || MEMORY_CHAT_PROFILES.retrieval.model,
    });
    this.answer = options.answer ?? answerWithResponses;
    this.inspect = options.inspect ?? answerWithResponses;
    this.browser = options.browser ?? new MemoryBrowser(resolveProjectPath("memory"));
  }

  toolNames(): string[] { return []; }

  async run(input: string, runOptions: AgentRunOptions = {}): Promise<string> {
    if (this.busy) throw new Error("Aguarde o fim da resposta atual.");
    if (!input.trim()) throw new Error("A mensagem não pode ser vazia.");
    // Nunca corta silenciosamente a mensagem nem o histórico usado para decisões.
    if (input.length > 20_000 || JSON.stringify(this.history).length + input.length > 160_000) {
      throw new Error("Conversa excede o limite de contexto. Inicie uma nova conversa com /limpar.");
    }
    this.busy = true;
    this.lastRetrieval = undefined;
    const emit = (event: AgentEvent) => { this.options.onStep?.(event); runOptions.onStep?.(event); };
    try {
      runOptions.signal?.throwIfAborted();
      const index = buildMemoryIndex(this.browser);
      const retrieval = await retrieveMemory({
        input, history: this.history, instructions: this.retrievalInstructions,
        evaluate: this.evaluate, browser: this.browser, signal: runOptions.signal,
        index,
        onProgress: (message) => emit({ type: "retrieval", message }),
        onTrace: (event) => emit({ type: "retrieval_trace", event }),
      });
      this.lastRetrieval = retrieval;
      const recentUser = this.history.filter((item) => item.role === "user").slice(-2).map((item) => item.content).join(" ");
      const preferred = mentionedMemories(`${recentUser} ${input}`, index);
      const requested = new Set<string>();
      let scopes: string[] = [];
      let lookupQuery = `${input} ${recentUser}`.trim();
      const expanded = new Set<string>();
      for (let round = 1; round <= 4; round++) {
        emit({ type: "retrieval", message: "Conferindo se faltam documentos integrais para responder" });
        const found = locateMemory(index, lookupQuery, {
          scopes, preferred: [...preferred, ...(retrieval.omitted ?? []).map((item) => item.path)],
          exclude: new Set([...requested, ...retrieval.files.map((file) => file.path)]),
        });
        const allowedFiles = new Set(found.files.map((node) => node.path));
        const allowedFolders = new Set(found.folders.map((node) => node.path));
        if (!found.files.length && !found.folders.length) break;
        const raw = await this.inspect({ model: this.model, instructions: this.inspectionInstructions,
          outputSchema: MEMORY_INSPECTION_SCHEMA,
          input: JSON.stringify({ stage: "inspect", task: "Escolha documentos candidatos ou peça outra pasta/consulta local. Não responda à pergunta nesta etapa.",
            candidateFiles: found.files, candidateFolders: found.folders, message: input, history: this.history, memory: retrieval, round }), signal: runOptions.signal });
        runOptions.signal?.throwIfAborted();
        let plan: unknown;
        try { plan = JSON.parse(raw); }
        catch { throw new Error("A conferência de memória recebeu um formato inválido. Tente enviar a mensagem novamente."); }
        if (!plan || typeof plan !== "object" || !("paths" in plan) || !Array.isArray(plan.paths) || plan.paths.length > 8
          || Object.keys(plan).some((key) => !["paths", "folders", "query"].includes(key))
          || plan.paths.some((path: unknown) => typeof path !== "string" || !allowedFiles.has(path))
          || ("folders" in plan && (!Array.isArray(plan.folders) || plan.folders.length > 4
            || plan.folders.some((path: unknown) => typeof path !== "string" || !allowedFolders.has(path))))
          || ("query" in plan && (typeof plan.query !== "string" || plan.query.length > 160))) {
          throw new Error("Solicitação de memória inválida: escolha apenas candidatos ou pastas oferecidos pelo localizador.");
        }
        const paths = [...new Set(plan.paths as string[])];
        const folders = [...new Set(("folders" in plan ? plan.folders : []) as string[])].filter((path) => !expanded.has(path));
        const nextQuery = "query" in plan ? (plan.query as string).trim() : "";
        if (!paths.length && !folders.length && (!nextQuery || nextQuery === lookupQuery)) break;
        retrieval.searched = true;
        if (paths.length) emit({ type: "retrieval_trace", event: { phase: "request", paths, round } });
        for (const path of paths) {
          runOptions.signal?.throwIfAborted();
          requested.add(path);
          const content = this.browser.read(path);
          // A segunda consulta tem orçamento próprio maior; nunca recorta documentos.
          if (retrieval.files.reduce((sum, file) => sum + file.content.length, 0) + content.length > 240_000) {
            retrieval.limited = true;
            const reason = "Arquivo integral excede o orçamento total de 240 mil caracteres.";
            retrieval.omitted = [...(retrieval.omitted ?? []).filter((file) => file.path !== path), { path, reason }];
            emit({ type: "retrieval_trace", event: { phase: "omitted", path, reason } });
            continue;
          }
          retrieval.files.push({ path, content, complete: true, source: "conversador" });
          retrieval.omitted = retrieval.omitted?.filter((file) => file.path !== path);
          emit({ type: "retrieval_trace", event: { phase: "selected", path, source: "conversador", chars: content.length } });
        }
        if (folders.length) {
          scopes = folders;
          for (const path of folders) {
            expanded.add(path);
            emit({ type: "retrieval_trace", event: { phase: "folder", path } });
          }
        } else if (nextQuery && nextQuery !== lookupQuery) scopes = [];
        if (nextQuery) lookupQuery = nextQuery;
        emit({ type: "retrieval_trace", event: { phase: "complete", files: retrieval.files.length, limited: retrieval.limited } });
      }
      runOptions.signal?.throwIfAborted();
      emit({ type: "retrieval", message: "Gudman está preparando a resposta" });
      emit({ type: "retrieval_trace", event: { phase: "answer" } });
      const content = await this.answer({
        model: this.model, instructions: this.answerInstructions,
        input: JSON.stringify({ stage: "answer", now: new Date().toISOString(), history: this.history, message: input, memory: retrieval }),
        signal: runOptions.signal, onContent: runOptions.onContent,
      });
      runOptions.signal?.throwIfAborted();
      if (!content.trim()) throw new Error("O modelo retornou uma resposta vazia.");
      // Transação de turno: falhas/cancelamentos não deixam mensagens órfãs.
      this.history.push({ role: "user", content: input }, { role: "assistant", content });
      emit({ type: "answer", content });
      return content;
    } finally {
      this.busy = false;
    }
  }
}
