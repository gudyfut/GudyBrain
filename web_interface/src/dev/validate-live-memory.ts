import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MemoryConversation } from "@gudybrain/agents/conversante/memory-conversation";
import { createDecisionsClient } from "@gudybrain/core/decisions";
import { createResponsesProvider } from "@gudybrain/core/responses";
import { MemoryBrowser } from "@gudybrain/tools/memoria/navegador";
import type { Message } from "@gudybrain/core/glm";
import { LiveController } from "../server/live-controller";

// Real orchestration and filesystem + real HTTP/SSE parsers, fake transports only.
const root = mkdtempSync(join(tmpdir(), "gudy-live-memory-"));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await delay(5); }
  assert.fail("Fluxo local não concluiu no prazo do teste.");
}
try {
  mkdirSync(join(root, "pessoas")); mkdirSync(join(root, "grupos"));
  const person = "---\ntitle: Aster\ndescription: Integrante da equipe Aurora\n---\n# Aster\nFaz parte da equipe Aurora.\n";
  const group = "---\ntitle: Equipe Aurora\ndescription: Participantes da equipe fictícia\n---\n# Aurora\n" + "Contexto fictício.\n".repeat(500)
    + "\n## Participantes confirmados\nAster e Vega. SENTINELA_FINAL.\n";
  writeFileSync(join(root, "pessoas/aster.md"), person); writeFileSync(join(root, "grupos/aurora.md"), group);
  for (const denied of [false, true]) {
    const stages: string[] = [];
    const sent: Record<string, unknown>[] = [];
    let confirmed: (() => void) | undefined;
    let agent: MemoryConversation | undefined;
    let history: readonly Message[] = [];
    const answer = "Aster e Vega participam da equipe Aurora.";
    const evaluate = createDecisionsClient({ apiKey: "synthetic-decisions", fetch: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/decisions");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-decisions");
      assert.ok(!String(init?.body).includes("SENTINELA_FINAL"), "Decisions só recebe metadados");
      stages.push("decisions");
      if (denied) return Response.json({}, { status: 429 });
      const body = JSON.parse(String(init?.body));
      return Response.json({ answers: body.questions.map((question: { name: string }) => ({ name: question.name, type: "predicate", probability: .1 })) });
    } });
    const responses = createResponsesProvider({ accessToken: async () => "synthetic-oauth", fetch: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-oauth");
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.input[0].content);
      stages.push(payload.stage);
      const encoder = new TextEncoder();
      let text: string;
      if (payload.stage === "inspect") {
        assert.equal(payload.memory.files[0].content, person);
        assert.ok(payload.candidateFiles.some((file: { path: string }) => file.path === "grupos/aurora.md"));
        assert.equal(body.text.format.strict, true);
        text = JSON.stringify({ paths: ["grupos/aurora.md"], folders: [], query: "" });
      } else {
        assert.equal(payload.memory.files.find((file: { path: string }) => file.path === "grupos/aurora.md").content, group);
        assert.equal(payload.memory.limited, false);
        assert.equal(body.text, undefined);
        text = answer;
      }
      return new Response(new ReadableStream({ start(controller) {
        const emit = (event: unknown) => controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
        emit({ type: "response.output_text.delta", delta: text });
        const complete = () => {
          emit({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } });
          controller.close();
        };
        if (payload.stage === "inspect") complete(); else confirmed = complete;
      } }), { headers: { "Content-Type": "text/event-stream" } });
    } });
    let live!: LiveController;
    live = new LiveController({ id: "synthetic-live", history: [], settleMs: 1, closeMs: 10,
      transport: {
        send(event) {
          sent.push(event);
          queueMicrotask(() => live.receive(event.type === "session.close"
            ? { type: "session.closed", usage: { seconds: 5 } }
            : { type: String(event.type).replace(/append$/, "appended"), client_event_id: event.event_id }));
        }, disconnect() {}, async hangup() {},
      }, query: (input, context, signal, onStep) => {
        agent = new MemoryConversation({ evaluate, answer: responses, inspect: responses, browser: new MemoryBrowser(root) });
        agent.history.push(...context);
        return agent.run(input, { signal, onStep });
      }, onFinish: (messages) => { history = messages; },
    });
    try {
      live.ready();
      live.receive({ type: "session.input_transcript.delta", event_id: "input-1", delta: "Quem participa da equipe da Aster?", start_ms: 0, end_ms: 200 });
      live.receive({ type: "session.delegation.created", event_id: "request-1", offset_ms: 200, delegation: { id: "query-1", target: "client" } });
      if (denied) {
        await until(() => !!live.snapshot().error);
        assert.deepEqual(stages, ["decisions"]);
        assert.equal(agent?.history.length, 0);
        assert.ok(sent.some((event) => String(event.content).includes("não invente")));
      } else {
        await until(() => !!confirmed);
        assert.equal(sent.some((event) => event.type === "session.commentary.append"), false, "rascunho SSE não pode ser entregue à voz");
        assert.equal(agent?.history.length, 0);
        confirmed!();
        await until(() => sent.some((event) => event.content === answer));
        assert.deepEqual(stages, ["decisions", "decisions", "inspect", "answer"]);
        assert.equal(agent?.history.at(-1)?.content, answer);
        live.receive({ type: "session.output_transcript.delta", event_id: "output-1", delta: "Na equipe estão Aster e Vega.", start_ms: 500, end_ms: 900 });
      }
      await live.close();
      assert.equal(history.length, denied ? 1 : 2);
      if (!denied) assert.equal(history.at(-1)?.content, "Na equipe estão Aster e Vega.", "histórico guarda a legenda recebida, não o rascunho do backend");
      assert.equal(readFileSync(join(root, "grupos/aurora.md"), "utf8"), group, "consulta não grava memória");
    } finally { await live.close(); }
  }
  console.log("✓ Fluxo completo: fala → Decisions HTTP → documentos integrais → inspeção/Resposta SSE → confirmação → voz e histórico; falha de cota bloqueada, sem chamadas reais.");
} finally {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\gudy-live-memory-") || resolve(root).startsWith(resolve(tmpdir()) + "/gudy-live-memory-"));
  rmSync(root, { recursive: true, force: true });
}
