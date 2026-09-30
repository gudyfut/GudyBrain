import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryBrowser } from "../tools/memoria/navegador";
import { buildMemoryIndex, locateMemory, mentionedMemories } from "../tools/memoria/indice-contexto";
import { JevConversation, MEMORY_INSPECTION_SCHEMA } from "../agents/conversante/jev-conversation";
import type { EvaluateJev } from "../core/jev";
import type { RetrievalEvent } from "../core/retrieval-events";

const root = mkdtempSync(join(tmpdir(), "gudy-memory-context-"));
mkdirSync(join(root, "social", "pessoas"), { recursive: true });
const path = "social/pessoas/amigo.md";
const content = '---\ntitle: Amigo fictício\ntype: Pessoa\napelido: [Beto, Betinho]\ndescription: Ficha de teste\n---\n## Histórico\n' + 'Informação fictícia. '.repeat(3300) + '\n## Última seção\nSENTINELA_NO_FIM: prefere trilhas.\n';
writeFileSync(join(root, path), content, "utf8");
const browser = new MemoryBrowser(root);
const index = buildMemoryIndex(browser);
assert.ok(index.nodes.some((node) => node.aliases?.includes("Beto")));
assert.ok(!JSON.stringify(index.nodes).includes("SENTINELA_NO_FIM"));
assert.deepEqual(mentionedMemories("E o BETO?", index.nodes), [path]);
assert.deepEqual(mentionedMemories("betoticamente", index.nodes), []);
assert.deepEqual(mentionedMemories("Betinho", index.nodes), [path]);
const low: EvaluateJev = async (state, questions) => {
  assert.ok(!("memoryIndex" in (state as object)), "Jev não recebe o catálogo completo");
  assert.ok(JSON.stringify(state).length < 1000, "estado de triagem fica pequeno");
  return Object.fromEntries(Object.keys(questions).map((key) => [key, .1]));
};
const trace: RetrievalEvent[] = [];
let inspections = 0;
const conversation = new JevConversation({ browser, evaluate: low,
  inspect: async (request) => {
    inspections++;
    assert.deepEqual(request.outputSchema, MEMORY_INSPECTION_SCHEMA);
    assert.ok(request.instructions.includes("Sua única tarefa"));

    const payload = JSON.parse(request.input);
    assert.equal(payload.stage, "inspect");
    if (inspections === 1) assert.ok(payload.candidateFiles.some((node: { aliases?: string[] }) => node.aliases?.includes("Beto")));
    assert.ok(!("memoryIndex" in payload));
    if (inspections === 1) {
      assert.equal(payload.memory.files.length, 0, "Arquivo acima do orçamento inicial não deve ser recortado");
      assert.equal(payload.memory.omitted[0].path, path);
      return JSON.stringify({ paths: [path] });
    }
    assert.equal(payload.memory.files[0].content, content);
    return '{"paths":[]}';
  },
  answer: async (request) => {
    assert.equal(request.outputSchema, undefined);
    assert.ok(!request.instructions.includes("social/pessoas/amigo.md"), "resposta não recebe a árvore em instructions");
    const payload = JSON.parse(request.input);
    assert.equal(payload.stage, "answer");
    assert.equal(payload.memory.files[0].content, content);
    assert.equal(payload.memory.files[0].complete, true);
    assert.equal(payload.memory.files[0].source, "conversador");
    assert.ok(payload.memory.files[0].content.includes("SENTINELA_NO_FIM"));
    request.onContent?.("Ele prefere trilhas.");
    return "Ele prefere trilhas.";
  },
});
let streamed = "";
await conversation.run("O que sabe sobre Beto?", { onContent: (chunk) => { streamed += chunk; }, onStep: (event) => { if (event.type === "retrieval_trace") trace.push(event.event); } });
assert.equal(streamed, "Ele prefere trilhas.");
const decision = trace.find((event) => event.phase === "decision");
assert.ok(decision?.phase === "decision" && decision.searched && decision.probability === .1 && decision.reason?.includes("apelido"));
assert.ok(trace.some((event) => event.phase === "request"));
assert.ok(trace.some((event) => event.phase === "selected" && event.chars === content.length));
assert.ok(!JSON.stringify(trace).includes("SENTINELA_NO_FIM"));

// Mesmo com triagem negativa, o conversador pode localizar e pedir um registro.
let count = 0;
const secondLook = new JevConversation({ browser, evaluate: low, inspect: async () => JSON.stringify({ paths: count++ === 0 ? [path] : [] }), answer: async (request) => {
  assert.equal(JSON.parse(request.input).memory.files[0].content, content); return "Contexto recuperado.";
} });
await secondLook.run("Pode conferir esse detalhe?");
assert.equal(secondLook.lastRetrieval?.searched, true);
assert.equal(secondLook.lastRetrieval?.probability, .1);

