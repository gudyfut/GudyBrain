"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Bot, BrainCircuit, Command, CornerDownLeft, LoaderCircle, MessageCircleMore, Mic, MicOff, PhoneOff, Plus, Square, UserRound, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { RetrievalEvent } from "@gudybrain/core/retrieval-events";
import { MemoryAtlas } from "./memory-atlas";
import { FloatingChat } from "./floating-chat";
import "./neural-chat.css";
import "./voice-workspace.css";
import { VoiceStage } from "./voice-stage";
import type { VoiceLevels } from "./voice-audio";
import { initialTrace, reduceTrace, type RetrievalTrace } from "./retrieval-state";
import { startLiveVoice, type LiveCall } from "./live-voice";
import { formatVoiceTime, type LiveSnapshot } from "../shared/live";

interface UiMessage { id: string; role: "user" | "assistant"; content: string; trace?: RetrievalTrace; voiceId?: string }

const commands = [
  { command: "/memorizar", title: "Memorizar conversa", description: "Entrega a conversa ao curador e abre as propostas." },
  { command: "/limpar", title: "Nova conversa", description: "Descarta o contexto curto e começa uma sessão limpa." },
  { command: "/ajuda", title: "Ver comandos", description: "Abre esta lista de ações da conversa." },
];

export function ChatWorkspace() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [voice, setVoice] = useState<LiveSnapshot | null>(null);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [voiceTrace, setVoiceTrace] = useState<RetrievalTrace | undefined>();
  const [view, setView] = useState<"voice" | "memory">("voice");
  const voiceLevels = useRef<VoiceLevels>({ input: 0, output: 0 });
  const voiceActive = voiceConnecting || !!voice && voice.phase !== "closed";
  const generation = useRef(0);
  const requestBusy = useRef(false);
  const nearBottom = useRef(true);
  const scrollInteractionAt = useRef(0);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceCall = useRef<LiveCall | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const voiceEpoch = useRef(0);
  const voiceTraceRef = useRef<RetrievalTrace | undefined>(undefined);
  const voiceErrorRef = useRef<string | undefined>(undefined);

  useEffect(() => { void newSession(); return () => {
    generation.current++; voiceEpoch.current++; abortRef.current?.abort();
    voiceAbort.current?.abort(); voiceCall.current?.dispose();
  }; }, []);
  useEffect(() => { if (nearBottom.current) endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth" }); }, [messages, activity, busy]);
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) stream.scrollTop = stream.scrollHeight;
    });
    observer.observe(stream);
    return () => observer.disconnect();
  }, []);

  async function newSession(): Promise<void> {
    const version = ++generation.current;
    await stopVoice();
    if (version !== generation.current) return;
    abortRef.current?.abort(); abortRef.current = null; requestBusy.current = false;
    setVoice(null); setVoiceTrace(undefined); voiceTraceRef.current = undefined;
    setSelectedId(null); setSessionId(null); setBusy(false); setMessages([]); setError(null); setActivity(null);
    nearBottom.current = true;
    try {
      const response = await fetch("/api/chat/session", { method: "POST" });
      const data = await response.json() as { id?: string; model?: string; error?: string };
      if (generation.current !== version) return;
      if (!response.ok || !data.id) throw new Error(data.error ?? "Não foi possível iniciar a conversa.");
      setSessionId(data.id); setModel(data.model ?? null);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (caught) { if (generation.current === version) setError(caught instanceof Error ? caught.message : String(caught)); }
  }

  async function startVoice(): Promise<void> {
    if (!sessionId || requestBusy.current || voiceActive) return;
    const epoch = ++voiceEpoch.current;
    const abort = new AbortController();
    voiceAbort.current = abort;
    voiceLevels.current = { input: 0, output: 0 };
    voiceErrorRef.current = undefined;
    setView("voice");
    setVoiceConnecting(true); setVoice(null); setError(null); setMuted(false); setPlaybackBlocked(false);
    voiceTraceRef.current = undefined; setVoiceTrace(undefined);
    nearBottom.current = true;
    try {
      const call = await startLiveVoice({ sessionId, signal: abort.signal,
        onLevels: (levels) => { if (epoch === voiceEpoch.current) voiceLevels.current = levels; },
        onSnapshot: (state) => {
          if (epoch !== voiceEpoch.current) return;
          setVoice(state);
          setActivity(state.activity);
          if (state.error) setError(state.error);
          else if (voiceErrorRef.current) {
            const previous = voiceErrorRef.current;
            setError((current) => current === previous ? null : current);
          }
          voiceErrorRef.current = state.error;
          const lastAssistant = state.messages.findLast((message) => message.role === "assistant");
          setMessages((current) => [...current.filter((message) => message.voiceId !== state.id),
            ...state.messages.map((message) => ({ ...message, voiceId: state.id,
              trace: message.id === lastAssistant?.id ? voiceTraceRef.current : undefined }))]);
          if (lastAssistant) setSelectedId(lastAssistant.id);
        },
        onRetrieval: (event) => {
          if (epoch !== voiceEpoch.current) return;
          voiceTraceRef.current = reduceTrace(event.phase === "gate" ? initialTrace() : voiceTraceRef.current ?? initialTrace(), event);
          setVoiceTrace(voiceTraceRef.current);
        },
        onPlaybackBlocked: () => { if (epoch === voiceEpoch.current) setPlaybackBlocked(true); },
        onFailure: (message) => { if (epoch === voiceEpoch.current) setError(message); },
        onEnded: () => {
          if (epoch !== voiceEpoch.current) return;
          voiceCall.current = null; setVoiceConnecting(false); setActivity(null);
          setVoice((current) => current ? { ...current, phase: "closed" } : null);
        },
      });
      if (epoch !== voiceEpoch.current || abort.signal.aborted) { call.dispose(); return; }
      voiceCall.current = call;
      setVoiceConnecting(false);
    } catch (caught) {
      if (epoch === voiceEpoch.current) {
        setVoiceConnecting(false);
        if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a voz.");
      }
    }
  }

  async function stopVoice(): Promise<void> {
    const call = voiceCall.current;
    if (call) {
      setVoice((current) => current ? { ...current, phase: "closing" } : null);
      await call.stop();
      voiceCall.current = null;
    } else {
      voiceEpoch.current++;
      voiceAbort.current?.abort();
      setVoice((current) => current ? { ...current, phase: "closed" } : null);
    }
    voiceAbort.current = null;
    setVoiceConnecting(false); setActivity(null);
  }

  function toggleMute(): void {
    voiceCall.current?.mute(!muted);
    setMuted(!muted);
  }

  function resumeAudio(): void {
    void voiceCall.current?.resumeAudio().then(() => setPlaybackBlocked(false))
      .catch(() => setError("O navegador bloqueou o som. Confira a permissão de áudio."));
  }

  async function curate(): Promise<void> {
    if (!sessionId || !messages.length || requestBusy.current || voiceActive) return;
    const version = generation.current;
    requestBusy.current = true; setBusy(true); setActivity("Preparando curadoria…"); setError(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "chat", id: sessionId }),
      });
      const data = await response.json() as { id?: string; error?: string };
      if (version !== generation.current) return;
      if (!response.ok || !data.id) throw new Error(data.error ?? "Não foi possível iniciar a curadoria.");
      router.push(`/memory?tab=review&review=${encodeURIComponent(data.id)}`);
    } catch (caught) { if (version === generation.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (version === generation.current) { requestBusy.current = false; setBusy(false); setActivity(null); } }
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || requestBusy.current || !sessionId || voiceActive) return;
    if (text === "/limpar") { setInput(""); await newSession(); return; }
    if (text === "/ajuda") { setInput(""); setCommandsOpen(true); return; }
    if (text === "/memorizar") { setInput(""); await curate(); return; }

    const version = generation.current;
    requestBusy.current = true; nearBottom.current = true;
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    setSelectedId(assistantId);
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "", trace: initialTrace() }]);
    setInput(""); setBusy(true); setError(null); setActivity("Gudman está pensando");
    const controller = new AbortController();
    abortRef.current = controller;
    let pending = "";
    let completed = false;
    let outcome: "done" | "cancelled" | "error" = "done";
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (!pending || generation.current !== version) return;
      const chunk = pending; pending = "";
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + chunk } : message));
    };
    try {
      const response = await fetch("/api/chat/message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }), signal: controller.signal,
      });
      if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "A resposta de Gudman não pôde ser iniciada."); }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          if (generation.current !== version) return;
          const event = JSON.parse(line) as { type: string; content?: string; name?: string; message?: string; event?: RetrievalEvent };
          if (event.type === "content" && event.content) {
            pending += event.content;
            if (frame === null) frame = requestAnimationFrame(flush);
            setActivity(null);
          } else if (event.type === "retrieval" && event.event) {
            const traceEvent = event.event;
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, trace: reduceTrace(message.trace ?? initialTrace(), traceEvent) } : message));
          } else if (event.type === "done") { completed = true;
          } else if (event.type === "activity") {
            setActivity(event.message ?? "Consultando a memória");
          } else if (event.type === "tool") {
            setActivity(`Consultando ${friendlyTool(event.name ?? "memória")}`);
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Gudman encontrou um erro.");
          }
        }
      }
      if (!completed) throw new Error("Conexão encerrada antes de concluir a resposta. Tente novamente.");
    } catch (caught) {
      outcome = controller.signal.aborted ? "cancelled" : "error";
      if (!controller.signal.aborted && generation.current === version) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
      if (generation.current === version) {
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, trace: message.trace ? { ...message.trace, phase: outcome } : undefined } : message));
        setBusy(false); setActivity(null); abortRef.current = null; requestBusy.current = false;
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }

  return (
    <div className={`chat-page neural-chat ${view === "voice" ? "voice-layout" : "memory-layout"}${voiceActive ? " live-voice-active" : ""}`}>
      {view === "voice" ? <>
        <header className="voice-workspace-header"><div className="voice-workspace-brand"><AudioLines size={21} /><span>Gudman<small>Seu assistente pessoal</small></span></div><div className="workspace-views" aria-label="Visualização"><button aria-pressed={true}><AudioLines size={15} />Conversa</button><button aria-pressed={false} onClick={() => setView("memory")}><BrainCircuit size={15} />Memória</button></div></header>
        <VoiceStage active={voiceActive} connecting={voiceConnecting} muted={muted} playbackBlocked={playbackBlocked} voice={voice} levels={voiceLevels} busy={busy} ready={!!sessionId} activity={activity}
          onStart={() => void startVoice()} onMute={toggleMute} onStop={() => void stopVoice()} onResumeAudio={resumeAudio} onMemory={() => setView("memory")} />
      </> : <>
        <button className="return-to-voice" onClick={() => setView("voice")}><AudioLines size={16} />Voltar à conversa</button>
        <MemoryAtlas trace={voiceActive ? voiceTrace : messages.find((message) => message.id === selectedId)?.trace} selectedId={selectedId} busy={busy} onSelect={setSelectedId} moments={messages.flatMap((message, index) => message.role === "assistant" ? [{ id: message.id, label: messages[index - 1]?.content ?? "Conversa", phase: message.trace?.phase }] : [])} />
      </>}
      <FloatingChat busy={busy} voiceActive={voiceActive} docked={view === "voice"}>
      <header className="chat-topbar">

        <div className="chat-actions">
          <button className="button ghost" onClick={() => setCommandsOpen((value) => !value)}><Command size={16} /> Comandos</button>
          <button className="button ghost" onClick={() => void newSession()}><Plus size={16} /> Nova conversa</button>
          <button className="button primary" disabled={!messages.length || busy || voiceActive} onClick={() => void curate()}><BrainCircuit size={16} /> Memorizar</button>
        </div>
      </header>
      <div className={commandsOpen ? "chat-body commands-visible" : "chat-body"}>
        <section className="conversation" aria-live="polite">
          <div className="message-stream" ref={streamRef} tabIndex={0} aria-label="Mensagens da conversa"
            onWheel={() => { scrollInteractionAt.current = Date.now(); }} onTouchMove={() => { scrollInteractionAt.current = Date.now(); }}
            onPointerDown={() => { scrollInteractionAt.current = Date.now(); }} onKeyDown={() => { scrollInteractionAt.current = Date.now(); }}
            onScroll={(event) => {
              const el = event.currentTarget;
              // Resizing the stage should keep following captions. Only user
              // scrolling opts out; reaching the bottom opts back in.
              if (Date.now() - scrollInteractionAt.current < 1000 || !nearBottom.current)
                nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}>
            {!messages.length && <div className="chat-welcome"><span className="welcome-mark"><MessageCircleMore size={27} /></span><span className="eyebrow">Conectado à sua memória</span><h2>{voiceActive ? "A conversa ganha palavras." : "Uma ideia. Novas conexões."}</h2><p>{voiceActive ? "O que você e Gudman disserem aparece aqui, enquanto a conversa acontece." : "Fale pela esfera ou escreva aqui. Este é o fio da nossa conversa."}</p>{!voiceActive && <div className="prompt-suggestions"><button onClick={() => setInput("O que você lembra sobre as pessoas mais próximas de mim?")}>Pessoas próximas</button><button onClick={() => setInput("Me ajude a organizar o que tenho pensado ultimamente.")}>Organizar pensamentos</button><button onClick={() => setInput("Quais eventos marcantes estão registrados?")}>Eventos marcantes</button></div>}</div>}
            {messages.map((message, index) => {
              const targetId = message.role === "assistant" ? message.id : messages[index + 1]?.id;
              return <article className={`message ${message.role} ${selectedId === targetId ? "moment-selected" : ""}`} key={message.id} onClick={(event) => { if (targetId && !(event.target as Element).closest("a, button")) setSelectedId(targetId); }}><div className="message-avatar">{message.role === "user" ? <UserRound size={14} /> : <Bot size={14} />}</div><div className="message-content"><span className="message-author">{message.role === "user" ? "Você" : "Gudman"}{message.voiceId ? " · voz" : ""}</span>{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : busy && message.id === messages.at(-1)?.id && message.role === "assistant" ? <div className="typing"><i /><i /><i /></div> : message.trace?.phase === "cancelled" ? <p>Resposta interrompida.</p> : message.trace?.phase === "error" ? <p>Não foi possível concluir a resposta.</p> : null}{message.role === "assistant" && message.trace && <div className="message-tools"><button className="message-moment" aria-pressed={selectedId === message.id} onClick={() => { setSelectedId(message.id); setView("memory"); }}><BrainCircuit size={12} />{message.trace?.phase === "cancelled" ? "Busca cancelada" : message.trace?.phase === "error" ? "Busca interrompida" : view === "memory" && selectedId === message.id ? "Percurso em exibição" : "Ver percurso no núcleo"}</button></div>}</div></article>;
            })}
            {activity && <div className="agent-activity"><LoaderCircle size={14} className="spin-icon" />{activity.includes("Consultando") ? <Wrench size={13} /> : null}<span>{activity}</span></div>}
            {error && <div className="error-banner">{error}{error.includes("Configurações") && <a href="/settings" className="button ghost">Abrir Configurações</a>}</div>}
            <div ref={endRef} />
          </div>
          <div className="composer-wrap">
            {voiceActive && view === "memory" && <div className="live-voice-panel" role="status">
              <div className="live-voice-heading"><span className="voice-pulse" /><strong>{voiceConnecting ? "Conectando a voz…" : voice?.phase === "closing" ? "Encerrando a conversa…" : muted ? "Microfone silenciado" : "Conversa ao vivo"}</strong>
                <span>{formatVoiceTime(voice?.seconds ?? 0)}</span></div>
              <p>{muted ? "A sessão continua ativa e consumindo créditos." : "Fale naturalmente. Você pode interromper Gudman."}</p>
              <div className="live-voice-controls">
                {!voiceConnecting && voice?.phase !== "closing" && <button onClick={toggleMute} aria-pressed={muted}>{muted ? <Mic size={14} /> : <MicOff size={14} />}{muted ? "Ativar microfone" : "Silenciar microfone"}</button>}
                {playbackBlocked && <button onClick={resumeAudio}>Ativar som</button>}
                <button className="live-end" disabled={voice?.phase === "closing"} onClick={() => void stopVoice()}><PhoneOff size={14} />{voiceConnecting ? "Cancelar conexão" : "Encerrar"}</button>
              </div>
              <small>Voz gerada por IA · estimativa US$ {((voice?.seconds ?? 0) / 60 * 0.05).toFixed(2)} somente voz</small>
            </div>}
            {voiceActive && view === "voice" && <div className="voice-transcript-note"><AudioLines size={14} /><span>A conversa aparece aqui em tempo real.<small>As legendas podem conter imprecisões.</small></span></div>}
            {!voiceActive && voice?.phase === "closed" && <div className="voice-receipt" role="status">Voz encerrada · {formatVoiceTime(voice.seconds)} · {voice.usageConfirmed ? "duração confirmada" : "consumo final não confirmado"}{voice.reason === "inactivity" ? " · por inatividade" : voice.reason === "duration_limit" ? " · limite de duração" : ""}</div>}
            <div className="composer">
              <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Fale com Gudman…" rows={1} disabled={!sessionId || voiceActive} />
              {view === "memory" && <button className="voice-button" aria-label="Iniciar conversa ao vivo" title="Conversar ao vivo (usa créditos de API)" disabled={!sessionId || busy || voiceActive} onClick={() => void startVoice()}><Mic size={17} /></button>}
              {busy ? <button className="send-button stop" aria-label="Interromper" onClick={() => abortRef.current?.abort()}><Square size={14} fill="currentColor" /></button> : <button className="send-button" aria-label="Enviar" disabled={!input.trim() || !sessionId || voiceActive} onClick={() => void send()}><CornerDownLeft size={17} /></button>}
            </div>
            <div className="composer-hint"><span>{voiceActive ? "Encerre a voz para enviar texto ou memorizar." : "Enter envia · Voz usa créditos por tempo conectado"}</span>{model && <span>{voiceActive ? "gpt-live-1" : model}</span>}</div>
          </div>
        </section>
        {commandsOpen && <aside className="command-drawer"><div className="command-header"><div><span className="eyebrow">Atalhos</span><h2>Comandos</h2></div><button className="button icon-only ghost" onClick={() => setCommandsOpen(false)}><X size={17} /></button></div><p>Você pode digitar os comandos ou usar os botões da interface.</p><div className="command-list">{commands.map((item) => <button key={item.command} onClick={() => { if (item.command === "/memorizar") void curate(); else if (item.command === "/limpar") void newSession(); setCommandsOpen(false); }}><code>{item.command}</code><strong>{item.title}</strong><span>{item.description}</span></button>)}</div><div className="command-note"><BrainCircuit size={16} /><span>A curadoria apenas cria propostas. Cada mudança ainda precisa da sua aprovação.</span></div></aside>}
      </div>
      </FloatingChat>
    </div>
  );
}

function friendlyTool(name: string): string {
  return ({ memoria_buscar: "a memória", memoria_ler: "uma memória", memoria_listar: "o índice", hora: "o horário" } as Record<string, string>)[name] ?? name.replaceAll("_", " ");
}
