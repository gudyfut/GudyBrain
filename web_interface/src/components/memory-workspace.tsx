"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpenText, BrainCircuit, Check, CheckCircle2, ChevronRight, Clock3, FileDiff, FolderSearch2, LoaderCircle, Pencil, RefreshCw, Save, Search, Undo2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EditableDiff } from "./editable-diff";
import {
  actionableCandidates,
  candidateStatusCounts,
  candidateStatusLabel,
  nextActionableId,
} from "./review-state";

interface MemoryItem { path: string; title: string; type: string; description: string; category: string | null; updatedAt: string }
interface Candidate { id: string; acao: "criar" | "atualizar"; pathOrigem?: string; path: string; frontmatter: Record<string, unknown>; corpo: string; motivo: string; naturezaProposta: string; evidencias: string[]; noveltyAssessments?: Array<{ observationId: string; classification: string; reason: string; comparedPath?: string }>; consultedPaths?: string[]; decision: "pendente" | "aprovada" | "rejeitada" | "erro"; result: string | null }
interface Review { id: string; source: { kind: "chat" | "call"; id: string }; status: "na_fila" | "analisando" | "revisao" | "concluida" | "erro"; createdAt: string; updatedAt: string; progress: string[]; candidates: Candidate[]; coverage?: { requiredObservationIds: string[]; unresolvedObservationIds: string[]; issues: string[]; noveltySummary?: Record<string, number> } | null; error: string | null }

