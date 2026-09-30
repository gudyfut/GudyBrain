"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, BrainCircuit, Crosshair, FileText, Folder, Layers, Maximize2, Minus, Orbit, Plus, Radio, Search, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { graphNodes, initialTrace, reduceTrace, visibleGraphTrace, type RetrievalTrace, type TraceNode } from "./retrieval-state";
import { AtlasPhysics, atlasEdge, type AtlasPoint } from "./atlas-physics";

type AtlasNode = TraceNode & { description?: string };
export interface AtlasMoment { id: string; label: string; phase?: string }
const pct = (value?: number) => value === undefined ? "—" : `${Math.round(value * 100)}%`;
const phases = { gate: "Analisando contexto", search: "Explorando memória", answer: "Formulando resposta", done: "Percurso concluído", error: "Busca interrompida", cancelled: "Busca cancelada" };

export function MemoryAtlas({ trace, moments, selectedId, onSelect, busy }: { trace?: RetrievalTrace; moments: AtlasMoment[]; selectedId: string | null; onSelect: (id: string) => void; busy: boolean }) {
  const [base, setBase] = useState<RetrievalTrace>(initialTrace);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [document, setDocument] = useState<{ path: string; content?: string; error?: string } | null>(null);
  const [quiet, setQuiet] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null);
  const nodeDrag = useRef<{ id: number; path: string; x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const suppressClick = useRef<string | null>(null);
  const pendingCenter = useRef<string | null>(null);
  const initialFit = useRef(false);
  const physics = useRef<AtlasPhysics | null>(null);
  if (!physics.current) physics.current = new AtlasPhysics();
  const frame = useRef<number | null>(null);
  const [positions, setPositions] = useState<Record<string, AtlasPoint>>({});
  const documentRequest = useRef<AbortController | null>(null);
  const live = Boolean(trace && !["done", "cancelled", "error"].includes(trace.phase) && busy);
  const momentIndex = moments.findIndex((moment) => moment.id === selectedId);
  const historical = momentIndex >= 0 && momentIndex < moments.length - 1;
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    void fetch("/api/memory/atlas", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Não foi possível carregar o mapa de memória.");
      const data = await response.json();
      if (!controller.signal.aborted) { setBase(reduceTrace(initialTrace(), { phase: "index", nodes: data.nodes, chars: data.chars })); setLoaded(true); }
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => { setFocus(null); setDocument(null); documentRequest.current?.abort(); }, [selectedId]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFocus(null); setDocument(null); documentRequest.current?.abort(); }
    };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); documentRequest.current?.abort(); };
  }, []);
  // A historical trace owns its snapshot; don't merge today's nodes into yesterday's path.
  const shown = useMemo(() => trace && Object.keys(trace.nodes).length ? trace : { ...base, ...(trace ? { phase: trace.phase } : {}) }, [trace, base]);
  const visible = useMemo(() => visibleGraphTrace(shown, expandedFolders), [shown, expandedFolders]);
  const nodes = useMemo(() => graphNodes(visible, 2100), [visible]);
  const lookup = useMemo(() => new Map(nodes.map((node) => [node.path, node])), [nodes]);
  const center = lookup.get("")?.x ?? 320;
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of Object.values(shown.nodes)) if (node.kind === "file") {
      let parent = node.parent;
      while (parent) { counts.set(parent, (counts.get(parent) ?? 0) + 1); parent = shown.nodes[parent]?.parent ?? ""; }
    }
    return counts;
  }, [shown]);
  const layoutKey = nodes.map((node) => `${node.path}:${node.parent}`).join("|");
  // A câmera usa coordenadas fixas: novos percursos não alteram seu enquadramento.
  const size = 1200;
  const startPhysics = () => {
    if (frame.current !== null) return;
    const tick = () => {
      frame.current = null;
      const moving = physics.current!.step();
      setPositions(physics.current!.positions());
      if (moving) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    physics.current!.sync(nodes.map((node) => ({ path: node.path, parent: node.parent, title: node.title,
      kind: node.kind, x: node.x - center, y: node.y - center })));
    setPositions(physics.current!.positions());
    startPhysics();
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  }, [layoutKey]);
  useEffect(() => {
    const path = pendingCenter.current;
    const node = path && lookup.get(path);
    if (!node) return;
    pendingCenter.current = null;
    setView((old) => ({ ...old, x: -(node.x - center) * old.zoom, y: -(node.y - center) * old.zoom }));
  }, [lookup, center]);
  const location = (path: string): AtlasPoint => positions[path] ?? physics.current!.point(path)
    ?? { x: (lookup.get(path)?.x ?? center) - center, y: (lookup.get(path)?.y ?? center) - center };
  const resetLayout = () => {
    drag.current = null; nodeDrag.current = null;
    physics.current!.reset(); setPositions(physics.current!.positions());
    setView({ x: 0, y: 0, zoom: 1 }); startPhysics();
  };
  const worldPoint = (clientX: number, clientY: number): AtlasPoint | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom };
  };
  const selected = focus === null ? undefined : shown.nodes[focus] as AtlasNode | undefined;
  const all = Object.values(shown.nodes);
  const files = all.filter((node) => node.selected);
  const evaluated = all.filter((node) => node.probability !== undefined);
  const matching = all.filter((node) => node.path && `${node.title} ${node.path} ${(node.aliases ?? []).join(" ")}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const matchingPaths = new Set(matching.map((node) => node.path));
  const activePaths = new Set<string>();
  const finalPaths = new Set<string>();
  for (const node of all) if (node.selected || node.visited || node.path === trace?.active && live) {
    let path = node.path;
    while (path) { activePaths.add(path); if (node.selected) finalPaths.add(path); path = shown.nodes[path]?.parent ?? ""; }
  }
  const changeZoom = (factor: number, anchor = { x: 0, y: 0 }) => setView((old) => {
    const zoom = Math.max(.08, Math.min(5, old.zoom * factor)), ratio = zoom / old.zoom;
    return { zoom, x: anchor.x - (anchor.x - old.x) * ratio, y: anchor.y - (anchor.y - old.y) * ratio };
  });
  const fitGraph = () => {
    const extent = Math.max(1, ...nodes.map((node) => Math.hypot(node.x - center, node.y - center)));
    setView({ x: 0, y: 0, zoom: Math.max(.08, Math.min(1, 445 / (extent + 110))) });
  };
  useEffect(() => {
    if (!loaded || initialFit.current || nodes.length < 2) return;
    initialFit.current = true;
    fitGraph();
  }, [loaded, layoutKey]);
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const matrix = el.getScreenCTM(); if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      changeZoom(Math.exp(-event.deltaY * .0015), point);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const inspect = (path: string) => { setFocus(path); setDocument(null); documentRequest.current?.abort(); };
  const toggleFolder = (path: string) => setExpandedFolders((old) => {
    const next = new Set(old);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const readDocument = async () => {
    if (!selected || selected.kind !== "file") return;
    documentRequest.current?.abort(); const controller = new AbortController(); documentRequest.current = controller;
    setDocument({ path: selected.path });
    try {
      const response = await fetch(`/api/memory?path=${encodeURIComponent(selected.path)}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível abrir este documento.");
      const result = await response.json();
      if (!controller.signal.aborted) setDocument({ path: selected.path, content: result.content });
    } catch (error) { if (!controller.signal.aborted) setDocument({ path: selected.path, error: error instanceof Error ? error.message : "Erro de leitura." }); }
  };
  return <section className={`memory-atlas ${live ? "is-live" : ""} ${quiet ? "is-quiet" : ""}`} aria-label="Atlas interativo da memória">
    <div className="atlas-atmosphere" aria-hidden="true"><div className="atlas-nebula" /><div className="atlas-grid" /><div className="atlas-dust" /></div>
    <header className="atlas-heading"><div className="atlas-eyebrow"><span /> GUDMAN / NEURAL INTERFACE</div><h1>Memória em órbita<span>.</span></h1><p>{historical ? "Um instante da conversa, preservado no mapa." : "Conexões que dão contexto à sua conversa."}</p></header>
    <div className="atlas-status" role="status"><Radio size={13} /><span>{historical ? "HISTÓRICO" : live ? "AO VIVO" : trace?.phase === "error" || trace?.phase === "cancelled" ? "INTERROMPIDO" : "NÚCLEO ONLINE"}</span><i />{trace ? phases[trace.phase] : loaded ? "Pronto para conectar" : "Carregando mapa"}</div>
    <div className="atlas-viewport">
      <svg ref={svg} className="atlas-svg" viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} tabIndex={0} role="group" aria-label="Mapa de memória; arraste para mover, use a roda para zoom" onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key.startsWith("Arrow")) { event.preventDefault(); setView((old) => ({ ...old, x: old.x + (event.key === "ArrowRight" ? -40 : event.key === "ArrowLeft" ? 40 : 0), y: old.y + (event.key === "ArrowDown" ? -40 : event.key === "ArrowUp" ? 40 : 0) })); }
        if (event.key === "+" || event.key === "=") changeZoom(1.2);
        if (event.key === "-") changeZoom(1 / 1.2);
        if (event.key === "Home") resetLayout();
      }} onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest(".atlas-node")) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, px: view.x, py: view.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const gesture = drag.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = size / Math.min(rect.width, rect.height);
        const next = { x: gesture.px + (event.clientX - gesture.x) * ratio, y: gesture.py + (event.clientY - gesture.y) * ratio };
        setView((old) => ({ ...old, ...next }));
      }} onPointerUp={(event) => { if (drag.current?.id === event.pointerId) drag.current = null; }}
      onPointerCancel={(event) => { if (drag.current?.id === event.pointerId) drag.current = null; }}
      onLostPointerCapture={(event) => { if (drag.current?.id === event.pointerId) drag.current = null; }}>
        <defs><radialGradient id="atlas-core-fill"><stop stopColor="#93fff0" stopOpacity=".28" /><stop offset="1" stopColor="#12384b" stopOpacity=".5" /></radialGradient><radialGradient id="atlas-aura"><stop stopColor="#63e9df" stopOpacity=".12" /><stop offset="1" stopColor="#63e9df" stopOpacity="0" /></radialGradient></defs>
        <g className="atlas-camera" transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <circle r={Math.max(240, center * .75)} fill="url(#atlas-aura)" />
          {[170, 340, 510, 680].filter((r) => r < center).map((r) => <circle className="atlas-ring" key={r} r={r} />)}
          <g className="atlas-compass" style={{ transformOrigin: "0px 0px" }}><circle r="104" /><circle r="116" /></g>
          {nodes.filter((node) => node.path).map((node) => {
            const parent = lookup.get(node.parent); if (!parent) return null;
            const d = atlasEdge(location(parent.path), location(node.path));
            return <g key={`edge-${node.path}`} data-path={node.path} className={`atlas-link ${activePaths.has(node.path) ? "chosen" : ""} ${finalPaths.has(node.path) ? "final-path" : ""}`}><path d={d} />{activePaths.has(node.path) && live && <path className="atlas-signal" d={d} />}</g>;
          })}
          <g className={`atlas-core ${live ? "active" : ""}`}>
            <circle className="atlas-core-pulse" r="80" /><circle className="atlas-core-pulse second" r="80" /><circle r="74" fill="url(#atlas-core-fill)" /><circle className="atlas-core-inner" r="61" />
            <BrainCircuit x="-23" y="-34" width="46" height="46" /><text y="34" textAnchor="middle">GUDMAN</text><text className="atlas-core-sub" y="49" textAnchor="middle">{live ? "PROCESSANDO" : "MEMORY CORE"}</text>
          </g>
          {nodes.filter((node) => node.path).map((node) => {
            const point = location(node.path);
            return <g key={node.path} className={`atlas-node ${node.kind} ${node.selected ? "selected" : activePaths.has(node.path) ? "visited" : ""} ${focus === node.path ? "focused" : ""} ${filter && !matchingPaths.has(node.path) ? "dimmed" : ""}`} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={`${node.title}, ${node.selected ? "selecionado" : "inspecionar memória"}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault(); event.stopPropagation();
                const origin = worldPoint(event.clientX, event.clientY);
                if (!origin) return;
                const at = location(node.path);
                nodeDrag.current = { id: event.pointerId, path: node.path, x: origin.x, y: origin.y, px: at.x, py: at.y, moved: false };
                physics.current!.grab(node.path);
                event.currentTarget.setPointerCapture(event.pointerId);
              }} onPointerMove={(event) => {
                const gesture = nodeDrag.current;
                if (!gesture || gesture.id !== event.pointerId || gesture.path !== node.path) return;
                event.stopPropagation();
                const at = worldPoint(event.clientX, event.clientY);
                if (!at) return;
                if (Math.hypot(at.x - gesture.x, at.y - gesture.y) > 5) gesture.moved = true;
                if (gesture.moved) {
                  physics.current!.move(node.path, gesture.px + at.x - gesture.x, gesture.py + at.y - gesture.y);
                  setPositions(physics.current!.positions()); startPhysics();
                }
              }} onPointerUp={(event) => {
                if (nodeDrag.current?.id !== event.pointerId) return;
                suppressClick.current = nodeDrag.current.moved ? node.path : null;
                nodeDrag.current = null; physics.current!.release(); startPhysics(); event.stopPropagation();
              }} onPointerCancel={(event) => {
                if (nodeDrag.current?.id !== event.pointerId) return;
                nodeDrag.current = null; physics.current!.release(); startPhysics(); event.stopPropagation();
              }} onLostPointerCapture={(event) => {
                if (nodeDrag.current?.id !== event.pointerId) return;
                nodeDrag.current = null; physics.current!.release(); startPhysics();
              }} onClick={() => {
                if (suppressClick.current === node.path) { suppressClick.current = null; return; }
                inspect(node.path);
                if (node.kind === "folder") toggleFolder(node.path);
              }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(node.path); if (node.kind === "folder") toggleFolder(node.path); } }}>
            <title>{node.title} · {pct(node.probability)} relevância</title><circle className="atlas-node-halo" r="30" /><circle r={node.kind === "folder" ? 18 : 12} />{node.kind === "folder" ? <Folder x="-8" y="-8" width="16" height="16" /> : <circle className="atlas-node-dot" r="3" />}
            <rect className="atlas-node-label" x={-Math.min(182, Math.max(92, Math.min(23, node.title.length) * 7.4 + 22)) / 2} y="25" width={Math.min(182, Math.max(92, Math.min(23, node.title.length) * 7.4 + 22))} height={node.kind === "folder" ? 65 : node.probability === undefined ? 31 : 48} rx="9" />
            <text textAnchor="middle" y="44">{node.title.length > 23 ? node.title.slice(0, 22) + "…" : node.title}</text>{node.probability !== undefined && <text className="atlas-node-percent" textAnchor="middle" y="61">{pct(node.probability)}</text>}{node.kind === "folder" && <text className="atlas-node-count" textAnchor="middle" y={node.probability === undefined ? 63 : 78}>{childCounts.get(node.path) ?? 0} memórias · {expandedFolders.has(node.path) ? "recolher" : "explorar"}</text>}
          </g>; })}
        </g>
      </svg>
    </div>
    <div className="atlas-controls"><button aria-label="Diminuir grafo" onClick={() => changeZoom(1 / 1.2)}><Minus size={15} /></button><button aria-label="Restaurar zoom" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>{Math.round(view.zoom * 100)}%</button><button aria-label="Aumentar grafo" onClick={() => changeZoom(1.2)}><Plus size={15} /></button><span /><button aria-label="Enquadrar ramificações visíveis" onClick={fitGraph}><Maximize2 size={15} /></button><button aria-label="Centralizar núcleo e restaurar posições" onClick={resetLayout}><Crosshair size={16} /></button><button aria-label="Reduzir animações ambientes" aria-pressed={quiet} onClick={() => setQuiet(!quiet)}><Orbit size={16} /></button></div>
    <aside className="atlas-telemetry">
      <div className="atlas-panel-label"><Activity size={12} /> TELEMETRIA DE CONTEXTO</div>
      <div className="atlas-decision"><div><small>ACESSAR MEMÓRIA PROFUNDA</small><strong>{!trace || trace.probability === undefined ? "EM ESPERA" : (trace.gateSearched ?? trace.searched) ? "SIM" : "NÃO"}</strong></div><b>{pct(trace?.probability)}<small>relevância Jev</small></b></div>
      <div className="atlas-meter"><i style={{ width: `${(trace?.probability ?? 0) * 100}%` }} /></div>
      <p>{trace?.gateReason ?? "Envie uma mensagem para acompanhar as decisões e os caminhos percorridos."}</p>
      {trace?.probability !== undefined && <small>Limiar de busca: {pct(trace.threshold ?? .5)}</small>}
      <div className="atlas-counts"><div><b>{nodes.length - 1}<small> / {all.filter((node) => node.path).length}</small></b><small>visíveis / total</small></div><div><b>{evaluated.length}</b><small>avaliados</small></div><div><b>{files.length}</b><small>integrais</small></div></div>
      {!!trace?.requests?.length && <p className="atlas-notice">O conversador solicitou {trace.requests.reduce((n, item) => n + item.paths.length, 0)} leitura(s) complementar(es).</p>}
      {trace?.limited && <p className="atlas-warning">Contexto parcial: houve limite de busca ou leitura.</p>}
      {trace && <details className="atlas-steps"><summary>Percurso · {trace.visits.length} pastas</summary><ol>{trace.visits.map((path) => <li key={path}><button onClick={() => inspect(path)}>{shown.nodes[path]?.title ?? (path || "Núcleo")}</button></li>)}</ol></details>}
      <div className="atlas-legend"><span><i /> No índice</span><span><i /> Percorrido</span><span><i /> Caminho final</span></div><div className="atlas-disclaimer">Estimativas de relevância, não certeza factual.</div>
    </aside>
    <div className="atlas-find"><button className="atlas-search-trigger" aria-label="Abrir busca de memórias" onClick={() => searchInput.current?.focus()}><Search size={14} /></button><input ref={searchInput} aria-label="Localizar memória no grafo" placeholder="Localizar uma memória…" value={filter} onChange={(event) => setFilter(event.target.value)} />{filter && <button aria-label="Limpar filtro" onClick={() => setFilter("")}><X size={13} /></button>}{filter && <div className="atlas-results">{matching.slice(0, 30).map((node) => <button key={node.path} onClick={() => { inspect(node.path); if (node.kind === "file") setExpandedFolders((old) => new Set(old).add(node.parent)); pendingCenter.current = node.path; setFilter(""); }}><span>{node.title}</span><small>{pct(node.probability)}</small></button>)}{!matching.length && <p>Nenhuma memória encontrada.</p>}{matching.length > 30 && <p>Refine a busca para ver mais resultados.</p>}</div>}</div>
    {loadError && <div className="atlas-load-error" role="alert">{loadError}<button onClick={() => setRetry((n) => n + 1)}>Tentar novamente</button></div>}
    {selected && <aside className="atlas-inspector" key={`${selectedId}-${selected.path}`} aria-label="Detalhes da memória"><header><span>{selected.kind === "folder" ? <Folder size={15} /> : <FileText size={15} />} {selected.kind === "folder" ? "RAMIFICAÇÃO" : "REGISTRO DE MEMÓRIA"}</span><button aria-label="Fechar detalhes" onClick={() => { setFocus(null); documentRequest.current?.abort(); setDocument(null); }}><X size={16} /></button></header><h2>{selected.title}</h2><code>{selected.path || "memory/"}</code>{selected.description && <p>{selected.description}</p>}{selected.aliases?.length ? <div className="atlas-aliases">{selected.aliases.map((alias) => <span key={alias}>{alias}</span>)}</div> : null}<div className="atlas-inspect-score"><b>{pct(selected.probability)}</b><span>{selected.probability === undefined ? "Não avaliado pelo Jev neste percurso" : "Relevância estimada neste percurso"}</span></div><p>{selected.reason ?? (selected.selected ? "Documento integral incluído no contexto." : selected.visited ? "Ramificação explorada." : "Disponível no índice de memória.")}</p>{selected.selected && <p className="atlas-notice">{selected.chars?.toLocaleString("pt-BR")} caracteres integrais · {selected.source === "conversador" ? "solicitado pelo conversador" : selected.source === "identity" ? "nome/apelido identificado" : "selecionado pelo Jev"}</p>}{selected.omitted && <p className="atlas-warning">{selected.omitted}</p>}{selected.kind === "folder" && <button className="atlas-read" onClick={() => toggleFolder(selected.path)}>{expandedFolders.has(selected.path) ? "Recolher memórias" : `Explorar ${childCounts.get(selected.path) ?? 0} memórias`} <ArrowRight size={14} /></button>}{selected.kind === "file" && <button className="atlas-read" onClick={() => void readDocument()}>Abrir documento atual <ArrowRight size={14} /></button>}{document?.path === selected.path && <div className="atlas-document"><small>VERSÃO ATUAL · a leitura aqui não altera o contexto da resposta anterior.</small>{document.error ? <p role="alert">{document.error}</p> : document.content !== undefined ? <ReactMarkdown>{document.content}</ReactMarkdown> : <p>Carregando documento…</p>}</div>}</aside>}
    <footer className="atlas-bottom"><div className="atlas-coordinate"><Layers size={12} /> {trace ? historical ? "PERCURSO / HISTÓRICO" : "CONTEXTO / SESSÃO" : "ÍNDICE / MEMÓRIA VIVA"}<span>ARRASTE PARA EXPLORAR · SCROLL PARA ZOOM</span></div>{moments.length > 0 && <div className="atlas-timeline"><button aria-label="Percurso anterior" disabled={momentIndex <= 0} onClick={() => onSelect(moments[momentIndex - 1]!.id)}><ArrowLeft size={14} /></button><span>{String(momentIndex + 1).padStart(2, "0")} / {String(moments.length).padStart(2, "0")}</span><p>{moments[momentIndex]?.label ?? "Conversa"}</p><button aria-label="Próximo percurso" disabled={momentIndex >= moments.length - 1} onClick={() => onSelect(moments[momentIndex + 1]!.id)}><ArrowRight size={14} /></button>{historical && <button className="atlas-return" onClick={() => onSelect(moments.at(-1)!.id)}>Última busca <Radio size={12} /></button>}</div>}</footer>
  </section>;
}
