import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { Message } from "@gudybrain/core/glm";
import { DecisionsError } from "@gudybrain/core/decisions";
import { LiveController, delegationContext, voiceChunks, type LiveControllerOptions } from "../server/live-controller";
import { createLiveConnection, liveSessionBody, LiveError } from "../server/live-provider";
import { readLiveRequest, liveErrorResponse } from "../server/live-http";
import { liveMessages, type LiveFragment } from "../shared/live";

let eventNumber = 0;
function fragment(role: "user" | "assistant", text: string, start = 100, end = 200): LiveFragment {
  return { id: "fragment-" + ++eventNumber, role, text, startMs: start, endMs: end };
}
function transcript(controller: LiveController, role: "user" | "assistant", text: string, start = 100, end = 200) {
  const event = { type: "session." + (role === "user" ? "input" : "output") + "_transcript.delta",
    event_id: "event-" + ++eventNumber, delta: text, start_ms: start, end_ms: end };
  controller.receive(event);
  return event;
}
function delegate(controller: LiveController, id = "delegation-1", offset = 200) {
  controller.receive({ type: "session.delegation.created", event_id: "event-" + ++eventNumber,
    offset_ms: offset, delegation: { id, target: "client" } });
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5); }
  assert.fail("O estado esperado não chegou no prazo do teste.");
}

function harness(overrides: Partial<LiveControllerOptions> = {}, acknowledge = true, finalEvent = true) {
  const sent: Record<string, unknown>[] = [];
  let finished: readonly Message[] = [];
  let disconnected = 0;
  let hungup = 0;
  let controller!: LiveController;
  controller = new LiveController({ id: "live-test", history: [], settleMs: 1, closeMs: 10,
    transport: {
      send(event) {
        sent.push(event);
        if (event.type === "session.close") {
          if (finalEvent) queueMicrotask(() => controller.receive({ type: "session.closed", usage: { seconds: 17 }, reason: "close_requested" }));
        } else if (acknowledge) queueMicrotask(() => controller.receive({ type: String(event.type).replace(/append$/, "appended"), client_event_id: event.event_id }));
      },
      disconnect() { disconnected++; },
      async hangup() { hungup++; },
    },
    query: async () => "Resultado interno que não é automaticamente uma fala.",
    onFinish: (messages) => { finished = messages; }, ...overrides });
  return { controller, sent, get finished() { return finished; }, get disconnected() { return disconnected; }, get hungup() { return hungup; } };
}

const config = liveSessionBody("v=0\r\nfake-offer", "tempo", [{ role: "user", content: "Uma pergunta sintética" }]);
assert.equal(config.session.model, "gpt-live-1");
assert.equal(config.session.store, false);
assert.equal(config.session.delegation.type, "client");
assert.deepEqual(config.session.client.data_channel.allowed_client_events, ["session.close"]);
assert.equal("format" in config.session.audio, false, "WebRTC negocia o formato de áudio");
assert.ok(config.session.instructions.includes("Generate <|SpawnThinking|>"));
assert.ok(config.session.instructions.includes("somente de leitura"));
const largeHistory = Array.from({ length: 200 }, () => ({ role: "user" as const, content: "Contexto sintético ".repeat(40) }));
const bounded = liveSessionBody("v=0", "tempo", largeHistory).session.input;
assert.ok(bounded.length <= 100);
assert.ok(bounded.reduce((sum, message) => sum + Buffer.byteLength(message.content[0]!.text), 0) <= 6_000);

