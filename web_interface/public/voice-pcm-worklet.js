class VoicePcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.samples = [];
    this.port.onmessage = (event) => {
      if (event.data?.type !== "flush") return;
      if (this.count) {
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples.push(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767));
        this.sum = 0;
        this.count = 0;
      }
      this.emit();
      this.port.postMessage({ type: "flushed" });
    };
  }

  emit() {
    if (!this.samples.length) return;
    const pcm = Int16Array.from(this.samples);
    this.samples = [];
    this.port.postMessage({ type: "pcm", buffer: pcm.buffer }, [pcm.buffer]);
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (const sample of input) {
        this.sum += sample;
        this.count++;
        this.phase += 16000;
        if (this.phase >= sampleRate) {
          const value = Math.max(-1, Math.min(1, this.sum / this.count));
          this.samples.push(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767));
          this.phase -= sampleRate;
          this.sum = 0;
          this.count = 0;
        }
      }
      if (this.samples.length >= 1600) this.emit();
    }
    for (const channel of outputs[0] ?? []) channel.fill(0);
    return true;
  }
}

registerProcessor("voice-pcm", VoicePcmWorklet);
