import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { loadEnv } from "@gudybrain/core/env";
import { resolveProjectPath } from "@gudybrain/core/project-root";

// Diagnóstico explícito com frase fictícia. Faz chamadas reais; nunca lê memórias.
loadEnv(resolveProjectPath(".env"));
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error("GEMINI_API_KEY não configurada.");
const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: "v1beta" } });
const sentence = "Olá Gudman, você está me ouvindo? Responda em uma frase curta.";
const ms = () => performance.now();
const seconds = (duration: number) => `${(duration / 1000).toFixed(2)} s`;
const show = (name: string, duration: number) => console.log(`${name}: ${seconds(duration)}`);
async function withTimeout<T>(task: Promise<T>, duration: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} não concluiu em ${duration / 1000} s.`)), duration); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function pcm16k(pcm: Buffer, rate: number): Buffer {
  assert.equal(pcm.length % 2, 0);
  const output = Buffer.alloc(Math.floor((pcm.length / 2) * 16_000 / rate) * 2);
  for (let i = 0; i < output.length / 2; i++) output.writeInt16LE(pcm.readInt16LE(Math.floor(i * rate / 16_000) * 2), i * 2);
  return output;
}

async function main(): Promise<void> {
let firstAudio: number | undefined;
const audioChunks: Buffer[] = [];
const streamStart = ms();
const stream = await ai.interactions.create({
  model: "gemini-3.8-flash-lite-tts",
  input: [{ type: "user_input", content: [{ type: "text", text: sentence }] }],
  response_format: { type: "audio" },
  generation_config: { speech_config: [{ voice: "Charon" }] },
  stream: true,
  store: false,
}, { maxRetries: 0 });
for await (const event of stream) {
  if (event.event_type === "step.delta" && event.delta.type === "audio") {
    firstAudio ??= ms();
    audioChunks.push(Buffer.from(event.delta.data ?? "", "base64"));
  }
}
assert.ok(firstAudio && audioChunks.length);
show("TTS streaming, primeiro áudio", firstAudio - streamStart);
show("TTS streaming, fim", ms() - streamStart);
const pcm = pcm16k(Buffer.concat(audioChunks), 24_000);
show("Duração do áudio de teste", pcm.length / 32);

const unaryStart = ms();
try {
  const unary = await ai.interactions.create({
    model: "gemini-3.8-flash-lite-tts",
    input: [{ type: "user_input", content: [{ type: "text", text: sentence }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: "Charon" }] },
    store: false,
  }, { maxRetries: 0 });
  assert.equal(unary.output_audio?.mime_type, "audio/wav");
  assert.equal(Buffer.from(unary.output_audio.data ?? "", "base64").toString("ascii", 0, 4), "RIFF");
  show("TTS antigo, WAV completo", ms() - unaryStart);
} catch (error) {
  console.log(`TTS antigo: falhou após ${seconds(ms() - unaryStart)} (${error instanceof Error ? error.name : "erro"}).`);
}

const tokenStart = ms();
const token = await ai.authTokens.create({ config: {
  uses: 1,
  newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
  expireTime: new Date(Date.now() + 5 * 60_000).toISOString(),
  liveConnectConstraints: { model: "gemini-3.5-transcribe-live", config: {
    responseModalities: [Modality.TEXT], inputAudioTranscription: { languageCodes: ["pt-BR"] },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
  } },
} });
assert.ok(token.name);
show("STT, token temporário", ms() - tokenStart);
const stt = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: "v1beta" } });
let session: Session | undefined;
let resolveTranscript: (() => void) | undefined;
let rejectTranscript: ((error: Error) => void) | undefined;
const transcript = new Promise<void>((resolve, reject) => { resolveTranscript = resolve; rejectTranscript = reject; });
let interimAt: number | undefined;
let finalAt: number | undefined;
const connectStart = ms();
try {
  session = await stt.live.connect({ model: "gemini-3.5-transcribe-live", config: {
    responseModalities: [Modality.TEXT], inputAudioTranscription: { languageCodes: ["pt-BR"] },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
  }, callbacks: {
    onopen: () => {},
    onmessage: (message) => {
      if (message.serverContent?.interimInputTranscription?.text) interimAt ??= ms();
      if (message.serverContent?.inputTranscription?.text) { finalAt = ms(); resolveTranscript?.(); }
    },
    onerror: () => rejectTranscript?.(new Error("Falha na conexão STT.")),
    onclose: () => rejectTranscript?.(new Error("Conexão STT encerrada.")),
  } });
  show("STT, conectar Live", ms() - connectStart);
  session.sendRealtimeInput({ activityStart: {} });
  for (let i = 0; i < pcm.length; i += 3_200) {
    session.sendRealtimeInput({ audio: { data: pcm.subarray(i, i + 3_200).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
    await pause(95);
  }
  const endAt = ms();
  session.sendRealtimeInput({ activityEnd: {} });
  await withTimeout(transcript, 15_000, "STT");
  if (interimAt) show("STT, primeira transcrição parcial após conexão", interimAt - connectStart);
  show("STT, texto final após fim da fala", finalAt! - endAt);
} finally { session?.close(); }

const liveStart = ms();
let liveSession: Session | undefined;
let resolveLive: (() => void) | undefined;
let rejectLive: ((error: Error) => void) | undefined;
const liveDone = new Promise<void>((resolve, reject) => { resolveLive = resolve; rejectLive = reject; });
let liveFirstAudio: number | undefined;
let liveEnd: number | undefined;
try {
  liveSession = await ai.live.connect({ model: "gemini-3.8-live", config: {
    responseModalities: [Modality.AUDIO], outputAudioTranscription: {},
    systemInstruction: "Responda em português do Brasil com uma frase curta.",
  }, callbacks: {
    onopen: () => {},
    onmessage: (message) => {
      if (message.serverContent?.modelTurn?.parts?.some((part) => Boolean(part.inlineData?.data))) liveFirstAudio ??= ms();
      if (message.serverContent?.turnComplete) { liveEnd = ms(); resolveLive?.(); }
    },
    onerror: () => rejectLive?.(new Error("Falha na conexão Gemini 3.8 Live.")),
    onclose: () => rejectLive?.(new Error("Conexão Gemini 3.8 Live encerrada.")),
  } });
  show("Gemini 3.8 Live, conectar", ms() - liveStart);
  const promptAt = ms();
  liveSession.sendClientContent({ turns: "Diga olá e confirme que está ouvindo.", turnComplete: true });
  await withTimeout(liveDone, 30_000, "Gemini 3.8 Live");
  assert.ok(liveFirstAudio);
  show("Gemini 3.8 Live, primeiro áudio após texto", liveFirstAudio - promptAt);
  show("Gemini 3.8 Live, conclusão", liveEnd! - promptAt);
} finally { liveSession?.close(); }

const audioLiveStart = ms();
let audioLiveSession: Session | undefined;
let resolveAudioLive: (() => void) | undefined;
let rejectAudioLive: ((error: Error) => void) | undefined;
const audioLiveDone = new Promise<void>((resolve, reject) => { resolveAudioLive = resolve; rejectAudioLive = reject; });
let audioLiveFirst: number | undefined;
let audioLiveEnd: number | undefined;
let audioLiveInputTranscriptions = 0;
let audioLiveOutputTranscriptions = 0;
try {
  audioLiveSession = await ai.live.connect({ model: "gemini-3.8-live", config: {
    responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},
    systemInstruction: "Responda em português do Brasil com uma frase curta.",
  }, callbacks: {
    onopen: () => {},
    onmessage: (message) => {
      if (message.serverContent?.inputTranscription?.text) audioLiveInputTranscriptions++;
      if (message.serverContent?.outputTranscription?.text) audioLiveOutputTranscriptions++;
      if (message.serverContent?.modelTurn?.parts?.some((part) => Boolean(part.inlineData?.data))) audioLiveFirst ??= ms();
      if (message.serverContent?.turnComplete) { audioLiveEnd = ms(); resolveAudioLive?.(); }
    },
    onerror: () => rejectAudioLive?.(new Error("Falha na conexão de áudio do Gemini 3.8 Live.")),
    onclose: () => rejectAudioLive?.(new Error("Conexão de áudio do Gemini 3.8 Live encerrada.")),
  } });
  show("Gemini 3.8 Live áudio→áudio, conectar", ms() - audioLiveStart);
  for (let i = 0; i < pcm.length; i += 3_200) {
    audioLiveSession.sendRealtimeInput({ audio: { data: pcm.subarray(i, i + 3_200).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
    await pause(95);
  }
  const endAt = ms();
  audioLiveSession.sendRealtimeInput({ audioStreamEnd: true });
  try {
    await withTimeout(audioLiveDone, 30_000, "Gemini 3.8 Live áudio→áudio");
    if (!audioLiveFirst) throw new Error("A sessão terminou sem áudio.");
    show("Gemini 3.8 Live áudio→áudio, primeiro som após fala", audioLiveFirst - endAt);
    show("Gemini 3.8 Live áudio→áudio, conclusão após fala", audioLiveEnd! - endAt);
  } catch (error) {
    console.log(`Gemini 3.8 Live áudio→áudio: inconclusivo (${error instanceof Error ? error.message : String(error)}; transcrições de entrada ${audioLiveInputTranscriptions}; de saída ${audioLiveOutputTranscriptions}).`);
  }
} finally { audioLiveSession?.close(); }
}

await main().catch((error: unknown) => {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  console.error(status === 429
    ? "Medição interrompida: cota gratuita deste modelo Gemini atingida (HTTP 429). Confira a renovação no Google AI Studio."
    : `Medição interrompida: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