const fragments = [fragment("user", "Eu ", 0, 50), fragment("user", "eu ", 50, 100), fragment("assistant", "Certo.", 105, 110), fragment("user", "prefiro azul.", 110, 200)];
assert.equal(liveMessages(fragments)[0]!.content, "Eu eu ", "não deduplica palavras repetidas");
assert.equal(delegationContext([], fragments, 200)?.input, "Eu eu prefiro azul.", "backchannels não quebram a pergunta");
assert.equal(delegationContext([], fragments, 100)?.input, "Eu eu", "pedido limitado ao offset disponível");
assert.equal(delegationContext([], [], 0), undefined);
assert.equal(delegationContext([], [fragments[3]!, ...fragments.slice(0, 3)], 200)?.input, "Eu eu prefiro azul.", "a pergunta segue o tempo da fala, não a ordem de chegada");
const followup = [fragment("user", "Qual é o prazo?", 0, 100), fragment("assistant", "Quinta-feira.", 150, 300), fragment("user", "E o responsável?", 350, 450)];
assert.equal(delegationContext([], followup, 450)?.input, "E o responsável?", "resposta substantiva separa perguntas próximas");
assert.deepEqual(delegationContext([], followup, 450)?.history.map((message) => message.content), ["Qual é o prazo?", "Quinta-feira."]);
const longUtterance = Array.from({ length: 2000 }, (_, i) => fragment("user", "palavra ", i * 10, i * 10 + 9));
assert.equal(delegationContext([], longUtterance, 20_000)?.input, "palavra ".repeat(2000).trim(), "fala longa preservada sem reexaminar todo o histórico a cada fragmento");
const long = "Uma explicação com acentos e 🎧. ".repeat(150) + "a".repeat(600);
assert.equal(voiceChunks(long).join(""), long);
assert.ok(voiceChunks(long).every((chunk) => Buffer.byteLength(chunk) <= 450));

{
  const h = harness();
  h.controller.ready();
  const first = transcript(h.controller, "user", "Quem é a pessoa fictícia?");
  h.controller.receive(first);
  assert.equal(h.controller.snapshot().messages.length, 1, "eventos duplicados não duplicam histórico");
  const cachedMessages = h.controller.snapshot().messages;
  assert.equal(h.controller.snapshot().messages, cachedMessages, "estado de uso/atividade reutiliza a transcrição já montada");
  delegate(h.controller);
  delegate(h.controller); // Same delegation ID, distinct event ID.
  await until(() => h.sent.some((event) => event.type === "session.commentary.append"));
  assert.equal(h.sent.filter((event) => event.type === "session.thinking.append").length, 1);
  assert.ok(h.sent.filter((event) => String(event.type).endsWith("append")).every((event) => event.delegation_id === "delegation-1"));
  transcript(h.controller, "assistant", "Resposta realmente transcrita.", 500, 900);
  assert.notEqual(h.controller.snapshot().messages, cachedMessages, "nova fala invalida o cache da transcrição");
  h.controller.receive({ type: "session.usage.updated", usage: { seconds: 12 } });
  h.controller.receive({ type: "session.usage.updated", usage: { seconds: 15 } });
  assert.equal(h.controller.snapshot().seconds, 15, "uso cumulativo substitui, não soma");
  const closed = await h.controller.close();
  assert.equal(closed.seconds, 17);
  assert.equal(closed.usageConfirmed, true);
  assert.deepEqual(h.finished.map((message) => message.content), ["Quem é a pessoa fictícia?", "Resposta realmente transcrita."]);
  assert.equal(h.disconnected, 1);
  await h.controller.close();
  assert.equal(h.disconnected, 1, "encerramento idempotente");
}

{
  let calls = 0;
  const h = harness({ query: async () => { calls++; return "Resultado confirmado após a busca"; } }, false);
  h.controller.ready();
  transcript(h.controller, "user", "Consulte a memória"); delegate(h.controller);
  await until(() => calls === 1);
  const thinking = h.sent.find((event) => event.type === "session.thinking.append")!;
  assert.ok(thinking, "consulta inicia antes da confirmação do aviso de espera");
  await delay(5);
  assert.equal(h.sent.some((event) => event.type === "session.commentary.append"), false, "resultado aguarda as duas confirmações");
  h.controller.receive({ type: "session.thinking.appended", client_event_id: thinking.event_id });
  await until(() => h.sent.some((event) => event.content === "Resultado confirmado após a busca"));
  const answer = h.sent.find((event) => event.type === "session.commentary.append")!;
  h.controller.receive({ type: "session.commentary.appended", client_event_id: answer.event_id });
  await h.controller.close();
}

