import assert from "node:assert/strict";
import { MemoryConversation } from "../agents/conversante/memory-conversation";
import { retrieveMemory } from "../agents/recuperador-decisions";
import { buildMemoryIndex, locateMemory } from "../tools/memoria/indice-contexto";
import type { MemoryNode } from "../tools/memoria/navegador";
import type { EvaluateDecisions } from "../core/decisions";

const node = (path: string, kind: MemoryNode["kind"] = "file", title = path): MemoryNode => ({ path, kind, title, description: "Registro fictício" });
const low: EvaluateDecisions = async (_state, questions) => Object.fromEntries(Object.keys(questions).map((key) => [key, .1]));
const plan = (paths: string[] = [], folders: string[] = [], query = "") => JSON.stringify({ paths, folders, query });
let failures = 0;
async function check(name: string, test: () => Promise<void>) {
  try { await test(); console.log("✓ " + name); }
  catch (error) { failures++; console.error("✗ " + name + ": " + (error instanceof Error ? error.message : "Falhou")); }
}

await check("Conferência volta ao índice geral após esgotar uma pasta", async () => {
  let inspections = 0;
  const agent = new MemoryConversation({ evaluate: low,
    browser: { list: (folder) => folder ? [node(`${folder}/registro.md`)] : [node("pessoas", "folder"), node("grupos", "folder")], read: (path) => `INTEGRAL:${path}` },
    inspect: async (request) => {
      inspections++;
      const payload = JSON.parse(request.input);
      if (inspections === 1) return plan([], ["pessoas"]);
      if (inspections === 2) return plan(["pessoas/registro.md"]);
      assert.ok(payload.candidateFiles.some((file: MemoryNode) => file.path === "grupos/registro.md"));
      return plan(["grupos/registro.md"]);
    }, answer: async (request) => {
      const files = JSON.parse(request.input).memory.files;
      assert.deepEqual(files.map((file: MemoryNode) => file.path).sort(), ["grupos/registro.md", "pessoas/registro.md"]);
      return "A relação foi conferida nos dois documentos.";
    },
  });
  await agent.run("Confira a relação da pessoa com o grupo");
  assert.equal(inspections, 3);
});

await check("Limite de inspeções não simula uma busca completa", async () => {
  let inspections = 0;
  const agent = new MemoryConversation({ evaluate: low,
    browser: { list: () => [node("registro.md")], read: () => "Documento" },
    inspect: async () => plan([], [], `refinamento ${++inspections}`),
    answer: async (request) => {
      const memory = JSON.parse(request.input).memory;
      assert.equal(memory.limited, true, "a quarta consulta ainda pediu mais busca");
      assert.ok(memory.limitations.some((reason: string) => reason.includes("rodadas")));
      return "A consulta ficou incompleta.";
    },
  });
  await agent.run("Confira o detalhe");
  assert.equal(inspections, 4);
});

await check("Refinamento explícito supera preferências antigas do histórico", async () => {
  const prior = Array.from({ length: 24 }, (_, i) => node(`antigo-${i}.md`, "file", `Pessoa ${i}`));
  const target = { ...node("alvo.md", "file", "Iniciativa Orbital"), description: "Pesquisa sobre foguetes" };
  let inspections = 0;
  const agent = new MemoryConversation({ evaluate: low,
    browser: { list: () => [...prior, target], read: (path) => `INTEGRAL:${path}` },
    inspect: async (request) => {
      inspections++;
      if (inspections === 1) return plan([], [], "foguetes");
      if (inspections === 2) {
        assert.equal(JSON.parse(request.input).candidateFiles[0].path, target.path);
        return plan([target.path]);
      }
      return plan();
    }, answer: async (request) => {
      assert.equal(JSON.parse(request.input).memory.files[0].path, target.path);
      return "Projeto encontrado.";
    },
  });
  agent.history.push({ role: "user", content: prior.map((file) => file.title).join(", ") });
  await agent.run("Agora confira aquela iniciativa");
});

await check("Índice sem documentos dispensa Decisions e inspeção", async () => {
  const agent = new MemoryConversation({
    browser: { list: (path) => path ? [] : [node("vazia", "folder")], read: () => { throw new Error("Não ler"); } },
    evaluate: async () => { throw new Error("Avaliação remota desnecessária"); },
    inspect: async () => { throw new Error("Inspeção sem documentos"); },
    answer: async (request) => { assert.deepEqual(JSON.parse(request.input).memory.files, []); return "Sem contexto local."; },
  });
  await agent.run("Olá");
});

await check("Identidade local pula julgamentos redundantes sem perder registros relacionados", async () => {
  const browser = {
    list: (path: string): MemoryNode[] => path === "" ? [node("social", "folder"), node("grupos", "folder")]
      : path === "social" ? [node("social/pessoas", "folder")]
        : path === "social/pessoas" ? [{ ...node("social/pessoas/ana.md", "file", "Ana de teste"), aliases: ["Aninha"] }]
          : [node("grupos/equipe.md")],
    read: (path: string) => `INTEGRAL:${path}`,
  };
  const evaluated: string[] = [];
  const result = await retrieveMemory({ input: "Qual é o grupo da Aninha?", history: [], instructions: "teste", browser, index: buildMemoryIndex(browser),
    evaluate: async (_state, questions) => Object.fromEntries(Object.entries(questions).map(([key, value]) => {
      const path = (value.instructions as { node?: MemoryNode }).node?.path;
      if (path) evaluated.push(path);
      return [key, .9];
    })),
  });
  assert.deepEqual(evaluated, ["grupos", "grupos/equipe.md"], "caminhos obrigatórios dispensam predicados");
  assert.deepEqual(result.files.map((file) => file.path), ["social/pessoas/ana.md", "grupos/equipe.md"]);
  assert.equal(result.files[0]?.source, "identity");
});

// A maximum-size synthetic index checks ranking without personal records or APIs.
const largeIndex = { nodes: Array.from({ length: 1900 }, (_, i) => ({ ...node(`item-${i}.md`), description: i === 1899 ? "astronomia científica" : "Registro fictício" })), identities: new Map<string, string[]>(), chars: 0 };
const before = performance.now();
assert.equal(locateMemory(largeIndex, "astronomia").files[0]?.path, "item-1899.md");
console.log(`Localizador com 1.900 documentos fictícios: ${Math.round(performance.now() - before)} ms.`);
if (failures) throw new Error(`${failures} regressão/regressões reproduzidas na auditoria de memória.`);
