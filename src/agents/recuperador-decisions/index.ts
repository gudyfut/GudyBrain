import type { Message } from "../../core/glm";
import type { EvaluateDecisions, DecisionPredicate } from "../../core/decisions";
import type { MemoryBrowser, MemoryNode } from "../../tools/memoria/navegador";
import type { RetrievalEvent } from "../../core/retrieval-events";
import { mentionedMemories, type MemoryIndex } from "../../tools/memoria/indice-contexto";

export interface RetrievalResult {
  searched: boolean;
  probability: number;
  files: Array<{ path: string; content: string; probability?: number; complete: true; source: "decisions" | "identity" | "conversador" }>;
  omitted?: Array<{ path: string; reason: string }>;
  limited: boolean;
}

export interface RetrievalLimits {
  gate: number;
  folder: number;
  file: number;
  maxFolders: number;
  maxNodes: number;
  maxFiles: number;
  maxChars: number;
}

export const DEFAULT_RETRIEVAL_LIMITS: RetrievalLimits = {
  gate: 0.5, folder: 0.35, file: 0.55,
  maxFolders: 40, maxNodes: 1000, maxFiles: 16, maxChars: 60_000,
};

export async function retrieveMemory(options: {
  input: string;
  history: readonly Message[];
  instructions: string;
  evaluate: EvaluateDecisions;
  browser: Pick<MemoryBrowser, "list" | "read">;
  index?: MemoryIndex;
  limits?: Partial<RetrievalLimits>;
  /** Bounded look-ahead and concurrent requests; 1 keeps serial traversal. */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onTrace?: (event: RetrievalEvent) => void;
}): Promise<RetrievalResult> {
  const limits = { ...DEFAULT_RETRIEVAL_LIMITS, ...options.limits };
  const concurrency = options.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("Concorrência de recuperação inválida.");
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0 || (["gate", "folder", "file"].includes(key) ? value > 1 : !Number.isInteger(value) || value < 1)) {
      throw new Error(`Limite de recuperação inválido: ${key}.`);
    }
  }
  options.signal?.throwIfAborted();
  const mentions = options.index ? mentionedMemories(options.input, options.index) : [];
  // Reuse this turn's validated index. Documents still go through browser.read;
  // nothing is cached across turns or sent to the provider as a global catalog.
  const children = new Map<string, MemoryNode[]>();
  for (const node of options.index?.nodes ?? []) {
    const parent = node.path.split("/").slice(0, -1).join("/");
    const siblings = children.get(parent) ?? [];
    siblings.push(node);
    children.set(parent, siblings);
  }
  const forced = (path: string) => mentions.some((file) => file === path || file.startsWith(`${path}/`));
  const state = { history: options.history, message: options.input,
    // Only direct local identity hits cross the model boundary at the gate.
    identityMatches: mentions.map((path) => {
      const node = options.index?.nodes.find((item) => item.path === path);
      return { path, title: node?.title, aliases: node?.aliases };
    }) };
  const question = (text: string, node?: MemoryNode): DecisionPredicate => ({
    type: "predicate",
    instructions: { rules: options.instructions, question: text, ...(node ? { node } : {}) },
  });
  options.onProgress?.("Decisions está avaliando se precisa consultar a memória");
  options.onTrace?.({ phase: "gate" });
  if (options.index) options.onTrace?.({ phase: "index", chars: options.index.chars, nodes: options.index.nodes.map(({ path, kind, title, aliases, description }) => ({ path, kind, title, aliases, description })) });
  const gate = await options.evaluate(state, {
    search: question("Devo buscar na memória profunda para responder o usuário?"),
  }, options.signal);
  options.signal?.throwIfAborted();
  const probability = requiredProbability(gate, "search");
  const result: RetrievalResult = { searched: probability >= limits.gate || mentions.length > 0, probability, files: [], limited: false };
  options.onTrace?.({ phase: "decision", searched: result.searched, probability, threshold: limits.gate,
    reason: mentions.length ? "Nome ou apelido cadastrado identificado: consulta obrigatória aos registros correspondentes." : probability >= limits.gate ? "Probabilidade de utilidade acima do limiar: explorar memória." : "Probabilidade abaixo do limiar; o conversador ainda pode solicitar documentos pelo índice." });
  if (!result.searched) return result;

  let frontier = [{ path: "", probability: 1 }];
  let folders = 0;
  let evaluated = 0;
  const candidates: Array<{ path: string; probability?: number }> = [];
  const visited = new Set<string>();
  while (frontier.length) {
    options.signal?.throwIfAborted();
    const work: Array<{ parent: string; node: MemoryNode }> = [];
    // Reserve budgets in priority order before starting requests. A small
    // look-ahead joins sparse folders without exploring the entire frontier.
    let reservedFolders = 0;
    while (frontier.length && reservedFolders < concurrency) {
      const next = frontier.shift()!;
      if (visited.has(next.path)) continue;
      if (folders >= limits.maxFolders || evaluated >= limits.maxNodes) { result.limited = true; frontier = []; break; }
      visited.add(next.path);
      folders++;
      reservedFolders++;
      options.onTrace?.({ phase: "folder", path: next.path });
      options.onProgress?.(`Decisions está explorando a memória (${folders} pastas)`);
      const all = options.index ? children.get(next.path) ?? [] : options.browser.list(next.path);
      const nodes = all.slice(0, limits.maxNodes - evaluated);
      evaluated += nodes.length;
      if (nodes.length < all.length) result.limited = true;
      work.push(...nodes.map((node) => ({ parent: next.path, node })));
    }
    const abort = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    try {
      // At most three in-flight requests, with at most 40 predicates each.
      // Apply results in reserved order, independent of network completion order.
      for (let start = 0; start < work.length; start += 40 * concurrency) {
        const batches = Array.from({ length: Math.min(concurrency, Math.ceil((work.length - start) / 40)) },
          (_, i) => work.slice(start + i * 40, start + (i + 1) * 40));
        const responses = await Promise.all(batches.map(async (batch) => {
          signal.throwIfAborted();
          for (const parent of new Set(batch.map((item) => item.parent))) {
            options.onTrace?.({ phase: "discovered", parent, nodes: batch.filter((item) => item.parent === parent).map(({ node: { path, kind, title } }) => ({ path, kind, title })) });
          }
          const questions = Object.fromEntries(batch.map(({ node }, i) => [
            `node_${i}`, question(node.kind === "folder"
              ? "Esta pasta pode conter registros úteis para responder à mensagem atual?"
              : "Este arquivo é útil como contexto para responder à mensagem atual?", node),
          ]));
          const answers = await options.evaluate(state, questions, signal);
          signal.throwIfAborted();
          return batch.map(({ node, parent }, i) => ({ node, parent, probability: requiredProbability(answers, `node_${i}`) }));
        }));
        signal.throwIfAborted();
        for (const response of responses) {
          for (const parent of new Set(response.map((item) => item.parent))) {
            options.onTrace?.({ phase: "evaluated", parent, nodes: response.filter((item) => item.parent === parent).map(({ node: { path, kind, title }, probability }) => ({ path, kind, title,
              probability, accepted: forced(path) || probability >= (kind === "folder" ? limits.folder : limits.file),
              reason: forced(path) ? "Nome/apelido mencionado: explorar mesmo se abaixo do limiar." : `Limiar de ${kind === "folder" ? "pasta" : "arquivo"}: ${Math.round((kind === "folder" ? limits.folder : limits.file) * 100)}%.` })) });
          }
          for (const { node, probability } of response) {
            if (node.kind === "folder" && (forced(node.path) || probability >= limits.folder)) frontier.push({ path: node.path, probability });
            if (node.kind === "file" && (forced(node.path) || probability >= limits.file)) candidates.push({ path: node.path, probability });
          }
        }
      }
    } catch (error) {
      // A failed/refused batch invalidates the turn and cancels its siblings.
      abort.abort();
      throw error;
    }
    frontier = frontier.sort((a, b) => Number(forced(b.path)) - Number(forced(a.path)) || b.probability - a.probability || a.path.localeCompare(b.path));
  }

  let chars = 0;
  for (const path of mentions) if (!candidates.some((item) => item.path === path)) candidates.push({ path });
  for (const candidate of candidates.sort((a, b) => Number(forced(b.path)) - Number(forced(a.path)) || (b.probability ?? 0) - (a.probability ?? 0) || a.path.localeCompare(b.path))) {
    options.signal?.throwIfAborted();
    const omit = (reason: string) => { result.limited = true; (result.omitted ??= []).push({ path: candidate.path, reason }); options.onTrace?.({ phase: "omitted", path: candidate.path, reason }); };
    if (result.files.length >= limits.maxFiles) { omit("Limite de arquivos no contexto inicial."); continue; }
    const content = options.browser.read(candidate.path);
    if (chars + content.length > limits.maxChars) { omit("Documento inteiro não cabe no orçamento inicial; pode ser solicitado na segunda consulta."); continue; }
    chars += content.length;
    const source = forced(candidate.path) ? "identity" : "decisions";
    result.files.push({ ...candidate, content, complete: true, source });
    options.onTrace?.({ phase: "selected", path: candidate.path, chars: content.length, source });
  }
  options.onProgress?.(`Memória consultada: ${result.files.length} arquivos selecionados${result.limited ? " (busca limitada)" : ""}`);
  options.onTrace?.({ phase: "complete", files: result.files.length, limited: result.limited });
  return result;
}

function requiredProbability(values: Record<string, number>, key: string): number {
  const value = values[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Avaliação da Decisions API inválida ou ausente.");
  return value;
}
