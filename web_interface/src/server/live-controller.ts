import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@gudybrain/core/agent";
import type { Message } from "@gudybrain/core/glm";
import { liveMessages, type LiveFragment, type LiveSnapshot, type LiveUpdate } from "../shared/live";

export interface LiveTransport {
  send(event: Record<string, unknown>): void;
  disconnect(): void;
  hangup(): Promise<void>;
}

export interface LiveControllerOptions {
  id: string;
  history: readonly Message[];
  transport: LiveTransport;
  query(input: string, history: readonly Message[], signal: AbortSignal, onStep: (event: AgentEvent) => void): Promise<string>;
  onFinish(messages: readonly Message[]): void;
  now?: () => number;
  idleMs?: number;
  maxMs?: number;
  settleMs?: number;
  closeMs?: number;
}

// Independent of Next, credentials and real providers so lifecycle and races can
// be verified locally. The trusted sideband is the only source of transcripts.
export class LiveController {
  private phase: LiveSnapshot["phase"] = "connecting";
  private readonly fragments: LiveFragment[] = [];
  private readonly seen = new Set<string>();
  private readonly delegations = new Set<string>();
  private readonly listeners = new Set<(event: LiveUpdate) => void>();
  private readonly now: () => number;
  private readonly startedAt: number;
  private lastActivity: number;
  private seconds = 0;
  private transcriptChars = 0;
  private usageConfirmed = false;
  private activity: string | null = null;
  private reason?: string;
  private error?: string;
  private pending?: { id: string; offset: number; revision: number };
  private revision = 0;
  private job?: AbortController;
  private settleTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private readonly ticker: ReturnType<typeof setInterval>;
  private readonly acknowledgments = new Map<string, { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly finished: Promise<LiveSnapshot>;
  private resolveFinished!: (snapshot: LiveSnapshot) => void;

  constructor(private readonly options: LiveControllerOptions) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.lastActivity = this.now();
    this.finished = new Promise((resolve) => { this.resolveFinished = resolve; });
    this.ticker = setInterval(() => this.tick(), 1_000);
    this.ticker.unref();
  }

  snapshot(): LiveSnapshot {
    return { id: this.options.id, phase: this.phase, messages: liveMessages(this.fragments), activity: this.activity,
      seconds: this.seconds, usageConfirmed: this.usageConfirmed, reason: this.reason, error: this.error };
  }

  subscribe(listener: (event: LiveUpdate) => void): () => void {
    this.listeners.add(listener);
    listener({ type: "snapshot", state: this.snapshot() });
    return () => { this.listeners.delete(listener); };
  }

  ready(): void {
    if (this.phase !== "connecting") return;
    this.phase = "active";
    this.lastActivity = this.now();
    this.publish();
  }

  tick(): void {
    if (this.phase === "closing" || this.phase === "closed") return;
    const now = this.now();
    if (this.phase === "connecting" && now - this.startedAt >= 30_000) void this.close("connection_timeout");
    else if (now - this.startedAt >= (this.options.maxMs ?? 30 * 60_000)) void this.close("duration_limit");
    else if (this.phase === "active" && !this.pending && !this.job && now - this.lastActivity >= (this.options.idleMs ?? 90_000)) {
      void this.close("inactivity");
    }
  }

