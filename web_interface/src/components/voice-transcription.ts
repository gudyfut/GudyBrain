import { GoogleGenAI, Modality, type Session } from "@google/genai";

export interface VoiceCapture {
  stop(): Promise<string>;
  cancel(): void;
}

const model = "gemini-3.5-transcribe-live";

export async function startVoiceTranscription(chatSessionId: string, onDraft: (text: string) => void, onFailure: (message: string) => void): Promise<VoiceCapture> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    throw new Error("Este navegador não oferece captura de áudio compatível. Use HTTPS ou localhost em um navegador atualizado.");
  }
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let session: Session | undefined;
  let closed = false;
  let stopping = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveStop: ((text: string) => void) | undefined;
  let rejectStop: ((error: Error) => void) | undefined;
  let resolveFlushed: (() => void) | undefined;
  const finalized: string[] = [];
  let interim = "";

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (stopTimer) clearTimeout(stopTimer);
    worklet?.disconnect();
    source?.disconnect();
    worklet?.port.close();
    stream?.getTracks().forEach((track) => track.stop());
    void context?.close();
    session?.close();
  };
  const fail = (message: string): void => {
    rejectStop?.(new Error(message));
    onFailure(message);
    cleanup();
  };

  try {
    // Ative o contexto durante o gesto do clique; navegadores bloqueiam resume tardio.
    context = new AudioContext();
    await context.resume();
    // A permissão é solicitada pelo clique no microfone, antes de qualquer conexão externa.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const response = await fetch("/api/chat/voice/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: chatSessionId }) });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) throw new Error(data.error ?? "Não foi possível autorizar a transcrição.");
    const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: "v1beta" } });
    session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: { languageCodes: ["pt-BR"] },
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      },
      callbacks: {
        onopen: () => {},
        onmessage: (message) => {
          const content = message.serverContent;
          if (content?.interimInputTranscription?.text) {
            interim = content.interimInputTranscription.text;
            onDraft([...finalized, interim].join(" ").trim());
          }
          if (content?.inputTranscription?.text) {
            finalized.push(content.inputTranscription.text.trim());
            interim = "";
            const transcript = finalized.join(" ").trim();
            onDraft(transcript);
            if (stopping && resolveStop) { resolveStop(transcript); cleanup(); }
          }
        },
        onerror: () => fail("A conexão de transcrição falhou. Tente novamente."),
        onclose: () => { if (!closed) fail("A conexão de transcrição foi encerrada."); },
      },
    });
    session.sendRealtimeInput({ activityStart: {} });

    await context.audioWorklet.addModule("/voice-pcm-worklet.js");
    source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, "voice-pcm");
    worklet.port.onmessage = (event: MessageEvent<{ type: "pcm"; buffer: ArrayBuffer } | { type: "flushed" }>) => {
      if (event.data.type === "flushed") { resolveFlushed?.(); return; }
      if (closed || !session) return;
      try {
        const bytes = new Uint8Array(event.data.buffer);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        session.sendRealtimeInput({ audio: { data: btoa(binary), mimeType: "audio/pcm;rate=16000" } });
      } catch { fail("Não foi possível transmitir o áudio capturado."); }
    };
    source.connect(worklet);
    worklet.connect(context.destination);
    await context.resume();
    return {
      stop: async () => {
        if (closed) return Promise.reject(new Error("A gravação já foi encerrada."));
        if (stopping) return Promise.reject(new Error("A transcrição já está sendo finalizada."));
        stopping = true;
        source?.disconnect();
        stream?.getTracks().forEach((track) => track.stop());
        if (worklet) {
          const flushed = new Promise<void>((resolve) => { resolveFlushed = resolve; });
          worklet.port.postMessage({ type: "flush" });
          await Promise.race([flushed, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
          resolveFlushed = undefined;
          worklet.disconnect();
        }
        return new Promise<string>((resolve, reject) => {
          resolveStop = resolve;
          rejectStop = reject;
          stopTimer = setTimeout(() => {
            const transcript = finalized.join(" ").trim();
            if (transcript) resolve(transcript);
            else reject(new Error("Não recebi uma transcrição. Tente falar novamente."));
            cleanup();
          }, 10_000);
          try { session?.sendRealtimeInput({ activityEnd: {} }); }
          catch { fail("Não foi possível finalizar a transcrição."); }
        });
      },
      cancel: () => { rejectStop?.(new Error("Transcrição cancelada.")); cleanup(); },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
