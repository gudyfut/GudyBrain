import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { retrieveMemory } from "../agents/recuperador-decisions";
import { MemoryConversation } from "../agents/conversante/memory-conversation";
import type { EvaluateDecisions } from "../core/decisions";
import type { RetrievalEvent } from "../core/retrieval-events";
import { buildMemoryIndex } from "../tools/memoria/indice-contexto";
import type { MemoryNode } from "../tools/memoria/navegador";

// Entirely synthetic: no credentials, network, personal memory or real models.
const node = (path: string, kind: MemoryNode["kind"] = "file"): MemoryNode => ({ path, kind, title: path, description: "Registro fictício" });
const predicates: EvaluateDecisions = async (_state, questions) => Object.fromEntries(Object.keys(questions).map((key) => [key, .9]));
const base = { input: "Confira os registros", history: [], instructions: "Sintético", evaluate: predicates };
const folders = Array.from({ length: 9 }, (_, i) => node(`pasta-${i}`, "folder"));
let lists = 0;
const browser = {
  list: (path: string) => { lists++; return path ? [node(`${path}/registro.md`)] : folders; },
  read: (path: string) => `Documento completo ${path}; SENTINELA_NO_FIM.`,
};
const index = buildMemoryIndex(browser);
const indexLists = lists;

async function measure(concurrency: number) {
  let calls = 0;
  const start = performance.now();
  const result = await retrieveMemory({ ...base, browser, index, concurrency,
    evaluate: async (...args) => { calls++; await delay(15); return predicates(...args); },
  });
  return { result, calls, ms: Math.round(performance.now() - start) };
}
const serial = await measure(1);
const optimized = await measure(3);
assert.deepEqual(optimized.result, serial.result, "mesmos documentos integrais e limites no cenário sem esgotamento");
assert.equal(serial.calls, 11);
assert.equal(optimized.calls, 5, "pastas pequenas compartilham requisições");
assert.equal(lists, indexLists, "a navegação não relê o índice do mesmo turno");
console.log(`Latência simulada (15 ms/chamada): serial ${serial.ms} ms/${serial.calls} chamadas; otimizada ${optimized.ms} ms/${optimized.calls} chamadas. Não mede a API real.`);

// Wide folder: cap requests at three, validate mapping despite reversed completion,
// and ensure a fourth request is not launched until the first group completes.
const many = Array.from({ length: 161 }, (_, i) => node(`${String(i).padStart(3, "0")}.md`));
let active = 0, peak = 0, evaluated = 0;
const sizes: number[] = [];
const completed: string[] = [];
const trace: RetrievalEvent[] = [];
const wide = await retrieveMemory({ ...base,
  browser: { list: () => many, read: (path) => path },
  limits: { maxNodes: 121, maxFiles: 4 }, onTrace: (event) => trace.push(event),
  evaluate: async (_state, questions, signal) => {
    if ("search" in questions) return { search: .9 };
    const paths = Object.values(questions).map((q) => (q.instructions as { node: MemoryNode }).node.path);
    active++; peak = Math.max(peak, active); sizes.push(paths.length); evaluated += paths.length;
    await delay(paths[0] === "000.md" ? 30 : 5, undefined, { signal });
    active--; completed.push(paths[0]!);
    return Object.fromEntries(paths.map((path, i) => [`node_${i}`, path === "080.md" ? .99 : .9]));
  },
});
assert.equal(peak, 3);
assert.equal(active, 0);
assert.equal(evaluated, 121);
assert.deepEqual(sizes, [40, 40, 40, 1]);
assert.notEqual(completed[0], "000.md", "respostas chegaram fora de ordem");
assert.deepEqual(wide.files.map((file) => file.path), ["080.md", "000.md", "001.md", "002.md"]);
assert.equal(wide.limited, true);
assert.deepEqual(trace.filter((event) => event.phase === "evaluated").map((event) => event.nodes[0]?.path), ["000.md", "040.md", "080.md", "120.md"]);
assert.ok(trace.filter((event) => event.phase === "evaluated").every((event) => event.parent === ""));

// Budgets are reserved before parallel calls, including partial final folders.
const limited = await retrieveMemory({ ...base, browser, index, limits: { maxFolders: 2 } });
assert.equal(limited.files.length, 1);
assert.equal(limited.limited, true);
const partial = await retrieveMemory({ ...base, browser, index, limits: { maxNodes: 10 } });
assert.equal(partial.files.length, 1);
assert.equal(partial.limited, true);
await assert.rejects(retrieveMemory({ ...base, browser, concurrency: 4 }), /Concorrência/);

// One refused/invalid batch cancels siblings and never reads/answers partial data.
for (const invalid of [false, true]) {
  const signals: AbortSignal[] = [];
  let reads = 0;
  await assert.rejects(retrieveMemory({ ...base,
    browser: { list: () => many, read: () => { reads++; return "não ler"; } },
    evaluate: async (_state, questions, signal): Promise<Record<string, number>> => {
      if ("search" in questions) return { search: .9 };
      signals.push(signal!);
      if (signals.length === 1) {
        await delay(2);
        if (invalid) return {};
        throw new Error("recusa sintética");
      }
      await delay(1000, undefined, { signal });
      return {};
    },
  }), invalid ? /inválida/ : /recusa/);
  assert.equal(signals.length, 3, "não agenda lotes após a primeira falha");
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(reads, 0);
}
const cancellation = new AbortController();
let batches = 0, reads = 0;
await assert.rejects(retrieveMemory({ ...base, signal: cancellation.signal,
  browser: { list: () => many, read: () => { reads++; return "não ler"; } },
  evaluate: async (_state, questions) => {
    if ("search" in questions) return { search: .9 };
    batches++;
    await delay(2);
    cancellation.abort(); // A provider can ignore abort and still return values.
    return Object.fromEntries(Object.keys(questions).map((key) => [key, .9]));
  },
}), { name: "AbortError" });
assert.equal(batches, 3);
assert.equal(reads, 0);

// Complete context avoids a redundant GPT inspection. Rebuild the index on the
// next turn so newly saved documents remain visible (no cross-turn cache).
let inspections = 0, turns = 0, roundLists = 0;
const conversation = new MemoryConversation({ evaluate: predicates,
  browser: {
    list: (path) => { roundLists++; return path ? [node(`${path}/registro.md`), ...(turns ? [node(`${path}/novo.md`)] : [])] : folders.slice(0, 1); },
    read: browser.read,
  },
  inspect: async () => { inspections++; throw new Error("não há documentos restantes"); },
  answer: async (request) => {
    const payload = JSON.parse(request.input);
    assert.equal(payload.memory.files.length, turns + 1);
    assert.ok(payload.memory.files.every((file: { content: string }) => file.content.endsWith("SENTINELA_NO_FIM.")));
    return "Resposta confirmada";
  },
});
await conversation.run("Consulte os registros");
turns++;
await conversation.run("Consulte os registros atualizados");
assert.equal(inspections, 0);
assert.equal(roundLists, 4, "cada pasta é listada uma única vez por turno");
assert.equal(conversation.history.length, 4);
console.log("✓ Otimização: agrupamento, concorrência limitada, ordem determinística, índice por turno, limites, falhas e cancelamento; sem provedores reais.");
