"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ArrowUpRight, AudioLines, BrainCircuit, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { formatVoiceTime, type LiveSnapshot } from "../shared/live";
import type { VoiceLevels } from "./voice-audio";

type Speaker = "quiet" | "user" | "assistant";

export function VoiceStage({ active, connecting, muted, playbackBlocked, voice, levels, busy, ready, activity,
  onStart, onMute, onStop, onResumeAudio, onMemory }: {
  active: boolean; connecting: boolean; muted: boolean; playbackBlocked: boolean;
  voice: LiveSnapshot | null; levels: RefObject<VoiceLevels>; busy: boolean; ready: boolean; activity: string | null;
  onStart(): void; onMute(): void; onStop(): void; onResumeAudio(): void; onMemory(): void;
}) {
  const orb = useRef<HTMLButtonElement>(null);
  const [speaker, setSpeaker] = useState<Speaker>("quiet");
  const closing = voice?.phase === "closing";
  useEffect(() => {
    let frame = 0;
    let lastSpeech = 0;
    let current: Speaker = "quiet";
    setSpeaker("quiet");
    if (!active || connecting || closing) {
      orb.current?.style.setProperty("--voice-energy", "0");
      return;
    }
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const tick = (now: number) => {
      const input = active && !connecting && !closing && !muted ? levels.current.input : 0;
      const output = active && !connecting && !closing && !playbackBlocked ? levels.current.output : 0;
      let next: Speaker = input > .09 ? "user" : output > .07 ? "assistant" : "quiet";
      if (next !== "quiet") lastSpeech = now;
      else if (active && !connecting && !closing && now - lastSpeech < 220 && !(muted && current === "user")) next = current;
      if (next !== current) { current = next; setSpeaker(next); }
      // DOM variables avoid re-rendering the transcript for every audio frame.
      orb.current?.style.setProperty("--voice-energy", motion.matches ? "0" : Math.max(input, output).toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, closing, connecting, levels, muted, playbackBlocked]);

  const state = closing ? "closing" : connecting ? "connecting" : !active ? busy ? "thinking" : "idle"
    : playbackBlocked ? "blocked" : speaker === "user" ? "user" : speaker === "assistant" ? "assistant"
      : activity ? "thinking" : muted ? "muted" : "listening";
  const title = ({ idle: "Vamos conversar?", connecting: "Preparando nossa conversa", closing: "Até a próxima conversa",
    user: "Estou ouvindo você", assistant: "Gudman está falando", thinking: "Conectando as memórias",
    listening: "Pode falar, estou ouvindo", muted: "Microfone silenciado", blocked: "Ative o som para me ouvir" })[state];
  const hint = ({ idle: "Toque na esfera e fale naturalmente.", connecting: "Conectando o microfone e o áudio…", closing: "Encerrando o áudio e confirmando a duração…",
    user: "Pode continuar. Estou acompanhando.", assistant: "Pode me interromper a qualquer momento.", thinking: activity ?? "Preparando uma resposta para você.",
    listening: "Uma ideia, uma pergunta ou o que estiver pensando.", muted: "A sessão continua ativa e consumindo créditos.", blocked: "Seu navegador precisa de permissão para reproduzir áudio." })[state];
  return <section className="voice-stage" data-state={state} aria-label="Conversa por voz">
    <div className="voice-session-line"><span className={active ? "voice-session-label is-live" : "voice-session-label"}><i />{connecting ? "Conectando" : active ? "Conversa ao vivo" : "Seu espaço para conversar"}</span>
      {active && <time>{formatVoiceTime(voice?.seconds ?? 0)}</time>}</div>
    <div className="voice-stage-center">
      <div className="voice-orb-space">
        <div className="voice-orbit orbit-one" aria-hidden="true" /><div className="voice-orbit orbit-two" aria-hidden="true" />
        <button ref={orb} className="voice-orb" data-state={state}
          aria-label={!active ? "Iniciar conversa ao vivo" : muted ? "Retomar escuta pela esfera" : "Pausar escuta pela esfera"}
          aria-describedby="voice-orb-hint" aria-pressed={active ? muted : undefined}
          disabled={!ready || connecting || closing || (!active && busy)} onClick={active ? onMute : onStart}>
          <span className="orb-glow" aria-hidden="true" /><span className="orb-surface" aria-hidden="true"><span className="orb-current current-one" /><span className="orb-current current-two" /><span className="orb-current current-three" /><span className="orb-shine" /></span>
          <span className="orb-action" aria-hidden="true">{active && muted ? <MicOff size={23} /> : <Mic size={23} />}</span>
        </button>
        <div className="voice-wave" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ "--bar": `${9 + (1 - Math.abs(i - 8) / 9) * 20}px`, "--delay": `${i * -73}ms` } as CSSProperties} />)}</div>
      </div>
      <div className="voice-stage-copy"><h1 aria-live="polite">{title}</h1><p id="voice-orb-hint">{hint}</p></div>
      <div className="voice-stage-controls">
        {active ? <>
          {!connecting && !closing && <button className={muted ? "voice-control is-muted" : "voice-control"} onClick={onMute} aria-pressed={muted}>{muted ? <MicOff size={19} /> : <Mic size={19} />}<span>{muted ? "Ativar microfone" : "Silenciar microfone"}</span></button>}
          {playbackBlocked && <button className="voice-control enable-audio" onClick={onResumeAudio}><Volume2 size={19} /><span>Ativar som</span></button>}
          <button className="voice-control end-call" disabled={closing} onClick={onStop}><PhoneOff size={19} /><span>{connecting ? "Cancelar conexão" : "Encerrar"}</span></button>
        </> : <span className="voice-idle-hint"><AudioLines size={16} />Voz natural. Memória presente.</span>}
      </div>
    </div>
    <footer className="voice-stage-footer"><button onClick={onMemory}><BrainCircuit size={16} /><span>Explorar memória</span><ArrowUpRight size={14} /></button>
      <small>{active ? `Voz gerada por IA · estimativa US$ ${((voice?.seconds ?? 0) / 60 * .05).toFixed(2)} somente voz` : "Voz gerada por IA · usa créditos de API"}</small></footer>
  </section>;
}