{
  let querySignal: AbortSignal | undefined;
  let release!: (text: string) => void;
  const h = harness({ query: (_input, _history, signal) => {
    querySignal = signal;
    return new Promise((resolve) => { release = resolve; });
  } }, false);
  transcript(h.controller, "user", "Consulte a memória"); delegate(h.controller);
  await until(() => !!release);
  const thinking = h.sent.find((event) => event.type === "session.thinking.append")!;
  h.controller.receive({ type: "error", client_event_id: thinking.event_id });
  await until(() => querySignal!.aborted);
  release("RESULTADO APÓS FALHA DO AVISO");
  await delay(5);
  assert.equal(h.sent.some((event) => event.content === "RESULTADO APÓS FALHA DO AVISO"), false);
  await h.controller.close();
}

{
  // A query failure must be handled immediately even while thinking lacks ack.
  const h = harness({ query: async () => { throw new Error("falha sintética"); } }, false);
  transcript(h.controller, "user", "Consulte a memória"); delegate(h.controller);
  await until(() => h.sent.some((event) => event.type === "session.commentary.append"));
  assert.match(h.controller.snapshot().error!, /Não foi possível/);
  const failure = h.sent.find((event) => event.type === "session.commentary.append")!;
  assert.ok(String(failure.content).includes("não invente"));
  h.controller.receive({ type: "session.commentary.appended", client_event_id: failure.event_id });
  await h.controller.close();
}

{
  const calls: { input: string; signal: AbortSignal; resolve: (text: string) => void }[] = [];
  const h = harness({ query: (input, _history, signal) => new Promise((resolve) => { calls.push({ input, signal, resolve }); }) });
  h.controller.ready();
  transcript(h.controller, "user", "Procure o projeto fictício de sexta.");
  delegate(h.controller);
  await until(() => calls.length === 1);
  transcript(h.controller, "user", " Na verdade, de quinta.", 220, 400);
  assert.equal(calls[0]!.signal.aborted, true);
  await until(() => calls.length === 2);
  // The corrected request must start without waiting for a canceled provider.
  calls[0]!.resolve("RESULTADO ANTIGO");
  assert.ok(calls[1]!.input.includes("quinta"));
  calls[1]!.resolve("Resultado corrigido");
  await until(() => h.sent.some((event) => event.content === "Resultado corrigido"));
  assert.equal(h.sent.some((event) => event.content === "RESULTADO ANTIGO"), false);
  await h.controller.close();
}

{
  let finishQuery!: (text: string) => void;
  const h = harness({ query: () => new Promise((resolve) => { finishQuery = resolve; }) });
  transcript(h.controller, "user", "Uma consulta"); delegate(h.controller);
  await until(() => !!finishQuery);
  await h.controller.close();
  finishQuery("Resultado depois do encerramento");
  await delay(10);
  assert.equal(h.sent.some((event) => event.type === "session.commentary.append"), false);
}

{
  const h = harness({}, true, false);
  h.controller.receive({ type: "session.usage.updated", usage: { seconds: 9 } });
  const pending = h.controller.close();
  await delay(20);
  const closed = await pending;
  assert.equal(closed.usageConfirmed, false);
  assert.equal(closed.seconds, 9);
  assert.equal(h.hungup, 1, "tenta encerrar pelo controle recuperado");
}

{
  const h = harness({}, true, false);
  h.controller.ready();
  for (let i = 0; i < 20_001; i++) h.controller.receive({ type: "session.input_audio.append", event_id: "pcm-" + i, audio: "AAA=" });
  assert.equal(h.controller.snapshot().phase, "active", "pacotes PCM não esgotam o limite de contexto");
  for (let i = 0; i < 20_001; i++) h.controller.receive({ type: "synthetic-event", event_id: "limit-" + i });
  assert.equal(h.controller.snapshot().phase, "closing");
  h.controller.receive({ type: "session.closed", event_id: "terminal-after-limit", usage: { seconds: 21 } });
  const closed = await h.controller.close();
  assert.equal(closed.usageConfirmed, true, "aceita recibo final mesmo após esgotar contexto");
  assert.equal(closed.seconds, 21);
}