  receive(raw: unknown): void {
    if (this.phase === "closed" || !raw || typeof raw !== "object") return;
    const event = raw as Record<string, unknown>;
    const type = event.type;
    if (typeof type !== "string") return;
    // Usage and PCM do not need deduplication. Always accept the terminal
    // receipt, including when the event or transcript limit triggered closure.
    if (type === "session.usage.updated" || type === "session.closed") {
      const usage = event.usage as { seconds?: unknown } | undefined;
      if (typeof usage?.seconds === "number" && Number.isFinite(usage.seconds) && usage.seconds >= 0) this.seconds = usage.seconds;
      if (type === "session.closed") {
        this.usageConfirmed = typeof usage?.seconds === "number" && Number.isFinite(usage.seconds) && usage.seconds >= 0;
        this.reason ??= typeof event.reason === "string" ? event.reason : "closed";
        this.finish();
      } else this.publish();
      return;
    }
    if (type === "session.input_audio.append" || type === "session.output_audio.delta") {
      // Reflected PCM is examined only for activity, never retained or forwarded.
      const data = type === "session.input_audio.append" ? event.audio : event.delta;
      if (typeof data === "string" && pcmHasActivity(data)) this.lastActivity = this.now();
      return;
    }
    if (typeof event.event_id === "string") {
      if (this.seen.has(event.event_id)) return;
      this.seen.add(event.event_id);
      if (this.seen.size > 20_000) { void this.close("context_limit"); return; }
    }
    if (typeof event.client_event_id === "string") {
      const ack = this.acknowledgments.get(event.client_event_id);
      if (ack) {
        clearTimeout(ack.timer);
        this.acknowledgments.delete(event.client_event_id);
        if (type === "error") ack.reject(); else ack.resolve();
      }
    }
    if (type === "session.input_transcript.delta" || type === "session.output_transcript.delta") {
      if (typeof event.delta !== "string" || !event.delta || typeof event.start_ms !== "number" || typeof event.end_ms !== "number"
        || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) || event.start_ms < 0 || event.end_ms < event.start_ms) return;
      const role = type === "session.input_transcript.delta" ? "user" : "assistant";
      if (this.transcriptChars + event.delta.length > 80_000) { void this.close("context_limit"); return; }
      this.transcriptChars += event.delta.length;
      this.fragments.push({ id: this.options.id + ":" + (typeof event.event_id === "string" ? event.event_id : randomUUID()),
        role, text: event.delta, startMs: event.start_ms, endMs: event.end_ms });
      this.lastActivity = this.now();
      if (role === "user" && this.pending && this.phase !== "closing") {
        this.pending.offset = Math.max(this.pending.offset, event.end_ms);
        this.pending.revision = ++this.revision;
        this.job?.abort();
        this.schedule();
      }
      this.publish();
      return;
    }
    if (this.phase === "closing") return;
    if (type === "session.delegation.created") {
      const delegation = event.delegation as { id?: unknown; target?: unknown } | undefined;
      if (typeof delegation?.id !== "string" || delegation.target !== "client" || this.delegations.has(delegation.id)
        || typeof event.offset_ms !== "number" || !Number.isFinite(event.offset_ms) || event.offset_ms < 0) return;
      this.delegations.add(delegation.id);
      this.job?.abort();
      this.pending = { id: delegation.id, offset: event.offset_ms, revision: ++this.revision };
      this.activity = "Consultando a memória…";
      this.schedule();
      this.publish();
    } else if (type === "error") {
      // Never surface provider payloads, credentials or internal reasoning.
      this.error = "A sessão de voz encontrou um erro. Encerre e tente novamente.";
      void this.close("provider_error");
    }
  }

  transportFailed(): void {
    if (this.phase === "closed") return;
    this.error = "A conexão de voz foi interrompida. O consumo final não foi confirmado.";
    void this.close("connection_lost");
  }

  close(reason = "user"): Promise<LiveSnapshot> {
    if (this.phase === "closed" || this.phase === "closing") return this.finished;
    this.phase = "closing";
    this.reason = reason;
    this.activity = null;
    this.pending = undefined;
    this.job?.abort();
    clearTimeout(this.settleTimer);
    this.publish();
    // Install finalization timeout before sending; a fake or fast peer can reply synchronously.
    this.closeTimer = setTimeout(() => {
      this.error ??= "Voz encerrada sem confirmação do consumo final.";
      void this.options.transport.hangup().catch(() => {}).finally(() => this.finish());
    }, this.options.closeMs ?? 5_000);
    this.closeTimer.unref();
    try { this.options.transport.send({ type: "session.close", event_id: randomUUID() }); }
    catch { void this.options.transport.hangup().catch(() => {}).finally(() => this.finish()); }
    return this.finished;
  }

  private finish(): void {
    if (this.phase === "closed") return;
    this.phase = "closed";
    this.pending = undefined;
    this.job?.abort();
    clearInterval(this.ticker);
    clearTimeout(this.settleTimer);
    clearTimeout(this.closeTimer);
    for (const ack of this.acknowledgments.values()) { clearTimeout(ack.timer); ack.reject(); }
    this.acknowledgments.clear();
    this.activity = null;
    const messages = liveMessages(this.fragments).map(({ role, content }) => ({ role, content }));
    this.options.onFinish(messages);
    this.publish();
    this.options.transport.disconnect();
    this.resolveFinished(this.snapshot());
    this.listeners.clear();
  }

  private schedule(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => { void this.work(); }, this.options.settleMs ?? 450);
    this.settleTimer.unref();
  }

  private async work(): Promise<void> {
    if (!this.pending || this.job || this.phase === "closing" || this.phase === "closed") return;
    const task = { ...this.pending };
    const abort = new AbortController();
    this.job = abort;
    const valid = () => !abort.signal.aborted && this.pending?.revision === task.revision && this.phase !== "closing" && this.phase !== "closed";
    try {
      const context = delegationContext(this.options.history, this.fragments, task.offset);
      if (!context) {
        await this.append("session.commentary.append", task.id, "Não recebi a pergunta completa. Peça ao usuário que a repita.", abort.signal);
        return;
      }
      await this.append("session.thinking.append", task.id, "Consultando a memória. Ainda não há resultado confirmado.", abort.signal);
      if (!valid()) return;
      const result = await this.options.query(context.input, context.history, abort.signal, (event) => {
        if (!valid()) return;
        if (event.type === "retrieval_trace") this.emit({ type: "retrieval", event: event.event });
        if (event.type === "retrieval") { this.activity = event.message; this.publish(); }
      });
      if (!valid()) return;
      for (const chunk of voiceChunks(result)) {
        if (!valid()) return;
        await this.append("session.commentary.append", task.id, chunk, abort.signal);
      }
    } catch {
      if (valid()) {
        this.error = "Não foi possível concluir a consulta de memória. Confira a conexão ChatGPT e a cota do Jev em Configurações.";
        try { await this.append("session.commentary.append", task.id, "A consulta falhou. Informe que não conseguiu verificar a memória; não invente uma resposta.", abort.signal); }
        catch { this.transportFailed(); }
      }
    } finally {
      this.job = undefined;
      if (this.pending?.revision === task.revision) { this.pending = undefined; this.activity = null; }
      this.lastActivity = this.now();
      this.publish();
      if (this.pending) this.schedule();
    }
  }

  private append(type: string, delegationId: string, content: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const fail = () => { clearTimeout(timer); this.acknowledgments.delete(id); signal.removeEventListener("abort", fail); reject(new Error("Live command not acknowledged")); };
      const timer = setTimeout(fail, 10_000);
      timer.unref();
      this.acknowledgments.set(id, { timer, reject: fail, resolve: () => { signal.removeEventListener("abort", fail); resolve(); } });
      signal.addEventListener("abort", fail, { once: true });
      try { this.options.transport.send({ type, event_id: id, delegation_id: delegationId, content }); }
      catch { fail(); }
    });
  }

  private emit(event: LiveUpdate): void { for (const listener of this.listeners) listener(event); }
  private publish(): void { this.emit({ type: "snapshot", state: this.snapshot() }); }
}

