import "server-only";

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CALL_ANALYSIS_PROMPT_VERSION,
  CALL_ANALYSIS_SCHEMA_VERSION,
} from "@gudybrain/agents/analisador-call/types";
import { AGENT_PROFILES } from "@gudybrain/agents/registry";
import { RECORDINGS_ROOT, resolveSessionDir } from "./paths";

interface SessionManifest {
  session_id?: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  call_duration?: number;
  guild?: { name?: string };
  voice_channel?: { name?: string };
  participants?: Array<{
    user_id?: number;
    display_name?: string;
    username?: string;
    chunks?: Array<{ file?: string; audio_duration?: number }>;
  }>;
}

export interface CallSummary {
  readonly id: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number;
  readonly guild: string;
  readonly channel: string;
  readonly participants: readonly string[];
  readonly hasTranscript: boolean;
  readonly hasAnalysis: boolean;
  readonly hasCuration: boolean;
  readonly stage: "gravada" | "transcrita" | "analisada" | "curada";
}

export interface CallDetail extends CallSummary {
  readonly tracks: ReadonlyArray<{
    userId: string;
    name: string;
    username: string;
    files: ReadonlyArray<{ name: string; relativePath: string; durationSeconds: number }>;
  }>;
  readonly analysis: unknown | null;
  readonly quality: unknown | null;
}

export function listCalls(): CallSummary[] {
  if (!existsSync(RECORDINGS_ROOT)) return [];
  return readdirSync(RECORDINGS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => callSummary(join(RECORDINGS_ROOT, entry.name), entry.name))
    .filter((item): item is CallSummary => item !== null)
    .sort((a, b) => (b.startedAt ?? b.id).localeCompare(a.startedAt ?? a.id));
}

export function getCall(sessionId: string): CallDetail {
  const dir = resolveSessionDir(sessionId);
  const manifest = readJson<SessionManifest>(join(dir, "session.json"));
  if (!manifest) throw new Error("Manifesto session.json não encontrado.");
  const summary = callSummary(dir, sessionId);
  if (!summary) throw new Error("Sessão inválida.");
  return {
    ...summary,
    tracks: (manifest.participants ?? []).map((participant) => ({
      userId: String(participant.user_id ?? ""),
      name: participant.display_name || participant.username || "Participante",
      username: participant.username ?? "",
      files: (participant.chunks ?? []).flatMap((chunk) => {
        if (!chunk.file) return [];
        return [{
          name: basename(chunk.file),
          relativePath: chunk.file.replace(/\\/g, "/"),
          durationSeconds: Number(chunk.audio_duration ?? 0),
        }];
      }),
    })),
    analysis: readJson(join(dir, "analise-call.json")),
    quality: readJson(join(dir, "transcricao-qualidade.json")),
  };
}

export function getTranscript(sessionId: string): string {
  const path = join(resolveSessionDir(sessionId), "conversa.txt");
  if (!existsSync(path)) throw new Error("Esta sessão ainda não possui transcrição.");
  return readFileSync(path, "utf8");
}

export function resolveTrack(sessionId: string, relativePath: string): string {
  if (!/^[\w./-]+$/u.test(relativePath)) throw new Error("Trilha inválida.");
  const dir = resolveSessionDir(sessionId);
  const full = join(dir, ...relativePath.split("/"));
  const normalizedDir = `${dir}\\`;
  if (!full.startsWith(normalizedDir) || !existsSync(full) || !statSync(full).isFile()) {
    throw new Error("Trilha não encontrada.");
  }
  return full;
}

function callSummary(dir: string, fallbackId: string): CallSummary | null {
  const manifest = readJson<SessionManifest>(join(dir, "session.json"));
  if (!manifest) return null;
  const hasTranscript = existsSync(join(dir, "conversa.txt"));
  const analysis = readJson<{
    schema_version?: number;
    generated_at?: string;
    analyzer?: { prompt_version?: string; model?: string };
  }>(join(dir, "analise-call.json"));
  const hasAnalysis = analysis?.schema_version === CALL_ANALYSIS_SCHEMA_VERSION
    && analysis.analyzer?.prompt_version === CALL_ANALYSIS_PROMPT_VERSION
    && analysis.analyzer?.model === AGENT_PROFILES.analisadorCall.model;
  const curation = readJson<{ status?: string; updatedAt?: string }>(join(dir, "curadoria-call.json"));
  const curationMatchesAnalysis = !analysis?.generated_at
    || !curation?.updatedAt
    || curation.updatedAt >= analysis.generated_at;
  const hasCuration = hasAnalysis
    && curation?.status === "concluida"
    && curationMatchesAnalysis;
  return {
    id: manifest.session_id ?? fallbackId,
    status: manifest.status ?? "desconhecido",
    startedAt: manifest.started_at ?? null,
    endedAt: manifest.ended_at ?? null,
    durationSeconds: Number(manifest.call_duration ?? 0),
    guild: manifest.guild?.name ?? "Servidor",
    channel: manifest.voice_channel?.name ?? "Canal",
    participants: (manifest.participants ?? []).map(
      (participant) => participant.display_name || participant.username || "Participante",
    ),
    hasTranscript,
    hasAnalysis,
    hasCuration,
    stage: hasCuration ? "curada" : hasAnalysis ? "analisada" : hasTranscript ? "transcrita" : "gravada",
  };
}

function readJson<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}