{
  let now = 0;
  const h = harness({ now: () => now, idleMs: 100 });
  h.controller.ready();
  now = 80;
  const pcm = Buffer.alloc(100); for (let i = 0; i < 50; i++) pcm.writeInt16LE(12_000, i * 2);
  h.controller.receive({ type: "session.output_audio.delta", delta: pcm.toString("base64") });
  now = 120; h.controller.tick();
  assert.equal(h.controller.snapshot().phase, "active", "áudio em andamento evita falso silêncio sem transcrição");
  now = 200; h.controller.tick();
  await until(() => h.controller.snapshot().phase === "closed");
  assert.equal(h.controller.snapshot().reason, "inactivity");
}
{
  let now = 0;
  const h = harness({ now: () => now });
  now = 30_001; h.controller.tick();
  await until(() => h.controller.snapshot().phase === "closed");
  assert.equal(h.controller.snapshot().reason, "connection_timeout");
}
{
  let now = 0;
  const h = harness({ now: () => now, maxMs: 100 });
  h.controller.ready(); now = 101; h.controller.tick();
  await until(() => h.controller.snapshot().phase === "closed");
  assert.equal(h.controller.snapshot().reason, "duration_limit");
}

{
  let attempts = 0;
  const h = harness({ query: async () => {
    if (++attempts === 1) throw new DecisionsError("Falha temporária sintética", "http", 429);
    return "Nova consulta concluída";
  } });
  transcript(h.controller, "user", "Primeira consulta"); delegate(h.controller);
  await until(() => !!h.controller.snapshot().error && !h.controller.snapshot().activity);
  transcript(h.controller, "user", "Uma nova consulta", 4000, 4200); delegate(h.controller, "query-recovered", 4200);
  await until(() => h.sent.some((event) => event.content === "Nova consulta concluída"));
  assert.equal(h.controller.snapshot().error, undefined, "uma nova consulta não mantém o erro da anterior");
  await h.controller.close();
}

{
  const h = harness({ query: async () => { throw new DecisionsError("A Decisions API recusou uma avaliação.", "refusal"); } });
  transcript(h.controller, "user", "Pergunta fictícia"); delegate(h.controller);
  await until(() => !!h.controller.snapshot().error);
  assert.match(h.controller.snapshot().error!, /Decisions API recusou/);
  assert.ok(h.sent.some((event) => event.type === "session.commentary.append" && String(event.content).includes("não invente")));
  await h.controller.close();
}

const request = (body: unknown) => new Request("http://127.0.0.1:3000/api/chat/voice/live", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
assert.deepEqual(await readLiveRequest(request({ action: "start", sessionId: "chat-test", sdp: "v=0\r\nfake", apiKey: "must-be-ignored" })),
  { action: "start", sessionId: "chat-test", sdp: "v=0\r\nfake" });
await assert.rejects(readLiveRequest(request({ action: "start", sessionId: "chat-test", sdp: "x".repeat(70_000) })), (error: unknown) => error instanceof LiveError && error.status === 413);
await assert.rejects(readLiveRequest(request({ action: "save-memory", sessionId: "chat-test" })));
await assert.rejects(readLiveRequest(request(null)));
for (const status of [401, 403, 404, 429, 500]) {
  let attempts = 0;
  await assert.rejects(createLiveConnection({ apiKey: "synthetic-secret", sdp: "v=0", voice: "tempo", history: [], onEvent() {}, onFailure() {},
    fetcher: async (url, init) => {
      attempts++;
      assert.equal(url, "https://api.openai.com/v1/live/sessions");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-secret");
      assert.ok(!String(init?.body).includes("synthetic-secret"));
      return Response.json({ error: { code: "credit_balance_exhausted", message: "synthetic-secret" } }, { status });
    } }), (error: unknown) => error instanceof LiveError && !error.message.includes("synthetic-secret"));
  assert.equal(attempts, 1, "criação cobrada não é repetida automaticamente");
}
assert.ok(!(await liveErrorResponse(new Error("synthetic-secret")).text()).includes("synthetic-secret"));
console.log("✓ GPT-Live: contrato, transcrições, delegação, correções, encerramento, limites, erros e sigilo; sem chamadas reais.");