export function delegationContext(history: readonly Message[], fragments: readonly LiveFragment[], offset: number): { input: string; history: Message[] } | undefined {
  const available = fragments.filter((fragment) => fragment.startMs <= offset);
  const users = available.filter((fragment) => fragment.role === "user");
  const latest = users.at(-1);
  if (!latest) return undefined;
  // A short assistant backchannel must not split the user's current request.
  let first = users.length - 1;
  while (first > 0 && users[first]!.startMs - users[first - 1]!.endMs <= 2_000) first--;
  const utterance = users.slice(first);
  const start = utterance[0]!.startMs;
  const input = utterance.map((fragment) => fragment.text).join("").trim();
  if (!input) return undefined;
  return { input, history: [...history.map((message) => ({ ...message })),
    ...liveMessages(available.filter((fragment) => fragment.endMs <= start)).map(({ role, content }) => ({ role, content }))] };
}

// A UTF-8 byte is an upper bound for a byte-level BPE token. Leave room below
// the API's 500-token append limit without adding a tokenizer dependency.
export function voiceChunks(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const word of text.match(/\S+\s*|\s+/gu) ?? []) {
    if (Buffer.byteLength(chunk + word, "utf8") <= 450) { chunk += word; continue; }
    if (chunk) { chunks.push(chunk); chunk = ""; }
    for (const char of word) {
      if (Buffer.byteLength(chunk + char, "utf8") > 450) { chunks.push(chunk); chunk = ""; }
      chunk += char;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function pcmHasActivity(base64: string): boolean {
  if (base64.length > 512_000) return false;
  const bytes = Buffer.from(base64, "base64");
  let energy = 0;
  const samples = Math.floor(bytes.length / 2);
  for (let i = 0; i < samples; i++) energy += (bytes.readInt16LE(i * 2) / 32768) ** 2;
  return samples > 0 && Math.sqrt(energy / samples) > 0.015;
}
