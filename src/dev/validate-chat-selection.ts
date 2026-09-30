import assert from "node:assert/strict";
import { parseFacts, selectChatMemories } from "../agents/curador-chat/selection";
import { createJevChoiceClient, type EvaluateJev, type ChooseJev } from "../core/jev";
import type { AnswerProvider } from "../core/llm";
import { preencherDocumentoCandidato } from "../tools/memoria/preencher";
import { montarPreviaMemoria } from "../tools/memoria/documento-editavel";
import type { EntradaCatalogoMemoria } from "../tools/memoria/catalogo";
import { revisaoMemoria } from "../tools/memoria/contrato-escrita";

const history = [{ role: "user" as const, content: "Ana joga xadrez semanalmente." }, { role: "assistant" as const, content: "Ana é campeã mundial." }];
const fact = { subject: "Ana", text: history[0]!.content, evidence: [{ messageId: "msg_0", quote: history[0]!.content }] };
const json = JSON.stringify({ complete: true, facts: [fact] });
assert.equal(parseFacts(json, history)[0]?.id, "fact_0");
assert.throws(() => parseFacts(JSON.stringify({ complete: false, facts: [] }), history), /incompleta/);
assert.throws(() => parseFacts(JSON.stringify({ complete: true, facts: [{ ...fact, evidence: [{ messageId: "msg_1", quote: history[1]!.content }] }] }), history), /Citação/);
assert.throws(() => parseFacts(JSON.stringify({ complete: true, facts: [{ ...fact, evidence: [{ messageId: "msg_0", quote: "inventada" }] }] }), history), /Citação/);

const evaluate: EvaluateJev = async (_state, questions, signal) => { signal?.throwIfAborted(); return Object.fromEntries(Object.keys(questions).map((key) => [key, key === "duplicate" || key === "contradiction" ? .01 : .99])); };
const choose: ChooseJev = async (_state, _instructions, criteria) => ({ choice: "Pessoa" in criteria ? "Pessoa" : "Interesses", confidence: .99 });
const answer: AnswerProvider = async (request) => JSON.parse(request.input).stage === "extract" ? json : JSON.stringify({ item: { tipo: "interesse", nome: "Xadrez", detalhe: "joga semanalmente" }, frontmatter: {} });
const base = { history, model: "fake", instructions: "fake", answer, evaluate, choose, catalog: [] as EntradaCatalogoMemoria[], read: () => { throw new Error("Não ler disco"); } };
const created = await selectChatMemories(base);
assert.equal(created.candidates.length, 1);
assert.equal(created.candidates[0]?.path, "social/pessoas/ana.md");
assert.ok(created.candidates[0]?.corpo.includes("**Xadrez**"));
assert.ok(created.candidates[0]?.evidencias[0]?.includes("msg_0"));
assert.equal(created.decisions[0]?.status, "proposta");
const eventHistory = [{ role: "user" as const, content: "Houve uma reunião do projeto Jardim." }];
const eventFact = { subject: "Reunião do Jardim", text: eventHistory[0]!.content,
  evidence: [{ messageId: "msg_0", quote: eventHistory[0]!.content }] };
const eventBase = { ...base, history: eventHistory,
  answer: (async (request) => JSON.parse(request.input).stage === "extract"
    ? JSON.stringify({ complete: true, facts: [eventFact] })
    : JSON.stringify({ item: { tipo: "fato", texto: eventFact.text }, frontmatter: {} })) as AnswerProvider,
  choose: (async (_state, _instructions, criteria) => ({
    choice: "Evento" in criteria ? "Evento" : "Contexto" in criteria ? "Contexto" : "eventos/projetos",
    confidence: .99,
  })) as ChooseJev,
  browseFolders: (folder: string) => folder === "eventos" ? [
    { path: "eventos/convivencia", kind: "folder" as const, title: "Convivência", description: "Encontros sociais" },
    { path: "eventos/projetos", kind: "folder" as const, title: "Projetos", description: "Reuniões de trabalho" },
  ] : [],
};
const routedEvent = await selectChatMemories(eventBase);
assert.equal(routedEvent.candidates[0]?.path, "eventos/projetos/reuniao-do-jardim.md");
const ambiguousEvent = await selectChatMemories({ ...eventBase,
  choose: async (state, instructions, criteria, signal) => "eventos/projetos" in criteria
    ? { choice: "ambigua", confidence: .99 }
    : eventBase.choose(state, instructions, criteria, signal),
});
assert.equal(ambiguousEvent.candidates.length, 0);
assert.equal(ambiguousEvent.decisions[0]?.status, "ambigua");
for (const key of ["supported", "attributed", "useful", "faithful"]) {
  const result = await selectChatMemories({ ...base, evaluate: async (...args) => ({ ...await evaluate(...args), [key]: .2 }) });
  assert.equal(result.candidates.length, 0, key);
  assert.equal(result.decisions.length, 1);
}
assert.equal((await selectChatMemories({ ...base, choose: async () => ({ choice: "ambigua", confidence: .99 }) })).candidates.length, 0);
await assert.rejects(selectChatMemories({ ...base, evaluate: async () => ({}) }), /incompleta/);
await assert.rejects(selectChatMemories({ ...base, evaluate: async () => { throw new Error("API falhou"); } }), /API falhou/);
const abort = new AbortController(); abort.abort();
await assert.rejects(selectChatMemories({ ...base, signal: abort.signal }), { name: "AbortError" });