let answered = false;
const invalid = new JevConversation({ browser, evaluate: low, inspect: async () => '{"paths":["../segredo.md"]}', answer: async () => { answered = true; return "Não executar"; } });
await assert.rejects(invalid.run("oi"), /inválida/);
assert.equal(answered, false);
assert.equal(invalid.history.length, 0);
const malformed = new JevConversation({ browser, evaluate: low, inspect: async () => "Você e o usuário fazem parte de um grupo privado.", answer: async () => { throw new Error("Não responder após plano inválido"); } });
await assert.rejects(malformed.run("Que grupo?"), (error: Error) => {
  assert.ok(error.message.includes("formato inválido"));
  assert.ok(!error.message.includes("grupo privado") && !error.message.includes("Unexpected token"));
  return true;
});
assert.equal(malformed.history.length, 0);
const largeIndex = { nodes: [
  { path: "social", kind: "folder" as const, title: "Pessoas", description: "Relações pessoais" },
  ...Array.from({ length: 80 }, (_, i) => ({ path: `social/pessoa-${i}.md`, kind: "file" as const,
    title: i === 79 ? "Amigo especial" : `Pessoa ${i}`, description: "Registro fictício", aliases: i === 79 ? ["Beto"] : [] })),
], identities: new Map([["beto", ["social/pessoa-79.md"]]]), chars: 0 };
const localHit = locateMemory(largeIndex, "Como está o Beto?");
assert.equal(localHit.files.length, 24);
assert.equal(localHit.files[0]?.path, "social/pessoa-79.md", "apelido encontra arquivo fora da primeira página do índice");
assert.equal(localHit.folders.length, 1);
const scopedNodes = [
  { path: "projetos", kind: "folder" as const, title: "Projetos", description: "Projetos" },
  { path: "social", kind: "folder" as const, title: "Pessoas", description: "Pessoas" },
];
const projects = Array.from({ length: 30 }, (_, i) => ({ path: `projetos/item-${i}.md`, kind: "file" as const, title: `Item ${i}`, description: "Registro fictício" }));
const people = Array.from({ length: 80 }, (_, i) => ({ path: `social/pessoa-${i}.md`, kind: "file" as const, title: `Pessoa ${i}`, description: "Registro fictício" }));
let locatorRounds = 0;
const progressive = new JevConversation({
  browser: { list: (folder) => folder === "" ? scopedNodes : folder === "social" ? people : projects,
    read: (file) => `Documento integral de ${file}` }, evaluate: low,
  inspect: async (request) => {
    const payload = JSON.parse(request.input);
    locatorRounds++;
    assert.ok(payload.candidateFiles.length <= 24 && payload.candidateFolders.length <= 24);
    assert.ok(!("memoryIndex" in payload));
    if (locatorRounds === 1) {
      assert.ok(payload.candidateFolders.some((node: { path: string }) => node.path === "social"));
      assert.ok(!payload.candidateFiles.some((node: { path: string }) => node.path === "social/pessoa-79.md"));
      return JSON.stringify({ paths: [], folders: ["social"], query: "" });
    }
    if (locatorRounds === 2) {
      assert.ok(payload.candidateFiles.every((node: { path: string }) => node.path.startsWith("social/")));
      return JSON.stringify({ paths: [], folders: [], query: "Pessoa 79" });
    }
    if (locatorRounds === 3) {
      assert.ok(payload.candidateFiles.some((node: { path: string }) => node.path === "social/pessoa-79.md"));
      return JSON.stringify({ paths: ["social/pessoa-79.md"], folders: [], query: "" });
    }
    return JSON.stringify({ paths: [], folders: [], query: "" });
  },
  answer: async (request) => {
    assert.equal(JSON.parse(request.input).memory.files[0].content, "Documento integral de social/pessoa-79.md");
    return "Localizado.";
  },
});
await progressive.run("Pode conferir um registro específico?");
assert.equal(locatorRounds, 4, "localizador amplia somente as pastas e consultas solicitadas");
const cancelled = new AbortController();
const cancellation = new JevConversation({ browser, evaluate: low, inspect: async () => { cancelled.abort(); return '{"paths":[]}'; }, answer: async () => { throw new Error("não responder"); } });
await assert.rejects(cancellation.run("oi", { signal: cancelled.signal }), { name: "AbortError" });
assert.equal(cancellation.history.length, 0);
console.log("✓ Contexto vivo: apelidos, triagem negativa, consulta adicional, arquivo integral >60 mil caracteres, seção final, isolamento de caminhos, cancelamento e eventos sem conteúdo privado.");
