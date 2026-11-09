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
    const audioContext = new AudioContext();
    const media = audioContext.createMediaStreamDestination().stream;
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
        const event = new Event("track"); event.streams = [media]; this.dispatchEvent(event);
      }
      close() { state.peersClosed++; this.connectionState = "closed"; }
    };
  });
  await page.goto((process.env.CHAT_TEST_URL || "http://127.0.0.1:3100") + "/chat");
  const start = page.getByRole("button", { name: "Iniciar conversa ao vivo", exact: true });
  await start.waitFor();
  await start.click();
  await page.getByText("Conversa ao vivo", { exact: true }).waitFor();
  assert.equal(await page.getByPlaceholder("Fale com Gudman…").isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Memorizar", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Silenciar microfone" }).click();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getAudioTracks()[0].enabled), false);
  await page.getByText("A sessão continua ativa e consumindo créditos.").waitFor();
  await page.getByRole("button", { name: "Ativar microfone" }).click();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getAudioTracks()[0].enabled), true);
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
  await page.getByRole("button", { name: "Encerrar", exact: true }).click();
  await page.getByText(/Voz encerrada.*duração confirmada/).waitFor();
  assert.equal(await page.getByPlaceholder("Fale com Gudman…").isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Memorizar", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended")), true);
  assert.equal(await page.locator(".message").count(), 2);
  await page.evaluate(() => { window.__liveTest.blockPlayback = true; });
  await start.click();
  await page.getByRole("button", { name: "Ativar som", exact: true }).waitFor();
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
  await start.click();
  await page.getByText("Conversa ao vivo", { exact: true }).waitFor();
  await page.evaluate(() => window.__liveTest.disconnect());
  await page.getByText(/acompanhamento da voz foi desconectado/).waitFor();
  await page.waitForFunction(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended"));
  await start.click();
  await page.getByText("Conversa ao vivo", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await page.getByText("Uma ideia. Novas conexões.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__liveTest.currentMedia.getTracks().every((track) => track.readyState === "ended")), true);
  assert.deepEqual(errors, []);
  console.log("✓ GPT-Live UI: desktop/mobile, legendas, mute, fim, inatividade, autoplay, permissão, cota, queda e nova conversa. Capturas: " + output);
} finally { await browser.close(); }