const doc = preencherDocumentoCandidato({ type: "Pessoa", frontmatter: { title: "Ana" }, alteracoes: [{ secao: "Histórico", modo: "acrescentar", conteudo: "- Fato anterior." }] });
const current = montarPreviaMemoria("", doc.frontmatter, doc.corpo);
const entry: EntradaCatalogoMemoria = { id: "mem_00000000-0000-4000-8000-000000000001", path: "social/pessoas/ana.md", title: "Ana", type: "Pessoa", description: null, tags: [], campos: {}, corpo: doc.corpo };
const existing = { ...base, catalog: [entry], read: () => current };
const updated = await selectChatMemories(existing);
assert.equal(updated.candidates[0]?.acao, "atualizar");
assert.equal(updated.candidates[0]?.baseRevision, revisaoMemoria(current));
assert.ok(updated.candidates[0]?.corpo.includes("Fato anterior."));
assert.equal((await selectChatMemories({ ...existing, evaluate: async (...args) => ({ ...await evaluate(...args), duplicate: .95 }) })).candidates.length, 0);
const contradiction = await selectChatMemories({ ...existing, evaluate: async (...args) => ({ ...await evaluate(...args), contradiction: .95 }) });
assert.equal(contradiction.candidates[0]?.noveltyAssessments[0]?.classification, "contradicao");
assert.ok(contradiction.candidates[0]?.corpo.includes("Fato anterior."));
assert.equal((await selectChatMemories({ ...existing, evaluate: async (...args) => ({ ...await evaluate(...args), match_0: .5 }) })).candidates.length, 0);
const grouped = await selectChatMemories({ ...base, answer: async (request) => JSON.parse(request.input).stage === "extract" ? JSON.stringify({ complete: true, facts: [fact, fact] }) : answer(request) });
assert.equal(grouped.candidates.length, 1);
assert.equal(grouped.candidates[0]?.corpo.match(/\*\*Xadrez\*\*/g)?.length, 1);
const aliases = { ...base, answer: async (request: Parameters<AnswerProvider>[0]) => JSON.parse(request.input).stage === "extract" ? JSON.stringify({ complete: true, facts: [fact, { ...fact, subject: "Ana Silva" }] }) : answer(request) };
assert.equal((await selectChatMemories(aliases)).candidates.length, 1, "Aliases do mesmo lote usam a mesma proposta");
const uncertainAlias = await selectChatMemories({ ...aliases, evaluate: async (...args) => ({ ...await evaluate(...args), pending_0: .5 }) });
assert.equal(uncertainAlias.decisions[1]?.status, "ambigua");
await assert.rejects(selectChatMemories({ ...existing, catalog: [entry, { ...entry, path: "social/pessoas/outra.md" }] }), /duplicados/);

const client = createJevChoiceClient({ apiKey: "fake", model: "fake", fetch: (async (_url, init) => {
  const body = JSON.parse(String(init?.body)); assert.equal(body.questions.route.type, "choice");
  return Response.json({ answers: { route: { type: "choice", choice: "Pessoa", confidence: .8, probabilities: { Pessoa: .9, nenhuma: .1 } } } });
}) as typeof fetch });
assert.equal((await client({}, "tipo?", { Pessoa: "Indivíduo", nenhuma: "nenhuma" })).choice, "Pessoa");
await assert.rejects(client({}, "tipo?", { Lugar: "Local" }), /inválida/);
console.log("✓ Curadoria de chat: citações, seleção, abstenções, identidade, novidade, contradição, agrupamento, revisão-base, falhas e Choice (sem API ou memória pessoal).");
