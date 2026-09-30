"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle, LogOut, RefreshCw } from "lucide-react";
import type { ChatGPTModel, ChatGPTStatus } from "@gudybrain/core/chatgpt-auth";

interface Connection extends ChatGPTStatus { model: string; usageUrl: string; loginError?: string }

export function ChatGPTConnection({ onModelChange }: { onModelChange: () => void }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/chatgpt", { cache: "no-store" });
      const value = await response.json() as Connection & { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Não foi possível conferir a conexão ChatGPT.");
      if (version !== generation.current) return;
      setConnection(value); setModels([]);
      if (value.loginError) setError(value.loginError);
      if (value.connected && value.planEnabled) {
        const listed = await actionRequest("models") as { models: ChatGPTModel[] };
        if (version === generation.current) setModels(listed.models);
      }
    } catch (caught) { if (version === generation.current) setError(errorText(caught)); }
    finally { if (version === generation.current) setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);

  async function mutate(action: string, fields: Record<string, string> = {}) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const next = await actionRequest(action, fields) as Connection & { notice?: string };
      setConnection(next);
      if (next.notice) setNotice(next.notice);
      if (action === "model") {
        onModelChange();
        setNotice("Modelo salvo. Inicie uma nova conversa para usá-lo.");
      } else {
        setModels([]);
        if (next.connected && next.planEnabled) setModels((await actionRequest("models") as { models: ChatGPTModel[] }).models);
        if (action === "select") setNotice("Conta selecionada. Inicie uma nova conversa para continuar.");
      }
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    setBusy(true); setError(null); setNotice(null);
    try {
      let totalMs = 0;
      for (const mode of ["text", "structured"]) {
        const result = await actionRequest("diagnose", { mode }) as { ok: boolean; elapsedMs: number; error?: string };
        if (!result.ok) throw new Error(result.error ?? "A comunicação com o modelo falhou.");
        totalMs += result.elapsedMs;
      }
      setNotice(`Comunicação validada: resposta de texto e saída estruturada funcionando (${(totalMs / 1000).toFixed(1)} s).`);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }

  const active = connection?.accounts.find((account) => account.id === connection.activeId);
  return <section className="panel settings-section chatgpt-connection">
    <div className="chatgpt-heading"><div><span className="eyebrow">Modelo de conversa</span><h2>Conecte seu ChatGPT ao Gudman</h2><p>Use seu plano para responder e preparar propostas de memória.</p></div>
      <span className={`chatgpt-status ${connection?.connected && connection.planEnabled ? "connected" : ""}`}>{busy ? <LoaderCircle size={14} className="spin-icon" /> : connection?.connected && connection.planEnabled ? <Check size={14} /> : null}{connection?.connected ? connection.planEnabled ? "Plano conectado" : "Uso do plano não autorizado" : "Desconectado"}</span>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="success-banner" role="status">{notice}</div>}
    <div className="chatgpt-controls">
      {connection && connection.accounts.length > 0 && <label>Conta / workspace<select value={connection.activeId ?? ""} disabled={busy} onChange={(event) => void mutate("select", { accountId: event.target.value })}>
        {!connection.activeId && <option value="" disabled>Escolha uma conta</option>}
        {connection.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}{!account.signedIn ? " · reconectar" : ""}</option>)}
      </select></label>}
      {connection?.planEnabled && <label>Modelo<select value={connection.model} disabled={busy || !models.length} onChange={(event) => void mutate("model", { model: event.target.value })}>
        {!models.some((model) => model.slug === connection.model) && <option value={connection.model}>{connection.model}{models.length ? " · indisponível nesta conta" : ""}</option>}
        {models.map((model) => <option key={model.slug} value={model.slug}>{model.displayName}</option>)}
      </select></label>}
    </div>
    <div className="chatgpt-actions">
      {(!connection?.connected || !connection.planEnabled) && <form method="post" action="/api/chatgpt">
        <input type="hidden" name="action" value="signin" />{active && <input type="hidden" name="accountId" value={active.id} />}
        <button type="submit" className="chatgpt-signin" disabled={busy}>Continue with ChatGPT</button>
      </form>}
      {connection?.connected && connection.planEnabled && active && <form method="post" action="/api/chatgpt"><input type="hidden" name="action" value="signin" /><input type="hidden" name="accountId" value={active.id} /><button type="submit" className="button ghost" disabled={busy}>Reconectar</button></form>}
      {active && <form method="post" action="/api/chatgpt"><input type="hidden" name="action" value="signin" /><button type="submit" className="button ghost" disabled={busy}>Adicionar outra conta</button></form>}
      <button className="button ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Atualizar</button>
      {connection?.connected && connection.planEnabled && <button className="button ghost" disabled={busy} onClick={() => void testConnection()} title="Faz duas chamadas curtas de teste e consome uso do plano"><Check size={14} /> Testar comunicação</button>}
      {connection?.connected && <button className="button ghost" disabled={busy} onClick={() => void mutate("signout")}><LogOut size={14} /> Desconectar</button>}
      <a className="button ghost" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Gerenciar uso</a>
    </div>
    <p className="chatgpt-footnote">O consumo compartilha a cota do Codex / ChatGPT Work. Você pode definir um limite semanal para o Gudman no ChatGPT. As credenciais ficam protegidas neste computador.</p>
  </section>;
}

async function actionRequest(action: string, fields: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch("/api/chatgpt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...fields }) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Não foi possível atualizar a conexão ChatGPT.");
  return data;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : "Não foi possível atualizar a conexão ChatGPT."; }
