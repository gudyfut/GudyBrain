import type { RetrievalEvent } from "@gudybrain/core/retrieval-events";
import type { LiveSnapshot, LiveUpdate } from "../shared/live";

export interface LiveCall {
  stop(): Promise<void>;
  dispose(): void;
  mute(muted: boolean): void;
  resumeAudio(): Promise<void>;
}

const endpoint = "/api/chat/voice/live";

export async function startLiveVoice(options: {
  sessionId: string; signal: AbortSignal;
  onSnapshot(state: LiveSnapshot): void;
  onRetrieval(event: RetrievalEvent): void;
  onPlaybackBlocked(): void;
  onFailure(message: string): void;
  onEnded(): void;
}): Promise<LiveCall> {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    throw new Error("Este navegador não oferece voz compatível. Abra em localhost com permissão de microfone.");
  }
  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel("oai-events");
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  const eventAbort = new AbortController();
  let media: MediaStream | undefined;
  let liveId: string | undefined;
  let cleaned = false;
  let stopPromise: Promise<void> | undefined;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let startedResolve!: () => void;
  let startedReject!: (error: Error) => void;
  const started = new Promise<void>((resolve, reject) => { startedResolve = resolve; startedReject = reject; });
  // A rejection can precede the SDP exchange. Install a handler immediately.
  void started.catch(() => {});
  let peerClosedResolve!: () => void;
  const peerClosed = new Promise<void>((resolve) => { peerClosedResolve = resolve; });

  const post = async (action: "ready" | "stop", timeout = 20_000) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sessionId: options.sessionId, liveId }), signal: AbortSignal.timeout(timeout) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "A conexão de voz falhou.");
    return body;
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(disconnectTimer);
    eventAbort.abort();
    options.signal.removeEventListener("abort", dispose);
    window.removeEventListener("pagehide", dispose);
    media?.getTracks().forEach((track) => track.stop());
    audio.pause(); audio.srcObject = null;
    channel.close(); pc.close();
    startedReject(new Error("A sessão de voz foi encerrada."));
    options.onEnded();
  };

  const dispose = () => {
    if (cleaned) return;
    if (channel.readyState === "open") {
      try { channel.send(JSON.stringify({ type: "session.close" })); } catch { /* Server lease also closes it. */ }
    }
    if (liveId) {
      const body = JSON.stringify({ action: "stop", sessionId: options.sessionId, liveId });
      if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }))) {
        void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    }
    cleanup();
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    if (cleaned) return Promise.resolve();
    stopPromise = (async () => {
      media?.getTracks().forEach((track) => { track.enabled = false; });
      try {
        if (liveId) options.onSnapshot(await post("stop"));
      } catch {
        if (channel.readyState === "open") {
          try { channel.send(JSON.stringify({ type: "session.close" })); } catch { /* Cleanup below. */ }
          await waitFor(peerClosed, 5_000).catch(() => {});
        }
        options.onFailure("A voz foi interrompida. Não foi possível confirmar o consumo final no servidor.");
      } finally { cleanup(); }
    })();
    return stopPromise;
  };

  channel.addEventListener("message", (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === "session.started") startedResolve();
      if (event.type === "session.closed") peerClosedResolve();
      if (event.type === "error") { options.onFailure("A conexão de voz encontrou um erro."); void stop(); }
    } catch { options.onFailure("A conexão de voz recebeu um evento inválido."); void stop(); }
  });
  pc.addEventListener("track", (event) => {
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void audio.play().catch(() => { if (!cleaned) options.onPlaybackBlocked(); });
  });
  pc.addEventListener("connectionstatechange", () => {
    clearTimeout(disconnectTimer);
    if (cleaned) return;
    const failed = () => { options.onFailure("A conexão de áudio caiu. Inicie a conversa novamente."); void stop(); };
    if (pc.connectionState === "failed") failed();
    else if (pc.connectionState === "disconnected") disconnectTimer = setTimeout(failed, 5_000);
  });
  options.signal.addEventListener("abort", dispose, { once: true });
  window.addEventListener("pagehide", dispose);

  try {
    options.signal.throwIfAborted();
    media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (cleaned || options.signal.aborted) { media.getTracks().forEach((track) => track.stop()); throw new Error("Conexão cancelada."); }
    for (const track of media.getTracks()) pc.addTrack(track, media);
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc, options.signal);
    options.signal.throwIfAborted();
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", sessionId: options.sessionId, sdp: pc.localDescription?.sdp }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(40_000)]) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Não foi possível iniciar a voz.");
    if (typeof body.id !== "string" || typeof body.sdp !== "string") throw new Error("Resposta de conexão inválida.");
    liveId = body.id;
    if (cleaned || options.signal.aborted) { await post("stop").catch(() => {}); throw new Error("Conexão cancelada."); }

    // Register the authoritative event stream before audio starts flowing.
    const headerTimer = setTimeout(() => eventAbort.abort(), 15_000);
    let events: Response;
    try { events = await fetch(endpoint + "?" + new URLSearchParams({ sessionId: options.sessionId, liveId: body.id }), { signal: eventAbort.signal }); }
    finally { clearTimeout(headerTimer); }
    if (!events.ok || !events.body) throw new Error("Não foi possível acompanhar a conversa por voz.");
    void readEvents(events.body, eventAbort.signal, (event) => {
      if (event.type === "snapshot") {
        options.onSnapshot(event.state);
        if (event.state.phase === "closing") media?.getTracks().forEach((track) => { track.enabled = false; });
        if (event.state.phase === "closed") cleanup();
      } else if (event.type === "retrieval") options.onRetrieval(event.event);
    }).then(() => {
      if (!cleaned) { options.onFailure("O acompanhamento da voz foi desconectado."); void stop(); }
    }).catch(() => {
      if (!cleaned) { options.onFailure("A conexão com o servidor de voz foi perdida."); void stop(); }
    });
    await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
    await waitFor(started, 20_000);
    if (cleaned || options.signal.aborted) throw new Error("Conexão cancelada.");
    await post("ready");
    if (cleaned || options.signal.aborted) throw new Error("Conexão cancelada.");
    return { stop, dispose, mute: (muted) => media?.getAudioTracks().forEach((track) => { track.enabled = !muted; }),
      resumeAudio: () => audio.play() };
  } catch (error) {
    if (liveId && !cleaned) await stop();
    else cleanup();
    throw error;
  }
}

async function readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, receive: (event: LiveUpdate) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await waitFor(reader.read(), 25_000);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000) throw new Error("Voice event too large");
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) if (line) receive(JSON.parse(line));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

function waitFor<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("A conexão de voz demorou demais.")), ms); })])
    .finally(() => clearTimeout(timer));
}

function waitForIce(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", changed); signal.removeEventListener("abort", aborted); };
    const changed = () => { if (pc.iceGatheringState === "complete") { cleanup(); resolve(); } };
    const aborted = () => { cleanup(); reject(new Error("Conexão cancelada.")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Não foi possível preparar a conexão de áudio.")); }, 10_000);
    pc.addEventListener("icegatheringstatechange", changed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted(); else changed();
  });
}
