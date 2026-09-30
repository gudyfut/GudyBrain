import assert from "node:assert/strict";
import { retrieveMemory } from "@gudybrain/agents/recuperador-jev";
import { graphNodes, initialTrace, reduceTrace, visibleGraphTrace } from "../components/retrieval-state";
import { AtlasPhysics, atlasEdge } from "../components/atlas-physics";

let trace = initialTrace();
const result = await retrieveMemory({
  input: "Consulta fictícia", history: [], instructions: "fake",
  evaluate: async (_state, questions) => Object.fromEntries(Object.keys(questions).map((key) => [key, .99])),
  browser: {
    list: (path) => path === "" ? [{ path: "projetos", kind: "folder", title: "Projetos", description: "" }]
      : Array.from({ length: 150 }, (_, i) => ({ path: `projetos/${String(i).padStart(3, "0")}.md`, kind: "file", title: `Projeto ${i}`, description: "" })),
    read: () => "CONTEUDO_PRIVADO",
  },
  limits: { maxFiles: 3 },
  onTrace: (event) => {
    assert.ok(!JSON.stringify(event).includes("CONTEUDO_PRIVADO"));
    trace = reduceTrace(trace, event);
  },
});
assert.deepEqual(Object.values(trace.nodes).filter((node) => node.selected).map((node) => node.path), result.files.map((file) => file.path));
assert.deepEqual(trace.visits, ["", "projetos"]);
assert.equal(trace.limited, true);
assert.equal(graphNodes(trace).length, 100);
assert.equal(graphNodes(trace, 1100).length, 152);
assert.ok(graphNodes(trace).filter((node) => node.selected).length === 3);
const overview = visibleGraphTrace(trace, new Set());
assert.equal(graphNodes(overview).length, 5, "visão inicial mantém apenas núcleo, pastas e arquivos finais");
const expanded = visibleGraphTrace(trace, new Set(["projetos"]));
const expandedNodes = graphNodes(expanded, 1100);
assert.equal(expandedNodes.length, 152, "todos os arquivos reaparecem ao explorar a ramificação");
const siblings = expandedNodes.filter((node) => node.parent === "projetos" && node.kind === "file");
const firstGap = Math.hypot(siblings[0]!.x - siblings[1]!.x, siblings[0]!.y - siblings[1]!.y);
assert.ok(firstGap >= 195, "ramificação densa reserva espaço real entre rótulos");
trace = { ...trace, phase: "cancelled" };
assert.equal(reduceTrace(trace, { phase: "answer" }), trace, "evento tardio não reabre busca cancelada");
let skipped = initialTrace();
await retrieveMemory({ input: "oi", history: [], instructions: "fake", evaluate: async () => ({ search: .1 }),
  browser: { list: () => { throw new Error("Não navegar"); }, read: () => { throw new Error("Não ler"); } },
  onTrace: (event) => { skipped = reduceTrace(skipped, event); },
});
assert.equal(skipped.searched, false);
assert.equal(Object.keys(skipped.nodes).length, 0);
const field = new AtlasPhysics();
field.sync([
  { path: "", parent: "", title: "Núcleo", kind: "folder", x: 0, y: 0 },
  { path: "a", parent: "", title: "Registro A", kind: "file", x: 200, y: 0 },
  { path: "b", parent: "", title: "Registro B", kind: "file", x: 203, y: 2 },
  { path: "c", parent: "", title: "Registro C", kind: "file", x: 207, y: 5 },
]);
for (let i = 0; i < 400; i++) field.step();
const separated = field.positions();
for (const [left, right] of [["a", "b"], ["a", "c"], ["b", "c"]] as const) {
  const a = separated[left]!, b = separated[right]!;
  assert.ok(Math.abs(a.x - b.x) >= 90 || Math.abs(a.y - b.y) >= 92,
    "Rótulos vizinhos devem ter espaço para serem lidos");
}
const initialEdge = atlasEdge(separated[""]!, separated.a!);
field.grab("a"); field.move("a", separated.a!.x + 140, separated.a!.y + 70);
for (let i = 0; i < 45; i++) field.step();
assert.notEqual(atlasEdge(field.positions()[""]!, field.positions().a!), initialEdge, "Aresta acompanha o nó arrastado");
assert.ok(field.positions().b!.x !== separated.b!.x || field.positions().c!.x !== separated.c!.x,
  "Nós vizinhos devem reagir ao arraste");
field.release(); field.reset();
assert.ok(Math.abs(field.positions().a!.x - separated.a!.x) < 15, "Centralizar restaura a distribuição");
const dense = new AtlasPhysics();
const total = 36;
dense.sync([
  { path: "", parent: "", title: "Núcleo", kind: "folder", x: 0, y: 0 },
  ...Array.from({ length: total }, (_, i) => ({ path: `item-${i}`, parent: "", kind: "file" as const,
    title: `Memória com título extenso ${i}`, x: 360 * Math.cos(i * 2 * Math.PI / total), y: 360 * Math.sin(i * 2 * Math.PI / total) })),
]);
for (let i = 0; i < 350; i++) dense.step();
const layout = dense.positions();
for (let i = 0; i < total; i++) for (let j = i + 1; j < total; j++) {
  const a = layout[`item-${i}`]!, b = layout[`item-${j}`]!;
  assert.ok(Math.abs(a.x - b.x) >= 182 || Math.abs(a.y - b.y) >= 92,
    "Etiquetas de memórias vizinhas não podem se sobrepor");
}
dense.grab("item-0"); dense.move("item-0", 0, 0);
assert.ok(Math.hypot(dense.positions()["item-0"]!.x, dense.positions()["item-0"]!.y) >= 190,
  "Um nó arrastado não deve cobrir o núcleo");
console.log("✓ Eventos reais de recuperação -> estado visual: seleção, limites, percurso, cancelamento e privacidade dos corpos.");