export function MemoryWorkspace() {
  const [tab, setTab] = useState<"library" | "review">("library");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [memoryContent, setMemoryContent] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [activeReview, setActiveReview] = useState<Review | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "info"; text: string } | null>(null);

  const loadMemories = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    const response = await fetch(`/api/memory?${params}`);
    const data = await response.json() as { items?: MemoryItem[]; error?: string };
    if (!response.ok) throw new Error(data.error);
    setItems(data.items ?? []);
  }, [query, type]);

  const loadReviews = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/reviews", { cache: "no-store" });
    const data = await response.json() as { reviews: Review[] };
    setReviews(data.reviews ?? []);
    const wanted = preferredId ?? activeReview?.id;
    if (!wanted) return;
    const detailResponse = await fetch(`/api/reviews?id=${encodeURIComponent(wanted)}`, { cache: "no-store" });
    if (!detailResponse.ok) return;
    const detail = await detailResponse.json() as Review;
    setActiveReview(detail);
    setSelectedCandidateId((current) => current && detail.candidates.some((candidate) => candidate.id === current)
      ? current
      : nextActionableId(detail.candidates) ?? detail.candidates[0]?.id ?? null);
  }, [activeReview?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reviewId = params.get("review");
    if (params.get("tab") === "review" || reviewId) setTab("review");
    Promise.all([loadMemories(), loadReviews(reviewId ?? undefined)])
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void loadMemories().catch((caught: unknown) => setError(String(caught))), 220);
    return () => clearTimeout(timer);
  }, [loadMemories]);
  useEffect(() => {
    if (!activeReview || !["na_fila", "analisando"].includes(activeReview.status)) return;
    const timer = setInterval(() => void loadReviews(activeReview.id), 1800);
    return () => clearInterval(timer);
  }, [activeReview, loadReviews]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timer);
  }, [notice]);

  async function openMemory(item: MemoryItem): Promise<void> {
    setError(null); setSelectedMemory(item); setMemoryContent("");
    const response = await fetch(`/api/memory?path=${encodeURIComponent(item.path)}`);
    const data = await response.json() as { content?: string; error?: string };
    if (!response.ok) { setError(data.error ?? "Falha ao abrir memória."); return; }
    setMemoryContent(data.content ?? "");
  }

  function openReview(review: Review): void {
    setActiveReview(review);
    setSelectedCandidateId(nextActionableId(review.candidates) ?? review.candidates[0]?.id ?? null);
    void loadReviews(review.id);
  }

  function updateReview(updated: Review, candidateId: string, message: string, kind: "success" | "info"): void {
    setActiveReview(updated);
    setReviews((current) => current.map((review) => review.id === updated.id ? updated : review));
    // Mantém o card decidido em foco para que a confirmação verde/vermelha
    // seja inequívoca. O usuário avança quando terminar de conferir o estado.
    setSelectedCandidateId(candidateId);
    setNotice({ kind, text: message });
    void loadMemories();
  }

  const memoryTypes = useMemo(() => [...new Set(items.map((item) => item.type))].sort(), [items]);
  const pendingCandidates = actionableCandidates(activeReview?.candidates ?? []);
  const candidate = activeReview?.candidates.find((item) => item.id === selectedCandidateId) ?? null;
  const statusCounts = candidateStatusCounts(activeReview?.candidates ?? []);

  return <div className="page memory-page">
    <header className="page-header"><div><span className="eyebrow">Conhecimento pessoal</span><h1>Memória</h1><p>Consulte o que Gudman conhece e mantenha controle explícito sobre cada alteração.</p></div><div className="tabs"><button className={tab === "library" ? "tab active" : "tab"} onClick={() => setTab("library")}><BookOpenText size={14} /> Biblioteca</button><button className={tab === "review" ? "tab active" : "tab"} onClick={() => setTab("review")}><FileDiff size={14} /> Acurácia {pendingTotal(reviews) ? <b>{pendingTotal(reviews)}</b> : null}</button></div></header>
    {error && <div className="error-banner memory-error">{error}</div>}
    {notice && <div className={`workspace-toast ${notice.kind}`}><CheckCircle2 size={17} /><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X size={14} /></button></div>}
    {tab === "library" ? <div className="split-layout">
      <section className="panel list-panel"><div className="toolbar"><div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar em todas as memórias" /></div></div><select className="field type-filter" value={type} onChange={(event) => setType(event.target.value)}><option value="">Todos os tipos</option>{memoryTypes.map((value) => <option key={value}>{value}</option>)}</select><div className="list-summary">{items.length} registro(s)</div><div className="item-list">{loading ? Array.from({ length: 7 }, (_, index) => <div className="skeleton memory-skeleton" key={index} />) : items.map((item) => <button key={item.path} className={selectedMemory?.path === item.path ? "list-item active" : "list-item"} onClick={() => void openMemory(item)}><div className="list-item-meta"><span>{item.type}{item.category ? ` · ${item.category}` : ""}</span><ChevronRight size={13} /></div><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</button>)}</div></section>
      <section className="panel detail-panel memory-detail">{selectedMemory ? <MemoryDocument item={selectedMemory} content={memoryContent} onSaved={(summary, content) => { setSelectedMemory(summary); setMemoryContent(content); setItems((current) => current.map((item) => item.path === summary.path ? summary : item)); setNotice({ kind: "success", text: "Memória salva e revalidada com sucesso." }); void loadMemories(); }} onError={setError} /> : <Empty icon={<FolderSearch2 size={25} />} title="Selecione uma memória" text="Escolha um registro ao lado para ler seu conteúdo completo." />}</section>
    </div> : <div className="review-layout">
      <section className="panel review-sidebar"><div className="section-heading"><div><span className="eyebrow">Sessões</span><h2>Revisões</h2></div><button className="button icon-only ghost" onClick={() => void loadReviews()}><RefreshCw size={15} /></button></div><div className="item-list">{reviews.length ? reviews.map((review) => <button key={review.id} className={activeReview?.id === review.id ? "list-item active" : "list-item"} onClick={() => openReview(review)}><div className="list-item-meta"><span>{review.source.kind === "call" ? "Call" : "Conversa"}</span><ReviewStatus status={review.status} /></div><strong>{review.source.kind === "call" ? friendlySession(review.source.id) : "Conversa com Gudman"}</strong><p>{review.candidates.length ? `${review.candidates.length} proposta(s) · ${actionableCandidates(review.candidates).length} a revisar` : formatReviewStatus(review)}</p></button>) : <div className="empty-compact">Nenhuma revisão nesta execução.</div>}</div></section>
      <section className="panel candidate-list-panel">{activeReview ? <><div className="section-heading review-proposals-heading"><div><span className="eyebrow">Todas as propostas</span><h2>{activeReview.candidates.length || "—"} alterações</h2></div><ReviewStatus status={activeReview.status} /></div>{activeReview.coverage?.unresolvedObservationIds.length ? <div className="info-banner coverage-warning"><AlertTriangle size={15} /><span><strong>Cobertura parcial</strong><br />As propostas válidas foram preservadas, mas {activeReview.coverage.unresolvedObservationIds.length} de {activeReview.coverage.requiredObservationIds.length} observação(ões) ainda exigem revisão em uma nova curadoria.</span></div> : null}<div className="candidate-status-summary"><span className="pendente">{statusCounts.pendente} pendente(s)</span><span className="aprovada">{statusCounts.aprovada} aprovada(s)</span><span className="rejeitada">{statusCounts.rejeitada} rejeitada(s)</span>{statusCounts.erro > 0 && <span className="erro">{statusCounts.erro} com erro</span>}</div>{["na_fila", "analisando"].includes(activeReview.status) ? <ReviewLoading review={activeReview} /> : activeReview.error ? <div className="error-banner">{activeReview.error}</div> : activeReview.candidates.length ? <div className="candidate-nav">{activeReview.candidates.map((item, index) => <button key={item.id} className={selectedCandidateId === item.id ? `candidate-nav-item active ${item.decision}` : `candidate-nav-item ${item.decision}`} onClick={() => setSelectedCandidateId(item.id)}><span className="candidate-state-icon"><CandidateStateIcon decision={item.decision} fallback={index + 1} /></span><div><div className="candidate-card-title"><strong>{String(item.frontmatter.title ?? item.path.split("/").at(-1))}</strong><b className={`candidate-status-pill ${item.decision}`}>{candidateStatusLabel(item.decision)}</b></div><small>{item.acao === "criar" ? "Adição" : "Atualização"}{item.pathOrigem && item.pathOrigem !== item.path ? " · renomeia arquivo" : ""}</small>{item.decision === "erro" && <em>Corrija os dados e tente novamente</em>}</div><ChevronRight size={14} /></button>)}</div> : <Empty icon={<CheckCircle2 size={25} />} title="Nada durável encontrado" text="O curador analisou a fonte e não preparou nenhuma proposta." />}</> : <Empty icon={<FileDiff size={25} />} title="Escolha uma revisão" text="As revisões iniciadas no chat ou em uma call aparecem aqui." />}</section>
      <section className="panel candidate-detail-panel">{candidate && activeReview ? <CandidateEditor key={candidate.id} review={activeReview} candidate={candidate} onUpdated={(updated, candidateId, message, kind) => updateReview(updated, candidateId, message, kind)} onSelectCandidate={setSelectedCandidateId} /> : <Empty icon={activeReview && !pendingCandidates.length ? <CheckCircle2 size={25} /> : <BrainCircuit size={25} />} title={activeReview && !pendingCandidates.length ? "Tudo revisado" : "Proposta não selecionada"} text={activeReview && !pendingCandidates.length ? "Não há mais alterações aguardando sua decisão nesta sessão." : "Selecione uma alteração para comparar, editar, aprovar ou rejeitar."} />}</section>
    </div>}
  </div>;
}

