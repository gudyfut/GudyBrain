"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, BrainCircuit, Command, CornerDownLeft, LoaderCircle, MessageCircleMore, Plus, Square, UserRound, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface UiMessage { id: string; role: "user" | "assistant"; content: string }

const commands = [
  { command: "/memorizar", title: "Acurar conversa", description: "Entrega a conversa ao curador e abre as propostas." },
  { command: "/limpar", title: "Nova conversa", description: "Descarta o contexto curto e começa uma sessão limpa." },
  { command: "/ajuda", title: "Ver comandos", description: "Abre esta lista de ações da conversa." },
];

export function ChatWorkspace() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { void newSession(); return () => abortRef.current?.abort(); }, []);
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/settings");
        if (!response.ok) return;
        const data = await response.json() as { agents?: Array<{ id: string; model: string }> };
        const conversante = data.agents?.find((agent) => agent.id === "conversante");
        if (conversante?.model) setModel(conversante.model);
      } catch {
        // O rótulo do modelo é informativo; falhas de configuração aparecem nas outras telas.
      }
    })();
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth" }); }, [messages, activity, busy]);

  async function newSession(): Promise<void> {
    abortRef.current?.abort();
    setBusy(false); setMessages([]); setError(null); setActivity(null);
    const response = await fetch("/api/chat/session", { method: "POST" });
    const data = await response.json() as { id?: string; error?: string };
    if (!response.ok || !data.id) { setError(data.error ?? "Não foi possível iniciar a conversa."); return; }
    setSessionId(data.id);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function curate(): Promise<void> {
    if (!sessionId || !messages.length || busy) return;
    setActivity("Preparando curadoria…");
    const response = await fetch("/api/reviews", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "chat", id: sessionId }),
    });
    const data = await response.json() as { id?: string; error?: string };
    if (!response.ok || !data.id) { setError(data.error ?? "Não foi possível iniciar a curadoria."); setActivity(null); return; }
    router.push(`/memory?tab=review&review=${encodeURIComponent(data.id)}`);
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || busy || !sessionId) return;
    if (text === "/limpar") { setInput(""); await newSession(); return; }
    if (text === "/ajuda") { setInput(""); setCommandsOpen(true); return; }
    if (text === "/memorizar") { setInput(""); await curate(); return; }

    const userMessage: UiMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput(""); setBusy(true); setError(null); setActivity("Gudman está pensando");
    const controller = new AbortController();
    abortRef.current = controller;
    let pending = "";
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (!pending) return;
      const chunk = pending; pending = "";
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + chunk } : message));
    };
    try {
      const response = await fetch("/api/chat/message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }), signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("A resposta de Gudman não pôde ser iniciada.");
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
          const event = JSON.parse(line) as { type: string; content?: string; name?: string; message?: string };
          if (event.type === "content" && event.content) {
            pending += event.content;
            if (frame === null) frame = requestAnimationFrame(flush);
            setActivity(null);
          } else if (event.type === "tool") {
            setActivity(`Consultando ${friendlyTool(event.name ?? "memória")}`);
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Gudman encontrou um erro.");
          }
        }
      }
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false); setActivity(null); abortRef.current = null;
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className="chat-page">
      <header className="chat-topbar">
        <div className="chat-identity"><span><Bot size={19} /></span><div><strong>Gudman</strong><small><i className="status-dot ok" /> online · memória conectada</small></div></div>
        <div className="chat-actions">
          <button className="button ghost" onClick={() => setCommandsOpen((value) => !value)}><Command size={16} /> Comandos</button>
          <button className="button ghost" onClick={() => void newSession()}><Plus size={16} /> Nova conversa</button>
          <button className="button primary" disabled={!messages.length || busy} onClick={() => void curate()}><BrainCircuit size={16} /> Acurar</button>
        </div>
      </header>
      <div className={commandsOpen ? "chat-body commands-visible" : "chat-body"}>
        <section className="conversation" aria-live="polite">
          <div className="message-stream">
            {!messages.length && <div className="chat-welcome"><span className="welcome-mark"><MessageCircleMore size={27} /></span><span className="eyebrow">Conversa privada</span><h1>Sobre o que vamos conversar?</h1><p>Gudman pode consultar suas memórias quando isso ajudar, mas nunca as altera sem passar pela sua revisão.</p><div className="prompt-suggestions"><button onClick={() => setInput("O que você lembra sobre as pessoas mais próximas de mim?")}>Pessoas próximas</button><button onClick={() => setInput("Me ajude a organizar o que tenho pensado ultimamente.")}>Organizar pensamentos</button><button onClick={() => setInput("Quais eventos marcantes estão registrados?")}>Eventos marcantes</button></div></div>}
            {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === "user" ? <UserRound size={17} /> : <Bot size={17} />}</div><div className="message-content"><span className="message-author">{message.role === "user" ? "Você" : "Gudman"}</span>{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : busy && message.role === "assistant" ? <div className="typing"><i /><i /><i /></div> : null}</div></article>)}
            {activity && <div className="agent-activity"><LoaderCircle size={14} className="spin-icon" />{activity.includes("Consultando") ? <Wrench size={13} /> : null}<span>{activity}</span></div>}
            {error && <div className="error-banner">{error}</div>}
            <div ref={endRef} />
          </div>
          <div className="composer-wrap"><div className="composer"><textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Fale com Gudman…" rows={1} disabled={!sessionId} />{busy ? <button className="send-button stop" aria-label="Interromper" onClick={() => abortRef.current?.abort()}><Square size={14} fill="currentColor" /></button> : <button className="send-button" aria-label="Enviar" disabled={!input.trim() || !sessionId} onClick={() => void send()}><CornerDownLeft size={17} /></button>}</div><div className="composer-hint"><span><kbd>Enter</kbd> envia · <kbd>Shift</kbd> + <kbd>Enter</kbd> quebra linha</span>{model && <span>{model}</span>}</div></div>
        </section>
        <aside className="command-drawer"><div className="command-header"><div><span className="eyebrow">Atalhos</span><h2>Comandos</h2></div><button className="button icon-only ghost" onClick={() => setCommandsOpen(false)}><X size={17} /></button></div><p>Você pode digitar os comandos ou usar os botões da interface.</p><div className="command-list">{commands.map((item) => <button key={item.command} onClick={() => { if (item.command === "/memorizar") void curate(); else if (item.command === "/limpar") void newSession(); setCommandsOpen(false); }}><code>{item.command}</code><strong>{item.title}</strong><span>{item.description}</span></button>)}</div><div className="command-note"><BrainCircuit size={16} /><span>A curadoria apenas cria propostas. Cada mudança ainda precisa da sua aprovação.</span></div></aside>
      </div>
    </div>
  );
}

function friendlyTool(name: string): string {
  return ({ memoria_buscar: "a memória", memoria_ler: "uma memória", memoria_listar: "o índice", hora: "o horário" } as Record<string, string>)[name] ?? name.replaceAll("_", " ");
}
