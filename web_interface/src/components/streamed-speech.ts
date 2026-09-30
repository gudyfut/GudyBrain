/** Reproduz PCM mono 24 kHz à medida que a resposta de TTS chega. */
export class StreamedSpeech {
  private readonly context = new AudioContext();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private started = false;
  private pendingByte: number | null = null;
  private resolveEnd: (() => void) | undefined;
  private finished = false;
  private stopped = false;

  async resume(): Promise<void> { await this.context.resume(); }

  append(chunk: Uint8Array): boolean {
    if (this.stopped) return false;
    const bytes = this.pendingByte === null ? chunk : new Uint8Array(chunk.length + 1);
    if (this.pendingByte !== null) { bytes[0] = this.pendingByte; bytes.set(chunk, 1); }
    const sampleCount = Math.floor(bytes.length / 2);
    this.pendingByte = bytes.length % 2 ? bytes.at(-1)! : null;
    if (!sampleCount) return false;
    const samples = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const buffer = this.context.createBuffer(1, sampleCount, 24_000);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.nextStart, this.context.currentTime + (this.started ? 0.035 : 0.12));
    this.nextStart = start + buffer.duration;
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (this.finished && this.sources.size === 0) { this.resolveEnd?.(); this.resolveEnd = undefined; }
    };
    this.sources.add(source);
    source.start(start);
    const first = !this.started;
    this.started = true;
    return first;
  }

  finish(): Promise<void> {
    if (!this.started || this.pendingByte !== null) throw new Error("O áudio recebido está incompleto.");
    this.finished = true;
    if (this.sources.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => { this.resolveEnd = resolve; });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.resolveEnd?.();
    this.resolveEnd = undefined;
    for (const source of this.sources) { try { source.stop(); } catch { /* nó já terminou */ } source.disconnect(); }
    this.sources.clear();
    void this.context.close();
  }
}