function MemoryDocument({
  item,
  content,
  onSaved,
  onError,
}: {
  item: MemoryItem;
  content: string;
  onSaved: (summary: MemoryItem, content: string) => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(content); setEditing(false); }, [item.path, content]);

  async function save(): Promise<void> {
    setSaving(true); onError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, content: draft }),
      });
      const data = await response.json() as { summary?: MemoryItem; content?: string; error?: string };
      if (!response.ok || !data.summary || typeof data.content !== "string") {
        throw new Error(data.error ?? "Não foi possível salvar a memória.");
      }
      onSaved(data.summary, data.content);
      setEditing(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <div className="detail-title memory-document-title"><div><span className="badge">{item.type}</span><h2>{item.title}</h2><code>{item.path}</code></div><div className="memory-edit-actions">{editing ? <><button className="button ghost" disabled={saving} onClick={() => { setDraft(content); setEditing(false); }}><Undo2 size={14} /> Cancelar</button><button className="button success" disabled={saving || draft === content} onClick={() => void save()}>{saving ? <LoaderCircle size={14} className="spin-icon" /> : <Save size={14} />} Salvar memória</button></> : <button className="button ghost" onClick={() => setEditing(true)}><Pencil size={14} /> Editar texto</button>}</div></div>
    {!content ? <div className="detail-loading"><LoaderCircle className="spin-icon" size={18} /> Abrindo memória…</div> : editing ? <div className="memory-source-editor"><div className="diff-edit-hint"><Pencil size={13} /> Edite o Markdown integral. ID, status e proveniência permanecem protegidos.</div><textarea className="field memory-raw-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /></div> : <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>}
  </>;
}

function CandidateEditor({ review, candidate, onUpdated, onSelectCandidate }: { review: Review; candidate: Candidate; onUpdated: (review: Review, candidateId: string, message: string, kind: "success" | "info") => void; onSelectCandidate: (candidateId: string) => void }) {
  const creationConflict = candidate.acao === "criar" && /j[aá] existe/i.test(candidate.result ?? "");
  const [action, setAction] = useState<Candidate["acao"]>(creationConflict ? "atualizar" : candidate.acao);
  const [origin, setOrigin] = useState(creationConflict ? candidate.path : candidate.pathOrigem ?? candidate.path);
  const [path, setPath] = useState(candidate.path);
  const [current, setCurrent] = useState("");
  const [proposed, setProposed] = useState("");
  const proposedRef = useRef("");
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const conflict = candidate.acao === "criar" && /j[aá] existe/i.test(candidate.result ?? "");
    setAction(conflict ? "atualizar" : candidate.acao);
    setOrigin(conflict ? candidate.path : candidate.pathOrigem ?? candidate.path);
    setPath(candidate.path);
    setError(null);
    setCurrent("");
    setProposed("");
    proposedRef.current = "";
  }, [candidate.id]);
  useEffect(() => {
    if (!creationConflict) return;
    setAction("atualizar");
    setOrigin(candidate.path);
  }, [creationConflict, candidate.path]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingPreview(true); setError(null);
    fetch("/api/memory/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, origin: action === "atualizar" ? origin : undefined, frontmatter: candidate.frontmatter, body: candidate.corpo }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as { current?: string; proposed?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível montar a comparação.");
      const nextProposed = data.proposed ?? "";
      setCurrent(data.current ?? ""); setProposed(nextProposed); proposedRef.current = nextProposed;
    }).catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => { if (!controller.signal.aborted) setLoadingPreview(false); });
    return () => controller.abort();
  }, [action, origin, candidate.id]);

  async function decide(decision: "aprovar" | "rejeitar") {
    setWorking(true); setError(null);
    try {
      const response = await fetch("/api/reviews/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: review.id,
          candidateId: candidate.id,
          decision,
          edited: decision === "aprovar"
            ? { acao: action, pathOrigem: action === "atualizar" ? origin : undefined, path, conteudo: proposedRef.current }
            : undefined,
        }),
      });
      const data = await response.json() as Review & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível registrar a decisão.");
      const updated = data.candidates.find((item) => item.id === candidate.id);
      const remaining = actionableCandidates(data.candidates).length;
      const message = updated?.decision === "aprovada"
        ? remaining
          ? "Memória aprovada e aplicada. A próxima proposta já está pronta para revisão."
          : "Memória aprovada e aplicada. Esta revisão foi concluída."
        : updated?.decision === "rejeitada"
          ? "Proposta rejeitada e removida da fila pendente."
          : updated?.result ?? "Proposta atualizada para uma nova revisão.";
      onUpdated(data, candidate.id, message, updated?.decision === "aprovada" ? "success" : "info");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } finally { setWorking(false); }
  }
  const decided = candidate.decision === "aprovada" || candidate.decision === "rejeitada";
  const nextCandidateId = decided ? nextActionableId(review.candidates) : null;
  const changeProposed = (value: string): void => {
    proposedRef.current = value;
    setProposed(value);
  };
  return <div className="candidate-editor">
    <div className="candidate-kicker"><span className={action === "criar" ? "change-type create" : "change-type update"}>{action === "criar" ? "Adição" : "Atualização"}</span><span>{candidate.naturezaProposta.replaceAll("_", " ")}</span></div>
    <h2>{String(candidate.frontmatter.title ?? candidate.path)}</h2>
    <p className="candidate-reason">{candidate.motivo}</p>
    {candidate.noveltyAssessments?.length ? <div className="evidence-block"><span className="form-label">Comparação com a memória</span>{candidate.noveltyAssessments.map((assessment) => <p key={`${assessment.observationId}-${assessment.classification}`}><strong>{assessment.classification}</strong>{assessment.comparedPath ? ` · ${assessment.comparedPath}` : ""} — {assessment.reason}</p>)}</div> : null}
    <div className={`candidate-decision-status ${candidate.decision}`} aria-live="polite"><CandidateStateIcon decision={candidate.decision} /><div><strong>{candidateStatusLabel(candidate.decision)}</strong><span>{candidate.decision === "aprovada" ? "A alteração foi gravada na memória." : candidate.decision === "rejeitada" ? "A proposta não alterou a memória." : candidate.decision === "erro" ? "A alteração não foi gravada. Corrija a proposta e tente novamente." : "Aguardando sua decisão."}</span></div></div>
    {candidate.result?.startsWith("Erro:") && <div className="error-banner correction-help">A aplicação foi recusada sem alterar a memória. Ajuste a ação ou os caminhos abaixo e tente novamente.</div>}
    <div className="action-fields">
      <label className="form-label">Operação<select className="field" value={action} onChange={(event) => setAction(event.target.value as Candidate["acao"])} disabled={decided}><option value="criar">Adicionar memória nova</option><option value="atualizar">Atualizar memória existente</option></select></label>
      {action === "atualizar" && <label className="form-label">Arquivo existente<input className="field" value={origin} onChange={(event) => setOrigin(event.target.value)} disabled={decided} /></label>}
    </div>
    {action === "atualizar" && origin !== path && <div className="rename-notice"><FileDiff size={15} /><span>O arquivo será renomeado de <code>{origin}</code> para <code>{path}</code>.</span></div>}
    <label className="form-label">Arquivo final<input className="field" value={path} onChange={(event) => setPath(event.target.value)} disabled={decided} /></label>
    <div className="evidence-block"><span className="form-label">Evidências</span>{candidate.evidencias.length ? candidate.evidencias.map((evidence, index) => <blockquote key={index}>{evidence}</blockquote>) : <small>Nenhuma citação adicional.</small>}</div>
    {loadingPreview ? <div className="detail-loading"><LoaderCircle className="spin-icon" size={18} /> Montando comparação linha por linha…</div> : proposed && <EditableDiff current={current} proposed={proposed} onChange={changeProposed} disabled={decided || working} />}
    {error && <div className="error-banner">{error}</div>}
    {candidate.result && !candidate.result.startsWith("Erro:") && <div className="info-banner">{candidate.result}</div>}
    {decided ? <div className={`decision-complete ${candidate.decision}`}><div><CandidateStateIcon decision={candidate.decision} /><span>{candidate.decision === "aprovada" ? "Proposta aceita e aplicada com sucesso." : "Proposta rejeitada; nenhuma alteração foi aplicada."}</span></div>{nextCandidateId && <button className="button ghost compact" onClick={() => onSelectCandidate(nextCandidateId)}>Revisar próxima <ChevronRight size={14} /></button>}</div> : <div className="decision-bar"><button className="button danger" disabled={working} onClick={() => void decide("rejeitar")}><X size={16} /> Rejeitar</button><button className="button success" disabled={working || loadingPreview || !proposed} onClick={() => void decide("aprovar")}>{working ? <LoaderCircle size={15} className="spin-icon" /> : <Check size={16} />} Aprovar e aplicar</button></div>}
  </div>;
}

