import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = mkdtempSync(join(tmpdir(), "gudy-live-ui-"));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Only synthetic state is supplied to the page. No OpenAI/Gemini or real mic.
  await page.route(/https:\/\/(api\.openai\.com|.*googleapis\.com)\//, (route) => route.abort());
  await page.addInitScript(() => {
    window.__liveTest = { starts: 0, stops: 0, peersClosed: 0, microphoneDenied: false, blockPlayback: false, httpError: false };
    const state = window.__liveTest;
    navigator.sendBeacon = () => { state.beacons = (state.beacons ?? 0) + 1; return true; };
    let liveSnapshot;
    let streamController;
    const encoder = new TextEncoder();
    const publish = () => streamController?.enqueue(encoder.encode(JSON.stringify({ type: "snapshot", state: liveSnapshot }) + "\n"));
    state.say = () => {
      liveSnapshot = { ...liveSnapshot, seconds: 25, activity: null, messages: [
        { id: liveSnapshot.id + "-user", role: "user", content: "Qual é o prazo do projeto fictício?" },
        { id: liveSnapshot.id + "-assistant", role: "assistant", content: "O prazo fictício é quinta-feira." },
      ] }; publish();
    };
    state.longTranscript = () => {
      liveSnapshot = { ...liveSnapshot, messages: Array.from({ length: 20 }, (_, i) => ({ id: liveSnapshot.id + '-long-' + i,
        role: i % 2 ? 'assistant' : 'user', content: `Mensagem fictícia ${i}. ` + 'Uma conversa longa para verificar a leitura do histórico. '.repeat(3) })) }; publish();
    };
    state.append = () => { liveSnapshot = { ...liveSnapshot, messages: [...liveSnapshot.messages,
      { id: liveSnapshot.id + '-new', role: 'assistant', content: 'Uma nova fala enquanto você lê o histórico.' }] }; publish(); };
    state.disconnect = () => { streamController.close(); streamController = undefined; };
    state.expire = () => { liveSnapshot = { ...liveSnapshot, phase: "closed", reason: "inactivity", usageConfirmed: true }; publish(); };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (url === "/api/chat/session") return Response.json({ id: "chat-synthetic", model: "modelo simulado" });
      if (url === "/api/memory/atlas") return Response.json({ nodes: [], chars: 0 });
      if (String(url).startsWith("/api/chat/voice/live?")) return new Response(new ReadableStream({
        start(controller) { streamController = controller; publish(); },
        cancel() { streamController = undefined; },
      }), { headers: { "Content-Type": "application/x-ndjson" } });
      if (url !== "/api/chat/voice/live") return realFetch(url, options);
      const body = JSON.parse(options.body);
      if (body.action === "start") {
        if (state.httpError) return Response.json({ error: "Os créditos de API acabaram." }, { status: 429 });
        state.starts++;
        liveSnapshot = { id: "voice-" + state.starts, phase: "connecting", messages: [], activity: null, seconds: 0, usageConfirmed: false };
        return Response.json({ id: liveSnapshot.id, sdp: "fake-answer" }, { status: 201 });
      }
      if (body.action === "ready") { liveSnapshot.phase = "active"; publish(); return Response.json({ ok: true }); }
      state.stops++;
      liveSnapshot = { ...liveSnapshot, phase: "closed", reason: "user", seconds: 30, usageConfirmed: true };
      publish(); return Response.json(liveSnapshot);
    };
    const NativeAudioContext = window.AudioContext;
    const audioContext = new NativeAudioContext();
    const input = audioContext.createGain(), output = audioContext.createGain();
    const inputSink = audioContext.createMediaStreamDestination(), outputSink = audioContext.createMediaStreamDestination();
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 220; input.gain.value = 0; output.gain.value = 0;
    oscillator.connect(input); oscillator.connect(output); input.connect(inputSink); output.connect(outputSink); oscillator.start();
    const media = inputSink.stream;
    state.levels = async (mic, speaker) => { await audioContext.resume(); input.gain.value = mic; output.gain.value = speaker; };
    state.activity = (activity) => { liveSnapshot = { ...liveSnapshot, activity }; publish(); };
    state.activeMeters = 0;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { if (state.failMeter) throw new Error("Analyser unavailable"); super(...args); state.activeMeters++; }
      close() { state.activeMeters--; return super.close(); }
    };
    state.media = media;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      if (state.microphoneDenied) throw new DOMException("Microfone não autorizado", "NotAllowedError");
      const stream = media.clone(); state.currentMedia = stream; return stream;
    } });
    HTMLMediaElement.prototype.play = function () { return state.blockPlayback ? Promise.reject(new Error("Autoplay blocked")) : Promise.resolve(); };
    class FakeChannel extends EventTarget {
      readyState = "open";
      send(value) { if (JSON.parse(value).type === "session.close") state.emergencyClose = true; }
      close() { this.readyState = "closed"; }
    }
    window.RTCPeerConnection = class extends EventTarget {
      iceGatheringState = "complete";
      connectionState = "connected";
      channel = new FakeChannel();
      createDataChannel() { return this.channel; }
      addTrack() {}
      async createOffer() { return { type: "offer", sdp: "v=0\r\nfake" }; }
      async setLocalDescription(value) { this.localDescription = value; }
      async setRemoteDescription() {
        if (!state.waitForStart) this.channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "session.started" }) }));
        const event = new Event("track"); event.streams = [outputSink.stream]; this.dispatchEvent(event);
      }
      close() { state.peersClosed++; this.connectionState = "closed"; }
    };
  });
  await page.goto((process.env.CHAT_TEST_URL || "http://127.0.0.1:3100") + "/chat");
  const start = page.getByRole("button", { name: "Iniciar conversa ao vivo", exact: true });
  await start.waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Iniciar conversa ao vivo"]')?.disabled);
  await page.screenshot({ path: join(output, "voice-idle.png") });
  await start.click();
  await page.getByText("Conversa ao vivo", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.voice-stage')?.getAttribute('data-state') === 'listening');
  await page.evaluate(() => window.__liveTest.levels(.08, 0));
  await page.getByRole("heading", { name: "Estou ouvindo você" }).waitFor();
  assert.ok(Number(await page.locator('.voice-orb').evaluate((el) => el.style.getPropertyValue('--voice-energy'))) > .1, "esfera recebe amplitude real do microfone sintético");
  await page.screenshot({ path: join(output, "voice-user.png") });
  await page.evaluate(() => window.__liveTest.levels(0, .1));
  await page.getByRole("heading", { name: "Gudman está falando" }).waitFor();
  await page.screenshot({ path: join(output, "voice-assistant.png") });
  await page.evaluate(() => window.__liveTest.levels(0, 0));
  await page.getByRole("heading", { name: "Pode falar, estou ouvindo" }).waitFor();
  await page.evaluate(() => window.__liveTest.activity("Consultando a memória"));
  await page.getByRole("heading", { name: "Conectando as memórias" }).waitFor();
  await page.evaluate(() => window.__liveTest.activity(null));
  assert.equal(await page.getByPlaceholder("Fale com Gudman…").isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Memorizar", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Silenciar microfone" }).click();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getAudioTracks()[0].enabled), false);
  await page.getByText("A sessão continua ativa e consumindo créditos.").waitFor();
  await page.getByRole("button", { name: "Ativar microfone" }).click();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getAudioTracks()[0].enabled), true);
  // The orb itself is a keyboard-operable microphone button.
  await page.getByRole("button", { name: "Pausar escuta pela esfera" }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getAudioTracks()[0].enabled), false);
  await page.getByRole("button", { name: "Retomar escuta pela esfera" }).click();
  await page.evaluate(() => window.__liveTest.longTranscript());
  await page.waitForFunction(() => { const stream = document.querySelector('.message-stream'); return document.querySelectorAll('.message').length === 20 && stream.scrollHeight - stream.scrollTop - stream.clientHeight < 10; });
  await page.locator('.message-stream').hover();
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(400);
  const readingPosition = await page.locator('.message-stream').evaluate((el) => el.scrollTop);
  await page.evaluate(() => window.__liveTest.append());
  await page.waitForFunction(() => document.querySelectorAll('.message').length === 21);
  await page.waitForTimeout(300);
  assert.ok(Math.abs(await page.locator('.message-stream').evaluate((el) => el.scrollTop) - readingPosition) < 3, "novas falas não roubam a posição de leitura");
  await page.mouse.wheel(0, 10000);
  await page.waitForFunction(() => { const el = document.querySelector('.message-stream'); return el.scrollHeight - el.scrollTop - el.clientHeight < 10; });
  await page.evaluate(() => window.__liveTest.say());
  await page.getByText("O prazo fictício é quinta-feira.", { exact: true }).waitFor();
  await page.waitForTimeout(400); // Finish the existing message entrance animation.
  await page.screenshot({ path: join(output, "live-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, "live-mobile.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.ok((await page.locator(".message-stream").boundingBox()).height > 100, "legendas continuam legíveis no celular");
  await page.evaluate(() => window.__liveTest.levels(0, .1));
  await page.getByRole("heading", { name: "Gudman está falando" }).waitFor();
  assert.equal(await page.locator('.voice-orb').evaluate((el) => getComputedStyle(el).transform), "none", "redução de movimento também desativa reação de escala ao áudio");
  assert.equal(await page.locator('.orb-current').first().evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.evaluate(() => window.__liveTest.levels(0, 0));
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    for (const selector of [".voice-orb", ".end-call", ".docked-chat"]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height, selector + " visível no viewport reduzido");
    }
    const streamBox = await page.locator('.message-stream').boundingBox();
    const lastMessage = await page.locator('.message.assistant').last().boundingBox();
    assert.ok(lastMessage.y < streamBox.y + streamBox.height && lastMessage.y + lastMessage.height <= streamBox.y + streamBox.height + 2, "última fala continua visível após resize");
    await page.screenshot({ path: join(output, `voice-${viewport.width}x${viewport.height}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Switching to memory and back keeps the call and transcript alive.
  const startsBeforeNavigation = await page.evaluate(() => window.__liveTest.starts);
  await page.getByRole("button", { name: "Memória", exact: true }).click();
  await page.getByRole("button", { name: "Voltar à conversa" }).click();
  assert.equal(await page.evaluate(() => window.__liveTest.starts), startsBeforeNavigation);
  assert.equal(await page.locator(".message").count(), 2);
  await page.getByRole("button", { name: "Encerrar", exact: true }).click();
  await page.getByText(/Voz encerrada.*duração confirmada/).waitFor();
  assert.equal(await page.getByPlaceholder("Fale com Gudman…").isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Memorizar", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended")), true);
  assert.equal(await page.evaluate(() => window.__liveTest.activeMeters), 0, "encerra o AudioContext da visualização");
  assert.equal(await page.locator(".message").count(), 2);
  await page.evaluate(() => { window.__liveTest.blockPlayback = true; });
  await start.click();
  await page.getByRole("button", { name: "Ativar som", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Ative o som para me ouvir" }).waitFor();
  await page.evaluate(() => { window.__liveTest.blockPlayback = false; });
  await page.getByRole("button", { name: "Ativar som", exact: true }).click();
  await page.evaluate(() => window.__liveTest.expire());
  await page.getByText(/por inatividade/).waitFor();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended")), true);
  await page.evaluate(() => { window.__liveTest.microphoneDenied = true; });
  await start.click();
  await page.getByText("Microfone não autorizado", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__liveTest.starts), 2, "sem conexão paga antes de autorizar microfone");
  await page.evaluate(() => { window.__liveTest.microphoneDenied = false; window.__liveTest.httpError = true; });
  await start.click();
  await page.getByText("Os créditos de API acabaram.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended")), true);
  await page.evaluate(() => { window.__liveTest.httpError = false; });
  await page.evaluate(() => { window.__liveTest.waitForStart = true; });
  await start.click();
  await page.getByRole("button", { name: "Cancelar conexão", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.live-voice-active'));
  await page.evaluate(() => { window.__liveTest.waitForStart = false; });
  await page.evaluate(() => { window.__liveTest.failMeter = true; });
  await start.click();
  await page.getByText("Conversa ao vivo", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__liveTest.activeMeters), 0, "falha do analisador visual não impede a chamada");
  await page.evaluate(() => window.__liveTest.disconnect());
  await page.getByText(/acompanhamento da voz foi desconectado/).waitFor();
  await page.waitForFunction(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended"));
  await start.click();
  await page.getByText("Conversa ao vivo", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await page.getByText("Uma ideia. Novas conexões.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended")), true);
  assert.equal(await page.evaluate(() => window.__liveTest.activeMeters), 0);
  assert.deepEqual(errors, []);
  console.log("✓ GPT-Live UI: esfera reativa a dois fluxos de áudio, teclado, movimento reduzido, desktop/mobile/paisagem, memória, legendas, mute, fim, inatividade, autoplay, permissão, cota, queda e limpeza. Capturas: " + output);
} finally { await browser.close(); }
