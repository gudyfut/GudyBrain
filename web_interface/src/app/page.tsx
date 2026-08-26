import Link from "next/link";
import { ArrowRight, Bot, BrainCircuit, Clock3, MessageCircleMore, Radio, Sparkles } from "lucide-react";
import { listCalls } from "../server/calls";
import { listMemories } from "../server/memory";
import { listReviews } from "../server/curation";
import { ownerDisplayName } from "../server/settings";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const calls = listCalls();
  const memories = listMemories();
  const reviews = listReviews();
  const nome = ownerDisplayName();
  const pending = reviews.reduce((total, review) => total + review.candidates.filter((item) => item.decision === "pendente").length, 0);
  const latestCall = calls[0];
  return (
    <div className="page dashboard-page">
      <header className="page-header hero-header">
        <div><span className="eyebrow"><Sparkles size={14} /> Central do Gudman</span><h1>{nome ? `Bom te ver, ${nome}.` : "Bom te ver."}</h1><p>Converse, transforme evidências em memória e acompanhe suas calls em um só lugar.</p></div>
        <Link href="/chat" className="button primary"><MessageCircleMore size={17} /> Conversar com Gudman</Link>
      </header>
      <section className="metric-grid" aria-label="Resumo do sistema">
        <Link href="/memory" className="metric-card"><span className="metric-icon violet"><BrainCircuit size={20} /></span><div><strong>{memories.length}</strong><span>memórias cadastradas</span></div><ArrowRight size={17} /></Link>
        <Link href="/memory?tab=review" className="metric-card"><span className="metric-icon amber"><Clock3 size={20} /></span><div><strong>{pending}</strong><span>propostas aguardando</span></div><ArrowRight size={17} /></Link>
        <Link href="/calls" className="metric-card"><span className="metric-icon cyan"><Radio size={20} /></span><div><strong>{calls.length}</strong><span>calls no histórico</span></div><ArrowRight size={17} /></Link>
      </section>
      <section className="dashboard-grid">
        <div className="panel quick-panel">
          <div className="section-heading"><div><span className="eyebrow">Começar</span><h2>Ações rápidas</h2></div></div>
          <div className="quick-actions">
            <Link href="/chat" className="quick-action"><span><MessageCircleMore size={20} /></span><div><strong>Nova conversa</strong><small>Fale com Gudman com acesso à memória</small></div><ArrowRight size={17} /></Link>
            <Link href="/discord" className="quick-action"><span><Bot size={20} /></span><div><strong>Gravar uma call</strong><small>Ligue o bot e controle a captura</small></div><ArrowRight size={17} /></Link>
            <Link href="/calls" className="quick-action"><span><Radio size={20} /></span><div><strong>Processar calls</strong><small>Transcreva, analise e envie à curadoria</small></div><ArrowRight size={17} /></Link>
          </div>
        </div>
        <div className="panel">
          <div className="section-heading"><div><span className="eyebrow">Atividade recente</span><h2>Última call</h2></div><Link href="/calls" className="text-link">Ver todas</Link></div>
          {latestCall ? <div className="latest-call"><div className="call-orb"><Radio size={22} /></div><div><strong>{latestCall.channel}</strong><span>{latestCall.participants.join(", ") || "Sem participantes identificados"}</span><small>{formatDate(latestCall.startedAt)} · {formatDuration(latestCall.durationSeconds)}</small></div><span className={`stage-badge ${latestCall.stage}`}>{latestCall.stage}</span></div> : <div className="empty-compact">Nenhuma call gravada ainda.</div>}
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "Data desconhecida";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
}
