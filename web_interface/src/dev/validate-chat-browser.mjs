import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Servidor Next local + Playwright disponível no ambiente de desenvolvimento.
// Fetch de chat é simulado no navegador: nenhuma API de modelo é chamada.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = mkdtempSync(join(tmpdir(), "gudy-chat-ui-"));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (url === "/api/chat/session") return Response.json({ id: crypto.randomUUID(), model: "modelo simulado" });
      if (url === "/api/chat/voice/speech") {
        const body = JSON.parse(options.body);
        if (body.text !== "Resposta simulada com contexto selecionado.") throw new Error("TTS recebeu texto divergente da resposta.");
        window.__voiceStreamDone = false;
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new Uint8Array(48_000)); // Primeiro segundo de PCM mono 24 kHz.
          setTimeout(() => { controller.enqueue(new Uint8Array(48_000)); controller.close(); window.__voiceStreamDone = true; }, 500);
        } }), { headers: { "Content-Type": "audio/L16;rate=24000;channels=1" } });
      }
      if (url === "/api/memory/atlas") return Response.json({ chars: 2000, nodes: [
        {path:"social", title:"Pessoas e relações", kind:"folder"}, {path:"projetos", title:"Projetos", kind:"folder"},
        ...Array.from({length:24},(_,i)=>({path:`${i < 16 ? "social" : "projetos"}/registro-${i}.md`, title:["Ana · pesquisa", "Bruno · design", "Clara · música"][i] ?? `Conexão ${i + 1}`, kind:"file", description:"Uma memória fictícia para validação visual."}))
      ] });
      if (String(url).startsWith("/api/memory?path=")) return Response.json({ content: "# Memória fictícia\nConteúdo atual carregado apenas para inspeção." });
      if (url !== "/api/chat/message") return original(url, options);
      const message = JSON.parse(options.body).message;
      const trace = (event) => ({ type: "retrieval", event });
      const folders = [{ path: "social", title: "Pessoas e relações", kind: "folder" }, { path: "projetos", title: "Projetos", kind: "folder" }];
      const files = message.includes("grande") ? Array.from({ length: 150 }, (_, i) => ({ path: `social/registro-${i}.md`, title: `Registro ${i}`, kind: "file" }))
        : [{ path: "social/ana.md", title: "Ana · pesquisa", kind: "file" }, { path: "social/bruno.md", title: "Bruno · design", kind: "file" }, { path: "social/clara.md", title: "Clara · música", kind: "file" }];
      const events = [trace({ phase: "gate" }), trace({ phase: "index", nodes: [...folders, ...files], chars: 2000 }), trace({ phase: "decision", searched: !message.includes("sem busca"), probability: .94, threshold: .5, reason: "Probabilidade acima do limiar" })];
      if (!message.includes("sem busca")) events.push(
        trace({ phase: "folder", path: "" }), trace({ phase: "discovered", parent: "", nodes: folders }),
        trace({ phase: "evaluated", parent: "", nodes: folders.map((node, i) => ({ ...node, probability: i ? .12 : .95, accepted: !i })) }),
        trace({ phase: "folder", path: "projetos" }), trace({ phase: "folder", path: "social" }), trace({ phase: "discovered", parent: "social", nodes: files }),
        trace({ phase: "evaluated", parent: "social", nodes: files.map((node, i) => ({ ...node, probability: i === 1 ? .2 : .91, accepted: i !== 1 })) }),
        trace({ phase: "selected", path: files[0].path, chars: 4321, source: "jev" }), trace({ phase: "selected", path: files[2].path, chars: 2100, source: "jev" }),
        trace({ phase: "complete", files: 2, limited: message.includes("grande") }),
      );
      if (message.includes("falha")) events.push({ type: "error", message: "Falha simulada do Jev" });
      else events.push(trace({ phase: "answer" }), { type: "content", content: "Resposta simulada com contexto selecionado." }, { type: "done" });
      let timer;
      let index = 0;
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          const stop = () => { clearTimeout(timer); try { controller.error(new DOMException("Cancelado", "AbortError")); } catch {} };
          options.signal?.addEventListener("abort", stop, { once: true });
          const next = () => {
            if (options.signal?.aborted) return stop();
            if (index === events.length) { options.signal?.removeEventListener("abort", stop); controller.close(); return; }
            controller.enqueue(encoder.encode(JSON.stringify(events[index++]) + "\n"));
            timer = setTimeout(next, message.includes("lento") ? 500 : 80);
          };
          next();
        }, cancel() { clearTimeout(timer); },
      }), { headers: { "Content-Type": "application/x-ndjson" } });
    };
  });
  await page.goto(`${process.env.CHAT_TEST_URL || "http://127.0.0.1:3100"}/chat`);
  const input = page.getByPlaceholder("Fale com Gudman…");
  const send = async (text) => { await input.fill(text); await page.getByRole("button", { name: "Enviar", exact: true }).click(); };
  await page.locator(".atlas-node").nth(1).waitFor();
  assert.equal(await page.locator(".atlas-node").count(), 2, "mapa inicial exibe as ramificações sem amontoar todos os arquivos");
  await page.getByRole("button", { name: /Pessoas e relações, inspecionar memória/ }).click();
  assert.equal(await page.locator(".atlas-node").count(), 18, "ramificação revela seus arquivos");
  await page.getByRole("button", { name: "Recolher memórias" }).click();
  assert.equal(await page.locator(".atlas-node").count(), 2, "ramificação pode ser recolhida");
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await page.waitForTimeout(750); // Aguarda a entrada visual dos nós.
  await page.screenshot({ path: join(output, "desktop-idle.png") });
  await send("Mostre as pessoas · lento");
  await page.locator(".atlas-node.selected").first().waitFor();
  await page.screenshot({ path: join(output, "desktop-search.png") });
  await page.getByText("Resposta simulada com contexto selecionado.", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Interromper"]'));
  assert.equal(await page.getByRole("button", { name: "Iniciar gravação de voz" }).isEnabled(), true, "microfone disponível no chat pronto");
  await page.getByRole("button", { name: "Ouvir", exact: true }).click();
  await page.getByRole("button", { name: "Parar áudio", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__voiceStreamDone), false, "reprodução deve começar antes de receber todo o TTS");
  await page.getByRole("button", { name: "Parar áudio", exact: true }).click();
  await page.getByRole("button", { name: "Ouvir", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ana · pesquisa, selecionado" }).click();
  assert.ok((await page.locator(".atlas-inspector").innerText()).includes("social/ana.md"));
  assert.ok((await page.locator(".atlas-decision").innerText()).includes("94%"));
  await page.getByRole("button", { name: "Abrir documento atual" }).click();
  await page.getByText("Conteúdo atual carregado apenas para inspeção.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await page.getByRole("button", { name: "Aumentar grafo" }).click();
  assert.equal(await page.getByRole("button", { name: "Restaurar zoom" }).innerText(), "120%");
  await page.getByText("Percurso · 3 pastas", { exact: true }).click();
  assert.equal(await page.locator(".atlas-steps li").count(), 3);

  const handle = page.getByRole("button", { name: /Mover conversa/ });
  const before = await page.locator(".floating-chat").boundingBox();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 50, grip.y + 20); await page.mouse.down(); await page.mouse.move(grip.x - 220, grip.y - 120, { steps: 12 }); await page.mouse.up();
  const after = await page.locator(".floating-chat").boundingBox();
  assert.ok(after.x < before.x - 100 && after.y < before.y, "janela deve acompanhar o arraste");
  await handle.focus(); await page.keyboard.press("ArrowLeft");
  assert.ok((await page.locator(".floating-chat").boundingBox()).x < after.x, "movimento por teclado");
  await page.getByRole("button", { name: "Restaurar posição da conversa" }).click();
  const draggable = page.getByRole("button", { name: /Pessoas e relações, inspecionar memória/ });
  const initialNode = await draggable.getAttribute("transform");
  const initialEdge = await page.locator('.atlas-link[data-path="social"] > path').first().getAttribute("d");
  const nodeBox = await draggable.boundingBox();
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 115, nodeBox.y + 85, { steps: 12 });
  await page.mouse.up();
  assert.notEqual(await draggable.getAttribute("transform"), initialNode, "nó deve acompanhar o ponteiro");
  assert.notEqual(await page.locator('.atlas-link[data-path="social"] > path').first().getAttribute("d"), initialEdge, "aresta deve acompanhar o nó");
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "", "arrastar não seleciona texto");
  await page.getByRole("button", { name: "Centralizar núcleo e restaurar posições" }).click();
  assert.notEqual(await draggable.getAttribute("transform"), undefined);
  for (let i = 0; i < 8; i++) {
    const empty = await page.locator(".atlas-svg").boundingBox();
    await page.mouse.move(empty.x + 16, empty.y + 16);
    await page.mouse.down(); await page.mouse.move(empty.x + 19 + i, empty.y + 17 + i); await page.mouse.up();
  }
  assert.deepEqual(errors, [], "soltar o ponteiro rapidamente não pode causar TypeError");
  const camera = await page.locator(".atlas-camera").getAttribute("transform");
  const area = await page.locator(".atlas-svg").boundingBox();
  await page.mouse.move(area.x + area.width * .65, area.y + 20); await page.mouse.down(); await page.mouse.move(area.x + area.width * .65 + 70, area.y + 65, { steps: 6 }); await page.mouse.up();
  assert.notEqual(await page.locator(".atlas-camera").getAttribute("transform"), camera, "pan do grafo");
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(150);
  assert.notEqual(await page.getByRole("button", { name: "Restaurar zoom" }).innerText(), "120%", "zoom pela roda");
  const fixedCamera = await page.locator(".atlas-camera").getAttribute("transform");
  const fixedBox = await page.locator(".atlas-svg").getAttribute("viewBox");
  const rootPosition = () => page.locator(".atlas-core").evaluate((node) => { const point = new DOMPoint(0, 0).matrixTransform(node.getScreenCTM()); return { x: point.x, y: point.y }; });
  const fixedRoot = await rootPosition();
  const verifyCamera = async () => {
    assert.equal(await page.locator(".atlas-camera").getAttribute("transform"), fixedCamera, "mensagem/histórico não deve zerar pan/zoom");
    assert.equal(await page.locator(".atlas-svg").getAttribute("viewBox"), fixedBox, "quantidade de nós não deve reenquadrar câmera");
    assert.deepEqual(await rootPosition(), fixedRoot, "núcleo deve permanecer no mesmo ponto da tela");
  };
  assert.equal(await page.locator('.atlas-link.final-path').count(), 3, "arquivos escolhidos e ancestral comum em dourado");
  assert.equal(await page.locator('.atlas-link.chosen:not(.final-path)[data-path="projetos"]').count(), 1, "pasta apenas explorada permanece verde");
  assert.equal(await page.locator('.atlas-link.final-path > path').first().evaluate((node) => getComputedStyle(node).stroke), "rgb(239, 198, 109)");

  await send("sem busca");
  await verifyCamera();
  await page.waitForFunction(() => document.querySelectorAll(".message.assistant").length === 2 && !document.querySelector('[aria-label="Interromper"]'));
  await verifyCamera();
  assert.equal(await page.locator(".atlas-link.final-path").count(), 0);
  assert.ok((await page.locator(".atlas-decision").innerText()).includes("NÃO"));
  await page.locator(".message-moment").first().click();
  assert.ok((await page.locator(".atlas-decision").innerText()).includes("SIM"));
  assert.ok((await page.locator(".atlas-status").innerText()).includes("HISTÓRICO"));
  assert.equal(await page.locator(".atlas-node.selected").count(), 2);
  assert.equal(await page.locator(".atlas-link.final-path").count(), 3);
  await verifyCamera();
  await page.getByRole("button", { name: "Próximo percurso" }).click();
  await verifyCamera();
  assert.equal(await page.locator(".atlas-link.final-path").count(), 0);
  assert.ok((await page.locator(".atlas-decision").innerText()).includes("NÃO"));
  await send("lento");
  await page.locator(".message-moment").first().click();
  await page.waitForTimeout(750);
  assert.ok((await page.locator(".atlas-status").innerText()).includes("HISTÓRICO"), "eventos ao vivo não roubam o snapshot selecionado");
  await page.getByRole("button", { name: "Interromper", exact: true }).click();
  await page.getByRole("button", { name: "Busca cancelada", exact: true }).waitFor();
  await send("falha");
  await page.getByText("Falha simulada do Jev", { exact: true }).waitFor();
  assert.ok((await page.locator(".atlas-status").innerText()).includes("Busca interrompida"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: join(output, "mobile-search.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "overflow horizontal da página");
  const mobilePanel = await page.locator(".floating-chat").boundingBox();
  assert.ok(mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 390, "janela contida após resize");
  await page.getByRole("button", { name: "Recolher conversa" }).click();
  await page.getByRole("button", { name: "Expandir conversa" }).click();
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await page.getByText("Uma ideia. Novas conexões.", { exact: true }).waitFor();
  assert.equal(await page.locator(".message").count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await send("grande");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Interromper"]'));
  assert.equal(await page.locator(".atlas-node").count(), 4, "percurso extenso exibe ramificações e arquivos finais");
  await verifyCamera();
  assert.ok((await page.locator(".atlas-warning").innerText()).includes("parcial"));
  await page.getByRole("textbox", { name: "Localizar memória no grafo" }).fill("Registro 149");
  await page.locator(".atlas-results button").click();
  assert.ok((await page.locator(".atlas-inspector").innerText()).includes("registro-149.md"));
  assert.equal(await page.locator(".atlas-node").count(), 152, "busca expande a ramificação do arquivo encontrado");
  assert.deepEqual(errors, []);
  console.log(`✓ Atlas: desktop/mobile, janela arrastável/teclado/resize, zoom/pan, snapshots e eventos ao vivo, leitura, busca, falha, cancelamento, nova sessão e 153 nós. Capturas: ${output}`);
} finally { await browser.close(); }
