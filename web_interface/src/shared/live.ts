import type { RetrievalEvent } from "@gudybrain/core/retrieval-events";

export interface LiveFragment {
  id: string;
  role: "user" | "assistant";
  text: string;
  startMs: number;
  endMs: number;
}

export interface LiveMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface LiveSnapshot {
  id: string;
  phase: "connecting" | "active" | "closing" | "closed";
  messages: LiveMessage[];
  activity: string | null;
  seconds: number;
  usageConfirmed: boolean;
  reason?: string;
  error?: string;
}

export type LiveUpdate = { type: "snapshot"; state: LiveSnapshot }
  | { type: "retrieval"; event: RetrievalEvent }
  | { type: "heartbeat" };

// Timing orders the speakers. Within each speaker, retain the exact deltas,
// including spaces and repeated words. These are captions, not proof of playback.
export function liveMessages(fragments: readonly LiveFragment[]): LiveMessage[] {
  const messages: (LiveMessage & { endMs: number })[] = [];
  for (const fragment of [...fragments].sort((a, b) => a.startMs - b.startMs)) {
    const previous = messages.at(-1);
    if (previous?.role === fragment.role && fragment.startMs - previous.endMs <= 2_000) {
      previous.content += fragment.text;
      previous.endMs = Math.max(previous.endMs, fragment.endMs);
    } else {
      messages.push({ id: fragment.id, role: fragment.role, content: fragment.text, endMs: fragment.endMs });
    }
  }
  return messages.map(({ id, role, content }) => ({ id, role, content }));
}

export function formatVoiceTime(seconds: number): string {
  const total = Math.floor(seconds);
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}
