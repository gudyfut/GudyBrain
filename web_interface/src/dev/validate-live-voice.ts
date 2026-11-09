import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { Message } from "@gudybrain/core/glm";
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
const long = "Uma explicação com acentos e 🎧. ".repeat(150) + "a".repeat(600);
assert.equal(voiceChunks(long).join(""), long);
assert.ok(voiceChunks(long).every((chunk) => Buffer.byteLength(chunk) <= 450));

{
  const h = harness();
  h.controller.ready();
  const first = transcript(h.controller, "user", "Quem é a pessoa fictícia?");
  h.controller.receive(first);
  assert.equal(h.controller.snapshot().messages.length, 1, "eventos duplicados não duplicam histórico");
  delegate(h.controller);
  delegate(h.controller); // Same delegation ID, distinct event ID.
  await until(() => h.sent.some((event) => event.type === "session.commentary.append"));
  assert.equal(h.sent.filter((event) => event.type === "session.thinking.append").length, 1);
  assert.ok(h.sent.filter((event) => String(event.type).endsWith("append")).every((event) => event.delegation_id === "delegation-1"));
  transcript(h.controller, "assistant", "Resposta realmente transcrita.", 500, 900);
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
  const calls: { input: string; signal: AbortSignal; resolve: (text: string) => void }[] = [];
  const h = harness({ query: (input, _history, signal) => new Promise((resolve) => { calls.push({ input, signal, resolve }); }) });
  h.controller.ready();
  transcript(h.controller, "user", "Procure o projeto fictício de sexta.");
  delegate(h.controller);
  await until(() => calls.length === 1);
  transcript(h.controller, "user", " Na verdade, de quinta.", 220, 400);
  assert.equal(calls[0]!.signal.aborted, true);
  calls[0]!.resolve("RESULTADO ANTIGO"); // Simulate a provider that ignores cancellation.
  await until(() => calls.length === 2);
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
