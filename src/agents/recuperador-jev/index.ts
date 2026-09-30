import type { Message } from "../../core/glm";
import type { EvaluateJev, JevQuestion } from "../../core/jev";
import type { MemoryBrowser, MemoryNode } from "../../tools/memoria/navegador";
import type { RetrievalEvent } from "../../core/retrieval-events";
import { mentionedMemories, type MemoryIndex } from "../../tools/memoria/indice-contexto";

export interface RetrievalResult {
  searched: boolean;
  probability: number;
  files: Array<{ path: string; content: string; probability?: number; complete: true; source: "jev" | "identity" | "conversador" }>;
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
  evaluate: EvaluateJev;
  browser: Pick<MemoryBrowser, "list" | "read">;
  index?: MemoryIndex;
  limits?: Partial<RetrievalLimits>;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onTrace?: (event: RetrievalEvent) => void;
}): Promise<RetrievalResult> {
  const limits = { ...DEFAULT_RETRIEVAL_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0 || (["gate", "folder", "file"].includes(key) ? value > 1 : !Number.isInteger(value) || value < 1)) {
      throw new Error(`Limite de recuperação inválido: ${key}.`);
    }
  }
  const mentions = options.index ? mentionedMemories(options.input, options.index) : [];
  const forced = (path: string) => mentions.some((file) => file === path || file.startsWith(`${path}/`));
  const state = { history: options.history, message: options.input,
    // Only direct local identity hits cross the model boundary at the gate.
    identityMatches: mentions.map((path) => {
      const node = options.index?.nodes.find((item) => item.path === path);
      return { path, title: node?.title, aliases: node?.aliases };
    }) };
  const question = (text: string, node?: MemoryNode): JevQuestion => ({
    type: "noul",
    instructions: { rules: options.instructions, question: text, ...(node ? { node } : {}) },
  });
  options.onProgress?.("Jev está avaliando se precisa consultar a memória");
  options.onTrace?.({ phase: "gate" });
  if (options.index) options.onTrace?.({ phase: "index", chars: options.index.chars, nodes: options.index.nodes.map(({ path, kind, title, aliases, description }) => ({ path, kind, title, aliases, description })) });
  const gate = await options.evaluate(state, {
    search: question("Devo buscar na memória profunda para responder o usuário?"),
  }, options.signal);
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
    const next = frontier.shift()!;
    if (visited.has(next.path)) continue;
    visited.add(next.path);
    if (folders >= limits.maxFolders || evaluated >= limits.maxNodes) { result.limited = true; break; }
    folders++;
    options.onTrace?.({ phase: "folder", path: next.path });
    options.onProgress?.(`Jev está explorando a memória (${folders} pastas)`);
    const all = options.browser.list(next.path);
    const nodes = all.slice(0, limits.maxNodes - evaluated);
    if (nodes.length < all.length) result.limited = true;
    // Várias perguntas independentes por chamada, sem uma requisição por arquivo.
    for (let start = 0; start < nodes.length; start += 40) {
      const batch = nodes.slice(start, start + 40);
      options.onTrace?.({ phase: "discovered", parent: next.path, nodes: batch.map(({ path, kind, title }) => ({ path, kind, title })) });
      const questions = Object.fromEntries(batch.map((node, i) => [
        `node_${i}`, question(node.kind === "folder"
          ? "Esta pasta pode conter registros úteis para responder à mensagem atual?"
          : "Este arquivo é útil como contexto para responder à mensagem atual?", node),
      ]));
      const answers = await options.evaluate(state, questions, options.signal);
      evaluated += batch.length;
      options.onTrace?.({ phase: "evaluated", parent: next.path, nodes: batch.map(({ path, kind, title }, i) => ({ path, kind, title,
        probability: requiredProbability(answers, `node_${i}`), accepted: forced(path) || requiredProbability(answers, `node_${i}`) >= (kind === "folder" ? limits.folder : limits.file),
        reason: forced(path) ? "Nome/apelido mencionado: explorar mesmo se abaixo do limiar." : `Limiar de ${kind === "folder" ? "pasta" : "arquivo"}: ${Math.round((kind === "folder" ? limits.folder : limits.file) * 100)}%.` })) });
      batch.forEach((node, i) => {
        const probability = requiredProbability(answers, `node_${i}`);
        if (node.kind === "folder" && (forced(node.path) || probability >= limits.folder)) frontier.push({ path: node.path, probability });
        if (node.kind === "file" && (forced(node.path) || probability >= limits.file)) candidates.push({ path: node.path, probability });
      });
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
    const source = forced(candidate.path) ? "identity" : "jev";
    result.files.push({ ...candidate, content, complete: true, source });
    options.onTrace?.({ phase: "selected", path: candidate.path, chars: content.length, source });
  }
  options.onProgress?.(`Memória consultada: ${result.files.length} arquivos selecionados${result.limited ? " (busca limitada)" : ""}`);
  options.onTrace?.({ phase: "complete", files: result.files.length, limited: result.limited });
  return result;
}

function requiredProbability(values: Record<string, number>, key: string): number {
  const value = values[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Decisão Jev inválida ou ausente.");
  return value;
}
