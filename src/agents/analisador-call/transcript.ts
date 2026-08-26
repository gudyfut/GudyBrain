import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { PROJECT_ROOT } from "../../core/project-root";
import type {
  CallChunk,
  CallParticipant,
  CallUtterance,
  LoadedCallTranscript,
} from "./types";

const RECORDINGS_ROOT = resolve(PROJECT_ROOT, "discordbot", "gravacoes");
const LINE_PATTERN = /^\[([\d:.]+)\s+-\s+([\d:.]+)\]\s+([^:]+):\s*(.*)$/;

export function resolveCallSession(value: string): string {
  const candidates = isAbsolute(value)
    ? [resolve(value)]
    : [
        resolve(PROJECT_ROOT, value),
        resolve(RECORDINGS_ROOT, value),
        resolve(RECORDINGS_ROOT, value.split(/[\\/]/).at(-1) ?? value),
      ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) return candidates[0] ?? resolve(value);

  const inside = relative(RECORDINGS_ROOT, found);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`A sessão precisa estar dentro de ${RECORDINGS_ROOT}.`);
  }
  return found;
}

export function loadCallTranscript(sessionInput: string): LoadedCallTranscript {
  const sessionDir = resolveCallSession(sessionInput);
  const textPath = resolve(sessionDir, "conversa.txt");
  const jsonPath = resolve(sessionDir, "conversa.json");
  if (!existsSync(textPath)) {
    throw new Error(`A sessão ainda não possui conversa.txt: ${textPath}`);
  }

  const conversationText = readFileSync(textPath, "utf8");
  if (!conversationText.trim()) {
    throw new Error(`A transcrição está vazia: ${textPath}`);
  }

  const structured = existsSync(jsonPath)
    ? parseStructuredTranscript(readFileSync(jsonPath, "utf8"))
    : null;
  const utterances = structured?.utterances.length
    ? structured.utterances
    : parseTextTranscript(conversationText);
  if (!utterances.length) {
    throw new Error("Nenhuma fala válida foi encontrada em conversa.txt/conversa.json.");
  }

  const structuredText = existsSync(jsonPath) ? readFileSync(jsonPath, "utf8") : "";
  return {
    session_dir: sessionDir,
    session_id: structured?.sessionId ?? sessionDir.split(/[\\/]/).at(-1) ?? "sessao",
    started_at: structured?.startedAt ?? null,
    ended_at: structured?.endedAt ?? null,
    participants: structured?.participants.length
      ? structured.participants
      : participantsFromUtterances(utterances),
    utterances,
    transcript_sha256: sha256(`${conversationText}\n${structuredText}`),
    conversation_txt: textPath,
    conversation_json: existsSync(jsonPath) ? jsonPath : null,
  };
}

export function chunkCallTranscript(
  utterances: readonly CallUtterance[],
  maximumCharacters = 22_000,
  overlapUtterances = 2,
): CallChunk[] {
  if (maximumCharacters < 2_000) {
    throw new Error("maximumCharacters precisa ser pelo menos 2000.");
  }
  const chunks: CallChunk[] = [];
  let start = 0;
  while (start < utterances.length) {
    let end = start;
    let characters = 0;
    const lines: string[] = [];
    while (end < utterances.length) {
      const utterance = utterances[end];
      if (!utterance) break;
      const line = formatUtterance(utterance);
      if (lines.length && characters + line.length + 1 > maximumCharacters) break;
      lines.push(line);
      characters += line.length + 1;
      end++;
    }
    if (end === start) end++;
    const selected = utterances.slice(start, end);
    const text = selected.map(formatUtterance).join("\n");
    chunks.push({ index: chunks.length + 1, utterances: selected, text, sha256: sha256(text) });
    if (end >= utterances.length) break;
    start = Math.max(start + 1, end - overlapUtterances);
  }
  return chunks;
}

export function formatOffset(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatUtterance(utterance: CallUtterance): string {
  const person = utterance.person_id ? ` person_id=${utterance.person_id}` : "";
  return `[${utterance.id} ${formatOffset(utterance.start)}-${formatOffset(utterance.end)}${person}] ${utterance.speaker}: ${utterance.text}`;
}

function parseStructuredTranscript(text: string): {
  sessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  participants: CallParticipant[];
  utterances: CallUtterance[];
} | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const rawUtterances = Array.isArray(data.utterances) ? data.utterances : [];
    const utterances = rawUtterances.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const spokenText = textValue(item.text);
      const speaker = textValue(item.display_name);
      if (!spokenText || !speaker) return [];
      return [{
        id: `fala_${String(index + 1).padStart(6, "0")}`,
        user_id: nullableIdentifier(item.user_id),
        person_id: nullableText(item.person_id),
        speaker,
        start: numberValue(item.start),
        end: numberValue(item.end),
        absolute_start: nullableText(item.absolute_start),
        absolute_end: nullableText(item.absolute_end),
        text: spokenText,
      } satisfies CallUtterance];
    });
    const participants = (Array.isArray(data.participants) ? data.participants : [])
      .flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        const displayName = textValue(item.display_name);
        if (!displayName) return [];
        return [{
          user_id: nullableIdentifier(item.user_id),
          person_id: nullableText(item.person_id),
          display_name: displayName,
        } satisfies CallParticipant];
      });
    return {
      sessionId: nullableText(data.session_id),
      startedAt: nullableText(data.started_at),
      endedAt: nullableText(data.ended_at),
      participants,
      utterances,
    };
  } catch {
    return null;
  }
}

function parseTextTranscript(text: string): CallUtterance[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(LINE_PATTERN);
    if (!match) return [];
    const [, start, end, speaker, spokenText] = match;
    if (!start || !end || !speaker || !spokenText) return [];
    return [{
      id: `fala_${String(index + 1).padStart(6, "0")}`,
      user_id: null,
      person_id: null,
      speaker: speaker.trim(),
      start: parseOffset(start),
      end: parseOffset(end),
      absolute_start: null,
      absolute_end: null,
      text: spokenText.trim(),
    } satisfies CallUtterance];
  });
}

function parseOffset(value: string): number {
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0;
  return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

function participantsFromUtterances(utterances: readonly CallUtterance[]): CallParticipant[] {
  const seen = new Set<string>();
  const result: CallParticipant[] = [];
  for (const utterance of utterances) {
    const key = utterance.person_id ?? utterance.user_id ?? utterance.speaker;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      user_id: utterance.user_id,
      person_id: utterance.person_id,
      display_name: utterance.speaker,
    });
  }
  return result;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  const text = textValue(value);
  return text || null;
}

function nullableIdentifier(value: unknown): string | null {
  // IDs do Discord excedem com frequência o limite inteiro seguro do JS.
  // Números inseguros são descartados; person_id continua sendo a identidade
  // canônica e novas integrações devem serializar Discord IDs como string.
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return nullableText(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
