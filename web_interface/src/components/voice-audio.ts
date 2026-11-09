export interface VoiceLevels { input: number; output: number }

/** Local, transient amplitude only. Audio is never recorded or sent elsewhere. */
export function createVoiceMeter(onLevels: (levels: VoiceLevels) => void) {
  let context: AudioContext | undefined;
  let frame = 0;
  let stopped = false;
  let muted = false;
  let playing = false;
  type Channel = { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; samples: Uint8Array<ArrayBuffer>; level: number };
  const channels: Partial<Record<"input" | "output", Channel>> = {};
  try {
    context = new AudioContext();
    // Resume during the initiating click, before microphone permissions await.
    void context.resume().catch(() => {});
  } catch { /* Visualization is optional; voice still works. */ }

  function connect(kind: "input" | "output", stream: MediaStream) {
    if (!context || stopped) return;
    try {
      channels[kind]?.source.disconnect();
      channels[kind]?.analyser.disconnect();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // No destination: do not play back the microphone.
      channels[kind] = { source, analyser, samples: new Uint8Array(analyser.fftSize), level: 0 };
      void context.resume().catch(() => {});
      if (!frame) frame = requestAnimationFrame(tick);
    } catch { /* Unsupported stream/analyser must not interrupt a call. */ }
  }
  function sample(kind: "input" | "output") {
    const channel = channels[kind];
    if (!channel || document.hidden || (kind === "input" ? muted : !playing)) return 0;
    channel.analyser.getByteTimeDomainData(channel.samples);
    let energy = 0;
    for (const value of channel.samples) energy += ((value - 128) / 128) ** 2;
    const rms = Math.sqrt(energy / channel.samples.length);
    const target = rms < .009 ? 0 : Math.min(1, rms * 7);
    channel.level += (target - channel.level) * (target > channel.level ? .55 : .2);
    return channel.level;
  }
  function tick() {
    if (stopped) return;
    onLevels({ input: sample("input"), output: sample("output") });
    frame = requestAnimationFrame(tick);
  }
  return {
    connect,
    mute(value: boolean) { muted = value; if (channels.input) channels.input.level = 0; },
    playback(value: boolean) { playing = value; if (!value && channels.output) channels.output.level = 0; },
    resume() { return context?.resume().catch(() => {}); },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      for (const channel of Object.values(channels)) { channel.source.disconnect(); channel.analyser.disconnect(); }
      if (context && context.state !== "closed") void context.close().catch(() => {});
      onLevels({ input: 0, output: 0 });
    },
  };
}
