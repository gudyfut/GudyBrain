"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, BrainCircuit, Command, CornerDownLeft, LoaderCircle, MessageCircleMore, Mic, Plus, Square, UserRound, Volume2, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { RetrievalEvent } from "@gudybrain/core/retrieval-events";
import { MemoryAtlas } from "./memory-atlas";
import { FloatingChat } from "./floating-chat";
import "./neural-chat.css";
import { initialTrace, reduceTrace, type RetrievalTrace } from "./retrieval-state";
import { startVoiceTranscription, type VoiceCapture } from "./voice-transcription";
import { StreamedSpeech } from "./streamed-speech";

interface UiMessage { id: string; role: "user" | "assistant"; content: string; trace?: RetrievalTrace }

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
  const [voicePhase, setVoicePhase] = useState<"idle" | "connecting" | "listening" | "finishing">("idle");
  const [voicePreview, setVoicePreview] = useState("");
  const [voiceDraft, setVoiceDraft] = useState(false);
  const [speechState, setSpeechState] = useState<"idle" | "loading" | "playing">("idle");
  const [speechMessageId, setSpeechMessageId] = useState<string | null>(null);
  const generation = useRef(0);
  const requestBusy = useRef(false);
  const nearBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceCapture = useRef<VoiceCapture | null>(null);
  const voiceEpoch = useRef(0);
  const speechEpoch = useRef(0);
  const speechAbort = useRef<AbortController | null>(null);
  const speechAudio = useRef<StreamedSpeech | null>(null);

  useEffect(() => { void newSession(); return () => {
    generation.current++; voiceEpoch.current++; abortRef.current?.abort(); voiceCapture.current?.cancel();
    speechAbort.current?.abort(); speechAudio.current?.stop();
  }; }, []);
  useEffect(() => { if (nearBottom.current) endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth" }); }, [messages, activity, busy]);

  async function newSession(): Promise<void> {
    const version = ++generation.current;
    abortRef.current?.abort(); abortRef.current = null; requestBusy.current = false;
    voiceEpoch.current++; voiceCapture.current?.cancel(); voiceCapture.current = null;
    setVoicePhase("idle"); setVoicePreview(""); setVoiceDraft(false); stopSpeech();
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

  function stopSpeech(): void {
    speechEpoch.current++;
    speechAbort.current?.abort(); speechAbort.current = null;
    speechAudio.current?.stop(); speechAudio.current = null;
    setSpeechState("idle"); setSpeechMessageId(null);
  }

  async function playSpeech(text: string, messageId: string, currentSessionId = sessionId): Promise<void> {
    if (!currentSessionId || !text.trim()) return;
    stopSpeech();
    const version = speechEpoch.current;
    const controller = new AbortController();
    speechAbort.current = controller;
    setSpeechState("loading"); setSpeechMessageId(messageId);
    try {
      const player = new StreamedSpeech();
      speechAudio.current = player;
      await player.resume();
      const response = await fetch("/api/chat/voice/speech", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId, text }), signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Não foi possível gerar a voz.");
      }
      if (!response.body || !response.headers.get("Content-Type")?.toLowerCase().startsWith("audio/l16")) throw new Error("Formato de áudio inesperado.");
      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (version !== speechEpoch.current) { await reader.cancel(); return; }
        if (done) break;
        if (player.append(value)) setSpeechState("playing");
      }
      await player.finish();
      if (version === speechEpoch.current) stopSpeech();
    } catch (caught) {
      if (version !== speechEpoch.current || controller.signal.aborted) return;
      stopSpeech();
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function startVoice(): Promise<void> {
    if (!sessionId || requestBusy.current || voicePhase !== "idle") return;
    stopSpeech(); setError(null); setVoicePreview(""); setVoicePhase("connecting");
    const version = ++voiceEpoch.current;
    try {
      const capture = await startVoiceTranscription(sessionId,
        (text) => { if (version === voiceEpoch.current) setVoicePreview(text); },
        (message) => { if (version === voiceEpoch.current) {
          voiceCapture.current = null; setVoicePhase("idle"); setError(message);
        } },
      );
      if (version !== voiceEpoch.current) { capture.cancel(); return; }
      voiceCapture.current = capture;
      setVoicePhase("listening");
    } catch (caught) {
      if (version === voiceEpoch.current) {
        setVoicePhase("idle"); setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
  }

  async function finishVoice(): Promise<void> {
    const capture = voiceCapture.current;
    if (!capture || voicePhase !== "listening") return;
    setVoicePhase("finishing");
    const version = voiceEpoch.current;
    try {
      const transcript = await capture.stop();
      if (version !== voiceEpoch.current) return;
      if (!transcript.trim()) throw new Error("Não recebi uma transcrição. Tente falar novamente.");
      setInput((current) => [current.trim(), transcript.trim()].filter(Boolean).join(" "));
      setVoiceDraft(true);
      setVoicePreview("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (caught) {
      if (version === voiceEpoch.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (version === voiceEpoch.current) { voiceCapture.current = null; setVoicePhase("idle"); }
    }
  }

  function cancelVoice(): void {
    voiceEpoch.current++;
    voiceCapture.current?.cancel();
    voiceCapture.current = null;
    setVoicePhase("idle");
    setVoicePreview("");
  }

  async function curate(): Promise<void> {
    if (!sessionId || !messages.length || requestBusy.current) return;
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
    if (!text || requestBusy.current || !sessionId || voicePhase !== "idle") return;
    if (text === "/limpar") { setInput(""); await newSession(); return; }
    if (text === "/ajuda") { setInput(""); setCommandsOpen(true); return; }
    if (text === "/memorizar") { setInput(""); await curate(); return; }

    const version = generation.current;
    const readAloud = voiceDraft;
    setVoiceDraft(false);
    stopSpeech();
    requestBusy.current = true; nearBottom.current = true;
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    setSelectedId(assistantId);
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "", trace: initialTrace() }]);
    setInput(""); setBusy(true); setError(null); setActivity("Gudman está pensando");
    const controller = new AbortController();
    abortRef.current = controller;
    let pending = "";
    let answerText = "";
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
            answerText += event.content;
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
        if (completed && outcome === "done" && readAloud && answerText.trim()) {
          void playSpeech(answerText, assistantId, sessionId);
        }
      }
    }
  }

  return (
    <div className="chat-page neural-chat">
      <MemoryAtlas trace={messages.find((message) => message.id === selectedId)?.trace} selectedId={selectedId} busy={busy} onSelect={setSelectedId} moments={messages.flatMap((message, index) => message.role === "assistant" ? [{ id: message.id, label: messages[index - 1]?.content ?? "Conversa", phase: message.trace?.phase }] : [])} />
      <FloatingChat busy={busy}>
      <header className="chat-topbar">

        <div className="chat-actions">
          <button className="button ghost" onClick={() => setCommandsOpen((value) => !value)}><Command size={16} /> Comandos</button>
          <button className="button ghost" onClick={() => void newSession()}><Plus size={16} /> Nova conversa</button>
          <button className="button primary" disabled={!messages.length || busy} onClick={() => void curate()}><BrainCircuit size={16} /> Memorizar</button>
        </div>
      </header>
      <div className={commandsOpen ? "chat-body commands-visible" : "chat-body"}>
        <section className="conversation" aria-live="polite">
          <div className="message-stream" onScroll={(event) => { const el = event.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150; }}>
            {!messages.length && <div className="chat-welcome"><span className="welcome-mark"><MessageCircleMore size={27} /></span><span className="eyebrow">Conectado à sua memória</span><h1>Uma ideia. Novas conexões.</h1><p>Converse comigo e acompanhe o contexto ganhando forma no núcleo.</p><div className="prompt-suggestions"><button onClick={() => setInput("O que você lembra sobre as pessoas mais próximas de mim?")}>Pessoas próximas</button><button onClick={() => setInput("Me ajude a organizar o que tenho pensado ultimamente.")}>Organizar pensamentos</button><button onClick={() => setInput("Quais eventos marcantes estão registrados?")}>Eventos marcantes</button></div></div>}
            {messages.map((message, index) => {
              const targetId = message.role === "assistant" ? message.id : messages[index + 1]?.id;
              return <article className={`message ${message.role} ${selectedId === targetId ? "moment-selected" : ""}`} key={message.id} onClick={(event) => { if (targetId && !(event.target as Element).closest("a, button")) setSelectedId(targetId); }}><div className="message-avatar">{message.role === "user" ? <UserRound size={14} /> : <Bot size={14} />}</div><div className="message-content"><span className="message-author">{message.role === "user" ? "Você" : "Gudman"}</span>{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : busy && message.id === messages.at(-1)?.id && message.role === "assistant" ? <div className="typing"><i /><i /><i /></div> : message.trace?.phase === "cancelled" ? <p>Resposta interrompida.</p> : message.trace?.phase === "error" ? <p>Não foi possível concluir a resposta.</p> : null}{message.role === "assistant" && <div className="message-tools"><button className="message-moment" aria-pressed={selectedId === message.id} onClick={() => setSelectedId(message.id)}><BrainCircuit size={12} />{message.trace?.phase === "cancelled" ? "Busca cancelada" : message.trace?.phase === "error" ? "Busca interrompida" : selectedId === message.id ? "Percurso em exibição" : "Ver percurso no núcleo"}</button>{message.content && <button className="message-moment" onClick={() => speechMessageId === message.id ? stopSpeech() : void playSpeech(message.content, message.id)}>{speechMessageId === message.id ? speechState === "loading" ? <LoaderCircle size={12} className="spin-icon" /> : <Square size={11} /> : <Volume2 size={12} />}{speechMessageId === message.id ? speechState === "loading" ? "Preparando voz" : "Parar áudio" : "Ouvir"}</button>}</div>}</div></article>;
            })}
            {activity && <div className="agent-activity"><LoaderCircle size={14} className="spin-icon" />{activity.includes("Consultando") ? <Wrench size={13} /> : null}<span>{activity}</span></div>}
            {error && <div className="error-banner">{error}{error.includes("Configurações") && <a href="/settings" className="button ghost">Abrir Configurações</a>}</div>}
            <div ref={endRef} />
          </div>
          <div className="composer-wrap">{voicePhase !== "idle" && <div className="voice-status" role="status"><span className="voice-pulse" />{voicePhase === "connecting" ? "Conectando microfone…" : voicePhase === "finishing" ? "Finalizando transcrição…" : "Ouvindo você…"}{voicePreview && <span className="voice-preview">{voicePreview}</span>}<button onClick={cancelVoice}>Descartar</button></div>}{voiceDraft && voicePhase === "idle" && <div className="voice-review">Transcrição pronta: revise o texto antes de enviar. A resposta será falada.</div>}<div className="composer"><textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Fale com Gudman…" rows={1} disabled={!sessionId || voicePhase !== "idle"} /><button className={`voice-button ${voicePhase === "listening" ? "recording" : ""}`} aria-label={voicePhase === "listening" ? "Terminar gravação" : "Iniciar gravação de voz"} title={voicePhase === "listening" ? "Terminar gravação" : "Falar com Gudman"} disabled={!sessionId || busy || voicePhase === "connecting" || voicePhase === "finishing"} onClick={() => voicePhase === "listening" ? void finishVoice() : void startVoice()}>{voicePhase === "connecting" || voicePhase === "finishing" ? <LoaderCircle size={17} className="spin-icon" /> : voicePhase === "listening" ? <Square size={14} fill="currentColor" /> : <Mic size={17} />}</button>{busy ? <button className="send-button stop" aria-label="Interromper" onClick={() => abortRef.current?.abort()}><Square size={14} fill="currentColor" /></button> : <button className="send-button" aria-label="Enviar" disabled={!input.trim() || !sessionId || voicePhase !== "idle"} onClick={() => void send()}><CornerDownLeft size={17} /></button>}</div><div className="composer-hint"><span><kbd>Enter</kbd> envia · <kbd>Shift</kbd> + <kbd>Enter</kbd> quebra linha</span>{model && <span>{model}</span>}</div></div>
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