function CandidateStateIcon({ decision, fallback }: { decision: Candidate["decision"]; fallback?: number }) {
  if (decision === "aprovada") return <Check size={14} />;
  if (decision === "rejeitada") return <X size={14} />;
  if (decision === "erro") return <AlertTriangle size={14} />;
  return fallback ?? <Clock3 size={14} />;
}

function ReviewLoading({ review }: { review: Review }) { return <div className="review-loading"><span className="review-loader"><BrainCircuit size={25} /><i /></span><h3>Curador examinando a fonte</h3><p>Esta tarefa ocorre em segundo plano. Você pode sair desta página.</p><div className="progress-list">{review.progress.slice(-4).map((item, index) => <span key={`${item}-${index}`}><Clock3 size={12} />{item}</span>)}</div></div>; }
function ReviewStatus({ status }: { status: Review["status"] }) { return <span className={`review-status ${status}`}>{status === "analisando" || status === "na_fila" ? <LoaderCircle size={11} className="spin-icon" /> : null}{({ na_fila: "na fila", analisando: "analisando", revisao: "revisar", concluida: "concluída", erro: "erro" } as const)[status]}</span>; }
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="empty-state"><div><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{text}</p></div></div>; }
function pendingTotal(reviews: Review[]) { return reviews.reduce((total, review) => total + review.candidates.filter((item) => item.decision === "pendente" || item.decision === "erro").length, 0); }
function friendlySession(id: string) { const [start, , end] = id.split("_"); return end ? `${start} → ${end}` : id; }
function formatReviewStatus(review: Review) { return review.status === "analisando" ? review.progress.at(-1) ?? "Analisando…" : review.status === "na_fila" ? "Aguardando o curador" : "Nenhuma proposta"; }
