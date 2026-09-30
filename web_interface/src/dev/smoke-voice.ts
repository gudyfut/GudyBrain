import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { loadEnv } from "@gudybrain/core/env";
import { resolveProjectPath } from "@gudybrain/core/project-root";

// Diagnóstico explícito: faz duas chamadas reais com frase sintética, sem memória pessoal.
loadEnv(resolveProjectPath(".env"));
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error("GEMINI_API_KEY não configurada.");

const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: "v1beta" } });
const sentence = "Olá, este é um teste de conversa por voz do Gudman.";
const speech = await ai.interactions.create({
  model: "gemini-3.8-flash-lite-tts",
  input: [{ type: "user_input", content: [{ type: "text", text: sentence }] }],
  response_format: { type: "audio" },
  generation_config: { speech_config: [{ voice: "Charon" }] },
  store: false,
});
const output = speech.output_audio;
assert.equal(output?.mime_type, "audio/wav");
assert.ok(output?.data);
const wav = Buffer.from(output.data, "base64");
assert.equal(wav.toString("ascii", 0, 4), "RIFF");
assert.equal(wav.readUInt16LE(22), 1, "áudio mono");
assert.equal(wav.readUInt16LE(34), 16, "PCM de 16 bits");
const sourceRate = wav.readUInt32LE(24);
let offset = 12;
while (offset + 8 <= wav.length && wav.toString("ascii", offset, offset + 4) !== "data") {
  offset += 8 + wav.readUInt32LE(offset + 4);
}
assert.ok(offset + 8 <= wav.length, "chunk de áudio WAV presente");
const pcm = wav.subarray(offset + 8, offset + 8 + wav.readUInt32LE(offset + 4));
const sourceSamples = pcm.length / 2;
const targetSamples = Math.floor(sourceSamples * 16_000 / sourceRate);
const converted = Buffer.alloc(targetSamples * 2);
for (let i = 0; i < targetSamples; i++) {
  converted.writeInt16LE(pcm.readInt16LE(Math.floor(i * sourceRate / 16_000) * 2), i * 2);
}
console.log("✓ Gemini TTS retornou WAV válido para texto fictício.");

const token = await ai.authTokens.create({ config: {
  uses: 1,
  newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
  expireTime: new Date(Date.now() + 5 * 60_000).toISOString(),
  liveConnectConstraints: {
    model: "gemini-3.5-transcribe-live",
    config: {
      responseModalities: [Modality.TEXT],
      inputAudioTranscription: { languageCodes: ["pt-BR"] },
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    },
  },
} });
assert.ok(token.name);
let session: Session | undefined;
let resolveTranscript: ((text: string) => void) | undefined;
let rejectTranscript: ((error: Error) => void) | undefined;
const transcript = new Promise<string>((resolve, reject) => { resolveTranscript = resolve; rejectTranscript = reject; });
const timer = setTimeout(() => rejectTranscript?.(new Error("Gemini não finalizou a transcrição em 15 segundos.")), 15_000);
try {
  const live = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: "v1beta" } });
  session = await live.live.connect({
    model: "gemini-3.5-transcribe-live",
    config: {
      responseModalities: [Modality.TEXT],
      inputAudioTranscription: { languageCodes: ["pt-BR"] },
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    },
    callbacks: {
      onopen: () => {},
      onmessage: (message) => {
        const text = message.serverContent?.inputTranscription?.text;
        if (text) resolveTranscript?.(text);
      },
      onerror: () => rejectTranscript?.(new Error("Falha na conexão Live.")),
      onclose: () => rejectTranscript?.(new Error("Conexão Live encerrada antes da transcrição.")),
    },
  });
  session.sendRealtimeInput({ activityStart: {} });
  for (let i = 0; i < converted.length; i += 3_200) {
    session.sendRealtimeInput({ audio: { data: converted.subarray(i, i + 3_200).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
    await pause(95);
  }
  session.sendRealtimeInput({ activityEnd: {} });
  const text = await transcript;
  assert.ok(text.trim().length > 5, "transcrição não vazia");
  console.log("✓ Gemini Live transcreveu a fala sintética com token temporário.");
} finally {
  clearTimeout(timer);
  session?.close();
}
