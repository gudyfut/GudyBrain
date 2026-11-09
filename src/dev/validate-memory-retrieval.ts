import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EvaluateDecisions } from "../core/decisions";
import { MemoryBrowser } from "../tools/memoria/navegador";
import { retrieveMemory } from "../agents/recuperador-decisions";
import { MemoryConversation } from "../agents/conversante/memory-conversation";

const root = mkdtempSync(join(tmpdir(), "gudy-decisions-test-"));
const external = mkdtempSync(join(tmpdir(), "gudy-decisions-external-"));
try {
  mkdirSync(join(root, "social", "pessoas"), { recursive: true });
  mkdirSync(join(root, "projetos"));
  writeFileSync(join(root, "social", "index.md"), "---\ntitle: Social\ndescription: Pessoas e relações\n---\n");
  writeFileSync(join(root, "social", "pessoas", "index.md"), "# Pessoas\n\nPessoas conhecidas pelo usuário.");
  writeFileSync(join(root, "social", "pessoas", "ana.md"), "---\ntitle: Ana\ndescription: Colega de pesquisa\n---\nCORPO_SECRETO: Ana trabalha com botânica.");
  writeFileSync(join(root, "social", "pessoas", "bia.md"), "---\ntitle: Bia\ndescription: Vizinha\n---\nOutro registro.");
  writeFileSync(join(root, "projetos", "jardim.md"), "---\ntitle: Jardim\ndescription: Jardim comunitário\n---\nProjeto fictício.");
  writeFileSync(join(root, "ignorar.txt"), "não é memória");
  writeFileSync(join(root, ".oculto.md"), "não deve ser visitado");
  writeFileSync(join(external, "fora.md"), "não ler");
  symlinkSync(external, join(root, "atalho"), process.platform === "win32" ? "junction" : "dir");
  const browser = new MemoryBrowser(root);
  const nodes = browser.list("");
  assert.deepEqual(nodes.map((node) => node.path).sort(), ["projetos", "social"]);
  assert.equal(nodes.find((node) => node.path === "social")?.description, "Pessoas e relações");
  assert.throws(() => browser.read("../fora.md"));
  assert.throws(() => browser.read(join(external, "fora.md")));
  assert.throws(() => browser.read("atalho/fora.md"));
  assert.equal(new MemoryBrowser(join(root, "ausente")).list("").length, 0);

  const history = [{ role: "user" as const, content: "Quero falar sobre Ana." }, { role: "assistant" as const, content: "O que deseja saber?" }];
  const visited: string[] = [];
  const evaluate: EvaluateDecisions = async (state, questions, signal) => {
    signal?.throwIfAborted();
    assert.deepEqual((state as { history: unknown }).history, history);
    assert.equal((state as { message: string }).message, "Onde ela trabalha?");
    assert.ok(!JSON.stringify(questions).includes("CORPO_SECRETO"), "Corpos não devem ser enviados à Decisions API nesta seleção por metadados");
    return Object.fromEntries(Object.entries(questions).map(([key, question]) => {
      const node = (question.instructions as { node?: { path: string } }).node;
      if (node) visited.push(node.path);
      return [key, node?.path === "projetos" || node?.path.endsWith("bia.md") ? 0.1 : 0.9];
    }));
  };
  const base = { input: "Onde ela trabalha?", history, instructions: "teste", browser, evaluate };
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GPT_API_KEY;
  const previousAnswerModel = process.env.OPENAI_MODEL;
  try {
    process.env.GPT_API_KEY = "synthetic-decisions-key";
    process.env.OPENAI_MODEL = "synthetic-responses-model";
    let requests = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/decisions", "nenhuma chamada ao provedor antigo");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-decisions-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-6-luna", "modelo Decisions é independente do modelo Responses");
      requests++;
      const parsed = Object.fromEntries(body.questions.map((q: { name: string; instructions: string }) => [q.name, { type: "predicate" as const, instructions: JSON.parse(q.instructions) }]));
      const values = await evaluate(JSON.parse(body.input), parsed);
      return Response.json({ answers: body.questions.map((q: { name: string }) => ({ name: q.name, type: "predicate", probability: values[q.name] })) });
    };
    const agent = new MemoryConversation({ browser, inspect: async () => '{"paths":[],"folders":[],"query":""}', answer: async (request) => {
      assert.equal(request.model, "synthetic-responses-model");
      assert.ok(JSON.parse(request.input).memory.files.some((file: { path: string }) => file.path === "social/pessoas/ana.md"));
      return "Resposta fictícia com memória.";
    } });
    agent.history.push(...history);
    await agent.run("Onde ela trabalha?");
    assert.ok(requests >= 2, "triagem e navegação usam o adaptador padrão");
    assert.equal(agent.history.at(-1)?.content, "Resposta fictícia com memória.");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GPT_API_KEY; else process.env.GPT_API_KEY = previousKey;
    if (previousAnswerModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previousAnswerModel;
  }
  const selected = await retrieveMemory(base);
  assert.equal(selected.searched, true);
  assert.deepEqual(selected.files.map((file) => file.path), ["social/pessoas/ana.md"]);
  assert.ok(selected.files[0]?.content.includes("CORPO_SECRETO"));
  assert.ok(!visited.includes("projetos/jardim.md"));
  assert.equal(selected.limited, false);

  let accessed = false;
  const skipped = await retrieveMemory({ ...base, evaluate: async () => ({ search: 0.1 }), browser: {
    list: () => { accessed = true; return []; }, read: () => { accessed = true; return ""; },
  } });
  assert.equal(skipped.searched, false);
  assert.equal(accessed, false, "Triagem negativa não deve ler memória");
  const empty = await retrieveMemory({ ...base, browser: { list: () => [], read: () => { throw new Error("não ler"); } } });
  assert.equal(empty.files.length, 0);
  const bounded = await retrieveMemory({ ...base, limits: { maxFolders: 1 } });
  assert.equal(bounded.limited, true);
  assert.equal(bounded.files.length, 0);
  const oversized = await retrieveMemory({ ...base, limits: { maxChars: 2 } });
  assert.equal(oversized.limited, true);
  assert.equal(oversized.files.length, 0, "Não truncar um documento no meio de uma afirmação");
  const batchSizes: number[] = [];
  const batched = await retrieveMemory({ ...base,
    browser: {
      list: () => Array.from({ length: 85 }, (_, i) => ({ path: `${i}.md`, kind: "file" as const, title: `Registro ${i}`, description: "Fictício" })),
      read: (path) => `Conteúdo de ${path}`,
    },
    evaluate: async (_state, questions) => {
      if (!("search" in questions)) batchSizes.push(Object.keys(questions).length);
      return Object.fromEntries(Object.keys(questions).map((key) => [key, 0.9]));
    },
    limits: { maxFiles: 3, maxNodes: 81 },
  });
  assert.deepEqual(batchSizes, [40, 40, 1]);
  assert.equal(batched.files.length, 3);
  assert.equal(batched.limited, true);
  await assert.rejects(retrieveMemory({ ...base, evaluate: async () => ({}) }), /inválida/);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(retrieveMemory({ ...base, signal: canceled.signal }), { name: "AbortError" });

  const progress: string[] = [];
  const conversation = new MemoryConversation({ inspect: async () => '{"paths":[]}', evaluate, browser, answer: async (request) => {
    const payload = JSON.parse(request.input);
    assert.deepEqual(payload.history, history);
    assert.equal(payload.message, "Onde ela trabalha?");
    assert.equal(payload.memory.files.length, 1);
    assert.ok(payload.memory.files[0].content.includes("CORPO_SECRETO"));
    request.onContent?.("Ela trabalha com botânica.");
    return "Ela trabalha com botânica.";
  } });
  conversation.history.push(...history);
  let streamed = "";
  await conversation.run("Onde ela trabalha?", {
    onContent: (chunk) => { streamed += chunk; },
    onStep: (event) => { if (event.type === "retrieval") progress.push(event.message); },
  });
  assert.equal(streamed, "Ela trabalha com botânica.");
  assert.equal(conversation.history.length, 4);
  assert.ok(progress.length >= 3);
  const failure = new MemoryConversation({ inspect: async () => '{"paths":[]}', evaluate: async () => { throw new Error("offline"); }, browser, answer: async () => { throw new Error("não chamar"); } });
  await assert.rejects(failure.run("oi"), /offline/);
  assert.equal(failure.history.length, 0);
  const answerFailure = new MemoryConversation({ inspect: async () => '{"paths":[]}', evaluate: async () => ({ search: 0 }), browser, answer: async () => { throw new Error("cota"); } });
  await assert.rejects(answerFailure.run("oi"), /cota/);
  assert.equal(answerFailure.history.length, 0);
  const noMemory = new MemoryConversation({ inspect: async () => '{"paths":[]}', evaluate: async () => ({ search: 0 }), browser, answer: async (request) => {
    assert.deepEqual(JSON.parse(request.input).memory.files, []); return "Olá!";
  } });
  await noMemory.run("oi");
  noMemory.history.length = 0;
  assert.equal(noMemory.history.length, 0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const concurrent = new MemoryConversation({ inspect: async () => '{"paths":[]}', evaluate: async () => { await held; return { search: 0 }; }, browser, answer: async () => "Olá" });
  const pending = concurrent.run("oi");
  await assert.rejects(concurrent.run("outra"), /Aguarde/);
  release();
  await pending;
  assert.equal(concurrent.history.length, 2);
  await assert.rejects(noMemory.run("oi", { signal: canceled.signal }), { name: "AbortError" });
  assert.equal(noMemory.history.length, 0);
  assert.equal(readFileSync(join(root, "social", "pessoas", "ana.md"), "utf8"), selected.files[0]?.content, "Recuperação não altera memória");
  mkdirSync(join(root, "eventos", "reunioes"), { recursive: true });
  writeFileSync(join(root, "eventos", "index.md"), "---\ntitle: Eventos\ndescription: Episódios situados no tempo\n---\n");
  writeFileSync(join(root, "eventos", "reunioes", "index.md"), "---\ntitle: Reuniões\ndescription: Debates de projetos\n---\n");
  writeFileSync(join(root, "eventos", "reunioes", "planejamento.md"), "---\ntitle: Planejamento\ndescription: Pauta de trabalho\n---\nTexto de teste.");
  assert.equal(browser.list("").find((node) => node.path === "eventos")?.description, "Episódios situados no tempo");
  assert.equal(browser.list("eventos").find((node) => node.path === "eventos/reunioes")?.description, "Debates de projetos");
  assert.equal(browser.list("eventos/reunioes")[0]?.path, "eventos/reunioes/planejamento.md");
  assert.deepEqual(browser.list("pasta-ainda-inexistente"), []);
  console.log("✓ Decisions: triagem, navegação, contexto, limites, falhas, cancelamento, HTTP e isolamento de caminhos (fixtures locais, sem API).");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(external, { recursive: true, force: true });
}
