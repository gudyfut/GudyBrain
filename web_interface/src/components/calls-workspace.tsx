"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, BrainCircuit, Check, ChevronRight, Clock3, FileAudio, FileText, LoaderCircle, MessageSquareText, Radio, RefreshCw, Sparkles, UsersRound } from "lucide-react";

interface Call { id: string; status: string; startedAt: string | null; endedAt: string | null; durationSeconds: number; guild: string; channel: string; participants: string[]; hasTranscript: boolean; hasAnalysis: boolean; hasCuration: boolean; stage: "gravada" | "transcrita" | "analisada" | "curada" }
interface CallDetail extends Call { tracks: Array<{ userId: string; name: string; username: string; files: Array<{ name: string; relativePath: string; durationSeconds: number }> }>; analysis: Record<string, unknown> | null; quality: Record<string, unknown> | null }
interface Job { id: string; kind: "transcrever" | "analisar"; sessionId: string; force: boolean; status: "na_fila" | "executando" | "concluido" | "erro"; logs: string[]; error: string | null }

export function CallsWorkspace() {
  const router = useRouter();
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeTab, setActiveTab] = useState<"summary" | "transcript" | "audio">("summary");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    const [callsResponse, jobsResponse] = await Promise.all([fetch("/api/calls", { cache: "no-store" }), fetch("/api/calls/jobs", { cache: "no-store" })]);
    const callsData = await callsResponse.json() as { calls: Call[] };
    const jobsData = await jobsResponse.json() as { jobs: Job[] };
    setCalls(callsData.calls ?? []); setJobs(jobsData.jobs ?? []);
    setSelectedId((current) => current ?? callsData.calls?.[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const response = await fetch(`/api/calls?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json() as CallDetail & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Falha ao abrir a call.");
    setDetail(data);
  }, []);

  useEffect(() => { void loadCalls().catch((caught) => setError(String(caught))).finally(() => setLoading(false)); }, [loadCalls]);
  useEffect(() => { if (selectedId) { setTranscript(null); setActiveTab("summary"); void loadDetail(selectedId).catch((caught) => setError(String(caught))); } }, [selectedId, loadDetail]);
  useEffect(() => {
    const active = jobs.some((job) => job.status === "na_fila" || job.status === "executando");
    if (!active) return;
    const timer = setInterval(() => { void loadCalls(); if (selectedId) void loadDetail(selectedId); }, 2200);
    return () => clearInterval(timer);
  }, [jobs, selectedId, loadCalls, loadDetail]);

  async function startJob(kind: "transcrever" | "analisar", force = false): Promise<void> {
    if (!selectedId) return;
    setWorking(true); setError(null);
    try {
      const response = await fetch("/api/calls/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, sessionId: selectedId, force }) });
      const data = await response.json() as Job & { error?: string };
      if (!response.ok) setError(data.error ?? "Não foi possível iniciar a tarefa.");
      await loadCalls();
    } finally {
      setWorking(false);
    }
  }

  async function loadTranscript(): Promise<void> {
    if (!selectedId || transcript !== null) return;
    const response = await fetch(`/api/calls?id=${encodeURIComponent(selectedId)}&transcript=1`);
    const data = await response.json() as { transcript?: string; error?: string };
    if (!response.ok) { setError(data.error ?? "Falha ao abrir transcrição."); return; }
    setTranscript(data.transcript ?? "");
  }

  async function curate(): Promise<void> {
    if (!selectedId) return;
    setWorking(true);
    const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "call", id: selectedId }) });
    const data = await response.json() as { id?: string; error?: string };
    setWorking(false);
    if (!response.ok || !data.id) { setError(data.error ?? "Falha ao iniciar curadoria."); return; }
    router.push(`/memory?tab=review&review=${encodeURIComponent(data.id)}`);
  }

  const latestJob = jobs.find((job) => job.sessionId === selectedId);
  const currentJob = jobs.find((job) => job.sessionId === selectedId && ["na_fila", "executando"].includes(job.status));
  const visibleJob = currentJob ?? (latestJob?.status === "erro" ? latestJob : undefined);

  return <div className="page calls-page">
    <header className="page-header"><div><span className="eyebrow">Do áudio à memória</span><h1>Fluxo de calls</h1><p>Acompanhe cada sessão da gravação até a decisão final de memória.</p></div><button className="button ghost" onClick={() => void loadCalls()}><RefreshCw size={15} /> Atualizar</button></header>
    {error && <div className="error-banner calls-error">{error}</div>}
    <div className="calls-layout">
      <section className="panel calls-list-panel"><div className="section-heading"><div><span className="eyebrow">Histórico</span><h2>{calls.length} sessões</h2></div></div><div className="call-list">{loading ? Array.from({ length: 5 }, (_, index) => <div className="skeleton call-skeleton" key={index} />) : calls.map((call) => <button key={call.id} className={selectedId === call.id ? "call-list-item active" : "call-list-item"} onClick={() => setSelectedId(call.id)}><div className="call-list-top"><span className="call-list-icon"><Radio size={16} /></span><span className={`stage-badge ${call.stage}`}>{call.stage}</span></div><strong>{call.channel}</strong><span>{formatDate(call.startedAt)}</span><div className="call-list-bottom"><small><UsersRound size={12} />{call.participants.length}</small><small><Clock3 size={12} />{duration(call.durationSeconds)}</small><ChevronRight size={14} /></div></button>)}</div></section>
      <section className="call-workspace">{detail ? <>
        <div className="panel call-overview"><div className="call-title-row"><div className="call-main-icon"><AudioLines size={24} /></div><div><span className="eyebrow">{detail.guild} · {detail.channel}</span><h2>{formatDate(detail.startedAt, true)}</h2><p>{detail.participants.join(", ") || "Nenhum participante identificado"} · {duration(detail.durationSeconds)}</p></div><span className={`stage-badge ${detail.stage}`}>{detail.stage}</span></div><Pipeline call={detail} /><div className="call-primary-actions">{!detail.hasTranscript && <button className="button primary" disabled={working || Boolean(currentJob)} onClick={() => void startJob("transcrever")}><FileText size={16} /> Transcrever</button>}{detail.hasTranscript && !detail.hasAnalysis && <button className="button primary" disabled={working || Boolean(currentJob)} onClick={() => void startJob("analisar")}><Sparkles size={16} /> Analisar conversa</button>}{detail.hasAnalysis && <button className="button ghost" title="Substitui o relatório atual por uma análise completa nova" disabled={working || Boolean(currentJob)} onClick={() => void startJob("analisar", true)}><RefreshCw size={16} /> Analisar novamente</button>}{detail.hasAnalysis && <button className="button primary" disabled={working || Boolean(currentJob)} onClick={() => void curate()}><BrainCircuit size={16} /> {detail.hasCuration ? "Nova curadoria" : "Enviar ao curador"}</button>}</div></div>
        {visibleJob && <JobPanel job={visibleJob} />}
        <div className="panel call-detail"><div className="tabs call-tabs"><button className={activeTab === "summary" ? "tab active" : "tab"} onClick={() => setActiveTab("summary")}><MessageSquareText size={14} /> Resumo</button><button className={activeTab === "transcript" ? "tab active" : "tab"} disabled={!detail.hasTranscript} onClick={() => { setActiveTab("transcript"); void loadTranscript(); }}><FileText size={14} /> Conversa</button><button className={activeTab === "audio" ? "tab active" : "tab"} onClick={() => setActiveTab("audio")}><FileAudio size={14} /> Áudios</button></div>{activeTab === "summary" ? <CallSummary detail={detail} /> : activeTab === "transcript" ? <TranscriptView transcript={transcript} /> : <AudioView detail={detail} />}</div>
      </> : <div className="panel empty-state"><div><span className="empty-icon"><Radio size={25} /></span><h3>Selecione uma call</h3><p>Abra uma sessão para acompanhar o processamento e consultar os arquivos.</p></div></div>}</section>
    </div>
  </div>;
}

function Pipeline({ call }: { call: Call }) {
  const steps = [{ label: "Gravada", done: true }, { label: "Transcrita", done: call.hasTranscript }, { label: "Analisada", done: call.hasAnalysis }, { label: "Curada", done: call.hasCuration }];
  return <div className="pipeline">{steps.map((step, index) => <div className={step.done ? "pipeline-step done" : "pipeline-step"} key={step.label}><span>{step.done ? <Check size={13} /> : index + 1}</span><small>{step.label}</small>{index < steps.length - 1 && <i />}</div>)}</div>;
}
function JobPanel({ job }: { job: Job }) { return <div className={job.status === "erro" ? "panel job-panel error" : "panel job-panel"}><div><span className="job-pulse">{job.status === "erro" ? <XIcon /> : <LoaderCircle size={17} className="spin-icon" />}</span><div><strong>{job.kind === "transcrever" ? "Transcrevendo a sessão" : job.force ? "Analisando novamente a conversa" : "Analisando a conversa"}</strong><small>{job.status === "na_fila" ? "Aguardando a tarefa anterior terminar" : job.error ?? job.logs.at(-1) ?? "Processando em segundo plano…"}</small></div></div>{job.logs.length > 0 && <details><summary>Ver logs</summary><pre>{job.logs.slice(-40).join("\n")}</pre></details>}</div>; }
function CallSummary({ detail }: { detail: CallDetail }) { const analysis = detail.analysis; const context = analysis?.conversation_context as Record<string, unknown> | undefined; return <div className="call-summary-content">{analysis ? <><span className="eyebrow">Relatório do analista</span><h3>{String(analysis.summary ?? context?.summary ?? "Conversa analisada")}</h3><div className="analysis-grid"><Info label="Atividade" value={String(context?.primary_activity ?? "Não determinada")} /><Info label="Tom" value={String(context?.tone ?? "Não determinado")} /><Info label="Potencial por blocos" value={memoryBlockSummary(analysis)} /><Info label="Observações" value={Array.isArray(analysis.observations) ? `${analysis.observations.length} encontradas` : "—"} /></div>{context?.curator_recommendation && <div className="curator-recommendation"><BrainCircuit size={18} /><div><strong>Recomendação ao curador</strong><p>{String((context.curator_recommendation as Record<string, unknown>).rationale ?? "Analise as observações com rigor.")}</p></div></div>}</> : <div className="empty-state"><div><span className="empty-icon"><Sparkles size={25} /></span><h3>Call ainda não analisada</h3><p>Depois da transcrição, o analista produz contexto, observações e uma recomendação para o curador.</p></div></div>}</div>; }
function TranscriptView({ transcript }: { transcript: string | null }) { return <div className="transcript-view">{transcript === null ? <div className="detail-loading"><LoaderCircle size={17} className="spin-icon" /> Carregando somente agora…</div> : transcript ? transcript.split(/\r?\n/).map((line, index) => <p key={index}>{line}</p>) : <div className="empty-compact">Transcrição vazia.</div>}</div>; }
function AudioView({ detail }: { detail: CallDetail }) { return <div className="track-list">{detail.tracks.map((track) => <div className="track-card" key={track.userId}><div><span className="participant-avatar">{initials(track.name)}</span><div><strong>{track.name}</strong><small>@{track.username || track.userId}</small></div></div>{track.files.map((file) => <div className="audio-row" key={file.relativePath}><span>{file.name} · {duration(file.durationSeconds)}</span><audio controls preload="none" src={`/api/calls/audio?session=${encodeURIComponent(detail.id)}&track=${encodeURIComponent(file.relativePath)}`} /></div>)}</div>)}</div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="analysis-info"><small>{label}</small><strong>{value.replaceAll("_", " ")}</strong></div>; }
function XIcon() { return <span aria-hidden>!</span>; }
function formatDate(value: string | null, long = false) { if (!value) return "Data desconhecida"; return new Intl.DateTimeFormat("pt-BR", long ? { dateStyle: "long", timeStyle: "medium" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function duration(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const secs = Math.round(seconds % 60); return hours ? `${hours}h ${minutes}min` : minutes ? `${minutes}min ${secs}s` : `${secs}s`; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function memoryBlockSummary(analysis: Record<string, unknown>) { const blocks = Array.isArray(analysis.memory_blocks) ? analysis.memory_blocks : []; const count = (signal: string) => { const block = blocks.find((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).signal === signal) as Record<string, unknown> | undefined; return Array.isArray(block?.observation_ids) ? block.observation_ids.length : 0; }; return `Alto ${count("alto")} · Médio ${count("medio")} · Baixo ${count("baixo")}`; }
